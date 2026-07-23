package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/proxy"
	"github.com/tinyrouter/tinyrouter/internal/usage"
)

// --- Usage ---

func (rt *Router) getUsage(w http.ResponseWriter, r *http.Request) {
	limit := rt.getIntQuery(r, "limit", 500)
	offset := rt.getIntQuery(r, "offset", 0)

	// 兜底清理：将超过 10 分钟仍未完成的 processing 条目标记为 error
	if rt.proxyHandler != nil && rt.proxyHandler.EntryTracker != nil {
		staleEntries := rt.proxyHandler.EntryTracker.SweepStale(10 * time.Minute)
		for _, e := range staleEntries {
			e.Status = "error"
			e.Error = "timeout"
			e.LatencyMs = time.Since(e.Timestamp).Milliseconds()
			rt.usage.Add(e)
			raw := proxy.MarshalEntryJSON(e)
			if raw != nil {
				rt.proxyHandler.RequestUpdates.Broadcast(proxy.RequestEvent{
					Type:   "request-done",
					ID:     e.ID,
					Status: "error",
					Entry:  raw,
				})
			}
			rt.proxyHandler.UsageUpdates.Signal()
		}
	}

	ringEntries := rt.usage.All()

	// Merge inflight (processing) entries from the entry tracker so the REST
	// response shows both completed and currently processing requests in a
	// single time-sorted list. The frontend uses each entry's ID for dedup.
	// 排除 playground 来源：那些归 /usage/playground，避免串入 Recent Requests。
	var inflightEntries []usage.Entry
	if rt.proxyHandler != nil && rt.proxyHandler.EntryTracker != nil {
		for _, e := range rt.proxyHandler.EntryTracker.All() {
			if e.Source != "playground" {
				inflightEntries = append(inflightEntries, e)
			}
		}
	}

	total := len(ringEntries) + len(inflightEntries)
	if offset >= total {
		offset = 0
	}
	end := offset + limit
	if end > total {
		end = total
	}

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

// getPlaygroundUsage 返回 Playground 来源的请求列表（独立 ring + playground
// 来源的在途条目），供 Playground 页面左侧列表消费。与 /api/usage 物理隔离。
func (rt *Router) getPlaygroundUsage(w http.ResponseWriter, r *http.Request) {
	limit := rt.getIntQuery(r, "limit", 50)
	offset := rt.getIntQuery(r, "offset", 0)

	var ringEntries []usage.Entry
	if rt.pgUsage != nil {
		ringEntries = rt.pgUsage.All()
	}

	var inflightEntries []usage.Entry
	if rt.proxyHandler != nil && rt.proxyHandler.EntryTracker != nil {
		for _, e := range rt.proxyHandler.EntryTracker.All() {
			if e.Source == "playground" {
				inflightEntries = append(inflightEntries, e)
			}
		}
	}

	total := len(ringEntries) + len(inflightEntries)
	if offset >= total {
		offset = 0
	}
	end := offset + limit
	if end > total {
		end = total
	}

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
