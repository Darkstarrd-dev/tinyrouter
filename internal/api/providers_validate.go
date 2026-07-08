package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

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
	if err := validateBaseURL(req.BaseURL); err != nil {
		writeAPIError(w, http.StatusBadRequest, fmt.Sprintf("invalid baseUrl: %v", err))
		return
	}

	valid, method, err := rt.probeUpstream(r.Context(), req.BaseURL, req.APIKey, req.ModelID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"valid":  valid,
		"error":  err,
		"method": method,
	})
}

// probeUpstream tries GET /v1/models first, then falls back to POST /v1/chat/completions if modelId is provided.
// Returns (valid, method, errorMessage).
func (rt *Router) probeUpstream(ctx context.Context, baseURL, apiKey, modelID string) (bool, string, string) {
	modelsURL := proxy.BuildUpstreamURL(baseURL, "/v1/models")

	req, err := http.NewRequestWithContext(ctx, "GET", modelsURL, nil)
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
		chatReq, err := http.NewRequestWithContext(ctx, "POST", chatURL, strings.NewReader(body))
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

	valid, _, errMsg := rt.probeUpstream(r.Context(), provider.BaseURL, key.Key, "")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"valid": valid,
		"error": errMsg,
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
