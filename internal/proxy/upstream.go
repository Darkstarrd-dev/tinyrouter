package proxy

import (
	"net/http"
	"strings"

	"github.com/tinyrouter/tinyrouter/internal/rotation"
)

func (h *Handler) forwardUpstream(sel *rotation.SelectedKey, body []byte, headers http.Header, isStream bool, path string) (*http.Response, error) {
	url := strings.TrimSuffix(sel.Provider.BaseURL, "/") + path

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