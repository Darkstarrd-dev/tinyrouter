package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

// --- QuickSlots ---
//
// QuickSlots share the same CRUD shape as Combos, so they live in a dedicated
// file next to combos.go. Keeping them separate (rather than merging into
// combos.go) preserves the one-responsibility-per-file goal while staying small.

func (rt *Router) listQuickSlots(w http.ResponseWriter, r *http.Request) {
	quickslots := rt.reg.ListQuickSlots()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"quickslots": quickslots})
}

func (rt *Router) createQuickSlot(w http.ResponseWriter, r *http.Request) {
	var qs config.QuickSlot
	if err := json.NewDecoder(r.Body).Decode(&qs); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if qs.ID == "" {
		qs.ID = generateID("qs")
	}
	for rt.reg.HasQuickSlot(qs.ID) {
		qs.ID = generateID("qs")
	}
	rt.reg.AddQuickSlot(qs)
	cfg := rt.reg.Config()
	if err := rt.saveConfig(&cfg); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(qs)
}

func (rt *Router) updateQuickSlot(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var updates config.QuickSlot
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if rt.reg.UpdateQuickSlot(id, updates) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "quickslot not found")
	}
}

func (rt *Router) deleteQuickSlot(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if rt.reg.DeleteQuickSlot(id) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "quickslot not found")
	}
}
