package registry

import (
	"sync"
	"time"
)

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
