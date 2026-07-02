package proxy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/combo"
	"github.com/tinyrouter/tinyrouter/internal/console"
	"github.com/tinyrouter/tinyrouter/internal/registry"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/usage"
)

type Handler struct {
	reg           *registry.Registry
	selector      *rotation.Selector
	comboRes      *combo.Resolver
	usage         *usage.RingBuffer
	logger        *console.Logger
	client        *http.Client
	UsageUpdateCh chan struct{}
}

func New(reg *registry.Registry, selector *rotation.Selector, comboRes *combo.Resolver, usageBuf *usage.RingBuffer, logger *console.Logger) *Handler {
	return &Handler{
		reg:           reg,
		selector:      selector,
		comboRes:      comboRes,
		usage:         usageBuf,
		logger:        logger,
		UsageUpdateCh: make(chan struct{}, 1),
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
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer r.Body.Close()

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

	providerID, upstreamModel := splitModel(modelStr)
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

	if !h.forwardWithRetry(w, r, providerID, upstreamModel, path, bodyBytes, parsed, isStream, msgCount, "", provider.Name) {
		writeError(w, http.StatusBadGateway, "all keys exhausted")
	}
}

func (h *Handler) handleCombo(w http.ResponseWriter, r *http.Request, comboName string, bodyBytes []byte, parsed map[string]any, isStream bool, msgCount int, path string) {
	plan, err := h.comboRes.Resolve(comboName)
	if err != nil || plan == nil || len(plan.Targets) == 0 {
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
	case "fusion":
		target := plan.Targets[0]
		if !h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount, comboLabel, "") {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
		}
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown combo strategy: %s", plan.Strategy))
	}
}

