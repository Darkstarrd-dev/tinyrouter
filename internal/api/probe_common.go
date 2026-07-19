package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Protocol identifiers (mirror config.Protocol* constants; defined locally so
// probe helpers can be referenced without importing config in callers that only
// need the literal values).
const (
	probeProtocolOpenAICompat    = "openai-compat"
	probeProtocolOpenAIResponses = "openai-responses"
	probeProtocolAnthropic       = "anthropic"
)

// ProbeResult is the outcome of probing a single protocol entry point for a model.
type ProbeResult struct {
	Protocol        string         // "openai-compat" / "openai-responses" / "anthropic"
	Ok              bool           // resp.StatusCode == 200 and body has no error field
	Status          int            // HTTP status code
	LatencyMs       int64          // round-trip latency in milliseconds
	Error           string         // human-readable error (empty on success)
	Request         map[string]any // {method, url, headers, body, bodyRaw}
	ResponseHeaders map[string][]string
	ResponseBody    any // JSON-parsed response body; nil if not parseable
	ResponseBodyRaw string
	Skipped         bool // true if the probe was skipped (e.g. no key available)
}

// probeQuotaHook is invoked (when non-nil) on a successful probe so the caller
// can extract quota info from the response headers. It is intentionally decoupled
// from the probe helpers so the helpers remain testable with a mocked upstream
// without requiring a Registry/quotaTracker.
type probeQuotaHook func(model string, resp *http.Response)

// probeOpenAICompat sends an /v1/chat/completions probe request (OpenAI Chat
// Completions compatible). Body: {model, messages:[{role:"user",content:"hi"}],
// max_tokens:16, stream:false}. Auth: Authorization: Bearer <key>.
func probeOpenAICompat(ctx context.Context, client *http.Client, baseURL, model, apiKey string, onOK probeQuotaHook) ProbeResult {
	const path = "/v1/chat/completions"
	url := buildProbeURL(baseURL, path)
	body := map[string]any{
		"model":      model,
		"messages":   []map[string]any{{"role": "user", "content": "hi"}},
		"max_tokens": 16,
		"stream":     false,
	}
	return doProbe(ctx, client, probeProtocolOpenAICompat, http.MethodPost, url, "application/json", "Authorization", "Bearer "+apiKey, body, onOK)
}

// probeOpenAIResponses sends an /v1/responses probe request (OpenAI Responses API).
// Body: {model, input:[{role:"user",content:"hi"}], max_output_tokens:16, stream:false}.
// Auth: Authorization: Bearer <key>.
func probeOpenAIResponses(ctx context.Context, client *http.Client, baseURL, model, apiKey string, onOK probeQuotaHook) ProbeResult {
	const path = "/v1/responses"
	url := buildProbeURL(baseURL, path)
	body := map[string]any{
		"model":             model,
		"input":             []map[string]any{{"role": "user", "content": "hi"}},
		"max_output_tokens": 16,
		"stream":            false,
	}
	return doProbe(ctx, client, probeProtocolOpenAIResponses, http.MethodPost, url, "application/json", "Authorization", "Bearer "+apiKey, body, onOK)
}

// probeAnthropic sends an /v1/messages probe request (Anthropic Messages API).
// Body: {model, max_tokens:16, messages:[{role:"user",content:"hi"}], stream:false}.
// Auth: x-api-key: <key> + anthropic-version: 2023-06-01.
func probeAnthropic(ctx context.Context, client *http.Client, baseURL, model, apiKey string, onOK probeQuotaHook) ProbeResult {
	const path = "/v1/messages"
	url := buildAnthropicURL(baseURL, path)
	body := map[string]any{
		"model":      model,
		"max_tokens": 16,
		"messages":   []map[string]any{{"role": "user", "content": "hi"}},
		"stream":     false,
	}
	return doProbe(ctx, client, probeProtocolAnthropic, http.MethodPost, url, "application/json", "x-api-key", apiKey, body, onOK, "anthropic-version", "2023-06-01")
}

// normalizeProbeBaseURL strips known endpoint suffixes so the URL ends at the
// API root. Examples:
//
//	"https://example.com/v1/chat/completions" → "https://example.com"
//	"https://example.com/v1/responses"        → "https://example.com"
//	"https://example.com/v1/messages"         → "https://example.com"
//	"https://example.com/v1/models"           → "https://example.com"
//	"https://example.com/v1/images/generations" → "https://example.com"
func normalizeProbeBaseURL(baseURL string) string {
	baseURL = strings.TrimSpace(baseURL)
	baseURL = strings.TrimSuffix(baseURL, "/")
	for _, suffix := range []string{
		"/v1/chat/completions",
		"/chat/completions",
		"/completions",
		"/v1/responses",
		"/responses",
		"/v1/messages",
		"/messages",
		"/v1/models",
		"/models",
		"/v1/images/generations",
		"/images/generations",
	} {
		if strings.HasSuffix(baseURL, suffix) {
			baseURL = baseURL[:len(baseURL)-len(suffix)]
			break
		}
	}
	return baseURL
}

// buildProbeURL constructs the OpenAI-style upstream URL from a base URL and an
// endpoint path. It mirrors proxy.BuildUpstreamURL but avoids depending on the
// proxy package's normalization: it supports raw mode (trailing '*'),
// complete-endpoint form, and host-root/path-bearing append.
func buildProbeURL(baseURL, endpointPath string) string {
	trimmed := strings.TrimSpace(baseURL)
	if strings.HasSuffix(trimmed, "*") {
		return strings.TrimRight(strings.TrimSuffix(trimmed, "*"), "/")
	}
	trimmed = normalizeProbeBaseURL(trimmed)
	trimmed = strings.TrimSuffix(trimmed, "/")
	if strings.HasSuffix(trimmed, endpointPath) {
		return trimmed
	}
	return trimmed + endpointPath
}

// buildAnthropicURL constructs the Anthropic /v1/messages upstream URL. The /v1
// prefix is NOT injected: BaseURL is treated as the complete endpoint when it
// already ends with the path, otherwise the path is appended. Raw mode (trailing
// '*') is honored verbatim.
func buildAnthropicURL(baseURL, endpointPath string) string {
	trimmed := strings.TrimSpace(baseURL)
	if strings.HasSuffix(trimmed, "*") {
		return strings.TrimRight(strings.TrimSuffix(trimmed, "*"), "/")
	}
	trimmed = normalizeProbeBaseURL(trimmed)
	trimmed = strings.TrimSuffix(trimmed, "/")
	if strings.HasSuffix(trimmed, endpointPath) {
		return trimmed
	}
	return trimmed + endpointPath
}

// doProbe performs a single JSON POST probe and normalizes the result into a
// ProbeResult. authKey/authVal set the primary auth header; extraHeaders is a
// variadic list of additional header key/value pairs.
func doProbe(ctx context.Context, client *http.Client, protocol, method, url, contentType, authKey, authVal string, body map[string]any, onOK probeQuotaHook, extraHeaders ...string) ProbeResult {
	res := ProbeResult{Protocol: protocol}

	rawBody, err := json.Marshal(body)
	if err != nil {
		res.Error = "failed to encode request: " + err.Error()
		return res
	}
	rawStr := string(rawBody)
	var parsedReqBody any = rawStr
	if j := map[string]any{}; json.Unmarshal(rawBody, &j) == nil {
		parsedReqBody = j
	}

	req, err := http.NewRequestWithContext(ctx, method, url, strings.NewReader(rawStr))
	if err != nil {
		res.Error = "invalid URL: " + err.Error()
		return res
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set(authKey, authVal)
	for i := 0; i+1 < len(extraHeaders); i += 2 {
		req.Header.Set(extraHeaders[i], extraHeaders[i+1])
	}

	start := time.Now()
	resp, err := client.Do(req)
	res.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		res.Error = err.Error()
		res.Status = 0
		safe := redactAuth(req.Header)
		res.Request = map[string]any{
			"method":  method,
			"url":     url,
			"headers": headerToMap(safe),
			"body":    parsedReqBody,
			"bodyRaw": rawStr,
		}
		return res
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	raw := string(respBody)
	var parsedResp any = raw
	if j := map[string]any{}; json.Unmarshal(respBody, &j) == nil {
		parsedResp = j
	}
	res.Status = resp.StatusCode
	res.ResponseHeaders = headerToMap(resp.Header)
	res.ResponseBody = parsedResp
	res.ResponseBodyRaw = raw

	var errMsg string
	statusText := http.StatusText(resp.StatusCode)
	statusCode := strconv.Itoa(resp.StatusCode)
	ok := resp.StatusCode == http.StatusOK
	if !ok {
		errMsg = "upstream returned " + statusText + " (status " + statusCode + ")"
		if e := extractErrorMsg(raw); e != "" {
			errMsg = "upstream returned " + statusText + " (status " + statusCode + "): " + e
		}
	}
	if ok {
		if e := extractErrorMsg(raw); e != "" {
			ok = false
			errMsg = "upstream returned " + statusText + " (status " + statusCode + "): " + e
		}
	}
	res.Ok = ok
	res.Error = errMsg

	if ok && onOK != nil {
		onOK(protocol, resp)
	}

	safe := redactAuth(req.Header)
	res.Request = map[string]any{
		"method":  method,
		"url":     url,
		"headers": headerToMap(safe),
		"body":    parsedReqBody,
		"bodyRaw": rawStr,
	}
	return res
}

// extractErrorMsg pulls a top-level "error.message" (object or string) from a
// raw JSON response body. Returns "" when no error is present.
func extractErrorMsg(raw string) string {
	var errResp map[string]any
	if json.Unmarshal([]byte(raw), &errResp) != nil {
		return ""
	}
	if e, ok := errResp["error"].(map[string]any); ok {
		if msg, ok := e["message"].(string); ok {
			return msg
		}
	} else if e, ok := errResp["error"].(string); ok {
		return e
	}
	return ""
}

// redactAuth returns a clone of h with the auth headers removed before logging.
func redactAuth(h http.Header) http.Header {
	safe := h.Clone()
	safe.Del("Authorization")
	safe.Del("X-Api-Key")
	safe.Del("x-api-key")
	return safe
}

// keyTestResult is the per-key outcome of the "test all keys" batch probe.
type keyTestResult struct {
	KeyID        string  `json:"keyId"`
	KeyName      string  `json:"keyName"`
	Ok           bool    `json:"ok"`
	TTFTMs       int64   `json:"ttftMs"`
	LatencyMs    int64   `json:"latencyMs"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	TokensPerSec float64 `json:"tokensPerSec"`
	Status       int     `json:"status"`
	Error        string  `json:"error,omitempty"`
	QuotaRemain  int     `json:"quotaRemain,omitempty"`
	QuotaTotal   int     `json:"quotaTotal,omitempty"`
}

// testAllKeysPrompt is sent to each key during the "test all keys" batch probe.
const testAllKeysPrompt = "hi"

// extractContentFromSSE extracts the text content (both delta.content and
// delta.reasoning_content) from a single SSE data chunk JSON payload.
func extractContentFromSSE(body []byte) string {
	var resp map[string]any
	if err := json.Unmarshal(body, &resp); err != nil {
		return ""
	}
	choices, ok := resp["choices"].([]any)
	if !ok || len(choices) == 0 {
		return ""
	}
	choice, ok := choices[0].(map[string]any)
	if !ok {
		return ""
	}
	delta, ok := choice["delta"].(map[string]any)
	if !ok {
		return ""
	}
	var sb strings.Builder
	if c, ok := delta["content"].(string); ok {
		sb.WriteString(c)
	}
	if rc, ok := delta["reasoning_content"].(string); ok {
		sb.WriteString(rc)
	}
	return sb.String()
}

// headerToMap converts an http.Header to a map[string][]string,
// preserving multi-value structure without filtering or merging.
func headerToMap(h http.Header) map[string][]string {
	m := make(map[string][]string, len(h))
	for k, v := range h {
		m[k] = v
	}
	return m
}
