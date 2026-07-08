package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
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
	req, err := http.NewRequestWithContext(r.Context(), "GET", modelsURL, nil)
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
