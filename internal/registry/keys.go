package registry

import (
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
)

// --- Keys ---

// HasKey reports whether a key with the given ID exists under the given provider.
func (r *Registry) HasKey(providerID, keyID string) bool {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		for _, k := range r.config.Providers[i].Keys {
			if k.ID == keyID {
				return true
			}
		}
	}
	return false
}

func (r *Registry) AddKey(providerID string, k config.Key) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		r.config.Providers[i].Keys = append(r.config.Providers[i].Keys, k)

		r.stateMu.Lock()
		r.states[stateKey(providerID, k.ID)] = &KeyRuntimeState{
			Status:     "active",
			ModelLocks: make(map[string]time.Time),
		}
		r.stateMu.Unlock()

		return true
	}
	return false
}

func (r *Registry) DeleteKey(providerID, keyID string) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		keys := r.config.Providers[i].Keys
		for j, k := range keys {
			if k.ID == keyID {
				r.config.Providers[i].Keys = append(keys[:j], keys[j+1:]...)

				r.stateMu.Lock()
				delete(r.states, stateKey(providerID, keyID))
				r.stateMu.Unlock()

				return true
			}
		}
	}
	return false
}

func (r *Registry) UpdateKey(providerID, keyID string, updates config.Key) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
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
				k.Account = updates.Account
				return true
			}
		}
	}
	return false
}
