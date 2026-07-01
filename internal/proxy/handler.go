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

// Handler processes /v1/* requests.
type Handler struct {
	reg     *registry.Registry
	selector *rotation.Selector
	comboRes *combo.Resolver
	usage    *usage.RingBuffer
	logger   *console.Logger
	client   *http.Client
}

// New creates a proxy Handler.
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

// ChatCompletions handles POST /v1/chat/completions
func (h *Handler) ChatCompletions(w http.ResponseWriter, r *http.Request) {
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

	// Check if it's a combo
	if h.comboRes.IsComboName(modelStr) {
		h.handleCombo(w, r, modelStr, bodyBytes, parsed, isStream, msgCount)
		return
	}

	// Single provider
	providerID, upstreamModel := splitModel(modelStr)
	if providerID == "" {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid model format: %s (expected provider/model)", modelStr))
		return
	}

	h.logger.Info("REQUEST %s | %s | %d msgs", providerID, upstreamModel, msgCount)
	h.forwardWithRetry(w, r, providerID, upstreamModel, bodyBytes, parsed, isStream, msgCount)
}

// handleCombo resolves a combo and executes according to its strategy.
func (h *Handler) handleCombo(w http.ResponseWriter, r *http.Request, comboName string, bodyBytes []byte, parsed map[string]any, isStream bool, msgCount int) {
	plan, err := h.comboRes.Resolve(comboName)
	if err != nil || plan == nil || len(plan.Targets) == 0 {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("combo not found or empty: %s", comboName))
		return
	}

	switch plan.Strategy {
	case "fallback":
		for _, target := range plan.Targets {
			h.logger.Info("REQUEST [combo:%s] %s | %s | %d msgs", comboName, target.ProviderID, target.Model, msgCount)
			// Try this target; if it fails, move to next
			h.forwardWithRetry(w, r, target.ProviderID, target.Model, bodyBytes, parsed, isStream, msgCount)
			return // forwardWithRetry handles its own response writing
		}
	case "round-robin":
		target := plan.Targets[0]
		h.logger.Info("REQUEST [combo:%s] %s | %s | %d msgs", comboName, target.ProviderID, target.Model, msgCount)
		h.forwardWithRetry(w, r, target.ProviderID, target.Model, bodyBytes, parsed, isStream, msgCount)
	case "fusion":
		// Fusion: send to all targets in parallel, pick best response
		// For simplicity in initial implementation, fall back to first target
		// TODO: implement parallel fusion
		target := plan.Targets[0]
		h.logger.Info("REQUEST [combo:%s:fusion] %s | %s | %d msgs", comboName, target.ProviderID, target.Model, msgCount)
		h.forwardWithRetry(w, r, target.ProviderID, target.Model, bodyBytes, parsed, isStream, msgCount)
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown combo strategy: %s", plan.Strategy))
	}
}

// forwardWithRetry attempts to forward a request, retrying with different keys on failure.
func (h *Handler) forwardWithRetry(w http.ResponseWriter, r *http.Request, providerID, upstreamModel string, bodyBytes []byte, parsed map[string]any, isStream bool, msgCount int) {
	var excludeKeyIDs []string
	maxAttempts := 10 // safety valve

	for attempt := 0; attempt < maxAttempts; attempt++ {
		sel, err := h.selector.SelectKey(providerID, upstreamModel, excludeKeyIDs)
		if err != nil {
			h.logger.Error("no available keys for %s/%s: %v", providerID, upstreamModel, err)
			writeError(w, http.StatusBadGateway, fmt.Sprintf("no available keys: %v", err))
			return
		}

		// Update model in body to upstream model name
		parsed["model"] = upstreamModel
		upstreamBody, _ := json.Marshal(parsed)

		startTime := time.Now()
		resp, err := h.forwardUpstream(sel, upstreamBody, r.Header, isStream)

		if err != nil {
			h.logger.Error("upstream error: %v", err)
			h.selector.MarkUnavailable(providerID, sel.Key.ID, upstreamModel, 0, err.Error())
			excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
			h.recordUsage(providerID, upstreamModel, sel, "error", 0, 0, 0, err.Error())
			continue
		}

		// Handle 429
		if resp.StatusCode == 429 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			bodyStr := string(body)

			if rotation.Is429TempError(429, bodyStr) {
				// Temporary 429: retry same key up to MaxRetries
				maxRetries := h.selector.Settings().MaxRetries
				if attempt < maxRetries {
					h.logger.Warn("429 temp rate limit, retrying in %ds (attempt %d/%d)",
						h.selector.Settings().RetryDelaySec, attempt+1, maxRetries)
					time.Sleep(time.Duration(h.selector.Settings().RetryDelaySec) * time.Second)
					continue // same key, don't exclude
				}
			}

			// Daily quota or exhausted retries: mark unavailable, try next key
			h.selector.MarkUnavailable(providerID, sel.Key.ID, upstreamModel, 429, bodyStr)
			excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
			h.logger.Warn("429 quota/cooldown for key %s, switching key", sel.Key.Name)
			continue
		}

		// Handle other errors
		if resp.StatusCode >= 500 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			h.selector.MarkUnavailable(providerID, sel.Key.ID, upstreamModel, resp.StatusCode, string(body))
			excludeKeyIDs = append(excludeKeyIDs, sel.Key.ID)
			h.logger.Error("upstream %d for key %s, switching", resp.StatusCode, sel.Key.Name)
			continue
		}

		// Success path
		h.selector.ClearError(providerID, sel.Key.ID, upstreamModel)

		maskedURL := maskURL(sel.Provider.BaseURL)
		h.logger.Info("PROXY %s | %s | conn=%s | url=%s", providerID, upstreamModel, sel.KeyName, maskedURL)

		latencyMs := time.Since(startTime).Milliseconds()

		if isStream {
			h.streamResponse(w, resp, providerID, upstreamModel, sel, latencyMs)
		} else {
			h.passThroughResponse(w, resp, providerID, upstreamModel, sel, latencyMs)
		}
		return
	}

	writeError(w, http.StatusBadGateway, "all keys exhausted")
}

