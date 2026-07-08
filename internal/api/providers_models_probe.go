package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/util"
)

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

// --- Provider Model Testing ---

// headerToMap converts an http.Header to a map[string][]string,
// preserving multi-value structure without filtering or merging.
func headerToMap(h http.Header) map[string][]string {
	m := make(map[string][]string, len(h))
	for k, v := range h {
		m[k] = v
	}
	return m
}

// testProviderModel tests a specific model by sending a minimal chat completion.
// Request: {model}
// Response: {ok, latencyMs, error?, status?}
func (rt *Router) testProviderModel(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	provider, ok := rt.reg.GetProvider(providerID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}

	var req struct {
		Model string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Model == "" {
		writeAPIError(w, http.StatusBadRequest, "model required")
		return
	}

	key := firstActiveKey(provider)
	if key == nil {
		writeAPIError(w, http.StatusBadRequest, "no active key for this provider")
		return
	}

	chatURL := proxy.BuildUpstreamURL(provider.BaseURL, "/v1/chat/completions")
	type probeReq struct {
		Model     string              `json:"model"`
		Messages  []map[string]string `json:"messages"`
		MaxTokens int                 `json:"max_tokens"`
		Stream    bool                `json:"stream"`
	}
	bodyBytes, err := json.Marshal(probeReq{
		Model:     req.Model,
		Messages:  []map[string]string{{"role": "user", "content": "hi"}},
		MaxTokens: 16,
		Stream:    false,
	})
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to encode request")
		return
	}
	body := string(bodyBytes)
	var parsedReqBody any = body
	var reqJSON map[string]any
	if json.Unmarshal([]byte(body), &reqJSON) == nil {
		parsedReqBody = reqJSON
	}
	req2, err := http.NewRequestWithContext(r.Context(), "POST", chatURL, strings.NewReader(body))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid URL")
		return
	}
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer "+key.Key)

	start := time.Now()
	resp, err := rt.client.Do(req2)
	latencyMs := time.Since(start).Milliseconds()
	if err != nil {
		safeReqHeaders := req2.Header.Clone()
		safeReqHeaders.Del("Authorization")
		safeReqHeaders.Del("X-Api-Key")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"ok":        false,
			"latencyMs": latencyMs,
			"error":     err.Error(),
			"status":    0,
			"request": map[string]any{
				"method":  "POST",
				"url":     chatURL,
				"headers": headerToMap(safeReqHeaders),
				"body":    parsedReqBody,
				"bodyRaw": body,
			},
			"responseHeaders": nil,
			"responseBody":    nil,
		})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	var parsedRespBody any = string(respBody)
	var respJSON map[string]any
	if json.Unmarshal(respBody, &respJSON) == nil {
		parsedRespBody = respJSON
	}

	var errMsg string
	ok = resp.StatusCode == 200
	if !ok {
		errMsg = "upstream returned " + http.StatusText(resp.StatusCode)
		var errResp map[string]any
		if json.Unmarshal(respBody, &errResp) == nil {
			if e, ok := errResp["error"].(map[string]any); ok {
				if msg, ok := e["message"].(string); ok {
					errMsg = msg
				}
			} else if e, ok := errResp["error"].(string); ok {
				errMsg = e
			}
		}
	}

	if ok {
		var respData map[string]any
		if json.Unmarshal(respBody, &respData) == nil {
			if e, ok := respData["error"].(map[string]any); ok {
				if msg, ok := e["message"].(string); ok {
					ok = false
					errMsg = msg
				}
			}
		}
	}

	// Parse quota from upstream response headers (e.g. ModelScope rate-limit headers).
	// Only trust quota when the probe actually succeeded (200 + no error body); a 4xx/5xx
	// (e.g. 402 insufficient_balance) must not populate misleading "remaining" numbers.
	var quotaRemain, quotaTotal int
	if ok {
		adapter := rotation.GetAdapter(*provider)
		if snap := adapter.ParseHeaders(resp.Header); snap != nil {
			quotaRemain = snap.ModelRemaining
			quotaTotal = snap.ModelLimit
			if ks := rt.reg.GetKeyState(providerID, key.ID); ks != nil {
				ks.UpdateQuota(req.Model, snap.ModelLimit, snap.ModelRemaining, snap.GlobalLimit, snap.GlobalRemaining)
			}
			activeKeyCount := 0
			for _, k := range provider.Keys {
				if k.IsActive {
					activeKeyCount++
				}
			}
			rt.quotaTracker.Update(provider.Name, req.Model, key.ID, key.Name, snap.ModelLimit, snap.ModelRemaining, activeKeyCount)
		}
	}

	safeReqHeaders := req2.Header.Clone()
	safeReqHeaders.Del("Authorization")
	safeReqHeaders.Del("X-Api-Key")

	respMap := map[string]any{
		"ok":        ok,
		"latencyMs": latencyMs,
		"error":     errMsg,
		"status":    resp.StatusCode,
		"request": map[string]any{
			"method":  "POST",
			"url":     chatURL,
			"headers": headerToMap(safeReqHeaders),
			"body":    parsedReqBody,
			"bodyRaw": body,
		},
		"responseHeaders": headerToMap(resp.Header),
		"responseBody":    parsedRespBody,
		"responseBodyRaw": string(respBody),
	}
	if quotaTotal > 0 {
		respMap["quotaRemain"] = quotaRemain
		respMap["quotaTotal"] = quotaTotal
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(respMap)
}

