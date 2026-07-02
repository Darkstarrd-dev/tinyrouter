package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync/atomic"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

// --- Settings ---

func (rt *Router) getSettings(w http.ResponseWriter, r *http.Request) {
	cfg := rt.reg.Config()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"port":               cfg.Port,
		"consoleLogMaxLines": cfg.ConsoleLogMaxLines,
		"usageRingSize":      cfg.UsageRingSize,
		"rotation":           cfg.Rotation,
	})
}

func (rt *Router) updateSettings(w http.ResponseWriter, r *http.Request) {
	var updates struct {
		Port               *int                   `json:"port"`
		ConsoleLogMaxLines *int                   `json:"consoleLogMaxLines"`
		UsageRingSize      *int                   `json:"usageRingSize"`
		Rotation           *config.RotationConfig `json:"rotation"`
	}
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	cfg := rt.reg.Config()
	if updates.Port != nil {
		cfg.Port = *updates.Port
	}
	if updates.ConsoleLogMaxLines != nil {
		cfg.ConsoleLogMaxLines = *updates.ConsoleLogMaxLines
	}
	if updates.UsageRingSize != nil {
		cfg.UsageRingSize = *updates.UsageRingSize
	}
	if updates.Rotation != nil {
		cfg.Rotation = *updates.Rotation
	}

	if err := config.Save(rt.configPath, &cfg); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	rt.reg.Reload(&cfg)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (rt *Router) reload(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Load(rt.configPath)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to reload config")
		return
	}
	rt.reg.Reload(cfg)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

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
	if p.APIType == "" {
		p.APIType = "openai-compatible"
	}
	p.IsActive = true
	rt.reg.AddProvider(p)
	cfg := rt.reg.Config()
	if err := config.Save(rt.configPath, &cfg); err != nil {
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
	if rt.reg.UpdateProvider(id, updates) {
		cfg := rt.reg.Config()
		config.Save(rt.configPath, &cfg)
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
		config.Save(rt.configPath, &cfg)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "provider not found")
	}
}

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
	k.IsActive = true
	if rt.reg.AddKey(providerID, k) {
		cfg := rt.reg.Config()
		config.Save(rt.configPath, &cfg)
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
		config.Save(rt.configPath, &cfg)
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
		config.Save(rt.configPath, &cfg)
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
	for m, t := range state.ModelLocks {
		locks[m] = t.Format("2006-01-02T15:04:05Z07:00")
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":       state.Status,
		"backoffLevel": state.BackoffLevel,
		"modelLocks":   locks,
		"lastUsedAt":   state.LastUsedAt.Format("2006-01-02T15:04:05Z07:00"),
		"consecCount":  state.ConsecCount,
		"lastError":    state.LastError,
	})
}

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
	rt.reg.AddCombo(c)
	cfg := rt.reg.Config()
	config.Save(rt.configPath, &cfg)
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
		config.Save(rt.configPath, &cfg)
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
		config.Save(rt.configPath, &cfg)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "combo not found")
	}
}

// --- Helpers ---

func writeAPIError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"error": msg})
}

func (rt *Router) getIntQuery(r *http.Request, key string, defaultVal int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultVal
	}
	return n
}

var idCounter int64

func generateID(prefix string) string {
	id := atomic.AddInt64(&idCounter, 1)
	return prefix + "_" + strconv.FormatInt(id, 36)
}
