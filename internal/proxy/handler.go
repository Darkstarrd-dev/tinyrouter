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
	reg      *registry.Registry
	selector *rotation.Selector
	comboRes *combo.Resolver
	usage    *usage.RingBuffer
	logger   *console.Logger
	client   *http.Client
}

func New(reg *registry.Registry, selector *rotation.Selector, comboRes *combo.Resolver, usageBuf *usage.RingBuffer, logger *console.Logger) *Handler {
	return &Handler{
		reg:      reg,
		selector: selector,
		comboRes: comboRes,
		usage:    usageBuf,
		logger:   logger,
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

	h.logger.Info("REQUEST %s | %s | %d msgs", providerID, upstreamModel, msgCount)
	if !h.forwardWithRetry(w, r, providerID, upstreamModel, path, bodyBytes, parsed, isStream, msgCount) {
		writeError(w, http.StatusBadGateway, "all keys exhausted")
	}
}

func (h *Handler) handleCombo(w http.ResponseWriter, r *http.Request, comboName string, bodyBytes []byte, parsed map[string]any, isStream bool, msgCount int, path string) {
	plan, err := h.comboRes.Resolve(comboName)
	if err != nil || plan == nil || len(plan.Targets) == 0 {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("combo not found or empty: %s", comboName))
		return
	}

	switch plan.Strategy {
	case "fallback":
		for _, target := range plan.Targets {
			h.logger.Info("REQUEST [combo:%s] %s | %s | %d msgs", comboName, target.ProviderID, target.Model, msgCount)
			if h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount) {
				return
			}
		}
		writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
	case "round-robin":
		target := plan.Targets[0]
		h.logger.Info("REQUEST [combo:%s] %s | %s | %d msgs", comboName, target.ProviderID, target.Model, msgCount)
		if !h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount) {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
		}
	case "fusion":
		target := plan.Targets[0]
		h.logger.Info("REQUEST [combo:%s:fusion] %s | %s | %d msgs", comboName, target.ProviderID, target.Model, msgCount)
		if !h.forwardWithRetry(w, r, target.ProviderID, target.Model, path, bodyBytes, parsed, isStream, msgCount) {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("all keys exhausted for combo: %s", comboName))
		}
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown combo strategy: %s", plan.Strategy))
	}
}

func (h *Handler) forwardWithRetry(w http.ResponseWriter, r *http.Request, providerID, upstreamModel, path string, bodyBytes []byte, parsed map[string]any, isStream bool, msgCount int) bool {
	var excludeKeyIDs []string
	maxAttempts := 10

	for attempt := 0; attempt < maxAttempts; attempt++ {
		sel, err := h.selector.SelectKey(providerID, upstreamModel, excludeKeyIDs)
		if err != nil {
			h.logger.Error("no available keys for %s/%s: %v", providerID, upstreamModel, err)
			return false
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
			continue
		}

		if resp.StatusCode == 429 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			bodyStr := string(body)

			if rotation.Is429TempError(429, bodyStr) {
				maxRetries := h.selector.Settings().MaxRetries
				if attempt < maxRetries {
					h.logger.Warn("429 temp rate limit, retrying in %ds (attempt %d/%d)",
						h.selector.Settings().RetryDelaySec, attempt+1, maxRetries)
					time.Sleep(time.Duration(h.selector.Settings().RetryDelaySec) * time.Second)
					continue
				}
			}

			h.selector.MarkUnavailable(providerID, sel.Key.ID, upstreamModel, 429, bodyStr)
			excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
			h.logger.Warn("429 quota/cooldown for key %s, switching key", sel.Key.Name)
			continue
		}

		if resp.StatusCode >= 500 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			h.selector.MarkUnavailable(providerID, sel.Key.ID, upstreamModel, resp.StatusCode, string(body))
			excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
			h.logger.Error("upstream %d for key %s, switching", resp.StatusCode, sel.Key.Name)
			continue
		}

		h.selector.ClearError(providerID, sel.Key.ID, upstreamModel)

		maskedURL := maskURL(sel.Provider.BaseURL)
		h.logger.Info("PROXY %s | %s | conn=%s | url=%s", providerID, upstreamModel, sel.KeyName, maskedURL)

		latencyMs := time.Since(startTime).Milliseconds()

		if isStream {
			h.streamResponse(w, resp, providerID, upstreamModel, sel, latencyMs)
		} else {
			h.passThroughResponse(w, resp, providerID, upstreamModel, sel, latencyMs)
		}
		return true
	}

	return false
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
		Provider:     provider,
		Model:        model,
		KeyID:        sel.Key.ID,
		KeyName:      sel.KeyName,
		Status:       status,
		LatencyMs:    latencyMs,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		Error:        errMsg,
	})
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

func extractTokens(body []byte) (int, int) {
	var resp map[string]any
	if err := json.Unmarshal(body, &resp); err != nil {
		return 0, 0
	}
	if usage, ok := resp["usage"].(map[string]any); ok {
		in, _ := usage["prompt_tokens"].(float64)
		out, _ := usage["completion_tokens"].(float64)
		return int(in), int(out)
	}
	return 0, 0
}