// forwardUpstream sends the request to the upstream provider.
func (h *Handler) forwardUpstream(sel *rotation.SelectedKey, body []byte, headers http.Header, isStream bool) (*http.Response, error) {
	url := strings.TrimSuffix(sel.Provider.BaseURL, "/") + "/v1/chat/completions"

	req, err := http.NewRequest("POST", url, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+sel.Key.Key)

	// Pass through select headers
	if ua := headers.Get("User-Agent"); ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	if isStream {
		req.Header.Set("Accept", "text/event-stream")
	}

	return h.client.Do(req)
}

// streamResponse streams an SSE response to the client.
func (h *Handler) streamResponse(w http.ResponseWriter, resp *http.Response, provider, model string, sel *rotation.SelectedKey, latencyMs int64) {
	defer resp.Body.Close()

	flusher, ok := w.(http.Flusher)
	if !ok {
		h.logger.Error("streaming not supported by response writer")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	buf := make([]byte, 32*1024)
	totalOutput := 0
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			flusher.Flush()
			totalOutput += n
		}
		if err != nil {
			break
		}
	}

	h.logger.Info("📊 [stream] %s | in=0 | out=%d | conn=%s", provider, totalOutput, sel.KeyName)
	h.logger.Info("🌊 [STREAM] %s | %s | %dms | %d", provider, model, latencyMs, resp.StatusCode)
	h.recordUsage(provider, model, sel, "success", latencyMs, 0, totalOutput, "")
}

// passThroughResponse sends a non-streaming response to the client.
func (h *Handler) passThroughResponse(w http.ResponseWriter, resp *http.Response, provider, model string, sel *rotation.SelectedKey, latencyMs int64) {
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		h.logger.Error("failed to read upstream response: %v", err)
		return
	}
	w.Write(bodyBytes)

	// Try to extract token counts from response
	inputTokens, outputTokens := extractTokens(bodyBytes)
	h.logger.Info("📊 [response] %s | in=%d | out=%d | conn=%s", provider, inputTokens, outputTokens, sel.KeyName)
	h.logger.Info("🌊 [RESPONSE] %s | %s | %dms | %d", provider, model, latencyMs, resp.StatusCode)
	h.recordUsage(provider, model, sel, "success", latencyMs, inputTokens, outputTokens, "")
}

// recordUsage writes a usage entry.
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

// ListModels handles GET /v1/models
func (h *Handler) ListModels(w http.ResponseWriter, r *http.Request) {
	providers := h.reg.ListProviders()
	combos := h.reg.ListCombos()

	type modelObj struct {
		ID      string `json:"id"`
		Object  string `json:"object"`
		OwnedBy string `json:"owned_by"`
	}

	var models []modelObj
	for _, p := range providers {
		if !p.IsActive {
			continue
		}
		models = append(models, modelObj{
			ID:      p.Prefix + "/*",
			Object:  "model",
			OwnedBy: p.Name,
		})
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

// --- Helpers ---

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
