package registry

import "github.com/tinyrouter/tinyrouter/internal/config"

// ListModels returns the custom model definitions for a provider.
func (r *Registry) ListModels(providerID string) []config.ModelDef {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID == providerID {
			out := make([]config.ModelDef, len(r.config.Providers[i].Models))
			copy(out, r.config.Providers[i].Models)
			return out
		}
	}
	return nil
}

// AddModel appends a model def to the provider if not already present.
func (r *Registry) AddModel(providerID string, model config.ModelDef) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		for _, m := range r.config.Providers[i].Models {
			if m.ID == model.ID {
				return true
			}
		}
		r.config.Providers[i].Models = append(r.config.Providers[i].Models, model)
		return true
	}
	return false
}

// DeleteModel removes a model def (by ID) from the provider.
func (r *Registry) DeleteModel(providerID, modelID string) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		models := r.config.Providers[i].Models
		for j, m := range models {
			if m.ID == modelID {
				r.config.Providers[i].Models = append(models[:j], models[j+1:]...)
				return true
			}
		}
		return false
	}
	return false
}

// UpdateModelQuotaType updates the QuotaType for a specific model on a provider.
func (r *Registry) UpdateModelQuotaType(providerID, modelID, quotaType string) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		for j := range r.config.Providers[i].Models {
			if r.config.Providers[i].Models[j].ID == modelID {
				r.config.Providers[i].Models[j].QuotaType = quotaType
				return true
			}
		}
		return false
	}
	return false
}
