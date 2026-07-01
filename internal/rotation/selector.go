package rotation

import (
	"fmt"
	"sync"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/registry"
)

type Selector struct {
	reg        *registry.Registry
	settings   *config.RotationConfig
	settingsMu sync.RWMutex
}

func New(reg *registry.Registry, settings *config.RotationConfig) *Selector {
	return &Selector{reg: reg, settings: settings}
}

type SelectedKey struct {
	Provider config.Provider
	Key      config.Key
	KeyName  string
}

func (s *Selector) SelectKey(providerID, model string, excludeKeyIDs []string) (*SelectedKey, error) {
	provider, ok := s.reg.GetProvider(providerID)
	if !ok {
		return nil, fmt.Errorf("provider not found: %s", providerID)
	}
	if !provider.IsActive {
		return nil, fmt.Errorf("provider inactive: %s", providerID)
	}

	exclude := make(map[string]bool)
	for _, id := range excludeKeyIDs {
		exclude[id] = true
	}

	var candidates []config.Key
	for _, k := range provider.Keys {
		if !k.IsActive {
			continue
		}
		if exclude[k.ID] {
			continue
		}
		state := s.reg.GetKeyState(provider.ID, k.ID)
		if state == nil {
			continue
		}
		if !s.isKeyAvailable(state, model) {
			continue
		}
		candidates = append(candidates, k)
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no available keys for provider %s (model %s)", providerID, model)
	}

	var chosen config.Key
	strategy := s.Settings().Strategy
	if strategy == "round-robin" {
		chosen = s.selectRoundRobin(provider.ID, candidates, model)
	} else {
		chosen = s.selectFillFirst(candidates)
	}

	state := s.reg.GetKeyState(provider.ID, chosen.ID)
	if state != nil {
		state.Lock()
		state.LastUsedAt = time.Now()
		state.ConsecCount++
		state.Unlock()
	}

	return &SelectedKey{Provider: *provider, Key: chosen, KeyName: chosen.Name}, nil
}

func (s *Selector) selectFillFirst(keys []config.Key) config.Key {
	best := keys[0]
	for _, k := range keys[1:] {
		if k.Priority < best.Priority {
			best = k
		}
	}
	return best
}

func (s *Selector) selectRoundRobin(providerID string, keys []config.Key, model string) config.Key {
	stickyLimit := s.Settings().StickyLimit
	if stickyLimit <= 0 {
		stickyLimit = 3
	}

	var current *config.Key
	var currentLastUsed time.Time
	currentConsec := 0
	for i := range keys {
		state := s.reg.GetKeyState(providerID, keys[i].ID)
		if state == nil {
			continue
		}
		state.Lock()
		if state.LastUsedAt.After(currentLastUsed) {
			currentLastUsed = state.LastUsedAt
			k := keys[i]
			current = &k
			currentConsec = state.ConsecCount
		}
		state.Unlock()
	}

	if current != nil && currentConsec < stickyLimit {
		return *current
	}

	oldest := keys[0]
	oldestTime := time.Now()
	for _, k := range keys {
		state := s.reg.GetKeyState(providerID, k.ID)
		if state == nil {
			continue
		}
		state.Lock()
		lu := state.LastUsedAt
		state.Unlock()
		if lu.Before(oldestTime) {
			oldestTime = lu
			oldest = k
		}
	}

	state := s.reg.GetKeyState(providerID, oldest.ID)
	if state != nil {
		state.Lock()
		state.ConsecCount = 0
		state.Unlock()
	}
	return oldest
}

func (s *Selector) isKeyAvailable(state *registry.KeyRuntimeState, model string) bool {
	state.Lock()
	defer state.Unlock()

	now := time.Now()

	if unlock, ok := state.ModelLocks[model]; ok {
		if now.Before(unlock) {
			return false
		}
		delete(state.ModelLocks, model)
	}

	for m, unlock := range state.ModelLocks {
		if !now.Before(unlock) {
			delete(state.ModelLocks, m)
		}
	}

	state.Status = "active"
	return true
}

func (s *Selector) Settings() config.RotationConfig {
	s.settingsMu.RLock()
	defer s.settingsMu.RUnlock()
	return *s.settings
}

func (s *Selector) UpdateSettings(newSettings config.RotationConfig) {
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	*s.settings = newSettings
}