package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

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
			Account  string `json:"account"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	added := 0
	var errors []map[string]any

	// Capture current key count for auto-naming offset
	offset := 0
	if provider, ok := rt.reg.GetProvider(providerID); ok {
		offset = len(provider.Keys)
	}

	for i, k := range req.Keys {
		if k.Key == "" {
			errors = append(errors, map[string]any{"index": i, "error": "empty key"})
			continue
		}
		name := k.Name
		if name == "" {
			name = "Key-" + strconv.Itoa(offset+i+1)
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
			Account:  k.Account,
		}
		if rt.reg.AddKey(providerID, newKey) {
			added++
		} else {
			errors = append(errors, map[string]any{"index": i, "error": "provider not found"})
		}
	}

	cfg := rt.reg.Config()
	if err := config.Save(rt.configPath, &cfg); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"added":  added,
		"errors": errors,
	})
}
