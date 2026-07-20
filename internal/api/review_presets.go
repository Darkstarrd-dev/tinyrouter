package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

// --- ReviewPresets ---

func (rt *Router) listReviewPresets(w http.ResponseWriter, r *http.Request) {
	presets := rt.reg.ListReviewPresets()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"presets": presets})
}

// upsertReviewPreset handles both create (no ID) and update (with ID) operations.
// POST /api/review-presets
func (rt *Router) upsertReviewPreset(w http.ResponseWriter, r *http.Request) {
	var p config.ReviewPreset
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	if p.ID == "" {
		// Create
		p.ID = generateID("rp")
		rt.reg.AddReviewPreset(p)
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"preset": p})
	} else {
		// Update
		if rt.reg.UpdateReviewPreset(p.ID, p) {
			cfg := rt.reg.Config()
			if err := rt.saveConfig(&cfg); err != nil {
				writeAPIError(w, http.StatusInternalServerError, "failed to save config")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"ok": true})
		} else {
			writeAPIError(w, http.StatusNotFound, "review preset not found")
		}
	}
}

// deleteReviewPreset deletes a review preset by ID.
// DELETE /api/review-presets/{id}
func (rt *Router) deleteReviewPreset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if rt.reg.DeleteReviewPreset(id) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "review preset not found")
	}
}