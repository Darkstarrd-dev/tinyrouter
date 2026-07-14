package proxy

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/usage"
)

// recordUsage records a completed (or errored) request into the usage ring
// buffer, broadcasts a request-done event for the live UI, and signals the
// usage broadcaster. It always captures request and response payloads/headers
// for the request inspector.
func (h *Handler) recordUsage(id string, provider, model string, sel *rotation.SelectedKey, status string, latencyMs int64, ttftMs int64, inputTokens, outputTokens int, errMsg string, reqBody []byte, respBody []byte, respHeaders http.Header, respStatus int, reqHeaders http.Header, upstreamURL string) {
	entry := usage.Entry{
		ID:           id,
		Timestamp:    time.Now(),
		Provider:     sel.Provider.Name,
		Model:        model,
		KeyID:        sel.Key.ID,
		KeyName:      sel.KeyName,
		Status:       status,
		LatencyMs:    latencyMs,
		TTFTMs:       ttftMs,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		Error:        errMsg,
	}
	if reqHeaders != nil {
		entry.Source = reqHeaders.Get("X-TinyRouter-Source")
	}
	if len(reqBody) > 0 {
		entry.ReqPayload = append([]byte(nil), reqBody...)
	}
	if len(respBody) > 0 {
		const maxRespBody = 512 * 1024
		if len(respBody) > maxRespBody {
			respBody = respBody[:maxRespBody]
		}
		if !json.Valid(respBody) {
			respBody, _ = json.Marshal(map[string]string{"raw": string(respBody)})
		}
		entry.RespPayload = append([]byte(nil), respBody...)
	}
	if len(respHeaders) > 0 {
		entry.RespHeaders = respHeaders.Clone()
	}
	entry.RespStatus = respStatus
	if len(reqHeaders) > 0 {
		entry.ReqHeaders = reqHeaders.Clone()
	}
	entry.UpstreamURL = upstreamURL
	h.usage.Add(entry)

	raw := MarshalEntryJSON(entry)
	if raw != nil {
		h.RequestUpdates.Broadcast(RequestEvent{
			Type:   "request-done",
			ID:     id,
			Status: status,
			Entry:  raw,
		})
	}
	h.UsageUpdates.Signal()
}

// parseAndUpdateQuota extracts rate-limit info from upstream response headers
// and stores it in the key's runtime state.
func (h *Handler) parseAndUpdateQuota(sel *rotation.SelectedKey, providerID, model string, headers http.Header) {
	adapter := rotation.GetAdapter(sel.Provider)
	snap := adapter.ParseHeaders(headers)
	if snap == nil {
		return
	}
	state := h.reg.GetKeyState(providerID, sel.Key.ID)
	if state == nil {
		return
	}
	state.UpdateQuota(model, snap.ModelLimit, snap.ModelRemaining, snap.GlobalLimit, snap.GlobalRemaining)
	// Count active keys for total capacity estimation
	activeKeyCount := 0
	for _, k := range sel.Provider.Keys {
		if k.IsActive {
			activeKeyCount++
		}
	}
	// Update the quota tracker for UI display
	h.quotaTracker.Update(sel.Provider.Name, model, sel.Key.ID, sel.Key.Name, snap.ModelLimit, snap.ModelRemaining, activeKeyCount)
}
