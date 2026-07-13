package proxy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/usage"
	"github.com/tinyrouter/tinyrouter/internal/util"
)

func (h *Handler) handleProxy(w http.ResponseWriter, r *http.Request, path string) {
	defer r.Body.Close()
	// 32 MB 代理请求体上限（LLM prompt 可能很大，32MB 足够）
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	var parsed map[string]any
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	modelStr, _ := parsed["model"].(string)
	if modelStr == "" {
		writeError(w, http.StatusBadRequest, "missing 'model' field")
		return
	}

	isStream := false
	if s, ok := parsed["stream"].(bool); ok {
		isStream = s
	}

	msgCount := 0
	if msgs, ok := parsed["messages"].([]any); ok {
		msgCount = len(msgs)
	}

	if h.comboRes.IsComboName(modelStr) {
		h.handleCombo(w, r, modelStr, bodyBytes, parsed, isStream, msgCount, path)
		return
	}

	if qs, ok := h.reg.GetQuickSlotByName(modelStr); ok {
		models := qs.Models
		idx := qs.SelectedIndex
		if idx < 0 || idx >= len(models) {
			idx = 0
		}
		if idx < len(models) {
			modelStr = models[idx]
		} else {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("quickslot %s has no models", modelStr))
			return
		}
	}

	providerID, upstreamModel := util.SplitModel(modelStr)
	if providerID == "" {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid model format: %s (expected provider/model)", modelStr))
		return
	}

	// Resolve prefix to actual provider ID
	provider, ok := h.reg.GetProviderByPrefix(providerID)
	if !ok {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown provider prefix: %s", providerID))
		return
	}
	providerID = provider.ID

	// NIM providers must not participate in Combo routing: the model name
	// carries a nv/* prefix and never matches a combo name, so no combo
	// resolution is attempted for them — fall through to the forward path.
	if ok, _ := h.forwardWithRetry(w, r, providerID, upstreamModel, path, bodyBytes, parsed, isStream, msgCount, "", provider.Name); !ok {
		writeError(w, http.StatusBadGateway, "all keys exhausted")
	}
}

func (h *Handler) handleCombo(w http.ResponseWriter, r *http.Request, comboName string, bodyBytes []byte, parsed map[string]any, isStream bool, msgCount int, path string) {
	plan, err := h.comboRes.Resolve(comboName)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if plan == nil || len(plan.Targets) == 0 {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("combo not found or empty: %s", comboName))
		return
	}

	comboLabel := fmt.Sprintf("[combo:%s] ", comboName)
	switch plan.Strategy {
	case "fallback":
		for _, target := range plan.Targets {
			if ok, _ := h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount, comboLabel, ""); ok {
				return
			}
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
	case "round-robin":
		target := plan.Targets[0]
		if ok, _ := h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount, comboLabel, ""); !ok {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
		}
	case "greedy-squirrel":
		for _, target := range plan.Targets {
			if ok, _ := h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount, comboLabel, ""); ok {
				return
			}
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown combo strategy: %s", plan.Strategy))
	}
}

