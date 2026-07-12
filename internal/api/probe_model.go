package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
)

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
	resp, err := rt.proxyHandler.ManagementClient(*provider).Do(req2)
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
