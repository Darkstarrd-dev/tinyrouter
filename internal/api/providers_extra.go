package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
)

// --- Provider Validation ---

// validateProvider tests connectivity to an upstream provider before creation.
// Request: {baseUrl, apiKey, modelId?}
// Response: {valid, error?, method?}
func (rt *Router) validateProvider(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL string `json:"baseUrl"`
		APIKey  string `json:"apiKey"`
		ModelID string `json:"modelId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.BaseURL == "" || req.APIKey == "" {
		writeAPIError(w, http.StatusBadRequest, "baseUrl and apiKey required")
		return
	}

	valid, method, err := rt.probeUpstream(req.BaseURL, req.APIKey, req.ModelID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"valid":  valid,
		"error":  err,
		"method": method,
	})
}

// probeUpstream tries GET /v1/models first, then falls back to POST /v1/chat/completions if modelId is provided.
// Returns (valid, method, errorMessage).
func (rt *Router) probeUpstream(baseURL, apiKey, modelID string) (bool, string, string) {
	modelsURL := proxy.BuildUpstreamURL(baseURL, "/v1/models")

	req, err := http.NewRequest("GET", modelsURL, nil)
	if err != nil {
		return false, "", "invalid URL: " + err.Error()
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := rt.client.Do(req)
	if err != nil {
		return false, "", "request failed: " + err.Error()
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		return true, "models", ""
	}

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return false, "", "authentication failed (status " + http.StatusText(resp.StatusCode) + ")"
	}

	if modelID != "" {
		chatURL := proxy.BuildUpstreamURL(baseURL, "/v1/chat/completions")
		body := `{"model":"` + modelID + `","messages":[{"role":"user","content":"hi"}],"max_tokens":16,"stream":false}`
		chatReq, err := http.NewRequest("POST", chatURL, strings.NewReader(body))
		if err != nil {
			return false, "", "invalid URL: " + err.Error()
		}
		chatReq.Header.Set("Content-Type", "application/json")
		chatReq.Header.Set("Authorization", "Bearer "+apiKey)

		chatResp, err := rt.client.Do(chatReq)
		if err != nil {
			return false, "", "chat request failed: " + err.Error()
		}
		defer chatResp.Body.Close()

		if chatResp.StatusCode == 401 || chatResp.StatusCode == 403 {
			return false, "", "authentication failed (status " + http.StatusText(chatResp.StatusCode) + ")"
		}
		return true, "chat", ""
	}

	return false, "", "upstream returned status " + http.StatusText(resp.StatusCode)
}

// --- Provider Key Testing ---

// testProviderKey tests a specific key's connectivity.
// Request: {keyId?} (defaults to first active key)
// Response: {valid, error?}
func (rt *Router) testProviderKey(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	provider, ok := rt.reg.GetProvider(providerID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}

	var req struct {
		KeyID string `json:"keyId"`
	}
	if r.ContentLength > 0 {
		json.NewDecoder(r.Body).Decode(&req)
	}

	var key *config.Key
	for i := range provider.Keys {
		k := &provider.Keys[i]
		if !k.IsActive {
			continue
		}
		if req.KeyID != "" {
			if k.ID == req.KeyID {
				key = k
				break
			}
		} else {
			key = k
			break
		}
	}
	if key == nil {
		writeAPIError(w, http.StatusBadRequest, "no active key found")
		return
	}

	valid, _, errMsg := rt.probeUpstream(provider.BaseURL, key.Key, "")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"valid": valid,
		"error": errMsg,
	})
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

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		writeAPIError(w, http.StatusBadGateway, "upstream returned "+http.StatusText(resp.StatusCode)+": "+string(body))
		return
	}

	var result struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
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
		if json.Unmarshal(respBody, &errResp) != nil {
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":        ok,
		"latencyMs": latencyMs,
		"error":     errMsg,
		"status":    resp.StatusCode,
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

	if rt.reg.AddModel(providerID, req.Model) {
		config.Save(rt.configPath, rt.reg.Config())
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "provider not found")
	}
}

// deleteProviderModel removes a custom model ID from a provider.
func (rt *Router) deleteProviderModel(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	modelID := chi.URLParam(r, "modelId")

	if rt.reg.DeleteModel(providerID, modelID) {
		config.Save(rt.configPath, rt.reg.Config())
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "model not found")
	}
}

// --- Bulk Key Addition ---

// bulkAddKeys adds multiple keys at once.
// Request: {keys: [{name, key, priority?}]}
// Response: {added, errors: [{index, error}]}
func (rt *Router) bulkAddKeys(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	var req struct {
		Keys []struct {
			Name     string `json:"name"`
			Key      string `json:"key"`
			Priority int    `json:"priority"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	added := 0
	var errors []map[string]any

	for i, k := range req.Keys {
		if k.Key == "" {
			errors = append(errors, map[string]any{"index": i, "error": "empty key"})
			continue
		}
		name := k.Name
		if name == "" {
			name = "Key-" + strconv.Itoa(i+1)
		}
		priority := k.Priority
		if priority == 0 {
			priority = 1
		}
		newKey := config.Key{
			ID:       generateID("key"),
			Key:      k.Key,
			Name:     name,
			Priority: priority,
			IsActive: true,
		}
		if rt.reg.AddKey(providerID, newKey) {
			added++
		} else {
			errors = append(errors, map[string]any{"index": i, "error": "provider not found"})
		}
	}

	config.Save(rt.configPath, rt.reg.Config())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"added":  added,
		"errors": errors,
	})
}

// --- Helpers ---

func firstActiveKey(provider *config.Provider) *config.Key {
	for i := range provider.Keys {
		if provider.Keys[i].IsActive {
			return &provider.Keys[i]
		}
	}
	return nil
}
