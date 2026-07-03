package rotation

import (
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
)

// selectRotation picks the key at the front of the rotation queue for the "failover"
// strategy. Keys are ordered by RotatedAt ASC (zero value first = never failed = most
// preferred), with ties broken by Priority ASC then config order. On success the chosen
// key is not rotated, so it stays sticky at the front; on failure the caller rotates it
// to the back via RotateToBack.
func (s *Selector) selectRotation(provider *config.Provider, keys []config.Key) config.Key {
	best := keys[0]
	bestState := s.reg.GetKeyState(provider.ID, best.ID)
	var bestRotated time.Time
	var bestPriority int
	if bestState != nil {
		bestState.Lock()
		bestRotated = bestState.RotatedAt
		bestState.Unlock()
	}
	bestPriority = best.Priority
	for _, k := range keys[1:] {
		st := s.reg.GetKeyState(provider.ID, k.ID)
		var kRotated time.Time
		if st != nil {
			st.Lock()
			kRotated = st.RotatedAt
			st.Unlock()
		}
		if kRotated.Before(bestRotated) || (kRotated.Equal(bestRotated) && k.Priority < bestPriority) {
			best = k
			bestRotated = kRotated
			bestPriority = k.Priority
		}
	}
	return best
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
