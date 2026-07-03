package api

import (
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
