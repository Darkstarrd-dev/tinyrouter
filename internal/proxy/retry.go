package proxy

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/rotation"
)

// retryState holds mutable state across retry iterations.
type retryState struct {
	excludeKeyIDs  []string
	temp429Retries int
	tpmWaitRetries int
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
	h.selector.OnKeyFailure(providerID, sel.Key.ID, model, 0, err.Error())
	state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
	h.recordUsage(providerID, model, sel, "error", 0, 0, 0, 0, err.Error(), nil, nil, nil, 0)
	state.temp429Retries = 0
	state.tpmWaitRetries = 0
}

// handle429 processes HTTP 429 responses. Distinguishes daily quota locks from temporary rate limits.
func (h *Handler) handle429(resp *http.Response, sel *rotation.SelectedKey, providerID, model string, startTime time.Time, state *retryState) {
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	bodyStr := string(body)
	latencyMs := time.Since(startTime).Milliseconds()

	// NIM 429: use NIM-specific cooldown ladder.
	if sel.Provider.IsNIM() {
		h.selector.MarkNIM429(providerID, sel.Key.ID, model)
		state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
		state.temp429Retries = 0
		state.tpmWaitRetries = 0
		h.logger.Warn("429 NIM: key %s cooled ladder, rotating", sel.Key.Name)
		h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
		return
	}

	// Parse rate-limit headers from the 429 response (ModelScope returns them even on 429)
	adapter := rotation.GetAdapter(sel.Provider)
	snap := adapter.ParseHeaders(resp.Header)
	if snap != nil {
		// Update quota state from the 429 response headers
		keyState := h.reg.GetKeyState(providerID, sel.Key.ID)
		if keyState != nil {
			keyState.UpdateQuota(model, snap.ModelLimit, snap.ModelRemaining, snap.GlobalLimit, snap.GlobalRemaining)
		}
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

	// If adapter detected quota exhaustion (ModelRemaining == 0), lock the key for this model
	if snap != nil && snap.ModelExhausted() {
		h.selector.MarkDailyQuotaLocked(providerID, sel.Key.ID, model, bodyStr)
		state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
		state.temp429Retries = 0
		h.logger.Warn("429 quota exhausted: %s | locked Key %s until next CST day", truncStr(bodyStr, 200), sel.Key.Name)
		h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
		return
	}

	// If adapter has quota info but not exhausted, use progressive backoff sequence
	if snap != nil && snap.HasQuota() && !snap.ModelExhausted() {
		maxBackoffRetries := 10
		if state.temp429Retries < maxBackoffRetries {
			state.temp429Retries++
			delay := rotation.BackoffSequence(state.temp429Retries)
			h.logger.Warn("429: %s | retrying in %ds (attempt %d/%d) [Key %s]",
				truncStr(bodyStr, 200), delay, state.temp429Retries, maxBackoffRetries, sel.Key.Name)
			h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
			time.Sleep(time.Duration(delay) * time.Second)
			return
		}
		state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
		state.temp429Retries = 0
		h.selector.OnKeyFailure(providerID, sel.Key.ID, model, 429, bodyStr)
		h.logger.Warn("429 retries exhausted for Key %s, switching", sel.Key.Name)
		h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
		return
	}

	// SenseNova-style 429: no rate-limit headers, but body is classifiable into rpm/tpm.
	// Both are per-account per-model with ~60s sliding window, but need different strategies:
	//   - rpm (request count): switching to a fresh account always works (count resets)
	//   - tpm (token count): if the request itself is large, any account will 429 immediately;
	//     switching keys causes a cascade that locks all keys. So tpm waits and retries the
	//     same key instead of switching.
	if snType := classifySenseNova429(bodyStr); snType != sn429Unknown {
		switch snType {
		case sn429RPM:
			// rpm exhausted: per-account. Cool current key+model 60s, exclude same-account
			// keys, switch to a different account immediately.
			h.selector.MarkRateLimited(providerID, sel.Key.ID, model, 60*time.Second)
			h.excludeSameAccountKeys(sel, state)
			state.temp429Retries = 0
			h.logger.Warn("429 rpm: %s | Key %s cooled 60s, switching account", truncStr(bodyStr, 200), sel.Key.Name)
			h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
		case sn429TPM:
			// tpm exceeded: per-account. Do NOT switch keys (a large request will 429 on any
			// account). Wait 15s and retry the same key once; if still 429, cool 60s and fail.
			if state.tpmWaitRetries < 1 {
				state.tpmWaitRetries++
				h.logger.Warn("429 tpm: %s | Key %s waiting 15s, retrying same key (attempt %d/1)",
					truncStr(bodyStr, 200), sel.Key.Name, state.tpmWaitRetries)
				h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
				time.Sleep(15 * time.Second)
				return
			}
			h.selector.MarkRateLimited(providerID, sel.Key.ID, model, 60*time.Second)
			state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
			state.tpmWaitRetries = 0
			h.logger.Warn("429 tpm: %s | Key %s cooled 60s after retry exhausted", truncStr(bodyStr, 200), sel.Key.Name)
			h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
		}
		return
	}

	// Fallback: no adapter (SenseNova/Elysiver) — use original logic
	if rotation.IsDailyQuota429(bodyStr, model) {
		h.selector.MarkDailyQuotaLocked(providerID, sel.Key.ID, model, bodyStr)
		state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
		state.temp429Retries = 0
		h.logger.Warn("429 daily quota: %s | locked Key %s until next CST day", truncStr(bodyStr, 200), sel.Key.Name)
		h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
		return
	}

	if state.temp429Retries < state.maxRetries {
		state.temp429Retries++
		delay := rotation.BackoffSequence(state.temp429Retries)
		h.logger.Warn("429: %s | retrying in %ds (attempt %d/%d) [Key %s]",
			truncStr(bodyStr, 200), delay, state.temp429Retries, state.maxRetries, sel.Key.Name)
		h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
		time.Sleep(time.Duration(delay) * time.Second)
		return
	}

	state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
	state.temp429Retries = 0
	h.selector.OnKeyFailure(providerID, sel.Key.ID, model, 429, bodyStr)
	h.logger.Warn("429 retries exhausted for Key %s, switching", sel.Key.Name)
	h.recordUsage(sel.Provider.Name, model, sel, "error", latencyMs, 0, 0, 0, bodyStr, nil, body, resp.Header, resp.StatusCode)
}

// handleUpstreamError processes HTTP 5xx and 4xx (non-429) responses. Always switches to the next key.
func (h *Handler) handleUpstreamError(resp *http.Response, sel *rotation.SelectedKey, providerID, model string, state *retryState) {
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	h.selector.OnKeyFailure(providerID, sel.Key.ID, model, resp.StatusCode, string(body))
	state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
	h.logger.Error("upstream %d for Key %s (%s), body=%s | switching", resp.StatusCode, sel.Key.Name, sel.Provider.Name, truncStr(string(body), 500))
	state.temp429Retries = 0
	state.tpmWaitRetries = 0
}

// senseNova429Type classifies SenseNova 429 responses by body content.
type senseNova429Type int

const (
	sn429Unknown senseNova429Type = iota
	sn429RPM                      // {"message":"rpm exhausted","type":"quota_exceeded_error","code":"8"}
	sn429TPM                      // {"message":"rate limit exceeded on dimension: tpm","type":"invalid_request_error","code":"429001"}
)

// classifySenseNova429 inspects the 429 body to determine if it's an rpm or tpm limit.
// Returns sn429Unknown if the body doesn't match SenseNova patterns.
func classifySenseNova429(body string) senseNova429Type {
	lower := strings.ToLower(body)
	if strings.Contains(lower, "rpm exhausted") {
		return sn429RPM
	}
	if strings.Contains(lower, "tpm") {
		return sn429TPM
	}
	return sn429Unknown
}

// excludeSameAccountKeys adds the current key and all keys with the same non-empty
// Account to the exclusion list. This prevents switching to another key of the same
// account when the rate limit is per-account (e.g., SenseNova rpm/tpm).
func (h *Handler) excludeSameAccountKeys(sel *rotation.SelectedKey, state *retryState) {
	state.excludeKeyIDs = append(state.excludeKeyIDs, sel.Key.ID)
	if sel.Key.Account == "" {
		return
	}
	for _, k := range sel.Provider.Keys {
		if k.ID != sel.Key.ID && k.Account == sel.Key.Account {
			state.excludeKeyIDs = append(state.excludeKeyIDs, k.ID)
		}
	}
}
