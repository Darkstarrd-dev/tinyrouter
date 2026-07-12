package proxy

import (
	"encoding/json"
	"net/http"
)

func (h *Handler) ListModels(w http.ResponseWriter, r *http.Request) {
	providers := h.reg.ListProviders()
	combos := h.reg.ListCombos()

	type modelObj struct {
		ID      string `json:"id"`
		Object  string `json:"object"`
		OwnedBy string `json:"owned_by"`
	}

	var models []modelObj = []modelObj{}
	for _, p := range providers {
		if !p.IsActive {
			continue
		}
		if len(p.Models) > 0 {
			for _, m := range p.Models {
				models = append(models, modelObj{
					ID:      p.Prefix + "/" + m.ID,
					Object:  "model",
					OwnedBy: p.Name,
				})
			}
		} else {
			models = append(models, modelObj{
				ID:      p.Prefix + "/*",
				Object:  "model",
				OwnedBy: p.Name,
			})
		}
	}
	for _, c := range combos {
		if c.Disabled {
			continue
		}
		models = append(models, modelObj{
			ID:      c.Name,
			Object:  "model",
			OwnedBy: "combo",
		})
	}
	for _, qs := range h.reg.ListQuickSlots() {
		if qs.Disabled {
			continue
		}
		models = append(models, modelObj{
			ID:      qs.Name,
			Object:  "model",
			OwnedBy: "quickslot",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"object": "list",
		"data":   models,
	})
}
