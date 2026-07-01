package rotation

import (
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/registry"
)

// Selector chooses a key from a provider using the configured strategy.
type Selector struct {
	reg        *registry.Registry
	settings   *config.RotationConfig
	settingsMu sync.RWMutex
}

// New creates a Selector.
func New(reg *registry.Registry, settings *config.RotationConfig) *Selector {
	return &Selector{reg: reg, settings: settings}
}

// SelectedKey holds the chosen key plus context for logging.
type SelectedKey struct {
	Provider   config.Provider
	Key        config.Key
	KeyName    string
}

// SelectKey picks an active key for the given provider+model,
// excluding any keys in excludeKeyIDs.
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

	// Update runtime state
	state := s.reg.GetKeyState(provider.ID, chosen.ID)
	if state != nil {
		state.mu.Lock()
		state.LastUsedAt = time.Now()
		state.ConsecCount++
		state.mu.Unlock()
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

	// Find current sticky key (most recently used)
	var current *config.Key
	var currentLastUsed time.Time
	currentConsec := 0
	for i := range keys {
		state := s.reg.GetKeyState(providerID, keys[i].ID)
		if state == nil {
			continue
		}
		state.mu.Lock()
		if state.LastUsedAt.After(currentLastUsed) {
			currentLastUsed = state.LastUsedAt
			k := keys[i]
			current = &k
			currentConsec = state.ConsecCount
		}
		state.mu.Unlock()
	}

	// Reuse sticky key if under limit
	if current != nil && currentConsec < stickyLimit {
		return *current
	}

	// Switch to least recently used
	oldest := keys[0]
	oldestTime := time.Now()
	for _, k := range keys {
		state := s.reg.GetKeyState(providerID, k.ID)
		if state == nil {
			continue
		}
		state.mu.Lock()
		lu := state.LastUsedAt
		state.mu.Unlock()
		if lu.Before(oldestTime) || lu.IsZero() {
			oldestTime = lu
			oldest = k
		}
	}

	// Reset consec count for the new key
	state := s.reg.GetKeyState(providerID, oldest.ID)
	if state != nil {
		state.mu.Lock()
		state.ConsecCount = 0
		state.mu.Unlock()
	}
	return oldest
}

// isKeyAvailable checks model locks and cooldown expiry.
func (s *Selector) isKeyAvailable(state *registry.KeyRuntimeState, model string) bool {
	state.mu.Lock()
	defer state.mu.Unlock()

	now := time.Now()

	// Check per-model lock
	if unlock, ok := state.ModelLocks[model]; ok {
		if now.Before(unlock) {
			return false
		}
		delete(state.ModelLocks, model)
	}

	// Check all expired locks, clean up
	for m, unlock := range state.ModelLocks {
		if !now.Before(unlock) {
			delete(state.ModelLocks, m)
		}
	}

	state.Status = "active"
	return true
}

// --- Cooldown ---

// MarkUnavailable marks a key as unavailable for a model and returns the unlock time.
func (s *Selector) MarkUnavailable(providerID, keyID, model string, statusCode int, body string) time.Time {
	state := s.reg.GetKeyState(providerID, keyID)
	if state == nil {
		return time.Time{}
	}
	state.mu.Lock()
	defer state.mu.Unlock()

	// 429 daily quota → lock until next CST midnight + 5 min
	if statusCode == 429 && isDailyQuota(body) {
		unlock := nextCSTMidnight05()
		state.ModelLocks[model] = unlock
		state.Status = "locked"
		state.LastError = fmt.Sprintf("429 daily quota: %s", truncate(body, 200))
		state.LastErrorAt = time.Now()
		return unlock
	}

	// Exponential backoff
	state.BackoffLevel++
	backoff := time.Duration(math.Pow(2, float64(state.BackoffLevel-1))) * time.Second
	maxBackoff := time.Duration(s.Settings().BackoffMaxSec) * time.Second
	if maxBackoff == 0 {
		maxBackoff = 240 * time.Second
	}
	if backoff > maxBackoff {
		backoff = maxBackoff
	}
	unlock := time.Now().Add(backoff)
	state.ModelLocks[model] = unlock
	state.Status = "cooldown"
	state.LastError = fmt.Sprintf("%d: %s", statusCode, truncate(body, 200))
	state.LastErrorAt = time.Now()
	return unlock
}

// ClearError clears the error state for a key+model on success.
func (s *Selector) ClearError(providerID, keyID, model string) {
	state := s.reg.GetKeyState(providerID, keyID)
	if state == nil {
		return
	}
	state.mu.Lock()
	defer state.mu.Unlock()

	delete(state.ModelLocks, model)
	// Only reset backoff if no locks remain
	if len(state.ModelLocks) == 0 {
		state.BackoffLevel = 0
		state.Status = "active"
		state.LastError = ""
	}
}

// nextCSTMidnight05 returns the next 00:05 CST (China Standard Time).
func nextCSTMidnight05() time.Time {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	now := time.Now().In(loc)
	next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 5, 0, 0, loc)
	return next
}

// isDailyQuota checks if a 429 response body indicates a daily quota exhaustion.
func isDailyQuota(body string) bool {
	lower := strings.ToLower(body)
	patterns := []string{
		"daily quota",
		"daily limit",
		"quota exceeded",
		"rate_limit_exceeded",
		"you exceeded your current quota",
	}
	for _, p := range patterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

// Is429TempError checks if a 429 is a temporary rate limit (not daily quota).
func Is429TempError(statusCode int, body string) bool {
	if statusCode != 429 {
		return false
	}
	return !isDailyQuota(body)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// Settings returns the current rotation settings (thread-safe copy).
func (s *Selector) Settings() config.RotationConfig {
	s.settingsMu.RLock()
	defer s.settingsMu.RUnlock()
	return *s.settings
}

// UpdateSettings updates rotation settings.
func (s *Selector) UpdateSettings(newSettings config.RotationConfig) {
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	*s.settings = newSettings
}

// Ensure sync is imported (already imported at top).
