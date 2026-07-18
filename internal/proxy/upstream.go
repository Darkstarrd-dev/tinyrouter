package proxy

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/tinyrouter/tinyrouter/internal/combo"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
)

// normalizeBaseURL strips known endpoint suffixes so the URL ends at the API root.
// e.g. "https://api.example.com/v1/chat/completions" → "https://api.example.com/v1"
//
//	"https://api.example.com/v1/models"            → "https://api.example.com/v1"
func normalizeBaseURL(baseURL string) string {
	baseURL = strings.TrimSuffix(baseURL, "/")
	for _, suffix := range []string{"/chat/completions", "/completions", "/models", "/images/generations"} {
		if strings.HasSuffix(baseURL, suffix) {
			baseURL = baseURL[:len(baseURL)-len(suffix)]
			break
		}
	}
	return baseURL
}

// BuildUpstreamURL constructs the full upstream URL from a base URL and an endpoint path.
// endpointPath is like "/v1/chat/completions" or "/v1/models".
//
// Three base URL forms are supported:
//   - Raw mode: a trailing '*' means the trimmed prefix is the exact endpoint and is
//     returned unchanged (no normalization or suffix handling).
//   - Host root (no path): the "/v1" prefix is injected and the full endpointPath is
//     appended, preserving backwards compatibility with old configs.
//   - Path-bearing base (e.g. ".../v1beta/openai"): the "/v1" prefix of endpointPath is
//     stripped and the remaining suffix is appended directly.
func BuildUpstreamURL(baseURL, endpointPath string) string {
	trimmed := strings.TrimSpace(baseURL)

	// 1) Raw mode: trailing '*' marks the prefix as the complete endpoint.
	if strings.HasSuffix(trimmed, "*") {
		return strings.TrimRight(strings.TrimSuffix(trimmed, "*"), "/")
	}

	normalized := normalizeBaseURL(trimmed)
	suffix := strings.TrimPrefix(endpointPath, "/v1") // "/v1/chat/completions" -> "/chat/completions"

	// 2) Host root (no path) -> inject "/v1" then append the full endpointPath.
	if isHostRoot(normalized) {
		return normalized + endpointPath
	}

	// 3) Path-bearing base -> append the suffix directly.
	return normalized + suffix
}

// isHostRoot reports whether base has no path beyond the host (e.g. "https://api.deepseek.com").
func isHostRoot(base string) bool {
	u, err := url.Parse(base)
	if err != nil {
		return false
	}
	return u.Path == "" || u.Path == "/"
}

func (h *Handler) forwardUpstream(ctx context.Context, sel *rotation.SelectedKey, body []byte, headers http.Header, isStream bool, path string, entryFormat combo.EntryFormat) (*http.Response, error) {
	var upstreamURL string
	var req *http.Request
	var err error

	// The upstream construction is chosen by the entry protocol, not by the
	// provider's APIType. A single aggregating provider may serve both the
	// anthropic (/v1/messages) and OpenAI (/v1/chat/completions) entry points,
	// so we must route by entryFormat rather than rejecting on provider type.
	switch {
	case entryFormat == combo.EntryFormatAnthropic:
		upstreamURL, req, err = buildAnthropicUpstreamRequest(ctx, sel, body, headers, isStream)
	case entryFormat == combo.EntryFormatOpenAIResponses:
		upstreamURL, req, err = buildResponsesUpstreamRequest(ctx, sel, body, isStream)
	default:
		upstreamURL = BuildUpstreamURL(sel.Provider.BaseURL, path)
		req, err = http.NewRequestWithContext(ctx, "POST", upstreamURL, strings.NewReader(string(body)))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+sel.Key.Key)
	}

	if err != nil {
		return nil, err
	}

	// OpenAI-specific passthrough headers (harmless for anthropic; anthropic
	// ignores them and they never include an Authorization for anthropic since
	// the branch above sets x-api-key instead).
	if ua := headers.Get("User-Agent"); ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	if am := headers.Get("X-Modelscope-Async-Mode"); am != "" {
		req.Header.Set("X-Modelscope-Async-Mode", am)
	}
	if tt := headers.Get("X-Modelscope-Task-Type"); tt != "" {
		req.Header.Set("X-Modelscope-Task-Type", tt)
	}
	if isStream {
		req.Header.Set("Accept", "text/event-stream")
	}

	var httpClient *http.Client
	if sel.Provider.UseProxy {
		if pu, _ := h.proxyURL.Load().(*url.URL); pu != nil {
			httpClient = h.proxyClient
		} else {
			httpClient = h.client
		}
	} else {
		httpClient = h.client
	}
	if isStream {
		if httpClient == h.proxyClient {
			return h.proxyStream.Do(req)
		}
		return h.streamClient.Do(req)
	}
	return httpClient.Do(req)
}

