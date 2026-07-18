package api

import (
	"fmt"
	"net"
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

// isBlockedSSRFHost reports whether the given host resolves to a private,
// loopback, link-local, or unspecified IP address. Used to prevent SSRF via
// the image proxy and save-image endpoints. If DNS resolution fails, the host
// is blocked (fail-closed).
func isBlockedSSRFHost(host string) bool {
	ips, err := net.LookupIP(host)
	if err != nil {
		return true
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return true
		}
	}
	return false
}
