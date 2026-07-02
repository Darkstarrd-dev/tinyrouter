package registry

import (
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
)

// --- Providers ---

func (r *Registry) ListProviders() []config.Provider {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	out := make([]config.Provider, len(r.config.Providers))
	copy(out, r.config.Providers)
	return out
}

func (r *Registry) GetProvider(id string) (*config.Provider, bool) {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID == id {
			p := r.config.Providers[i]
			return &p, true
		}
	}
	return nil, false
}

// GetProviderByPrefix finds a provider by its prefix string.
func (r *Registry) GetProviderByPrefix(prefix string) (*config.Provider, bool) {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].Prefix == prefix {
			p := r.config.Providers[i]
			return &p, true
		}
	}
	return nil, false
}

func (r *Registry) AddProvider(p config.Provider) {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	r.config.Providers = append(r.config.Providers, p)

	r.stateMu.Lock()
	defer r.stateMu.Unlock()
	for _, k := range p.Keys {
		r.states[p.ID+"/"+k.ID] = &KeyRuntimeState{
			Status:     "active",
			ModelLocks: make(map[string]time.Time),
		}
	}
}

func (r *Registry) UpdateProvider(id string, updates config.Provider) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID == id {
			r.config.Providers[i].Name = updates.Name
			r.config.Providers[i].Prefix = updates.Prefix
			r.config.Providers[i].BaseURL = updates.BaseURL
			r.config.Providers[i].IsActive = updates.IsActive
			r.config.Providers[i].RotationStrategy = updates.RotationStrategy
			r.config.Providers[i].StickyLimit = updates.StickyLimit
			return true
		}
	}
	return false
}

func (r *Registry) DeleteProvider(id string) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i, p := range r.config.Providers {
		if p.ID == id {
			r.config.Providers = append(r.config.Providers[:i], r.config.Providers[i+1:]...)

			r.stateMu.Lock()
			for _, k := range p.Keys {
				delete(r.states, stateKey(id, k.ID))
			}
			r.stateMu.Unlock()

			return true
		}
	}
	return false
}

// UpdateProviderStrategy updates per-provider rotation strategy override.
func (r *Registry) UpdateProviderStrategy(providerID, strategy string, stickyLimit int) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID == providerID {
			r.config.Providers[i].RotationStrategy = strategy
			r.config.Providers[i].StickyLimit = stickyLimit
			return true
		}
	}
	return false
}
