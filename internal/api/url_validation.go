package api

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// validateBaseURL 校验 provider BaseURL：
//   - 必须是 http/https scheme
//   - host 不能解析到私网/回环/链路本地/未指定地址
//
// 返回 nil 表示通过，否则 error 描述被拒原因。
//
// 注意：DNS 解析在调用时进行。如果 provider 配置后 DNS 变更到私网地址
// (DNS rebinding)，此校验不能防。纯本地工具场景下可接受。
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
	// 检查主机是否是字面 IP（如 "169.254.169.254"），若是则直接判断是否私网。
	// 否则做 DNS 查询；DNS 失败时降级为"不拦截"，保留纯本地工具的可用性
	// (内网/无外网环境无 DNS 也能配置 provider)，但拒绝已知的私网解析结果。
	if ip := net.ParseIP(host); ip != nil {
		if isPrivateIP(ip) {
			return fmt.Errorf("host %s is a private/loopback address, which is not allowed", host)
		}
		return nil
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		// DNS 解析失败：降级为不拦截（保留可用性，纯本地工具可接受）。
		return nil
	}
	for _, ip := range ips {
		if isPrivateIP(ip) {
			return fmt.Errorf("host %s resolves to private/loopback address %s, which is not allowed", host, ip)
		}
	}
	return nil
}

// isPrivateIP 判断一个 IP 是否属于不应被 SSRF 指向的私有/保留地址段。
func isPrivateIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}
