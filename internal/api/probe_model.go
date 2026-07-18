package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/state"
)

// testProviderModel probes a specific model across the three supported protocol
// entry points (OpenAI Chat Completions, OpenAI Responses, Anthropic Messages)
// concurrently. It aggregates the per-protocol outcomes into a summary, persists
// the derived supported-protocol set to config.yaml (only when it changed), and
// updates the lightweight probe detail in state.yaml.
//
// Request: {model}
// Response: {ok, protocols, openaiCompat, openaiResponses, anthropic, ...legacy
// top-level fields for backward compatibility...}
func (rt *Router) testProviderModel(w http.ResponseWriter, r *http.Request) {
	providerID := chi.URLParam(r, "id")
	provider, ok := rt.reg.GetProvider(providerID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}

	var req struct {
		Model string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Model == "" {
		writeAPIError(w, http.StatusBadRequest, "model required")
		return
	}

	key := firstActiveKey(provider)
	if key == nil {
		writeAPIError(w, http.StatusBadRequest, "no active key for this provider")
		return
	}

	// Locate the model def so we can compare the probed protocol set against the
	// stored one (only write config when it changes).
	modelID := req.Model
	if md, found := rt.reg.GetModelByAliasOrID(providerID, req.Model); found {
		modelID = md.ID
	}

	client := rt.proxyHandler.ManagementClient(*provider)

	// Quota extraction closure, invoked on a successful probe. Mirrors the
	// original testProviderModel logic: only trust quota on a real 200 + no error
	// body, and write back to the key state + quota tracker.
	onOK := func(model string, resp *http.Response) {
		adapter := rotation.GetAdapter(*provider)
		if snap := adapter.ParseHeaders(resp.Header); snap != nil && snap.HasQuota() {
			if ks := rt.reg.GetKeyState(providerID, key.ID); ks != nil {
				ks.UpdateQuota(model, snap.ModelLimit, snap.ModelRemaining, snap.GlobalLimit, snap.GlobalRemaining)
			}
			activeKeyCount := 0
			for _, k := range provider.Keys {
				if k.IsActive {
					activeKeyCount++
				}
			}
			rt.quotaTracker.Update(provider.Name, model, key.ID, key.Name, snap.ModelLimit, snap.ModelRemaining, activeKeyCount)
		}
	}

	ctx, cancel := contextWithOverallTimeout(r, 30*time.Second)
	defer cancel()

	// Fire all three probes concurrently.
	var (
		wg           sync.WaitGroup
		compatRes    ProbeResult
		responsesRes ProbeResult
		anthropicRes ProbeResult
		mu           sync.Mutex
	)
	wg.Add(3)
	go func() {
		defer wg.Done()
		res := probeOpenAICompat(ctx, client, provider.BaseURL, req.Model, key.Key, onOK)
		mu.Lock()
		compatRes = res
		mu.Unlock()
	}()
	go func() {
		defer wg.Done()
		res := probeOpenAIResponses(ctx, client, provider.BaseURL, req.Model, key.Key, onOK)
		mu.Lock()
		responsesRes = res
		mu.Unlock()
	}()
	go func() {
		defer wg.Done()
		res := probeAnthropic(ctx, client, provider.BaseURL, req.Model, key.Key, onOK)
		mu.Lock()
		anthropicRes = res
		mu.Unlock()
	}()
	wg.Wait()

	// Aggregate supported protocols (set of protocols whose probe succeeded).
	var supported []string
	if compatRes.Ok {
		supported = append(supported, config.ProtocolOpenAICompat)
	}
	if responsesRes.Ok {
		supported = append(supported, config.ProtocolOpenAIResponses)
	}
	if anthropicRes.Ok {
		supported = append(supported, config.ProtocolAnthropic)
	}

	// Compare with the stored set and persist only on change.
	if md, found := rt.reg.GetModelByAliasOrID(providerID, modelID); found {
		if !protocolsEqual(md.Protocols, supported) {
			if err := rt.reg.UpdateModelProtocols(providerID, modelID, supported); err != nil {
				rt.logger.Warn("failed to update model protocols: %v", err)
			} else {
				cfg := rt.reg.Config()
				if err := rt.saveConfig(&cfg); err != nil {
					rt.logger.Warn("failed to save config after protocol update: %v", err)
				}
			}
		}
	}

	// Persist lightweight probe detail to state.yaml (debounced).
	now := time.Now()
	rec := buildStateProbeRecord(providerID, modelID, now, compatRes, responsesRes, anthropicRes, supported)
	rt.reg.UpdateProbeRecord(providerID, modelID, rec)
	if rt.stateSaveFunc != nil {
		rt.stateSaveFunc()
	}

	// Build the response. Top-level fields stay backward-compatible (the first
	// successful protocol's detail wins, defaulting to OpenAI Compat) while the
	// new per-protocol sub-objects carry the full breakdown.
	top := compatRes
	if !top.Ok {
		if responsesRes.Ok {
			top = responsesRes
		} else if anthropicRes.Ok {
			top = anthropicRes
		}
	}
	topMap := probeResultToMap(top)

	respMap := map[string]any{
		"ok":              top.Ok || compatRes.Ok || responsesRes.Ok || anthropicRes.Ok,
		"protocols":       supported,
		"openaiCompat":    probeResultToMap(compatRes),
		"openaiResponses": probeResultToMap(responsesRes),
		"anthropic":       probeResultToMap(anthropicRes),
		// Legacy top-level fields for backward compatibility.
		"latencyMs":       top.LatencyMs,
		"error":           top.Error,
		"status":          top.Status,
		"request":         topMap["request"],
		"responseHeaders": topMap["responseHeaders"],
		"responseBody":    topMap["responseBody"],
		"responseBodyRaw": topMap["responseBodyRaw"],
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(respMap)
}

// contextWithOverallTimeout returns a child context bounded by overall. It
// falls back to r.Context() if that is already shorter.
func contextWithOverallTimeout(r *http.Request, overall time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), overall)
}

