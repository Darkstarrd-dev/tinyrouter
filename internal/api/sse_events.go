package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/proxy"
)

// --- Generic SSE event stream ---

// streamUsageEvents pushes the combined usage/inflight/request event streams to
// the connected admin UI over a single SSE connection.
func (rt *Router) streamUsageEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	fmt.Fprintf(w, "data: {\"type\":\"connected\"}\n\n")
	flusher.Flush()

	// Send existing inflight (processing) entries as request-start events so
	// a freshly connected client immediately sees all currently-running requests.
	if rt.proxyHandler != nil && rt.proxyHandler.EntryTracker != nil {
		for _, e := range rt.proxyHandler.EntryTracker.All() {
			raw := proxy.MarshalEntryJSON(e)
			if raw != nil {
				fmt.Fprintf(w, "data: {\"type\":\"request-start\",\"id\":%s,\"entry\":%s}\n\n",
					json.RawMessage(mustJSON(e.ID)), raw)
				flusher.Flush()
			}
		}
	}

	ch, unsubUsage := rt.proxyHandler.UsageUpdates.Subscribe()
	infCh, unsubInflight := rt.proxyHandler.InflightUpdates.Subscribe()
	reqCh, unsubRequests := rt.proxyHandler.RequestUpdates.Subscribe()
	defer unsubUsage()
	defer unsubInflight()
	defer unsubRequests()
	ctx := r.Context()
	for {
		select {
		case <-ch:
			fmt.Fprintf(w, "data: {\"type\":\"usage-updated\"}\n\n")
			flusher.Flush()
		case <-infCh:
			fmt.Fprintf(w, "data: {\"type\":\"key-inflight\"}\n\n")
			flusher.Flush()
		case ev, ok := <-reqCh:
			if !ok {
				return
			}
			if reqEv, ok := ev.(proxy.RequestEvent); ok {
				// Marshal a single JSON object for SSE transport.
				data, err := json.Marshal(reqEv)
				if err != nil {
					continue
				}
				fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()
			}
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// mustJSON returns the JSON encoding of s as a string, or the original string
// (quoted by the caller) if it cannot be encoded.
func mustJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
