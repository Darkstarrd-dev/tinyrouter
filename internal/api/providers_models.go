package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
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
const testAllKeysPrompt = "Write a ~500-word fantasy adventure short story with a beginning, climax, and resolution. The story should feature a reluctant heroine, a magical artifact, and a dragon who is not what it seems."

// sseLineBuf is a minimal SSE line buffer, equivalent to proxy.sseLineBuffer.
type sseLineBuf struct {
	buf []byte
}

func (b *sseLineBuf) feed(data []byte) []string {
	b.buf = append(b.buf, data...)
	var lines []string
	for {
		idx := bytes.IndexByte(b.buf, '\n')
		if idx < 0 {
			break
		}
		lines = append(lines, string(b.buf[:idx]))
		b.buf = b.buf[idx+1:]
	}
	return lines
}

func (b *sseLineBuf) remaining() string {
	if len(b.buf) > 0 {
		s := string(b.buf)
		b.buf = nil
		return s
	}
	return ""
}

// extractTokensFromSSE parses token usage from an SSE data payload.
func extractTokensFromSSE(body []byte) (int, int) {
	var resp map[string]any
	if err := json.Unmarshal(body, &resp); err != nil {
		return 0, 0
	}
	usage, ok := resp["usage"].(map[string]any)
	if !ok {
		return 0, 0
	}
	in := tokenValFromMap(usage, "prompt_tokens", "input_tokens")
	out := tokenValFromMap(usage, "completion_tokens", "output_tokens")
	if in == 0 && out == 0 {
		total, _ := usage["total_tokens"].(float64)
		if total > 0 {
			return int(total), 0
		}
	}
	return int(in), int(out)
}

// tokenValFromMap extracts the first non-zero float64 value for the given keys.
func tokenValFromMap(m map[string]any, keys ...string) float64 {
	for _, k := range keys {
		if v, ok := m[k].(float64); ok && v > 0 {
			return v
		}
	}
	return 0
}

// --- Provider Model Fetching ---

// fetchProviderModels fetches available models from the upstream provider's /v1/models endpoint.
// Response: {models: [{id}]}
func (rt *Router) fetchProviderModels(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	provider, ok := rt.reg.GetProvider(providerID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}

	key := firstActiveKey(provider)
	if key == nil {
		writeAPIError(w, http.StatusBadRequest, "no active key for this provider")
		return
	}

	modelsURL := proxy.BuildUpstreamURL(provider.BaseURL, "/v1/models")
	req, err := http.NewRequest("GET", modelsURL, nil)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid base URL")
		return
	}
	req.Header.Set("Authorization", "Bearer "+key.Key)

	resp, err := rt.client.Do(req)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "request failed: "+err.Error())
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "failed to read response: "+err.Error())
		return
	}

	if resp.StatusCode != 200 {
		writeAPIError(w, http.StatusBadGateway, "upstream returned "+http.StatusText(resp.StatusCode)+": "+string(respBody))
		return
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		writeAPIError(w, http.StatusBadGateway, "failed to parse models response: "+err.Error())
		return
	}

	models := make([]map[string]string, 0, len(result.Data))
	for _, m := range result.Data {
		if m.ID != "" {
			models = append(models, map[string]string{"id": m.ID})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"models": models})
}

// --- Provider Model Testing ---

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
	body := `{"model":"` + req.Model + `","messages":[{"role":"user","content":"hi"}],"max_tokens":16,"stream":false}`
	req2, err := http.NewRequest("POST", chatURL, strings.NewReader(body))
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
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"ok":        false,
			"latencyMs": latencyMs,
			"error":     err.Error(),
			"status":    0,
		})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

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

	// Parse quota from upstream response headers (e.g. ModelScope rate-limit headers)
	var quotaRemain, quotaTotal int
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

	respMap := map[string]any{
		"ok":        ok,
		"latencyMs": latencyMs,
		"error":     errMsg,
		"status":    resp.StatusCode,
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

	chatURL := proxy.BuildUpstreamURL(provider.BaseURL, "/v1/chat/completions")
	adapter := rotation.GetAdapter(*provider)

	bodyMap := map[string]any{
		"model": req.Model,
		"messages": []map[string]string{
			{"role": "user", "content": testAllKeysPrompt},
		},
		"max_tokens": 800,
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

		httpReq, err := http.NewRequest("POST", chatURL, bytes.NewReader(bodyBytes))
		if err != nil {
			result.Error = err.Error()
			results = append(results, result)
			continue
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+k.Key)
		httpReq.Header.Set("Accept", "text/event-stream")

		t0 := time.Now()
		resp, err := rt.client.Do(httpReq)
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
		sb := &sseLineBuf{}

		for {
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if ttftMs == 0 {
					ttftMs = time.Since(t0).Milliseconds()
				}
				for _, line := range sb.feed(buf[:n]) {
					line = strings.TrimSpace(line)
					if strings.HasPrefix(line, "data:") {
						payload := strings.TrimSpace(line[5:])
						if payload == "[DONE]" {
							continue
						}
						if in, out := extractTokensFromSSE([]byte(payload)); in > 0 || out > 0 {
							inputTokens = in
							outputTokens = out
						}
					}
				}
			}
			if readErr != nil {
				remaining := sb.remaining()
				if remaining != "" {
					line := strings.TrimSpace(remaining)
					if strings.HasPrefix(line, "data:") {
						payload := strings.TrimSpace(line[5:])
						if payload != "[DONE]" {
							if in, out := extractTokensFromSSE([]byte(payload)); in > 0 || out > 0 {
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

// --- Provider Model CRUD ---

// addProviderModel adds a custom model ID to a provider.
// Request: {model}
func (rt *Router) addProviderModel(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
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

	if rt.reg.AddModel(providerID, config.ModelDef{ID: req.Model}) {
		cfg := rt.reg.Config()
		config.Save(rt.configPath, &cfg)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "provider not found")
	}
}

// updateModelQuota updates the quotaType of a single model on a provider.
// Request: {"model": "model-id", "quotaType": "unlimited|limited|paid"}
func (rt *Router) updateModelQuota(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	var req struct {
		Model     string `json:"model"`
		QuotaType string `json:"quotaType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Model == "" {
		writeAPIError(w, http.StatusBadRequest, "model required")
		return
	}
	switch req.QuotaType {
	case "unlimited", "limited", "paid":
	default:
		writeAPIError(w, http.StatusBadRequest, "invalid quotaType, must be unlimited | limited | paid")
		return
	}
	if rt.reg.UpdateModelQuotaType(providerID, req.Model, req.QuotaType) {
		cfg := rt.reg.Config()
		config.Save(rt.configPath, &cfg)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "model not found on provider")
	}
}

// deleteProviderModel removes a custom model ID from a provider.
func (rt *Router) deleteProviderModel(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	modelID := r.URL.Query().Get("model")

	if rt.reg.DeleteModel(providerID, modelID) {
		cfg := rt.reg.Config()
		config.Save(rt.configPath, &cfg)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "model not found")
	}
}
