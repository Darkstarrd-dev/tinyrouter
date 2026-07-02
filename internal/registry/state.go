package registry

import (
	"sync"
	"time"
)

// QuotaInfo holds the latest known quota snapshot for a model.
type QuotaInfo struct {
	ModelLimit      int
	ModelRemaining  int
	GlobalLimit     int
	GlobalRemaining int
	LastUpdated     time.Time
}

// KeyRuntimeState holds mutable per-key runtime state (not persisted to YAML).
type KeyRuntimeState struct {
	mu           sync.Mutex
	Status       string // "active" | "cooldown" | "locked"
	BackoffLevel int
	ModelLocks   map[string]time.Time
	LastUsedAt   time.Time
	ConsecCount  int
	LastError    string
	LastErrorAt  time.Time
	ModelQuotas  map[string]*QuotaInfo
}

// Lock acquires the state's mutex.
func (s *KeyRuntimeState) Lock() { s.mu.Lock() }

// Unlock releases the state's mutex.
func (s *KeyRuntimeState) Unlock() { s.mu.Unlock() }

// GetKeyState returns the runtime state for a key, or nil if not found.
func (r *Registry) GetKeyState(providerID, keyID string) *KeyRuntimeState {
	r.stateMu.RLock()
	defer r.stateMu.RUnlock()
	return r.states[stateKey(providerID, keyID)]
}

// UpdateQuota stores the latest quota snapshot for a model on this key.
func (s *KeyRuntimeState) UpdateQuota(model string, modelLimit, modelRemaining, globalLimit, globalRemaining int) {
	s.Lock()
	defer s.Unlock()
	if s.ModelQuotas == nil {
		s.ModelQuotas = make(map[string]*QuotaInfo)
	}
	s.ModelQuotas[model] = &QuotaInfo{
		ModelLimit:      modelLimit,
		ModelRemaining:  modelRemaining,
		GlobalLimit:     globalLimit,
		GlobalRemaining: globalRemaining,
		LastUpdated:     time.Now(),
	}
}

// GetQuota returns the latest quota snapshot for a model, or nil.
func (s *KeyRuntimeState) GetQuota(model string) *QuotaInfo {
	s.Lock()
	defer s.Unlock()
	return s.ModelQuotas[model]
}
