package api

import (
	"fmt"
	"net/url"
	"strings"
)

// validateBaseURL 校验 provider BaseURL 格式（scheme + hostname），
// 不拦截私网/回环地址（TinyRouter 为纯本地工具，无 SSRF 风险）。
func validateBaseURL(baseURL string) error {
	if baseURL == "" {
		return fmt.Errorf("baseUrl is required")
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("only http/https schemes are allowed, got: %s", scheme)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("URL must have a hostname")
	}
	return nil
}
