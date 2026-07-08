package proxy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/combo"
	"github.com/tinyrouter/tinyrouter/internal/console"
	"github.com/tinyrouter/tinyrouter/internal/registry"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/usage"
	"github.com/tinyrouter/tinyrouter/internal/util"
)

type Handler struct {
	reg               *registry.Registry
	selector          rotation.KeySelector
	comboRes          *combo.Resolver
	usage             usage.UsageStore
	quotaTracker      *usage.QuotaTracker
	logger            *console.Logger
	client            *http.Client
	UsageUpdates      *Broadcaster
	InflightUpdates   *Broadcaster
	Inflight          *InflightTracker
	debugModeProvider func() bool
}

func New(reg *registry.Registry, selector rotation.KeySelector, comboRes *combo.Resolver, usageBuf usage.UsageStore, quotaTracker *usage.QuotaTracker, logger *console.Logger) *Handler {
	return &Handler{
		reg:              reg,
		selector:         selector,
		comboRes:         comboRes,
		usage:            usageBuf,
		quotaTracker:     quotaTracker,
		logger:           logger,
		UsageUpdates:     NewBroadcaster(4),
		InflightUpdates:  NewBroadcaster(4),
		Inflight:         NewInflightTracker(),
		client: &http.Client{
			Timeout: 300 * time.Second,
		},
	}
}

func (h *Handler) ChatCompletions(w http.ResponseWriter, r *http.Request) {
	h.handleProxy(w, r, "/v1/chat/completions")
}

func (h *Handler) Completions(w http.ResponseWriter, r *http.Request) {
	h.handleProxy(w, r, "/v1/completions")
}

func (h *Handler) handleProxy(w http.ResponseWriter, r *http.Request, path string) {
	defer r.Body.Close()
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
	if !h.forwardWithRetry(w, r, providerID, upstreamModel, path, bodyBytes, parsed, isStream, msgCount, "", provider.Name) {
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
			if h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount, comboLabel, "") {
				return
			}
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
	case "round-robin":
		target := plan.Targets[0]
		if !h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount, comboLabel, "") {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
		}
	case "greedy-squirrel":
		for _, target := range plan.Targets {
			if h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount, comboLabel, "") {
				return
			}
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown combo strategy: %s", plan.Strategy))
	}
}

func (h *Handler) forwardWithRetry(w http.ResponseWriter, r *http.Request, providerID, upstreamModel, path string, bodyBytes []byte, parsed map[string]any, isStream bool, msgCount int, logLabel, providerName string) bool {
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
			return false
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
					return false
				case <-time.After(wait):
				}
			}
		}

		parsed["model"] = upstreamModel
		upstreamBody, err := json.Marshal(parsed)
		if err != nil {
			h.logger.Error("failed to marshal upstream body: %v", err)
			writeError(w, http.StatusInternalServerError, "internal marshalling error")
			return false
		}
		h.logger.Debug("SEND %s | %s | body=%dB | %s", sel.Provider.Name, upstreamModel, len(upstreamBody), util.TruncStr(string(upstreamBody), 500))

		startTime := time.Now()
		resp, err := h.forwardUpstream(sel, upstreamBody, r.Header, isStream, path)

		if err != nil {
			h.handleNetworkError(sel, providerID, upstreamModel, err, state)
			// DecInFlight before continue — cannot use defer in for loop (would
			// accumulate across retry iterations).
			if keyState != nil {
				keyState.DecInFlight()
			}
			h.InflightUpdates.Signal()
			continue
		}

		if resp.StatusCode == 429 {
			h.handle429(resp, sel, providerID, upstreamModel, startTime, state, r)
			if keyState != nil {
				keyState.DecInFlight()
			}
			h.InflightUpdates.Signal()
			continue
		}

		if resp.StatusCode >= 400 {
			h.handleUpstreamError(resp, sel, providerID, upstreamModel, state)
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
			h.streamResponse(w, resp, upstreamModel, sel, latencyMs, bodyBytes, normalize)
		} else {
			h.passThroughResponse(w, resp, upstreamModel, sel, latencyMs, bodyBytes)
		}
		// DecInFlight after the synchronous response handling completes — this
		// key is no longer "in-use". Cannot use defer (see above).
		if keyState != nil {
			keyState.DecInFlight()
		}
		h.InflightUpdates.Signal()
		return true
	}
}

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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"object": "list",
		"data":   models,
	})
}

func (h *Handler) SetDebugModeProvider(fn func() bool) {
	h.debugModeProvider = fn
}

func (h *Handler) debugMode() bool {
	if h.debugModeProvider != nil {
		return h.debugModeProvider()
	}
	return false
}

func (h *Handler) recordUsage(provider, model string, sel *rotation.SelectedKey, status string, latencyMs int64, ttftMs int64, inputTokens, outputTokens int, errMsg string, reqBody []byte, respBody []byte, respHeaders http.Header, respStatus int) {
	entry := usage.Entry{
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
	if h.debugMode() {
		if len(reqBody) > 0 {
			entry.ReqPayload = append([]byte(nil), reqBody...)
		}
		if len(respBody) > 0 {
			const maxRespBody = 64 * 1024
			if len(respBody) > maxRespBody {
				respBody = respBody[:maxRespBody]
			}
			entry.RespPayload = append([]byte(nil), respBody...)
		}
		if len(respHeaders) > 0 {
			entry.RespHeaders = respHeaders.Clone()
		}
		entry.RespStatus = respStatus
	}
	h.usage.Add(entry)
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
