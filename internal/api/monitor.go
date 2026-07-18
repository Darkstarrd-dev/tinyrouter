package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// --- Monitor ---

func (rt *Router) getMonitorStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rt.monitorMgr.Status())
}

func (rt *Router) startMonitor(w http.ResponseWriter, r *http.Request) {
	// NOTE: The password-protection gate that was here (checking
	// cfg.Security.PasswordEnabled) was removed because it blocked
	// Monitor for users who haven't enabled password protection.
	// These routes are already inside AuthMiddleware — if a password
	// is enabled, auth is enforced. If not enabled, localhost-only
	// binding is the security boundary per the project design.
	var req struct {
		Command string   `json:"command"`
		Args    []string `json:"args"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Command == "" {
		writeAPIError(w, http.StatusBadRequest, "command is required")
		return
	}

	allowed := rt.reg.Config().Monitor.AllowedCommands
	if err := rt.monitorMgr.Start(req.Command, req.Args, allowed); err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	rt.logger.Info("monitor started: %s", req.Command)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (rt *Router) stopMonitor(w http.ResponseWriter, r *http.Request) {
	if err := rt.monitorMgr.Stop(); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	rt.logger.Info("monitor stopped")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (rt *Router) streamMonitor(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	for _, line := range rt.monitorMgr.BufferedLines() {
		payload, _ := json.Marshal(map[string]string{"type": "line", "line": line})
		fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
	}

	ch := rt.monitorMgr.Subscribe()
	defer rt.monitorMgr.Unsubscribe(ch)

	ctx := r.Context()
	for {
		select {
		case line, ok := <-ch:
			if !ok {
				return
			}
			payload, _ := json.Marshal(map[string]string{"type": "line", "line": line})
			fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
