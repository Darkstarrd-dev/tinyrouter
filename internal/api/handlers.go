package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

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
		"enablePlayground":   cfg.EnablePlayground,
		"debugMode":          rt.DebugMode(),
		"proxy":              cfg.Proxy,
		"security": map[string]any{
			"passwordEnabled": cfg.Security.PasswordEnabled,
			"hasPassword":     cfg.Security.PasswordEncrypted != "",
		},
	})
}

func (rt *Router) updateSettings(w http.ResponseWriter, r *http.Request) {
	var updates struct {
		Port               *int                   `json:"port"`
		ConsoleLogMaxLines *int                   `json:"consoleLogMaxLines"`
		UsageRingSize      *int                   `json:"usageRingSize"`
		Rotation           *config.RotationConfig `json:"rotation"`
		EnablePlayground   *bool                  `json:"enablePlayground"`
		DebugMode          *bool                  `json:"debugMode"`
		Proxy              *config.ProxyConfig    `json:"proxy"`
		Security           *struct {
			PasswordEnabled *bool  `json:"passwordEnabled"`
			Password        string `json:"password"`
		} `json:"security"`
	}
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	cfg := rt.reg.Config()
	portChanged := false
	if updates.Port != nil {
		newPort := *updates.Port
		if newPort < 1 || newPort > 65535 {
			writeAPIError(w, http.StatusBadRequest, fmt.Sprintf("invalid port number: %d", newPort))
			return
		}
		if newPort != cfg.Port {
			if err := checkPortAvailable(newPort); err != nil {
				writeAPIError(w, http.StatusBadRequest, fmt.Sprintf("port %d is not available: %v", newPort, err))
				return
			}
			portChanged = true
		}
		cfg.Port = newPort
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
	if updates.EnablePlayground != nil {
		cfg.EnablePlayground = *updates.EnablePlayground
	}
	if updates.DebugMode != nil {
		rt.SetDebugMode(*updates.DebugMode)
	}
	if updates.Security != nil {
		if updates.Security.PasswordEnabled != nil {
			cfg.Security.PasswordEnabled = *updates.Security.PasswordEnabled
			if !*updates.Security.PasswordEnabled {
				cfg.Security.PasswordEncrypted = ""
				cfg.Security.EncryptionKey = ""
			}
		}
		if updates.Security.Password != "" {
			key, err := config.GenerateKey()
			if err != nil {
				writeAPIError(w, http.StatusInternalServerError, "failed to generate encryption key")
				return
			}
			encrypted, err := config.Encrypt(key, updates.Security.Password)
			if err != nil {
				writeAPIError(w, http.StatusInternalServerError, "failed to encrypt password")
				return
			}
			cfg.Security.EncryptionKey = key
			cfg.Security.PasswordEncrypted = encrypted
			cfg.Security.PasswordEnabled = true
		}
	}
	if updates.Proxy != nil {
		cfg.Proxy = *updates.Proxy
		rt.proxyHandler.SetProxy(cfg.Proxy.Enabled, cfg.Proxy.Host, cfg.Proxy.Port)
	}

	if err := config.Save(rt.configPath, &cfg); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	rt.reg.Reload(&cfg)
	rt.selector.UpdateSettings(cfg.Rotation)

	// If password protection was just enabled or a new password was set,
	// issue a session token to the current client so it stays authenticated.
	// Without this, enabling password protection would immediately lock out
	// the current session (AuthMiddleware activates on Reload), making the
	// subsequent "save password" request fail with 401.
	if updates.Security != nil {
		justEnabled := updates.Security.PasswordEnabled != nil && *updates.Security.PasswordEnabled
		passwordSet := updates.Security.Password != ""
		passwordChanged := justEnabled || passwordSet
		if passwordChanged {
			sessionStore.ClearAll()
			if token, err := generateToken(); err == nil {
				sessionStore.Lock()
				sessionStore.tokens[token] = time.Now()
				sessionStore.Unlock()
				setSessionCookie(w, token)
			}
		}
	}

	if portChanged && rt.restartFn != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"ok":      true,
			"restart": true,
			"port":    cfg.Port,
		})
		newAddr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
		go func() {
			time.Sleep(300 * time.Millisecond)
			rt.restartFn(newAddr)
		}()
		return
	}

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
	rt.selector.UpdateSettings(cfg.Rotation)
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

	oldName := ""
	if p, ok := rt.reg.GetProvider(id); ok {
		oldName = p.Name
	}

	if rt.reg.UpdateProvider(id, updates) {
		cfg := rt.reg.Config()
		if err := config.Save(rt.configPath, &cfg); err != nil {
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
		if err := config.Save(rt.configPath, &cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
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
		if err := config.Save(rt.configPath, &cfg); err != nil {
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
		if err := config.Save(rt.configPath, &cfg); err != nil {
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
		if err := config.Save(rt.configPath, &cfg); err != nil {
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
	if err := config.Save(rt.configPath, &cfg); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to save config")
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
		if err := config.Save(rt.configPath, &cfg); err != nil {
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
		if err := config.Save(rt.configPath, &cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "combo not found")
	}
}

// --- QuickSlots ---

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
	if err := config.Save(rt.configPath, &cfg); err != nil {
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
		if err := config.Save(rt.configPath, &cfg); err != nil {
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
		if err := config.Save(rt.configPath, &cfg); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to save config")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	} else {
		writeAPIError(w, http.StatusNotFound, "quickslot not found")
	}
}

// --- Helpers ---

func writeAPIError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"error": msg})
}

// checkPortAvailable tests whether a TCP port can be bound on 127.0.0.1.
func checkPortAvailable(port int) error {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	return ln.Close()
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

// SyncIDCounter scans existing IDs in the config and advances idCounter past
// the highest numeric suffix found for each prefix. This must be called once
// at startup, after config is loaded, to prevent ID collisions after restart.
func SyncIDCounter(cfg *config.Config) {
	var maxVal int64
	scan := func(id string) {
		i := strings.LastIndexByte(id, '_')
		if i < 0 {
			return
		}
		n, err := strconv.ParseInt(id[i+1:], 36, 64)
		if err != nil {
			return
		}
		if n > maxVal {
			maxVal = n
		}
	}
	for _, p := range cfg.Providers {
		scan(p.ID)
		for _, k := range p.Keys {
			scan(k.ID)
		}
	}
	for _, c := range cfg.Combos {
		scan(c.ID)
	}
	for _, qs := range cfg.QuickSlots {
		scan(qs.ID)
	}
	atomic.StoreInt64(&idCounter, maxVal)
}