// buildAnthropicUpstreamRequest constructs an upstream POST request for a
// provider speaking the Anthropic Messages API. It differs from the OpenAI path
// in two ways:
//
//   - URL: the /v1 prefix is NOT injected. The provider BaseURL is expected to
//     already be the complete endpoint (e.g. "https://api.anthropic.com/v1/
//     messages"). If the BaseURL ends with "/v1/messages" it is used verbatim;
//     otherwise "/v1/messages" is appended to the base (host-root) form. Raw
//     mode (BaseURL ending in "*") is honored unchanged, like the OpenAI path.
//   - Auth: instead of "Authorization: Bearer <key>", it sets "x-api-key: <key>"
//     plus "anthropic-version" (default "2023-06-01") and, when configured,
//     "anthropic-beta". No Authorization header is set.
func buildAnthropicUpstreamRequest(ctx context.Context, sel *rotation.SelectedKey, body []byte, headers http.Header, isStream bool) (string, *http.Request, error) {
	// Raw mode: a trailing '*' marks the prefix as the complete endpoint.
	trimmed := strings.TrimSpace(sel.Provider.BaseURL)
	if strings.HasSuffix(trimmed, "*") {
		upstreamURL := strings.TrimRight(strings.TrimSuffix(trimmed, "*"), "/")
		req, err := http.NewRequestWithContext(ctx, "POST", upstreamURL, strings.NewReader(string(body)))
		if err != nil {
			return "", nil, err
		}
		setAnthropicHeaders(req, sel)
		return upstreamURL, req, nil
	}

	// Complete-endpoint form: BaseURL already contains "/v1/messages".
	trimmed = strings.TrimSuffix(trimmed, "/")
	var upstreamURL string
	if strings.HasSuffix(trimmed, "/v1/messages") {
		upstreamURL = trimmed
	} else {
		// Host-root / path-bearing base: append the fixed endpoint path.
		upstreamURL = trimmed + "/v1/messages"
	}

	req, err := http.NewRequestWithContext(ctx, "POST", upstreamURL, strings.NewReader(string(body)))
	if err != nil {
		return "", nil, err
	}
	setAnthropicHeaders(req, sel)
	return upstreamURL, req, nil
}

// setAnthropicHeaders applies the Content-Type and Anthropic-specific auth
// headers to an outgoing upstream request. No Authorization header is set.
func setAnthropicHeaders(req *http.Request, sel *rotation.SelectedKey) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", sel.Key.Key)
	version := sel.Provider.AnthropicVersion
	if version == "" {
		version = "2023-06-01"
	}
	req.Header.Set("anthropic-version", version)
	if sel.Provider.AnthropicBeta != "" {
		req.Header.Set("anthropic-beta", sel.Provider.AnthropicBeta)
	}
}

// buildResponsesUpstreamRequest constructs an upstream POST request for a
// provider speaking the OpenAI Responses API (/v1/responses). It mirrors the
// Anthropic builder in that the /v1 prefix is NOT injected by BuildUpstreamURL
// (which would mangle a BaseURL that already contains /v1/responses into
// /v1/v1/responses); instead the endpoint is resolved here:
//
//   - Raw mode: a trailing '*' means the trimmed prefix is the complete endpoint
//     and is returned unchanged.
//   - Complete-endpoint form: BaseURL already ends with "/v1/responses" → used
//     verbatim.
//   - Host-root / path-bearing base: "/v1/responses" is appended.
//
// Auth uses the standard "Authorization: Bearer <key>" header (NOT x-api-key),
// mirroring the OpenAI chat entry. No anthropic-version / anthropic-beta headers
// are set.
func buildResponsesUpstreamRequest(ctx context.Context, sel *rotation.SelectedKey, body []byte, isStream bool) (string, *http.Request, error) {
	// Raw mode: a trailing '*' marks the prefix as the complete endpoint.
	trimmed := strings.TrimSpace(sel.Provider.BaseURL)
	if strings.HasSuffix(trimmed, "*") {
		upstreamURL := strings.TrimRight(strings.TrimSuffix(trimmed, "*"), "/")
		req, err := http.NewRequestWithContext(ctx, "POST", upstreamURL, strings.NewReader(string(body)))
		if err != nil {
			return "", nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+sel.Key.Key)
		return upstreamURL, req, nil
	}

	// Complete-endpoint form: BaseURL already contains "/v1/responses".
	trimmed = strings.TrimSuffix(trimmed, "/")
	var upstreamURL string
	if strings.HasSuffix(trimmed, "/v1/responses") {
		upstreamURL = trimmed
	} else {
		// Host-root / path-bearing base: append the fixed endpoint path.
		upstreamURL = trimmed + "/v1/responses"
	}

	req, err := http.NewRequestWithContext(ctx, "POST", upstreamURL, strings.NewReader(string(body)))
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+sel.Key.Key)
	return upstreamURL, req, nil
}

func (h *Handler) forwardGetUpstream(ctx context.Context, sel *rotation.SelectedKey, path string, headers http.Header) (*http.Response, error) {
	upstreamURL := BuildUpstreamURL(sel.Provider.BaseURL, path)
	req, err := http.NewRequestWithContext(ctx, "GET", upstreamURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+sel.Key.Key)
	if ua := headers.Get("User-Agent"); ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	if tt := headers.Get("X-Modelscope-Task-Type"); tt != "" {
		req.Header.Set("X-Modelscope-Task-Type", tt)
	}
	return h.client.Do(req)
}
