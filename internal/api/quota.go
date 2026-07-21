package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/usage"
)

// --- Quota ---

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

	// Fill currentKeyName for each bar (the key the effective rotation strategy
	// would pick next), so the UI can show "in-use" next to the quota progress
	// without requiring an expand.
	for i := range bars {
		// Resolve model alias for display
		bars[i].Alias = rt.reg.ResolveModelAliasByID(bars[i].Provider, bars[i].Model)

		ck := rt.currentKey(bars[i].Provider, bars[i].Model)
		bars[i].CurrentKeyName = ck.Name
		bars[i].CurrentKeyID = ck.ID

		// Collect key names+IDs that have in-flight requests for this provider/model.
		names := make([]string, 0)
		ids := make([]string, 0)
		for _, p := range rt.reg.ListProviders() {
			if p.Name != bars[i].Provider {
				continue
			}
			for _, k := range p.Keys {
				if !k.IsActive {
					continue
				}
				state := rt.reg.GetKeyState(p.ID, k.ID)
				if state != nil && state.GetInFlight() > 0 {
					names = append(names, k.Name)
					ids = append(ids, k.ID)
				}
			}
			break
		}
		bars[i].InFlightKeyNames = names
		bars[i].InFlightKeyIDs = ids
	}

	// Sort by provider + model for stable ordering
	sort.Slice(bars, func(i, j int) bool {
		ki := bars[i].Provider + "/" + bars[i].Model
		kj := bars[j].Provider + "/" + bars[j].Model
		return ki < kj
	})

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{
		"quotas": bars,
	})
}

// currentKey holds the ID+Name of the key selected by the rotation strategy.
type currentKey struct {
	ID   string
	Name string
}

// currentKey returns the ID and Name of the key that the provider's effective
// rotation strategy would pick right now for the given model. Mirrors the
// ordering logic of getModelKeys so the value shown on the unexpanded quota
// bar matches the top row after expand. Returns zero value when no usable key exists.
func (rt *Router) currentKey(providerName, model string) currentKey {
	var provider *config.Provider
	for _, p := range rt.reg.ListProviders() {
		if p.Name == providerName || p.ID == providerName {
			pp := p
			provider = &pp
			break
		}
	}
	if provider == nil {
		return currentKey{}
	}
	strategy := provider.RotationStrategy
	if strategy == "" {
		strategy = rt.selector.Settings().Strategy
	}
	type sk struct {
		id        string
		name      string
		usable    bool
		priority  int
		configIdx int
		rotatedAt time.Time
		lastUsed  time.Time
	}
	cands := make([]sk, 0, len(provider.Keys))
	for idx, k := range provider.Keys {
		entry := sk{id: k.ID, name: k.Name, priority: k.Priority, configIdx: idx}
		state := rt.reg.GetKeyState(provider.ID, k.ID)
		if state != nil {
			func() {
				state.Lock()
				defer state.Unlock()
				entry.usable = k.IsActive
				if unlock, ok := state.ModelLocks[model]; ok && time.Now().Before(unlock) {
					entry.usable = false
				}
				entry.rotatedAt = state.RotatedAt
				entry.lastUsed = state.LastUsedAt
			}()
		} else {
			entry.usable = k.IsActive
		}
		if entry.usable {
			cands = append(cands, entry)
		}
	}
	if len(cands) == 0 {
		return currentKey{}
	}
	sort.SliceStable(cands, func(i, j int) bool {
		switch strategy {
		case "round-robin":
			if !cands[i].lastUsed.Equal(cands[j].lastUsed) {
				return cands[i].lastUsed.After(cands[j].lastUsed)
			}
		case "failover":
			if !cands[i].rotatedAt.Equal(cands[j].rotatedAt) {
				return cands[i].rotatedAt.Before(cands[j].rotatedAt)
			}
		}
		if cands[i].priority != cands[j].priority {
			return cands[i].priority < cands[j].priority
		}
		return cands[i].configIdx < cands[j].configIdx
	})
	return currentKey{ID: cands[0].id, Name: cands[0].name}
}