// protocolsEqual reports whether two protocol slices denote the same set,
// ignoring order and duplicates. Nil and empty slices are equal.
func protocolsEqual(a, b []string) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	if len(a) != len(b) {
		return false
	}
	sa := append([]string(nil), a...)
	sb := append([]string(nil), b...)
	sort.Strings(sa)
	sort.Strings(sb)
	for i := range sa {
		if sa[i] != sb[i] {
			return false
		}
	}
	return true
}

// buildStateProbeRecord assembles a state.ProbeRecord from the three probe
// outcomes. Only lightweight fields (status/latency/error/ok/timestamps) are
// kept — full request/response bodies are intentionally excluded to avoid
// bloating state.yaml.
func buildStateProbeRecord(providerID, modelID string, now time.Time, compat, responses, anthropic ProbeResult, protocols []string) state.ProbeRecord {
	return state.ProbeRecord{
		ProviderID:      providerID,
		ModelID:         modelID,
		OpenAICompat:    probeDetailOf(compat, now),
		OpenAIResponses: probeDetailOf(responses, now),
		Anthropic:       probeDetailOf(anthropic, now),
		Protocols:       append([]string(nil), protocols...),
		LastProbeAt:     now,
	}
}

// probeDetailOf converts a ProbeResult into a persisted state.ProbeDetail.
func probeDetailOf(res ProbeResult, now time.Time) state.ProbeDetail {
	return state.ProbeDetail{
		Ok:        res.Ok,
		Status:    res.Status,
		LatencyMs: res.LatencyMs,
		Error:     res.Error,
		LastAt:    now,
	}
}

// probeResultToMap converts a ProbeResult into the JSON map shape returned to
// the client (request/responseHeaders/responseBody/responseBodyRaw + status).
func probeResultToMap(res ProbeResult) map[string]any {
	return map[string]any{
		"protocol":        res.Protocol,
		"ok":              res.Ok,
		"status":          res.Status,
		"latencyMs":       res.LatencyMs,
		"error":           res.Error,
		"skipped":         res.Skipped,
		"request":         res.Request,
		"responseHeaders": res.ResponseHeaders,
		"responseBody":    res.ResponseBody,
		"responseBodyRaw": res.ResponseBodyRaw,
	}
}
