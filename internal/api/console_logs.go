package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// --- Console Logs ---

func (rt *Router) getConsoleLogs(w http.ResponseWriter, r *http.Request) {
	lines := rt.logger.AllLines()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"lines": lines,
		"count": len(lines),
	})
}

func (rt *Router) streamConsoleLogs(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	// Send existing lines first
	for _, line := range rt.logger.AllLines() {
		payload, _ := json.Marshal(map[string]string{"type": "line", "line": line})
		fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
	}

	// Subscribe to new lines
	ch := rt.logger.Subscribe()
	defer rt.logger.Unsubscribe(ch)

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
			// Keepalive ping
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func (rt *Router) clearConsoleLogs(w http.ResponseWriter, r *http.Request) {
	rt.logger.Clear()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
