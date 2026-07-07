package registry

import (
	"sync"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
)

// Registry provides thread-safe access to providers, keys, combos, and runtime key states.
type Registry struct {
	cfgMu   sync.RWMutex
	config  *config.Config
	stateMu sync.RWMutex
	states  map[string]*KeyRuntimeState
}

// New creates a Registry from the given config.
func New(cfg *config.Config) *Registry {
	r := &Registry{
		config: cfg,
		states: make(map[string]*KeyRuntimeState),
	}
	r.reloadStatesLocked()
	return r
}

func (r *Registry) reloadStatesLocked() {
	newStates := make(map[string]*KeyRuntimeState)
	for _, p := range r.config.Providers {
		for _, k := range p.Keys {
		newStates[p.ID+"/"+k.ID] = &KeyRuntimeState{
			ModelLocks:  make(map[string]time.Time),
			ModelStatus: make(map[string]string),
			ModelErrors: make(map[string]string),
		}
		}
	}
	r.stateMu.Lock()
	r.states = newStates
	r.stateMu.Unlock()
}

func stateKey(providerID, keyID string) string {
	return providerID + "/" + keyID
}

// Config returns a copy of the current configuration.
func (r *Registry) Config() config.Config {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	return *r.config
}

// Reload replaces the config and reinitializes runtime states.
func (r *Registry) Reload(cfg *config.Config) {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	r.config = cfg
	r.reloadStatesLocked()
}
