package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

// --- Combos ---

func (rt *Router) listCombos(w http.ResponseWriter, r *http.Request) {
	combos := rt.reg.ListCombos()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"combos": combos})
}

func (rt *Router) createCombo(w http.ResponseWriter, r *http.Request) {
	var c config.Combo
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if c.ID == "" {
		c.ID = generateID("combo")
	}
	for rt.reg.HasCombo(c.ID) {
		c.ID = generateID("combo")
	}
	rt.reg.AddCombo(c)
	cfg := rt.reg.Config()
	if err := rt.saveConfig(&cfg); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to save")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(c)
}

func (rt *Router) updateCombo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var updates config.Combo
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if rt.reg.UpdateCombo(id, updates) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "combo not found")
	}
}

func (rt *Router) deleteCombo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if rt.reg.DeleteCombo(id) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "combo not found")
	}
}
