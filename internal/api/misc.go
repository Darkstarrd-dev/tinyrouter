package api

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"sort"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/usage"
	"github.com/tinyrouter/tinyrouter/web"
)

// --- Usage ---

func (rt *Router) getUsage(w http.ResponseWriter, r *http.Request) {
	limit := rt.getIntQuery(r, "limit", 500)
	offset := rt.getIntQuery(r, "offset", 0)
	all := rt.usage.All()
	total := len(all)
	if offset >= total {
		offset = 0
	}
	end := offset + limit
	if end > total {
		end = total
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"total":   total,
		"entries": all[offset:end],
	})
}

func (rt *Router) getUsageSummary(w http.ResponseWriter, r *http.Request) {
	summary := rt.usage.Summary()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}

func (rt *Router) clearUsage(w http.ResponseWriter, r *http.Request) {
	rt.usage.Clear()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (rt *Router) getQuotas(w http.ResponseWriter, r *http.Request) {
	bars := rt.quotaTracker.All()
	modelStats := rt.usage.ModelStats()

	// Build a map of quota bars by "provider/model"
	barMap := make(map[string]int)
	for i := range bars {
		bars[i].HasQuota = true
		barMap[bars[i].Provider+"/"+bars[i].Model] = i
	}

	// Merge usage stats into quota bars; add non-quota models
	for _, ms := range modelStats {
		key := ms.Provider + "/" + ms.Model
		if idx, ok := barMap[key]; ok {
			bars[idx].SuccessCount = ms.SuccessCount
			bars[idx].ErrorCount = ms.ErrorCount
			bars[idx].InputTokens = ms.InputTokens
			bars[idx].OutputTokens = ms.OutputTokens
		} else {
			newBar := usage.QuotaBar{
				Provider:     ms.Provider,
				Model:        ms.Model,
				HasQuota:     false,
				SuccessCount: ms.SuccessCount,
				ErrorCount:   ms.ErrorCount,
				InputTokens:  ms.InputTokens,
				OutputTokens: ms.OutputTokens,
			}
			bars = append(bars, newBar)
			barMap[key] = len(bars) - 1
		}
	}

	// Sort by provider + model for stable ordering
	sort.Slice(bars, func(i, j int) bool {
		ki := bars[i].Provider + "/" + bars[i].Model
		kj := bars[j].Provider + "/" + bars[j].Model
		return ki < kj
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"quotas": bars,
	})
}

func (rt *Router) getModelKeys(w http.ResponseWriter, r *http.Request) {
	providerName := r.URL.Query().Get("provider")
	model := r.URL.Query().Get("model")
	if providerName == "" || model == "" {
		writeAPIError(w, http.StatusBadRequest, "provider and model are required")
		return
	}

	var provider *config.Provider
	for _, p := range rt.reg.ListProviders() {
		if p.Name == providerName {
			pp := p
			provider = &pp
			break
		}
	}
	if provider == nil {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}

	type keyDetail struct {
		KeyID       string  `json:"keyId"`
		KeyName     string  `json:"keyName"`
		IsActive    bool    `json:"isActive"`
		Status      string  `json:"status"`
		HasQuota    bool    `json:"hasQuota"`
		ModelLimit  int     `json:"modelLimit"`
		ModelRemain int     `json:"modelRemaining"`
		ModelLock   *string `json:"modelLock"`
		LastError   string  `json:"lastError"`
	}

	hasQuota := false
	details := make([]keyDetail, 0, len(provider.Keys))
	for _, k := range provider.Keys {
		kd := keyDetail{
			KeyID:    k.ID,
			KeyName:  k.Name,
			IsActive: k.IsActive,
			Status:   "active",
		}
		state := rt.reg.GetKeyState(provider.ID, k.ID)
		if state != nil {
			state.Lock()
			kd.Status = state.Status
			if unlock, ok := state.ModelLocks[model]; ok {
				if time.Now().Before(unlock) {
					s := unlock.Format("2006-01-02T15:04:05Z07:00")
					kd.ModelLock = &s
				}
			}
			kd.LastError = state.LastError
			if q := state.ModelQuotas[model]; q != nil {
				kd.HasQuota = true
				kd.ModelLimit = q.ModelLimit
				kd.ModelRemain = q.ModelRemaining
				hasQuota = true
			}
			state.Unlock()
		}
		details = append(details, kd)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"provider": providerName,
		"model":    model,
		"hasQuota": hasQuota,
		"keys":     details,
	})
}

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

	ch := rt.proxyHandler.UsageUpdateCh
	ctx := r.Context()
	for {
		select {
		case <-ch:
			fmt.Fprintf(w, "data: {\"type\":\"usage-updated\"}\n\n")
			flusher.Flush()
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

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
		fmt.Fprintf(w, "data: {\"type\":\"line\",\"line\":%s}\n\n", mustJSON(line))
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
			fmt.Fprintf(w, "data: {\"type\":\"line\",\"line\":%s}\n\n", mustJSON(line))
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

// --- Models ---

func (rt *Router) listModels(w http.ResponseWriter, r *http.Request) {
	providers := rt.reg.ListProviders()
	combos := rt.reg.ListCombos()

	type modelInfo struct {
		ID       string `json:"id"`
		Provider string `json:"provider"`
		Type     string `json:"type"` // "provider" | "combo"
	}

	var models []modelInfo
	for _, p := range providers {
		if !p.IsActive {
			continue
		}
		if len(p.Models) > 0 {
			for _, m := range p.Models {
				models = append(models, modelInfo{
					ID:       p.Prefix + "/" + m.ID,
					Provider: p.Name,
					Type:     "provider",
				})
			}
		} else {
			models = append(models, modelInfo{
				ID:       p.Prefix + "/*",
				Provider: p.Name,
				Type:     "provider",
			})
		}
	}
	for _, c := range combos {
		models = append(models, modelInfo{
			ID:       c.Name,
			Provider: c.Strategy,
			Type:     "combo",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"models": models})
}

func (rt *Router) handleShutdown(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	// Trigger shutdown after a short delay so the response is flushed.
	go func() {
		time.Sleep(100 * time.Millisecond)
		rt.shutdown()
	}()
}

// --- UI ---

func (rt *Router) serveUI(w http.ResponseWriter, r *http.Request) {
	staticFS, err := fs.Sub(web.Static, "static")
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Serve static files (no cache for development)
	if r.URL.Path != "/" {
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		f := http.FileServer(http.FS(staticFS))
		f.ServeHTTP(w, r)
		return
	}

	// Serve index.html at root
	data, err := fs.ReadFile(staticFS, "index.html")
	if err != nil {
		http.Error(w, "index.html not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html")
	w.Write(data)
}

func mustJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
