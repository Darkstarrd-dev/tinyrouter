package util

import "encoding/json"

// SplitModel parses "provider/model" into (providerID, model).
func SplitModel(s string) (string, string) {
	for i := 0; i < len(s); i++ {
		if s[i] == '/' {
			return s[:i], s[i+1:]
		}
	}
	return "", s
}

// TruncStr truncates a string to n characters, appending "..." if truncated.
func TruncStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// ExtractTokens parses token usage from a JSON response body.
func ExtractTokens(body []byte) (int, int) {
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

// tokenVal extracts the first non-zero float64 value for the given keys.
func tokenVal(m map[string]any, keys ...string) float64 {
	for _, k := range keys {
		if v, ok := m[k].(float64); ok && v > 0 {
			return v
		}
	}
	return 0
}