func (h *Handler) forwardWithRetry(w http.ResponseWriter, r *http.Request, providerID, upstreamModel, path string, bodyBytes []byte, parsed map[string]any, isStream bool, msgCount int, logLabel, providerName string) (bool, string) {
	state := &retryState{maxRetries: h.maxRetries()}

	cfgProvider, _ := h.reg.GetProvider(providerID)
	if isStream && cfgProvider != nil && cfgProvider.InjectStreamOpts {
		if _, ok := parsed["stream_options"]; !ok {
			parsed["stream_options"] = map[string]any{"include_usage": true}
		}
	}

	for {
		sel, err := h.selector.SelectKey(providerID, upstreamModel, state.excludeKeyIDs)
		if err != nil {
			h.logger.Error("no available keys for %s/%s: %v", providerID, upstreamModel, err)
			return false, ""
		}

		// Track in-flight: mark key as in-use immediately after selection.
		keyState := h.reg.GetKeyState(providerID, sel.Key.ID)
		if keyState != nil {
			keyState.IncInFlight()
		}

		if !state.requestLogged {
			h.logRequest(sel, logLabel, providerName, upstreamModel, msgCount, state)
		}

		// NIM min_interval: wait if too soon since last send on this key.
		if cfgProvider != nil && cfgProvider.IsNIM() {
			if wait := h.selector.WaitNIMInterval(providerID, sel.Key.ID); wait > 0 {
				h.logger.Debug("NIM min_interval wait %v for key %s", wait, sel.Key.Name)
				select {
				case <-r.Context().Done():
					h.logger.Debug("client canceled during NIM wait")
					return false, ""
				case <-time.After(wait):
				}
			}
		}

		parsed["model"] = upstreamModel
		if cfgProvider != nil && cfgProvider.IsGeminiOpenAICompat() {
			backfillThoughtSignatures(parsed, h.sigCache)
		}
		upstreamBody, err := json.Marshal(parsed)
		if err != nil {
			h.logger.Error("failed to marshal upstream body: %v", err)
			writeError(w, http.StatusInternalServerError, "internal marshalling error")
			return false, ""
		}
		h.logger.Debug("SEND %s | %s | body=%dB", sel.Provider.Name, upstreamModel, len(upstreamBody))

		// Create a processing usage entry now that we are about to forward the
		// request. This gives the UI an immediate "request-start" signal so
		// the recent-requests list shows the entry the moment it arrives.
		reqID := generateRequestID()
		processingEntry := usage.Entry{
			ID:        reqID,
			Timestamp: time.Now(),
			Provider:  sel.Provider.Name,
			Model:     upstreamModel,
			KeyID:     sel.Key.ID,
			KeyName:   sel.KeyName,
			Status:    "processing",
		}
		upstreamURL := BuildUpstreamURL(sel.Provider.BaseURL, path)
		if h.debugMode() {
			if len(bodyBytes) > 0 {
				rb := bodyBytes
				if !json.Valid(rb) {
					rb, _ = json.Marshal(map[string]string{"raw": string(rb)})
				}
				processingEntry.ReqPayload = append([]byte(nil), rb...)
			}
			processingEntry.ReqHeaders = r.Header.Clone()
			processingEntry.UpstreamURL = upstreamURL
		}
		h.EntryTracker.Register(processingEntry)
		h.broadcastRequestStart(reqID, processingEntry)

		startTime := time.Now()
		resp, err := h.forwardUpstream(r.Context(), sel, upstreamBody, r.Header, isStream, path)

		if err != nil {
			h.handleNetworkError(sel, providerID, upstreamModel, err, state, reqID, r.Header, upstreamURL)
			h.EntryTracker.Remove(reqID)
			// DecInFlight before continue — cannot use defer in for loop (would
			// accumulate across retry iterations).
			if keyState != nil {
				keyState.DecInFlight()
			}
			h.InflightUpdates.Signal()
			continue
		}

		if resp.StatusCode == 429 {
			h.handle429(resp, sel, providerID, upstreamModel, startTime, state, r, reqID, upstreamURL)
			h.EntryTracker.Remove(reqID)
			if keyState != nil {
				keyState.DecInFlight()
			}
			h.InflightUpdates.Signal()
			continue
		}

		if resp.StatusCode >= 400 {
			h.handleUpstreamError(resp, sel, providerID, upstreamModel, state, r, reqID, upstreamURL, startTime)
			h.EntryTracker.Remove(reqID)
			if keyState != nil {
				keyState.DecInFlight()
			}
			h.InflightUpdates.Signal()
			continue
		}

		// 2xx success
		h.selector.ClearError(providerID, sel.Key.ID, upstreamModel)

		// Parse rate-limit headers and update key quota state
		h.parseAndUpdateQuota(sel, providerID, upstreamModel, resp.Header)

		// NIM: track request count and rotate if limit reached.
		if cfgProvider != nil && cfgProvider.IsNIM() {
			h.selector.OnNIMRequestSuccess(providerID, sel.Key.ID, upstreamModel)
		}

		maskedURL := maskURL(sel.Provider.BaseURL)
		h.logger.Info("PROXY %s | %s | conn=%s | url=%s", sel.Provider.Name, upstreamModel, sel.KeyName, maskedURL)

		latencyMs := time.Since(startTime).Milliseconds()

		if isStream {
			normalize := cfgProvider != nil && cfgProvider.NormalizeStreamChunks
			h.streamResponse(w, resp, upstreamModel, sel, latencyMs, bodyBytes, normalize, reqID, r.Header, upstreamURL)
		} else {
			h.passThroughResponse(w, resp, upstreamModel, sel, latencyMs, bodyBytes, reqID, r.Header, upstreamURL)
		}
		h.EntryTracker.Remove(reqID)
		// DecInFlight after the synchronous response handling completes — this
		// key is no longer "in-use". Cannot use defer (see above).
		if keyState != nil {
			keyState.DecInFlight()
		}
		h.InflightUpdates.Signal()
		return true, reqID
	}
}

func (h *Handler) broadcastRequestStart(id string, entry usage.Entry) {
	raw := MarshalEntryJSON(entry)
	if raw == nil {
		return
	}
	h.RequestUpdates.Broadcast(RequestEvent{
		Type:  "request-start",
		ID:    id,
		Entry: raw,
	})
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"message": msg,
			"type":    "proxy_error",
		},
	})
}

func maskURL(url string) string {
	if len(url) <= 20 {
		return url
	}
	return url[:20] + "..."
}

// backfillThoughtSignatures injects the cached Gemini thought_signature into
// assistant tool_calls that are missing it, keyed by tool_call id. Google
// rejects tool-call round trips whose tool_calls lack the signature that was
// returned in the prior response; the proxy caches those signatures as it
// streams the first response and replays them here. Existing signatures are
// never overwritten; cache misses are silently skipped (best-effort).
func backfillThoughtSignatures(parsed map[string]any, cache SignatureCacheProvider) {
	msgs, ok := parsed["messages"].([]any)
	if !ok {
		return
	}
	for _, m := range msgs {
		msg, ok := m.(map[string]any)
		if !ok {
			continue
		}
		role, _ := msg["role"].(string)
		if role != "assistant" {
			continue
		}
		toolCalls, ok := msg["tool_calls"].([]any)
		if !ok || len(toolCalls) == 0 {
			continue
		}
		for _, tc := range toolCalls {
			tcm, ok := tc.(map[string]any)
			if !ok {
				continue
			}
			id, _ := tcm["id"].(string)
			if id == "" {
				continue
			}
			if hasThoughtSignature(tcm) {
				continue
			}
			sig, ok := cache.Get(id)
			if !ok || sig == "" {
				continue
			}
			tcm["extra_content"] = map[string]any{
				"google": map[string]any{
					"thought_signature": sig,
				},
			}
		}
	}
}

func hasThoughtSignature(tc map[string]any) bool {
	extra, ok := tc["extra_content"].(map[string]any)
	if !ok {
		return false
	}
	google, ok := extra["google"].(map[string]any)
	if !ok {
		return false
	}
	sig, ok := google["thought_signature"].(string)
	return ok && sig != ""
}
