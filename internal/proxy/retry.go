package proxy

import (
	"io"
	"net/http"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/rotation"
)

// retryState holds mutable state across retry iterations.
type retryState struct {
	excludeKeyIDs  []string
	temp429Retries int
	maxRetries     int
	requestLogged  bool
}

// maxRetries returns the configured max retry count with a default fallback.
func (h *Handler) maxRetries() int {
	mr := h.selector.Settings().MaxRetries
	if mr <= 0 {
		return 5
	}
	return mr
}

// logRequest logs the initial request line (only once per forwardWithRetry call).
func (h *Handler) logRequest(sel *rotation.SelectedKey, logLabel, providerName, upstreamModel string, msgCount int, state *retryState) {
	dspName := sel.Provider.Name
	if providerName != "" {
		dspName = providerName
	}
	h.logger.Info("REQUEST %s%s | %s | %d msgs | Key %s", logLabel, dspName, upstreamModel, msgCount, sel.Key.Name)
	state.requestLogged = true
}

// handleNetworkError processes upstream network errors. Always continues to the next key.
func (h *Handler) handleNetworkError(sel *rotation.SelectedKey, providerID, model string, err error, state *retryState) {
	h.logger.Error("upstream error: %v", err)
	h.selector.MarkUnavailable(providerID, sel.Key.ID, model, 0, err.Error())
	state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
	h.recordUsage(providerID, model, sel, "error", 0, 0, 0, err.Error())
	state.temp429Retries = 0
}

// handle429 processes HTTP 429 responses. Distinguishes daily quota locks from temporary rate limits.
func (h *Handler) handle429(resp *http.Response, sel *rotation.SelectedKey, providerID, model string, startTime time.Time, state *retryState) {
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	bodyStr := string(body)
	latencyMs := time.Since(startTime).Milliseconds()

	if rotation.IsDailyQuota429(bodyStr, model) {
		h.selector.MarkDailyQuotaLocked(providerID, sel.Key.ID, model, bodyStr)
		state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
		state.temp429Retries = 0
		h.logger.Warn("429 daily quota: %s | locked Key %s until next CST day", truncStr(bodyStr, 200), sel.Key.Name)
		h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, bodyStr)
		return
	}

	if state.temp429Retries < state.maxRetries {
		state.temp429Retries++
		h.logger.Warn("429: %s | retrying in %ds (attempt %d/%d) [Key %s]",
			truncStr(bodyStr, 200), h.selector.Settings().RetryDelaySec, state.temp429Retries, state.maxRetries, sel.Key.Name)
		h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, bodyStr)
		time.Sleep(time.Duration(h.selector.Settings().RetryDelaySec) * time.Second)
		return
	}

	state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
	state.temp429Retries = 0
	h.logger.Warn("429 retries exhausted for Key %s, switching", sel.Key.Name)
	h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, bodyStr)
}

// handleUpstreamError processes HTTP 5xx and 4xx (non-429) responses. Always switches to the next key.
func (h *Handler) handleUpstreamError(resp *http.Response, sel *rotation.SelectedKey, providerID, model string, state *retryState) {
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	h.selector.MarkUnavailable(providerID, sel.Key.ID, model, resp.StatusCode, string(body))
	state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
	h.logger.Error("upstream %d for Key %s (%s), body=%s | switching", resp.StatusCode, sel.Key.Name, sel.Provider.Name, truncStr(string(body), 500))
	state.temp429Retries = 0
}
