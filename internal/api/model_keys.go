package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/usage"
)

// --- Model-Key detail / ordering ---

func (rt *Router) getModelKeys(w http.ResponseWriter, r *http.Request) {
	providerName := r.URL.Query().Get("provider")
	model := r.URL.Query().Get("model")
	if providerName == "" || model == "" {
		writeAPIError(w, http.StatusBadRequest, "provider and model are required")
		return
	}

	var provider *config.Provider
	for _, p := range rt.reg.ListProviders() {
		if p.Name == providerName || p.ID == providerName {
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
		KeyID        string  `json:"keyId"`
		KeyName      string  `json:"keyName"`
		IsActive     bool    `json:"isActive"`
		Status       string  `json:"status"`
		HasQuota     bool    `json:"hasQuota"`
		ModelLimit   int     `json:"modelLimit"`
		ModelRemain  int     `json:"modelRemaining"`
		ModelLock    *string `json:"modelLock"`
		LastError    string  `json:"lastError"`
		LastUsedAt   string  `json:"lastUsedAt"`
		RotatedAt    string  `json:"rotatedAt"`
		Priority     int     `json:"priority"`
		ConfigIdx    int     `json:"configIdx"`
		SuccessCount int     `json:"successCount"`
		ErrorCount   int     `json:"errorCount"`
		AvgTTFTMs    int64   `json:"avgTtftMs"`
		AvgSpeed     float64 `json:"avgSpeed"`
		InFlight     int     `json:"inFlight"`
		LiveSpeed    float64 `json:"liveSpeed"`
	}

	hasQuota := false
	details := make([]keyDetail, 0, len(provider.Keys))

	// Fetch per-key usage stats
	keyStatEntries := rt.usage.Accumulator().KeyStatsFor(provider.Name, model)
	keyStatByID := make(map[string]usage.KeyStatEntry, len(keyStatEntries))
	for _, kse := range keyStatEntries {
		keyStatByID[kse.KeyID] = kse
	}

	// Fetch live speeds from inflight tracker
	liveSpeeds := make(map[string]float64)
	if rt.proxyHandler != nil && rt.proxyHandler.Inflight != nil {
		liveSpeeds = rt.proxyHandler.Inflight.LiveSpeedForKeys()
	}

	for idx, k := range provider.Keys {
		kd := keyDetail{
			KeyID:     k.ID,
			KeyName:   k.Name,
			IsActive:  k.IsActive,
			Status:    "active",
			Priority:  k.Priority,
			ConfigIdx: idx,
		}
		state := rt.reg.GetKeyState(provider.ID, k.ID)
		if state != nil {
			func() {
				state.Lock()
				defer state.Unlock()
				kd.InFlight = state.InFlight
				if unlock, ok := state.ModelLocks[model]; ok {
					if time.Now().Before(unlock) {
						s := unlock.Format("2006-01-02T15:04:05Z07:00")
						kd.ModelLock = &s
						kd.Status = state.ModelStatus[model]
						if kd.Status == "" {
							kd.Status = "cooldown"
						}
					}
				}
				if kd.Status == "" {
					kd.Status = "active"
				}
				kd.LastError = state.ModelErrors[model]
				if !state.LastUsedAt.IsZero() {
					kd.LastUsedAt = state.LastUsedAt.Format("2006-01-02T15:04:05Z07:00")
				}
				if !state.RotatedAt.IsZero() {
					kd.RotatedAt = state.RotatedAt.Format("2006-01-02T15:04:05Z07:00")
				}
				if q := state.ModelQuotas[model]; q != nil {
					kd.HasQuota = true
					kd.ModelLimit = q.ModelLimit
					kd.ModelRemain = q.ModelRemaining
					hasQuota = true
				}
			}()
		}
		if kse, ok := keyStatByID[k.ID]; ok {
			kd.SuccessCount = kse.SuccessCount
			kd.ErrorCount = kse.ErrorCount
			kd.AvgTTFTMs = kse.AvgTTFTMs
			kd.AvgSpeed = kse.AvgSpeed
		}
		if liveSpeed, ok := liveSpeeds[provider.ID+"/"+k.ID]; ok {
			kd.LiveSpeed = liveSpeed
		}
		details = append(details, kd)
	}

	// Sort details by the provider's effective rotation strategy so the "currently
	// in-use" key lands at the top. Unavailable keys (inactive / cooldown / locked
	// for this model) always sink to the bottom.
	strategy := provider.RotationStrategy
	if strategy == "" {
		strategy = rt.selector.Settings().Strategy
	}

	type sortKey struct {
		usable    bool
		t1        time.Time // primary compare, interpretation depends on strategy
		priority  int
		configIdx int
		lastUsed  time.Time
		idx       int // position in details, for stable reassembly
	}
	keys := make([]sortKey, len(details))
	for i, d := range details {
		var lu, rot time.Time
		if d.LastUsedAt != "" {
			var parseErr error
			lu, parseErr = time.Parse(time.RFC3339, d.LastUsedAt)
			if parseErr != nil {
				rt.logger.Debug("parse LastUsedAt failed for %s: %v", d.KeyID, parseErr)
			}
		}
		if d.RotatedAt != "" {
			rot, _ = time.Parse(time.RFC3339, d.RotatedAt)
		}
		usable := d.IsActive && d.ModelLock == nil
		keys[i] = sortKey{
			usable:    usable,
			t1:        rot, // failover: RotatedAt asc; never-rotated = zero = front
			priority:  d.Priority,
			configIdx: d.ConfigIdx,
			lastUsed:  lu,
			idx:       i,
		}
	}

	sort.SliceStable(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		if a.usable != b.usable {
			return a.usable
		}
		switch strategy {
		case "round-robin":
			// Most-recently-used usable key first; never-used sinks to bottom.
			if !a.lastUsed.Equal(b.lastUsed) {
				return a.lastUsed.After(b.lastUsed)
			}
			return a.configIdx < b.configIdx
		case "failover":
			// Never-rotated (zero RotatedAt) first, then RotatedAt asc.
			if !a.t1.Equal(b.t1) {
				return a.t1.Before(b.t1)
			}
			if a.priority != b.priority {
				return a.priority < b.priority
			}
			return a.configIdx < b.configIdx
		default: // fill-first
			if a.priority != b.priority {
				return a.priority < b.priority
			}
			return a.configIdx < b.configIdx
		}
	})

	sorted := make([]keyDetail, len(details))
	for i, k := range keys {
		sorted[i] = details[k.idx]
	}

	// Identify the in-use key (top usable entry) so the frontend can badge it.
	inUseKeyName := ""
	inUseKeyID := ""
	for _, d := range sorted {
		if d.IsActive && d.ModelLock == nil {
			inUseKeyName = d.KeyName
			inUseKeyID = d.KeyID
			break
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{
		"provider":         providerName,
		"model":            model,
		"hasQuota":         hasQuota,
		"keys":             sorted,
		"inUseKeyName":     inUseKeyName,
		"inUseKeyID":       inUseKeyID,
		"rotationStrategy": strategy,
	})
}
