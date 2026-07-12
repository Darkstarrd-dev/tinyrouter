package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

// keyTestResult is the per-key outcome of the "test all keys" batch probe.
type keyTestResult struct {
	KeyID        string  `json:"keyId"`
	KeyName      string  `json:"keyName"`
	Ok           bool    `json:"ok"`
	TTFTMs       int64   `json:"ttftMs"`
	LatencyMs    int64   `json:"latencyMs"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	TokensPerSec float64 `json:"tokensPerSec"`
	Status       int     `json:"status"`
	Error        string  `json:"error,omitempty"`
	QuotaRemain  int     `json:"quotaRemain,omitempty"`
	QuotaTotal   int     `json:"quotaTotal,omitempty"`
}

// testAllKeysPrompt is sent to each key during the "test all keys" batch probe.
const testAllKeysPrompt = "hi"

// extractContentFromSSE extracts the text content (both delta.content and
// delta.reasoning_content) from a single SSE data chunk JSON payload.
func extractContentFromSSE(body []byte) string {
	var resp map[string]any
	if err := json.Unmarshal(body, &resp); err != nil {
		return ""
	}
	choices, ok := resp["choices"].([]any)
	if !ok || len(choices) == 0 {
		return ""
	}
	choice, ok := choices[0].(map[string]any)
	if !ok {
		return ""
	}
	delta, ok := choice["delta"].(map[string]any)
	if !ok {
		return ""
	}
	var sb strings.Builder
	if c, ok := delta["content"].(string); ok {
		sb.WriteString(c)
	}
	if rc, ok := delta["reasoning_content"].(string); ok {
		sb.WriteString(rc)
	}
	return sb.String()
}

// headerToMap converts an http.Header to a map[string][]string,
// preserving multi-value structure without filtering or merging.
func headerToMap(h http.Header) map[string][]string {
	m := make(map[string][]string, len(h))
	for k, v := range h {
		m[k] = v
	}
	return m
}