// testProviderModelAllKeys tests a model against every active key of a provider (batch probe).
// Request: {model}
// Response: {provider, model, results: [{keyId, keyName, ok, ...}]}
func (rt *Router) testProviderModelAllKeys(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	provider, ok := rt.reg.GetProvider(providerID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}

	var req struct {
		Model string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Model == "" {
		writeAPIError(w, http.StatusBadRequest, "model required")
		return
	}

	activeKeyCount := 0
	for _, k := range provider.Keys {
		if k.IsActive {
			activeKeyCount++
		}
	}
	if activeKeyCount == 0 {
		writeAPIError(w, http.StatusBadRequest, "no active key for this provider")
		return
	}

	// SSE streaming branch: client requests Accept: text/event-stream to get
	// per-key results pushed as each key finishes probing.
	if r.Header.Get("Accept") == "text/event-stream" {
		rt.testProviderModelAllKeysSSE(w, r, providerID, provider, req.Model, activeKeyCount)
		return
	}

	chatURL := proxy.BuildUpstreamURL(provider.BaseURL, "/v1/chat/completions")
	adapter := rotation.GetAdapter(*provider)

	bodyMap := map[string]any{
		"model": req.Model,
		"messages": []map[string]string{
			{"role": "user", "content": testAllKeysPrompt},
		},
		"max_tokens": 100,
		"stream":     true,
	}
	bodyBytes, _ := json.Marshal(bodyMap)

	results := make([]keyTestResult, 0, activeKeyCount)

	for i := range provider.Keys {
		k := &provider.Keys[i]
		if !k.IsActive {
			continue
		}

		result := keyTestResult{
			KeyID:   k.ID,
			KeyName: k.Name,
		}

		httpReq, err := http.NewRequestWithContext(r.Context(), "POST", chatURL, bytes.NewReader(bodyBytes))
		if err != nil {
			result.Error = err.Error()
			results = append(results, result)
			continue
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+k.Key)
		httpReq.Header.Set("Accept", "text/event-stream")

		t0 := time.Now()
		resp, err := rt.testClient.Do(httpReq)
		if err != nil {
			result.Ok = false
			result.Error = err.Error()
			result.LatencyMs = time.Since(t0).Milliseconds()
			results = append(results, result)
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			errBody, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			errMsg := strings.TrimSpace(string(errBody))
			if len(errMsg) > 500 {
				errMsg = errMsg[:500]
			}
			result.Ok = false
			result.Status = resp.StatusCode
			result.Error = errMsg
			result.LatencyMs = time.Since(t0).Milliseconds()
			results = append(results, result)
			continue
		}

		var ttftMs int64
		inputTokens := 0
		outputTokens := 0
		buf := make([]byte, 32*1024)
		sb := &proxy.SSELineBuffer{}

		for {
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if ttftMs == 0 {
					ttftMs = time.Since(t0).Milliseconds()
				}
				for _, line := range sb.Feed(buf[:n]) {
					line = strings.TrimSpace(line)
					if strings.HasPrefix(line, "data:") {
						payload := strings.TrimSpace(line[5:])
						if payload == "[DONE]" {
							continue
						}
						if in, out := util.ExtractTokens([]byte(payload)); in > 0 || out > 0 {
							inputTokens = in
							outputTokens = out
						}
					}
				}
			}
			if readErr != nil {
				remaining := sb.Remaining()
				if remaining != "" {
					line := strings.TrimSpace(remaining)
					if strings.HasPrefix(line, "data:") {
						payload := strings.TrimSpace(line[5:])
						if payload != "[DONE]" {
							if in, out := util.ExtractTokens([]byte(payload)); in > 0 || out > 0 {
								inputTokens = in
								outputTokens = out
							}
						}
					}
				}
				break
			}
		}
		resp.Body.Close()

		totalMs := time.Since(t0).Milliseconds()
		outputPhaseSec := float64(totalMs-ttftMs) / 1000.0
		var tokensPerSec float64
		if outputPhaseSec > 0 {
			tokensPerSec = float64(outputTokens) / outputPhaseSec
		}

		if snap := adapter.ParseHeaders(resp.Header); snap != nil {
			result.QuotaRemain = snap.ModelRemaining
			result.QuotaTotal = snap.ModelLimit
			if ks := rt.reg.GetKeyState(providerID, k.ID); ks != nil {
				ks.UpdateQuota(req.Model, snap.ModelLimit, snap.ModelRemaining, snap.GlobalLimit, snap.GlobalRemaining)
			}
			rt.quotaTracker.Update(provider.Name, req.Model, k.ID, k.Name, snap.ModelLimit, snap.ModelRemaining, activeKeyCount)
		}

		result.Ok = true
		result.Status = 200
		result.TTFTMs = ttftMs
		result.LatencyMs = totalMs
		result.InputTokens = inputTokens
		result.OutputTokens = outputTokens
		result.TokensPerSec = tokensPerSec

		results = append(results, result)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"provider": providerID,
		"model":    req.Model,
		"results":  results,
	})
}

