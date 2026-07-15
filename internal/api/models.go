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
		ID          string   `json:"id"`
		RealModelID string   `json:"realModelId,omitempty"` // raw ModelDef.ID (alias-stripped) for PATCH calls — only for provider type
		Provider    string   `json:"provider"`
		ProviderID  string   `json:"providerId,omitempty"`  // internal provider ID for PATCH calls (only for provider type)
		Type        string   `json:"type"`                  // "provider" | "combo"
		Kind        string   `json:"kind,omitempty"`         // "text" (default/empty) | "image" — only for provider type
		ImgProtocol string   `json:"imgProtocol,omitempty"` // "gpt" | "xai" | "modelscope" — only for provider type
		ImgSizes    []string `json:"imgSizes,omitempty"`    // custom size list for image models — only for provider type
		Note        string   `json:"note,omitempty"`        // model note, if set — only for provider type
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
					RealModelID: m.ID,
					Provider:    p.Name,
					ProviderID:  p.ID,
					Type:        "provider",
					Kind:        m.Kind,
					ImgProtocol: m.ImgProtocol,
					ImgSizes:    m.ImgSizes,
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
