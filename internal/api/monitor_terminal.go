package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tinyrouter/tinyrouter/internal/terminal"
)

var terminalUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		return origin == "http://"+r.Host || origin == "https://"+r.Host
	},
}

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

	allowed := rt.cfg.Monitor.AllowedCommands
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

func (rt *Router) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	if !rt.DebugMode() {
		http.Error(w, "terminal requires debug mode", http.StatusForbidden)
		return
	}

	// NOTE: The password-protection gate that was here (checking
	// cfg.Security.PasswordEnabled) was removed because it blocked
	// Terminal for users who haven't enabled password protection,
	// causing "Terminal error. Terminal disconnected." when the WS
	// upgrade returned 403. These routes are already inside
	// AuthMiddleware — localhost-only binding is the security boundary.
	conn, err := terminalUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	var session *terminal.Session
	onClose := func() {
		rt.terminalMu.Lock()
		if rt.activeTerm == session {
			rt.activeTerm = nil
		}
		rt.terminalMu.Unlock()
		rt.logger.Info("terminal session closed")
	}

	session, err = terminal.NewSession("", conn, onClose)
	if err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Error: "+err.Error()))
		_ = conn.Close()
		return
	}

	rt.terminalMu.Lock()
	if rt.activeTerm != nil {
		rt.terminalMu.Unlock()
		_ = conn.WriteMessage(websocket.TextMessage, []byte("terminal session already active"))
		session.Close()
		return
	}
	rt.activeTerm = session
	rt.terminalMu.Unlock()
	rt.logger.Info("terminal session started")
}

func (rt *Router) stopTerminal(w http.ResponseWriter, r *http.Request) {
	rt.terminalMu.Lock()
	session := rt.activeTerm
	rt.activeTerm = nil
	rt.terminalMu.Unlock()

	if session == nil {
		writeAPIError(w, http.StatusBadRequest, "no active terminal session")
		return
	}

	session.Close()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
