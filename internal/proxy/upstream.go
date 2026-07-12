package proxy

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/tinyrouter/tinyrouter/internal/rotation"
)

// normalizeBaseURL strips known endpoint suffixes so the URL ends at the API root.
// e.g. "https://api.example.com/v1/chat/completions" → "https://api.example.com/v1"
//
//	"https://api.example.com/v1/models"            → "https://api.example.com/v1"
func normalizeBaseURL(baseURL string) string {
	baseURL = strings.TrimSuffix(baseURL, "/")
	for _, suffix := range []string{"/chat/completions", "/completions", "/models"} {
		if strings.HasSuffix(baseURL, suffix) {
			baseURL = baseURL[:len(baseURL)-len(suffix)]
			break
		}
	}
	return baseURL
}

// BuildUpstreamURL constructs the full upstream URL from a base URL and an endpoint path.
// endpointPath is like "/v1/chat/completions" or "/v1/models".
//
// Three base URL forms are supported:
//   - Raw mode: a trailing '*' means the trimmed prefix is the exact endpoint and is
//     returned unchanged (no normalization or suffix handling).
//   - Host root (no path): the "/v1" prefix is injected and the full endpointPath is
//     appended, preserving backwards compatibility with old configs.
//   - Path-bearing base (e.g. ".../v1beta/openai"): the "/v1" prefix of endpointPath is
//     stripped and the remaining suffix is appended directly.
func BuildUpstreamURL(baseURL, endpointPath string) string {
	trimmed := strings.TrimSpace(baseURL)

	// 1) Raw mode: trailing '*' marks the prefix as the complete endpoint.
	if strings.HasSuffix(trimmed, "*") {
		return strings.TrimRight(strings.TrimSuffix(trimmed, "*"), "/")
	}

	normalized := normalizeBaseURL(trimmed)
	suffix := strings.TrimPrefix(endpointPath, "/v1") // "/v1/chat/completions" -> "/chat/completions"

	// 2) Host root (no path) -> inject "/v1" then append the full endpointPath.
	if isHostRoot(normalized) {
		return normalized + endpointPath
	}

	// 3) Path-bearing base -> append the suffix directly.
	return normalized + suffix
}

// isHostRoot reports whether base has no path beyond the host (e.g. "https://api.deepseek.com").
func isHostRoot(base string) bool {
	u, err := url.Parse(base)
	if err != nil {
		return false
	}
	return u.Path == "" || u.Path == "/"
}

func (h *Handler) forwardUpstream(ctx context.Context, sel *rotation.SelectedKey, body []byte, headers http.Header, isStream bool, path string) (*http.Response, error) {
	url := BuildUpstreamURL(sel.Provider.BaseURL, path)

	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+sel.Key.Key)

	if ua := headers.Get("User-Agent"); ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	if isStream {
		req.Header.Set("Accept", "text/event-stream")
	}

	if isStream {
		return h.streamClient.Do(req)
	}
	return h.client.Do(req)
}
