package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

// --- Providers ---

func (rt *Router) listProviders(w http.ResponseWriter, r *http.Request) {
	providers := rt.reg.ListProviders()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"providers": providers})
}

func (rt *Router) createProvider(w http.ResponseWriter, r *http.Request) {
	var p config.Provider
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if p.ID == "" {
		p.ID = generateID("prov")
	}
	for rt.reg.HasProvider(p.ID) {
		p.ID = generateID("prov")
	}
	if p.APIType == "" {
		p.APIType = "openai-compatible"
	}
	p.IsActive = true
	if p.Name == "" {
		p.Name = "Provider-" + strconv.Itoa(len(rt.reg.ListProviders())+1)
	}
	rt.reg.AddProvider(p)
	cfg := rt.reg.Config()
	if err := rt.saveConfig(&cfg); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to save")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(p)
}

func (rt *Router) updateProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var updates config.Provider
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	oldName := ""
	if p, ok := rt.reg.GetProvider(id); ok {
		oldName = p.Name
	}

	if rt.reg.UpdateProvider(id, updates) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}

		if oldName != "" && oldName != updates.Name {
			rt.quotaTracker.RenameProvider(oldName, updates.Name)
			rt.usage.Accumulator().RenameProvider(oldName, updates.Name)
		}

		p, _ := rt.reg.GetProvider(id)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(p)
	} else {
		writeAPIError(w, http.StatusNotFound, "provider not found")
	}
}

func (rt *Router) deleteProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if rt.reg.DeleteProvider(id) {
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