func (h *Handler) forwardWithRetry(w http.ResponseWriter, r *http.Request, providerID, upstreamModel, path string, bodyBytes []byte, parsed map[string]any, isStream bool, msgCount int, logLabel, providerName string) bool {
	var excludeKeyIDs []string
	temp429Retries := 0
	requestLogged := false
	maxRetries := h.selector.Settings().MaxRetries
	if maxRetries <= 0 {
		maxRetries = 5
	}

	if isStream {
		if _, ok := parsed["stream_options"]; !ok {
			parsed["stream_options"] = map[string]any{"include_usage": true}
		}
	}

	for {
		sel, err := h.selector.SelectKey(providerID, upstreamModel, excludeKeyIDs)
		if err != nil {
			h.logger.Error("no available keys for %s/%s: %v", providerID, upstreamModel, err)
			return false
		}

		if !requestLogged {
			dspName := sel.Provider.Name
			if providerName != "" {
				dspName = providerName
			}
			h.logger.Info("REQUEST %s%s | %s | %d msgs | Key %s", logLabel, dspName, upstreamModel, msgCount, sel.Key.Name)
			requestLogged = true
		}

		parsed["model"] = upstreamModel
		upstreamBody, _ := json.Marshal(parsed)

		startTime := time.Now()
		resp, err := h.forwardUpstream(sel, upstreamBody, r.Header, isStream, path)

		if err != nil {
			h.logger.Error("upstream error: %v", err)
			h.selector.MarkUnavailable(providerID, sel.Key.ID, upstreamModel, 0, err.Error())
			excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
			h.recordUsage(providerID, upstreamModel, sel, "error", 0, 0, 0, err.Error())
			temp429Retries = 0
			continue
		}

		if resp.StatusCode == 429 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			bodyStr := string(body)
			latency429 := time.Since(startTime).Milliseconds()

			if rotation.IsDailyQuota429(bodyStr, upstreamModel) {
				h.selector.MarkDailyQuotaLocked(providerID, sel.Key.ID, upstreamModel, bodyStr)
				excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
				temp429Retries = 0
				h.logger.Warn("429 daily quota: %s | locked Key %s until next CST day", truncStr(bodyStr, 200), sel.Key.Name)
				h.recordUsage(sel.Provider.Name, upstreamModel, sel, "error", latency429, 0, 0, bodyStr)
				continue
			}

			if temp429Retries < maxRetries {
				temp429Retries++
				h.logger.Warn("429: %s | retrying in %ds (attempt %d/%d) [Key %s]",
					truncStr(bodyStr, 200), h.selector.Settings().RetryDelaySec, temp429Retries, maxRetries, sel.Key.Name)
				h.recordUsage(sel.Provider.Name, upstreamModel, sel, "error", latency429, 0, 0, bodyStr)
				time.Sleep(time.Duration(h.selector.Settings().RetryDelaySec) * time.Second)
				continue
			}

			excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
			temp429Retries = 0
			h.logger.Warn("429 retries exhausted for Key %s, switching", sel.Key.Name)
			h.recordUsage(sel.Provider.Name, upstreamModel, sel, "error", latency429, 0, 0, bodyStr)
			continue
		}

		if resp.StatusCode >= 500 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			h.selector.MarkUnavailable(providerID, sel.Key.ID, upstreamModel, resp.StatusCode, string(body))
			excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
			h.logger.Error("upstream %d for Key %s (%s), switching", resp.StatusCode, sel.Key.Name, sel.Provider.Name)
			temp429Retries = 0
			continue
		}

		if resp.StatusCode >= 400 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			h.selector.MarkUnavailable(providerID, sel.Key.ID, upstreamModel, resp.StatusCode, string(body))
			excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
			h.logger.Error("upstream %d for Key %s (%s), switching", resp.StatusCode, sel.Key.Name, sel.Provider.Name)
			temp429Retries = 0
			continue
		}

		h.selector.ClearError(providerID, sel.Key.ID, upstreamModel)

		maskedURL := maskURL(sel.Provider.BaseURL)
		h.logger.Info("PROXY %s | %s | conn=%s | url=%s", sel.Provider.Name, upstreamModel, sel.KeyName, maskedURL)

		latencyMs := time.Since(startTime).Milliseconds()

		if isStream {
			h.streamResponse(w, resp, upstreamModel, sel, latencyMs)
		} else {
			h.passThroughResponse(w, resp, upstreamModel, sel, latencyMs)
		}
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
					ID:      p.Prefix + "/" + m,
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

func (h *Handler) recordUsage(provider, model string, sel *rotation.SelectedKey, status string, latencyMs int64, inputTokens, outputTokens int, errMsg string) {
	h.usage.Add(usage.Entry{
		Timestamp:    time.Now(),
		Provider:     sel.Provider.Name,
		Model:        model,
		KeyID:        sel.Key.ID,
		KeyName:      sel.KeyName,
		Status:       status,
		LatencyMs:    latencyMs,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		Error:        errMsg,
	})
	if status == "success" {
		select {
		case h.UsageUpdateCh <- struct{}{}:
		default:
		}
	}
}

func splitModel(s string) (string, string) {
	idx := strings.Index(s, "/")
	if idx < 0 {
		return "", s
	}
	return s[:idx], s[idx+1:]
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

func truncStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func extractTokens(body []byte) (int, int) {
	var resp map[string]any
	if err := json.Unmarshal(body, &resp); err != nil {
		return 0, 0
	}
	usage, ok := resp["usage"].(map[string]any)
	if !ok {
		return 0, 0
	}
	in := tokenVal(usage, "prompt_tokens", "input_tokens")
	out := tokenVal(usage, "completion_tokens", "output_tokens")
	if in == 0 && out == 0 {
		total, _ := usage["total_tokens"].(float64)
		if total > 0 {
			return int(total), 0
		}
	}
	return int(in), int(out)
}

func tokenVal(m map[string]any, keys ...string) float64 {
	for _, k := range keys {
		if v, ok := m[k].(float64); ok && v > 0 {
			return v
		}
	}
	return 0
}
