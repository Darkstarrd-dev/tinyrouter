package rotation

import (
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
)

func (s *Selector) selectFillFirst(keys []config.Key) config.Key {
	best := keys[0]
	for _, k := range keys[1:] {
		if k.Priority < best.Priority {
			best = k
		}
	}
	return best
}

func (s *Selector) selectRoundRobin(provider *config.Provider, keys []config.Key, model string) config.Key {
	stickyLimit := s.effectiveStickyLimit(provider)
	if stickyLimit <= 0 {
		stickyLimit = 3
	}

	providerID := provider.ID

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

func (s *Selector) effectiveStrategy(provider *config.Provider) string {
	if provider.RotationStrategy != "" {
		return provider.RotationStrategy
	}
	return s.Settings().Strategy
}

func (s *Selector) effectiveStickyLimit(provider *config.Provider) int {
	if provider.StickyLimit > 0 {
		return provider.StickyLimit
	}
	return s.Settings().StickyLimit
}