// testProviderModelAllKeysSSE streams per-key probe results as SSE events.
// Events: meta ({total}) → key ({...single result...}) * N → done ({ok, fail, total}).
func (rt *Router) testProviderModelAllKeysSSE(w http.ResponseWriter, r *http.Request, providerID string, provider *config.Provider, model string, activeKeyCount int) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}
	ctx := r.Context()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	chatURL := proxy.BuildUpstreamURL(provider.BaseURL, "/v1/chat/completions")
	adapter := rotation.GetAdapter(*provider)

	bodyMap := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": testAllKeysPrompt},
		},
		"max_tokens": 100,
		"stream":     true,
	}
	bodyBytes, _ := json.Marshal(bodyMap)

	// meta event
	if metaJSON, err := json.Marshal(map[string]int{"total": activeKeyCount}); err == nil {
		fmt.Fprintf(w, "event: meta\ndata: %s\n\n", metaJSON)
		flusher.Flush()
	}

	okCount, failCount := 0, 0
	for i := range provider.Keys {
		k := &provider.Keys[i]
		if !k.IsActive {
			continue
		}
		result := probeSingleKey(ctx, rt, providerID, provider, model, k, chatURL, adapter, bodyBytes)

		if result.Ok {
			okCount++
			rt.logger.Info("TEST-ALL %s/%s | Key=%s | OK (%dms)", provider.Name, model, k.Name, result.LatencyMs)
		} else {
			failCount++
			rt.logger.Warn("TEST-ALL %s/%s | Key=%s | FAIL %d (%dms)", provider.Name, model, k.Name, result.Status, result.LatencyMs)
		}
		if b, err := json.Marshal(result); err == nil {
			fmt.Fprintf(w, "event: key\ndata: %s\n\n", b)
			flusher.Flush()
		}
	}

	// done event
	if doneJSON, err := json.Marshal(map[string]int{"ok": okCount, "fail": failCount, "total": activeKeyCount}); err == nil {
		fmt.Fprintf(w, "event: done\ndata: %s\n\n", doneJSON)
		flusher.Flush()
	}
}

