package rotation

import (
	"fmt"
	"sync"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/registry"
)

// KeySelector combines key selection and cooldown management.
// *Selector implements this interface.
type KeySelector interface {
	CooldownManager
	SelectKey(providerID, model string, excludeKeyIDs []string) (*SelectedKey, error)
	OnKeyFailure(providerID, keyID, model string, statusCode int, body string)
	Settings() config.RotationConfig
	WaitNIMInterval(providerID, keyID string) time.Duration
	OnNIMRequestSuccess(providerID, keyID, model string)
	MarkNIM429(providerID, keyID, model string) time.Time
}

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
	// Apply NIM per-key request-count filter.
	if provider.APIType == "nim" {
		candidates = s.filterNIMCandidates(provider.ID, candidates)
	}
	var chosen config.Key
	strategy := s.effectiveStrategy(provider)
	switch strategy {
	case "round-robin":
		chosen = s.selectRoundRobin(provider, candidates, model)
	case "failover":
		chosen = s.selectRotation(provider, candidates)
	default:
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

// OnKeyFailure handles a key failure in a strategy-aware manner. For the "failover"
// strategy it rotates the key to the back of the queue (no cooldown lock). For other
// strategies it applies exponential backoff cooldown via MarkUnavailable.
func (s *Selector) OnKeyFailure(providerID, keyID, model string, statusCode int, body string) {
	provider, ok := s.reg.GetProvider(providerID)
	if !ok {
		s.MarkUnavailable(providerID, keyID, model, statusCode, body)
		return
	}
	// NIM 429 uses NIM-specific cooldown ladder, not exponential backoff.
	if provider.APIType == "nim" && statusCode == 429 {
		s.MarkNIM429(providerID, keyID, model)
		return
	}
	if s.effectiveStrategy(provider) == "failover" {
		s.RotateToBack(providerID, keyID, model, statusCode, body)
		return
	}
	s.MarkUnavailable(providerID, keyID, model, statusCode, body)
}

// RotateToBack marks a key as rotated to the back of the failover queue by setting
// RotatedAt to now. Does not set a ModelLock, so the key remains eligible and will be
// retried once it naturally returns to the front of the queue.
func (s *Selector) RotateToBack(providerID, keyID, model string, statusCode int, body string) {
	state := s.reg.GetKeyState(providerID, keyID)
	if state == nil {
		return
	}
	state.Lock()
	defer state.Unlock()
	state.RotatedAt = time.Now()
	state.Status = "active"
	state.LastError = fmt.Sprintf("%d: %s", statusCode, truncate(body, 200))
	state.LastErrorAt = time.Now()
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

// Compile-time interface checks.
var _ KeySelector = (*Selector)(nil)
