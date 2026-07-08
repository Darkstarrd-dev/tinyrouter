package api

import (
	"encoding/json"
	"net/http"
)

func (rt *Router) resetQuota(w http.ResponseWriter, r *http.Request) {
	rt.reg.ResetAllCooldowns()
	if rt.stateSaveFunc != nil {
		rt.stateSaveFunc()
	}
	if rt.logger != nil {
		rt.logger.Info("all cooldowns and quota locks reset via API")
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}