// probeSingleKey performs a single streaming probe against an upstream model
// endpoint using one specific key, returning the measurement result.
func probeSingleKey(ctx context.Context, rt *Router, providerID string, provider *config.Provider, model string, k *config.Key, chatURL string, adapter rotation.RatelimitAdapter, bodyBytes []byte) keyTestResult {
	result := keyTestResult{KeyID: k.ID, KeyName: k.Name}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", chatURL, bytes.NewReader(bodyBytes))
	if err != nil {
		result.Error = err.Error()
		return result
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+k.Key)
	httpReq.Header.Set("Accept", "text/event-stream")

	rt.logger.Debug("PROBE SEND %s/%s | Key=%s | url=%s | body=%s", provider.Name, model, k.Name, chatURL, util.TruncStr(string(bodyBytes), 200))

	t0 := time.Now()
	resp, err := rt.client.Do(httpReq)
	if err != nil {
		rt.logger.Error("PROBE ERR %s/%s | Key=%s | %v", provider.Name, model, k.Name, err)
		result.Ok = false
		result.Error = err.Error()
		result.LatencyMs = time.Since(t0).Milliseconds()
		return result
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		errMsg := strings.TrimSpace(string(errBody))
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		rt.logger.Warn("PROBE %d %s/%s | Key=%s | body=%s", resp.StatusCode, provider.Name, model, k.Name, util.TruncStr(errMsg, 200))
		result.Ok = false
		result.Status = resp.StatusCode
		result.Error = errMsg
		result.LatencyMs = time.Since(t0).Milliseconds()
		return result
	}

	var ttftMs int64
	inputTokens := 0
	outputTokens := 0
	var contentChunks int
	var contentBuf strings.Builder
	buf := make([]byte, 32*1024)
	sb := &proxy.SSELineBuffer{}

	const minChunks = 10
	const maxStreamSec = 8

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if ttftMs == 0 {
				ttftMs = time.Since(t0).Milliseconds()
				rt.logger.Debug("PROBE STREAM %s/%s | Key=%s | TTFT=%dms", provider.Name, model, k.Name, ttftMs)
			}
			for _, line := range sb.Feed(buf[:n]) {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "data:") {
					payload := strings.TrimSpace(line[5:])
					if payload == "[DONE]" {
						continue
					}
					if in, out := util.ExtractTokens([]byte(payload)); in > 0 || out > 0 {
						inputTokens = in
						outputTokens = out
					}
					if text := extractContentFromSSE([]byte(payload)); text != "" {
						contentChunks++
						contentBuf.WriteString(text)
					}
				}
			}
			// Early termination: enough content chunks or streamed long enough
			if contentChunks >= minChunks || time.Since(t0).Seconds() > maxStreamSec {
				break
			}
		}
		if readErr != nil {
			remaining := sb.Remaining()
			if remaining != "" {
				line := strings.TrimSpace(remaining)
				if strings.HasPrefix(line, "data:") {
					payload := strings.TrimSpace(line[5:])
					if payload != "[DONE]" {
						if in, out := util.ExtractTokens([]byte(payload)); in > 0 || out > 0 {
							inputTokens = in
							outputTokens = out
						}
						if text := extractContentFromSSE([]byte(payload)); text != "" {
							contentChunks++
							contentBuf.WriteString(text)
						}
					}
				}
			}
			break
		}
	}
	resp.Body.Close()

	contentText := contentBuf.String()
	rt.logger.Debug("PROBE CONTENT %s/%s | Key=%s | chunks=%d | text=%s", provider.Name, model, k.Name, contentChunks, util.TruncStr(contentText, 200))

	totalMs := time.Since(t0).Milliseconds()
	outputPhaseSec := float64(totalMs-ttftMs) / 1000.0
	var tokensPerSec float64
	if outputTokens == 0 && len(contentText) > 0 {
		// Estimate tokens from content text (rough: 4 chars ≈ 1 token)
		outputTokens = len(contentText) / 4
		if outputTokens == 0 {
			outputTokens = 1
		}
	}
	if outputPhaseSec > 0 {
		tokensPerSec = float64(outputTokens) / outputPhaseSec
	}
	rt.logger.Info("PROBE OK %s/%s | Key=%s | ttft=%dms | total=%dms | in=%d out=%d | %.1f tok/s", provider.Name, model, k.Name, ttftMs, totalMs, inputTokens, outputTokens, tokensPerSec)

	if snap := adapter.ParseHeaders(resp.Header); snap != nil {
		rt.logger.Info("PROBE quota %s/%s | Key=%s | remain=%d/%d", provider.Name, model, k.Name, snap.ModelRemaining, snap.ModelLimit)
		result.QuotaRemain = snap.ModelRemaining
		result.QuotaTotal = snap.ModelLimit
		if ks := rt.reg.GetKeyState(providerID, k.ID); ks != nil {
			ks.UpdateQuota(model, snap.ModelLimit, snap.ModelRemaining, snap.GlobalLimit, snap.GlobalRemaining)
		}
		activeKeyCount := 0
		for _, kk := range provider.Keys {
			if kk.IsActive {
				activeKeyCount++
			}
		}
		rt.quotaTracker.Update(provider.Name, model, k.ID, k.Name, snap.ModelLimit, snap.ModelRemaining, activeKeyCount)
	}

	result.Ok = true
	result.Status = 200
	result.TTFTMs = ttftMs
	result.LatencyMs = totalMs
	result.InputTokens = inputTokens
	result.OutputTokens = outputTokens
	result.TokensPerSec = tokensPerSec
	return result
}
