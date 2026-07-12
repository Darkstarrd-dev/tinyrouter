package api

import (
	"encoding/json"
	"net/http"

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

// --- Terminal (debug-mode only) ---

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
