package registry

import "github.com/tinyrouter/tinyrouter/internal/config"

// --- QuickSlots ---

func (r *Registry) ListQuickSlots() []config.QuickSlot {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	out := make([]config.QuickSlot, len(r.config.QuickSlots))
	copy(out, r.config.QuickSlots)
	return out
}

// GetQuickSlot returns a pointer to the quickslot with the given ID.
func (r *Registry) GetQuickSlot(id string) (*config.QuickSlot, bool) {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	for i := range r.config.QuickSlots {
		if r.config.QuickSlots[i].ID == id {
			qs := r.config.QuickSlots[i]
			return &qs, true
		}
	}
	return nil, false
}

// HasQuickSlot reports whether a quickslot with the given ID already exists.
func (r *Registry) HasQuickSlot(id string) bool {
	r.cfgMu.RLock()
	defer r.cfgMu.RUnlock()
	for i := range r.config.QuickSlots {
		if r.config.QuickSlots[i].ID == id {
			return true
		}
	}
	return false
}

func (r *Registry) AddQuickSlot(qs config.QuickSlot) {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	r.config.QuickSlots = append(r.config.QuickSlots, qs)
}

func (r *Registry) UpdateQuickSlot(id string, updates config.QuickSlot) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i := range r.config.QuickSlots {
		if r.config.QuickSlots[i].ID == id {
			r.config.QuickSlots[i].Name = updates.Name
			r.config.QuickSlots[i].Models = updates.Models
			r.config.QuickSlots[i].Disabled = updates.Disabled
			r.config.QuickSlots[i].DisabledModels = updates.DisabledModels
			r.config.QuickSlots[i].Order = updates.Order
			r.config.QuickSlots[i].SelectedIndex = updates.SelectedIndex
			return true
		}
	}
	return false
}

func (r *Registry) DeleteQuickSlot(id string) bool {
	r.cfgMu.Lock()
	defer r.cfgMu.Unlock()
	for i, qs := range r.config.QuickSlots {
		if qs.ID == id {
			r.config.QuickSlots = append(r.config.QuickSlots[:i], r.config.QuickSlots[i+1:]...)
			return true
		}
	}
	return false
}
