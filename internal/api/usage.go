package api

import (
	"encoding/json"
	"net/http"

	"github.com/tinyrouter/tinyrouter/internal/usage"
)

// --- Usage ---

func (rt *Router) getUsage(w http.ResponseWriter, r *http.Request) {
	limit := rt.getIntQuery(r, "limit", 500)
	offset := rt.getIntQuery(r, "offset", 0)

	ringEntries := rt.usage.All()

	// Merge inflight (processing) entries from the entry tracker so the REST
	// response shows both completed and currently processing requests in a
	// single time-sorted list. The frontend uses each entry's ID for dedup.
	var inflightEntries []usage.Entry
	if rt.proxyHandler != nil && rt.proxyHandler.EntryTracker != nil {
		inflightEntries = rt.proxyHandler.EntryTracker.All()
	}

	total := len(ringEntries) + len(inflightEntries)
	if offset >= total {
		offset = 0
	}
	end := offset + limit
	if end > total {
		end = total
	}

	// Build a combined slice with ring entries first (most recently completed
	// are at the front of the ring's reverse-chronological order), then append
	// inflight entries. The frontend sorts by timestamp to achieve true
	// reverse-chronological order; this merge preserves ring ordering while
	// adding the in-flight set.
	combined := make([]usage.Entry, 0, total)
	combined = append(combined, ringEntries...)
	combined = append(combined, inflightEntries...)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{
		"total":   total,
		"entries": combined[offset:end],
	})
}

func (rt *Router) getUsageSummary(w http.ResponseWriter, r *http.Request) {
	summary := rt.usage.Summary()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(summary)
}

// clearUsage wipes the in-memory usage ring. Kept alongside the other usage
// endpoints rather than in a separate file because it shares the usage domain.
func (rt *Router) clearUsage(w http.ResponseWriter, r *http.Request) {
	rt.usage.Clear()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
