package api

import (
	"encoding/json"
	"net/http"
)

// --- Models ---

// listModels returns the combined set of selectable models: every active
// provider model plus every combo.
func (rt *Router) listModels(w http.ResponseWriter, r *http.Request) {
	providers := rt.reg.ListProviders()
	combos := rt.reg.ListCombos()

	type modelInfo struct {
		ID          string `json:"id"`
		Provider    string `json:"provider"`
		Type        string `json:"type"`                  // "provider" | "combo"
		Kind        string `json:"kind,omitempty"`        // "text" (default/empty) | "image" — only for provider type
		ImgProtocol string `json:"imgProtocol,omitempty"` // "gpt" | "xai" | "modelscope" — only for provider type
		Note        string `json:"note,omitempty"`        // model note, if set — only for provider type
	}

	var models []modelInfo
	for _, p := range providers {
		if !p.IsActive {
			continue
		}
		if len(p.Models) > 0 {
			for _, m := range p.Models {
				displayID := m.ID
				if m.Alias != "" {
					displayID = m.Alias
				}
				models = append(models, modelInfo{
					ID:          p.Prefix + "/" + displayID,
					Provider:    p.Name,
					Type:        "provider",
					Kind:        m.Kind,
					ImgProtocol: m.ImgProtocol,
					Note:        m.Note,
				})
			}
		} else {
			models = append(models, modelInfo{
				ID:       p.Prefix + "/*",
				Provider: p.Name,
				Type:     "provider",
			})
		}
	}
	for _, c := range combos {
		models = append(models, modelInfo{
			ID:       c.Name,
			Provider: c.Strategy,
			Type:     "combo",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"models": models})
}
