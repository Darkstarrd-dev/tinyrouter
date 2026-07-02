package registry

// --- Models ---

// ListModels returns the custom model IDs for a provider.
func (r *Registry) ListModels(providerID string) []string {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID == providerID {
			out := make([]string, len(r.config.Providers[i].Models))
			copy(out, r.config.Providers[i].Models)
			return out
		}
	}
	return nil
}

// AddModel appends a model ID to the provider if not already present.
func (r *Registry) AddModel(providerID, model string) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		for _, m := range r.config.Providers[i].Models {
			if m == model {
				return true
			}
		}
		r.config.Providers[i].Models = append(r.config.Providers[i].Models, model)
		return true
	}
	return false
}

// DeleteModel removes a model ID from the provider.
func (r *Registry) DeleteModel(providerID, model string) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.Providers {
		if r.config.Providers[i].ID != providerID {
			continue
		}
		models := r.config.Providers[i].Models
		for j, m := range models {
			if m == model {
				r.config.Providers[i].Models = append(models[:j], models[j+1:]...)
				return true
			}
		}
		return false
	}
	return false
}
