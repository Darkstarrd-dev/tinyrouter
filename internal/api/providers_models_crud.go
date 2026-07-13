package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

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
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
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
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "model not found on provider")
	}
}

// updateModelAlias updates the alias of a single model on a provider.
// Request: {"model": "model-id", "alias": "some-alias"}
func (rt *Router) updateModelAlias(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	var req struct {
		Model string `json:"model"`
		Alias string `json:"alias"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Model == "" {
		writeAPIError(w, http.StatusBadRequest, "model required")
		return
	}
	if rt.reg.UpdateModelAlias(providerID, req.Model, req.Alias) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		// UpdateModelAlias returns false when provider/model not found OR when
		// the alias conflicts with an existing model ID/alias. Try to
		// distinguish via GetModelByAliasOrID check.
		if _, ok := rt.reg.GetModelByAliasOrID(providerID, req.Model); ok {
			writeAPIError(w, http.StatusBadRequest, "alias conflicts with existing model ID or alias in this provider")
		} else {
			writeAPIError(w, http.StatusNotFound, "model not found on provider")
		}
	}
}

// updateModelNote updates the note of a single model on a provider.
// Request: {"model": "model-id", "note": "some note text"}
func (rt *Router) updateModelNote(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	var req struct {
		Model string `json:"model"`
		Note  string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Model == "" {
		writeAPIError(w, http.StatusBadRequest, "model required")
		return
	}
	if rt.reg.UpdateModelNote(providerID, req.Model, req.Note) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "model not found on provider")
	}
}

// updateModelNIM updates the NIM override of a single model on a provider.
// Request: {"model": "model-id", "nim": {"enabled": true, "request_count_per_key": 30, "min_interval_ms": 2000}}
func (rt *Router) updateModelNIM(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	var req struct {
		Model string                  `json:"model"`
		NIM   config.ModelNIMOverride `json:"nim"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Model == "" {
		writeAPIError(w, http.StatusBadRequest, "model required")
		return
	}
	if rt.reg.UpdateModelNIMOverride(providerID, req.Model, req.NIM) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
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
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "model not found")
	}
}
