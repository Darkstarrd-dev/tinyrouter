package registry

import (
	"sync"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
)

// KeyRuntimeState holds mutable per-key runtime state (not persisted to YAML).
type KeyRuntimeState struct {
	mu           sync.Mutex
	Status       string            // "active" | "cooldown" | "locked"
	BackoffLevel int
	ModelLocks   map[string]time.Time // model → unlock time
	LastUsedAt   time.Time
	ConsecCount  int
	LastError    string
	LastErrorAt  time.Time
}

// Lock acquires the state's mutex.
func (s *KeyRuntimeState) Lock() { s.mu.Lock() }

// Unlock releases the state's mutex.
func (s *KeyRuntimeState) Unlock() { s.mu.Unlock() }

// Registry provides thread-safe access to providers, keys, and combos.
type Registry struct {
	mu     sync.RWMutex
	config *config.Config
	states map[string]*KeyRuntimeState // key: providerID + "/" + keyID
}

// New creates a Registry from the given config.
func New(cfg *config.Config) *Registry {
	r := &Registry{
		config: cfg,
		states: make(map[string]*KeyRuntimeState),
	}
	r.initStates()
	return r
}

func (r *Registry) initStates() {
	for _, p := range r.config.Providers {
		for _, k := range p.Keys {
			r.states[p.ID+"/"+k.ID] = &KeyRuntimeState{
				Status:     "active",
				ModelLocks: make(map[string]time.Time),
			}
		}
	}
}

func stateKey(providerID, keyID string) string {
	return providerID + "/" + keyID
}

// --- Providers ---

func (r *Registry) ListProviders() []config.Provider {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]config.Provider, len(r.config.Providers))
	copy(out, r.config.Providers)
	return out
}

func (r *Registry) GetProvider(id string) (*config.Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID == id {
			p := r.config.Providers[i]
			return &p, true
		}
	}
	return nil, false
}

func (r *Registry) AddProvider(p config.Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.config.Providers = append(r.config.Providers, p)
	for _, k := range p.Keys {
		r.states[p.ID+"/"+k.ID] = &KeyRuntimeState{
			Status:     "active",
			ModelLocks: make(map[string]time.Time),
		}
	}
}

func (r *Registry) UpdateProvider(id string, updates config.Provider) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID == id {
			r.config.Providers[i].Name = updates.Name
			r.config.Providers[i].Prefix = updates.Prefix
			r.config.Providers[i].BaseURL = updates.BaseURL
			r.config.Providers[i].IsActive = updates.IsActive
			return true
		}
	}
	return false
}

func (r *Registry) DeleteProvider(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, p := range r.config.Providers {
		if p.ID == id {
			r.config.Providers = append(r.config.Providers[:i], r.config.Providers[i+1:]...)
			for _, k := range p.Keys {
				delete(r.states, stateKey(id, k.ID))
			}
			return true
		}
	}
	return false
}

// --- Keys ---

func (r *Registry) AddKey(providerID string, k config.Key) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID == providerID {
			r.config.Providers[i].Keys = append(r.config.Providers[i].Keys, k)
			r.states[stateKey(providerID, k.ID)] = &KeyRuntimeState{
				Status:     "active",
				ModelLocks: make(map[string]time.Time),
			}
			return true
		}
	}
	return false
}

func (r *Registry) DeleteKey(providerID, keyID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		keys := r.config.Providers[i].Keys
		for j, k := range keys {
			if k.ID == keyID {
				r.config.Providers[i].Keys = append(keys[:j], keys[j+1:]...)
				delete(r.states, stateKey(providerID, keyID))
				return true
			}
		}
	}
	return false
}

func (r *Registry) UpdateKey(providerID, keyID string, updates config.Key) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		for j := range r.config.Providers[i].Keys {
			if r.config.Providers[i].Keys[j].ID == keyID {
				k := &r.config.Providers[i].Keys[j]
				k.Name = updates.Name
				k.Key = updates.Key
				k.Priority = updates.Priority
				k.IsActive = updates.IsActive
				return true
			}
		}
	}
	return false
}

// --- Combos ---

func (r *Registry) ListCombos() []config.Combo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]config.Combo, len(r.config.Combos))
	copy(out, r.config.Combos)
	return out
}

func (r *Registry) GetComboByName(name string) (*config.Combo, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for i := range r.config.Combos {
		if r.config.Combos[i].Name == name {
			c := r.config.Combos[i]
			return &c, true
		}
	}
	return nil, false
}

func (r *Registry) AddCombo(c config.Combo) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.config.Combos = append(r.config.Combos, c)
}

func (r *Registry) UpdateCombo(id string, updates config.Combo) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.config.Combos {
		if r.config.Combos[i].ID == id {
			r.config.Combos[i].Name = updates.Name
			r.config.Combos[i].Strategy = updates.Strategy
			r.config.Combos[i].Models = updates.Models
			r.config.Combos[i].FusionJudge = updates.FusionJudge
			return true
		}
	}
	return false
}

func (r *Registry) DeleteCombo(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, c := range r.config.Combos {
		if c.ID == id {
			r.config.Combos = append(r.config.Combos[:i], r.config.Combos[i+1:]...)
			return true
		}
	}
	return false
}

// --- Key Runtime State ---

func (r *Registry) GetKeyState(providerID, keyID string) *KeyRuntimeState {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.states[stateKey(providerID, keyID)]
}

// --- Config access ---

func (r *Registry) Config() *config.Config {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.config
}

// Reload replaces the config and reinitializes runtime states.
func (r *Registry) Reload(cfg *config.Config) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.config = cfg
	r.states = make(map[string]*KeyRuntimeState)
	r.initStates()
}
