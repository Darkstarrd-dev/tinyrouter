package proxy

import (
	"net/http"
	"strings"

	"github.com/tinyrouter/tinyrouter/internal/rotation"
)

// normalizeBaseURL strips known endpoint suffixes so the URL ends at the API root.
// e.g. "https://api.example.com/v1/chat/completions" → "https://api.example.com/v1"
//      "https://api.example.com/v1/models"            → "https://api.example.com/v1"
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
// Handles base URLs in any form: root, ".../v1", or ".../v1/chat/completions".
func BuildUpstreamURL(baseURL, endpointPath string) string {
	normalized := normalizeBaseURL(baseURL)
	if strings.HasSuffix(normalized, "/v1") {
		return normalized + strings.TrimPrefix(endpointPath, "/v1")
	}
	return normalized + endpointPath
}

func (h *Handler) forwardUpstream(sel *rotation.SelectedKey, body []byte, headers http.Header, isStream bool, path string) (*http.Response, error) {
	url := BuildUpstreamURL(sel.Provider.BaseURL, path)

	req, err := http.NewRequest("POST", url, strings.NewReader(string(body)))
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

	return h.client.Do(req)
}
