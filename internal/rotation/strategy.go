package rotation

import (
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/registry"
)

func readRotatedAt(state *registry.KeyRuntimeState) time.Time {
	state.Lock()
	defer state.Unlock()
	return state.RotatedAt
}

func readKeyRoundRobinState(state *registry.KeyRuntimeState) (time.Time, int) {
	state.Lock()
	defer state.Unlock()
	return state.LastUsedAt, state.ConsecCount
}

func readLastUsedAt(state *registry.KeyRuntimeState) time.Time {
	state.Lock()
	defer state.Unlock()
	return state.LastUsedAt
}

func resetConsecCount(state *registry.KeyRuntimeState) {
	state.Lock()
	defer state.Unlock()
	state.ConsecCount = 0
}

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
		bestRotated = readRotatedAt(bestState)
	}
	bestPriority = best.Priority
	for _, k := range keys[1:] {
		st := s.reg.GetKeyState(provider.ID, k.ID)
		var kRotated time.Time
		if st != nil {
			kRotated = readRotatedAt(st)
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
		lu, consec := readKeyRoundRobinState(state)
		if lu.After(currentLastUsed) {
			currentLastUsed = lu
			k := keys[i]
			current = &k
			currentConsec = consec
		}
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
		lu := readLastUsedAt(state)
		if lu.Before(oldestTime) {
			oldestTime = lu
			oldest = k
		}
	}

	state := s.reg.GetKeyState(providerID, oldest.ID)
	if state != nil {
		resetConsecCount(state)
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
