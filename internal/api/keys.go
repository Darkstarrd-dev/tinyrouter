package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

// --- Keys ---

func (rt *Router) listKeys(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	provider, ok := rt.reg.GetProvider(providerID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"keys": provider.Keys})
}

func (rt *Router) createKey(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	var k config.Key
	if err := json.NewDecoder(r.Body).Decode(&k); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if k.ID == "" {
		k.ID = generateID("key")
	}
	for rt.reg.HasKey(providerID, k.ID) {
		k.ID = generateID("key")
	}
	k.IsActive = true
	if k.Name == "" {
		if provider, ok := rt.reg.GetProvider(providerID); ok {
			k.Name = "Key-" + strconv.Itoa(len(provider.Keys)+1)
		}
	}
	if rt.reg.AddKey(providerID, k) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(k)
	} else {
		writeAPIError(w, http.StatusNotFound, "provider not found")
	}
}

func (rt *Router) updateKey(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	keyID := chi.URLParam(r, "kid")
	var updates config.Key
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if rt.reg.UpdateKey(providerID, keyID, updates) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "key not found")
	}
}

func (rt *Router) deleteKey(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	keyID := chi.URLParam(r, "kid")
	if rt.reg.DeleteKey(providerID, keyID) {
		cfg := rt.reg.Config()
		if err := rt.saveConfig(&cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "key not found")
	}
}

func (rt *Router) getKeyState(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	keyID := chi.URLParam(r, "kid")
	state := rt.reg.GetKeyState(providerID, keyID)
	if state == nil {
		writeAPIError(w, http.StatusNotFound, "key state not found")
		return
	}
	state.Lock()
	defer state.Unlock()
	locks := make(map[string]string)
	statuses := make(map[string]string)
	errors := make(map[string]string)
	now := time.Now()
	active := true
	for m, t := range state.ModelLocks {
		locks[m] = t.Format("2006-01-02T15:04:05Z07:00")
		st := state.ModelStatus[m]
		if st == "" {
			st = "cooldown"
		}
		statuses[m] = st
		if now.Before(t) {
			active = false
		}
		if err, ok := state.ModelErrors[m]; ok {
			errors[m] = err
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":       map[bool]string{true: "active", false: "cooldown"}[active],
		"backoffLevel": state.BackoffLevel,
		"modelLocks":   locks,
		"modelStatus":  statuses,
		"modelErrors":  errors,
		"lastUsedAt":   state.LastUsedAt.Format("2006-01-02T15:04:05Z07:00"),
		"consecCount":  state.ConsecCount,
		"lastError":    "",
	})
}
