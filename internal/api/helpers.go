package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"

	"github.com/tinyrouter/tinyrouter/internal/config"
)

// saveConfig persists the given config to disk via config.Save. It performs no
// registry reload and is used by handlers whose in-memory changes do not need to
// be re-applied to the running registry (e.g. plain CRUD persistence).
func (rt *Router) saveConfig(cfg *config.Config) error {
	return config.Save(rt.configPath, cfg)
}

// saveConfigAndReload persists the given config to disk and then reloads it into
// the registry so the running proxy/rotation state reflects the saved changes.
// It is the single convergence point for the "modify cfg -> Save -> Reload"
// pattern that previously repeated across the per-domain CRUD handlers.
func (rt *Router) saveConfigAndReload(cfg *config.Config) error {
	if err := config.Save(rt.configPath, cfg); err != nil {
		return err
	}
	rt.reg.Reload(cfg)
	return nil
}

// writeAPIError writes a JSON error envelope with the given HTTP status.
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

// getIntQuery reads an integer query parameter with a default fallback.
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

// generateID returns a process-unique ID with the given prefix, encoded in
// base36. SyncIDCounter must be called at startup so the counter starts above
// the highest existing ID and avoids collisions across restarts.
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
