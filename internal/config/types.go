package config

import (
	"encoding/json"
	"strings"

	"gopkg.in/yaml.v3"
)

// RotationConfig controls key selection behavior.
type RotationConfig struct {
	Strategy      string `yaml:"strategy" json:"strategy"`
	StickyLimit   int    `yaml:"stickyLimit" json:"stickyLimit"`
	MaxRetries    int    `yaml:"maxRetries" json:"maxRetries"`
	RetryDelaySec int    `yaml:"retryDelaySec" json:"retryDelaySec"`
	BackoffMaxSec int    `yaml:"backoffMaxSec" json:"backoffMaxSec"`
	StatePersist  bool   `yaml:"state_persist" json:"statePersist"`
	StatePath     string `yaml:"state_path" json:"statePath"`
}

// Key represents one API key within a provider.
type Key struct {
	ID       string `yaml:"id" json:"id"`
	Key      string `yaml:"key" json:"key"`
	Name     string `yaml:"name" json:"name"`
	Priority int    `yaml:"priority" json:"priority"`
	IsActive bool   `yaml:"isActive" json:"isActive"`
	Account  string `yaml:"account,omitempty" json:"account,omitempty"`
}

// ModelDef represents one upstream model with its quota type tag.
type ModelDef struct {
	ID        string `yaml:"id" json:"id"`
	QuotaType string `yaml:"quotaType,omitempty" json:"quotaType,omitempty"` // "unlimited" | "limited" | "paid"
}

// UnmarshalYAML supports both scalar strings and mapping nodes for backward compatibility.
func (m *ModelDef) UnmarshalYAML(value *yaml.Node) error {
	if value.Kind == yaml.ScalarNode {
		m.ID = value.Value
		m.QuotaType = ""
		return nil
	}
	type modelDefAlias ModelDef
	var alias modelDefAlias
	if err := value.Decode(&alias); err != nil {
		return err
	}
	*m = ModelDef(alias)
	return nil
}

// UnmarshalJSON supports both JSON strings and objects for backward compatibility.
func (m *ModelDef) UnmarshalJSON(data []byte) error {
	if len(data) > 0 && data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		m.ID = s
		m.QuotaType = ""
		return nil
	}
	type modelDefAlias ModelDef
	var alias modelDefAlias
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	*m = ModelDef(alias)
	return nil
}

// Provider represents one upstream OpenAI-compatible endpoint.
type Provider struct {
	ID               string     `yaml:"id" json:"id"`
	Name             string     `yaml:"name" json:"name"`
	Prefix           string     `yaml:"prefix" json:"prefix"`
	BaseURL          string     `yaml:"baseUrl" json:"baseUrl"`
	APIType          string     `yaml:"apiType" json:"apiType"`
	IsActive         bool       `yaml:"isActive" json:"isActive"`
	Keys             []Key      `yaml:"keys" json:"keys"`
	Models           []ModelDef `yaml:"models,omitempty" json:"models,omitempty"`
	RotationStrategy string     `yaml:"rotationStrategy,omitempty" json:"rotationStrategy,omitempty"`
	StickyLimit      int        `yaml:"stickyLimit,omitempty" json:"stickyLimit,omitempty"`
	InjectStreamOpts bool       `yaml:"injectStreamOptions,omitempty" json:"injectStreamOptions,omitempty"`
	// NormalizeStreamChunks fixes upstreams (e.g. ModelScope) that emit
	// usage-only SSE chunks with "choices":null, which violates the OpenAI
	// chat-completion-chunk schema (choices must be an array or error an
	// object). When true, streamResponse rewrites "choices":null to
	// "choices":[] while preserving the usage field. Off by default.
	NormalizeStreamChunks bool         `yaml:"normalizeStreamChunks,omitempty" json:"normalizeStreamChunks,omitempty"`
	NIMConfig             *NIMSettings `yaml:"nim,omitempty" json:"nim,omitempty"`
	// UseProxy routes this provider's upstream requests through the global
	// upstream proxy (Config.Proxy) when enabled.
	UseProxy bool `yaml:"useProxy,omitempty" json:"useProxy,omitempty"`
}

// IsNIM reports whether this provider should use the NIM-specific key rotation
// and throttling path. It returns true when APIType == "nim" OR when the
// BaseURL contains "nvidia" (auto-detection fallback so a misconfigured
// apiType never silently bypasses NIM throttling).
func (p Provider) IsNIM() bool {
	if p.APIType == "nim" {
		return true
	}
	return strings.Contains(strings.ToLower(p.BaseURL), "nvidia")
}

// IsGeminiOpenAICompat reports whether this provider is the Google Gemini
// OpenAI-compatible endpoint, which requires thought_signature handling for
// tool calls. It matches when the BaseURL contains
// "generativelanguage.googleapis.com" AND the path contains "/openai".
func (p Provider) IsGeminiOpenAICompat() bool {
	u := strings.ToLower(p.BaseURL)
	return strings.Contains(u, "generativelanguage.googleapis.com") &&
		strings.Contains(u, "/openai")
}

// NIMSettings holds NVIDIA NIM-specific key rotation and throttling config.
// Effective when Provider.IsNIM() is true (apiType == "nim" or BaseURL contains "nvidia").
type NIMSettings struct {
	RequestCountPerKey int   `yaml:"request_count_per_key" json:"request_count_per_key"`
	MinIntervalMs      int   `yaml:"min_interval_ms" json:"min_interval_ms"`
	CooldownLadderMin  []int `yaml:"cooldown_ladder" json:"cooldown_ladder"`
	MaxConcurrent      int   `yaml:"max_concurrent" json:"max_concurrent"`
}

// Combo represents a model combination with a routing strategy.
type Combo struct {
	ID             string   `yaml:"id" json:"id"`
	Name           string   `yaml:"name" json:"name"`
	Strategy       string   `yaml:"strategy" json:"strategy"`
	Models         []string `yaml:"models" json:"models"`
	Disabled       bool     `yaml:"disabled,omitempty" json:"disabled,omitempty"`
	DisabledModels []string `yaml:"disabledModels,omitempty" json:"disabledModels,omitempty"`
}

// QuickSlot represents a quick model switch slot with an ordered position.
type QuickSlot struct {
	ID             string   `yaml:"id" json:"id"`
	Name           string   `yaml:"name" json:"name"`
	Models         []string `yaml:"models" json:"models"`
	Disabled       bool     `yaml:"disabled,omitempty" json:"disabled,omitempty"`
	DisabledModels []string `yaml:"disabledModels,omitempty" json:"disabledModels,omitempty"`
	Order          int      `yaml:"order" json:"order"`
	SelectedIndex  int      `yaml:"selectedIndex" json:"selectedIndex"`
}

// SecurityConfig controls password protection for the admin UI.
type SecurityConfig struct {
	PasswordEnabled   bool   `yaml:"passwordEnabled" json:"passwordEnabled"`
	PasswordEncrypted string `yaml:"passwordEncrypted,omitempty" json:"passwordEncrypted,omitempty"`
	EncryptionKey     string `yaml:"encryptionKey,omitempty" json:"encryptionKey,omitempty"`
}

// MonitorConfig controls the Monitor feature (command output streaming).
type MonitorConfig struct {
	Enabled         bool     `yaml:"enabled" json:"enabled"`
	AllowedCommands []string `yaml:"allowedCommands,omitempty" json:"allowedCommands,omitempty"`
	MaxLineLength   int      `yaml:"maxLineLength,omitempty" json:"maxLineLength,omitempty"`
}

// ServerConfig controls HTTP server and upstream proxy client timeouts.
// All values are in seconds. A zero value falls back to the default.
//
//   - ReadTimeoutSec: max duration for reading the entire request (incl. body).
//   - WriteTimeoutSec: max duration for writing the response. For non-streaming
//     requests this bounds the full upstream call; for streaming (SSE) responses
//     the write deadline is exempted (see proxy streamResponse) so long streams
//     are never force-terminated here.
//   - IdleTimeoutSec: max idle keep-alive time for a connection.
//   - UpstreamTimeoutSec: max duration for a single non-streaming upstream call.
//     Streaming upstream calls are intentionally unbounded (controlled by the
//     downstream request context instead).
type ServerConfig struct {
	ReadTimeoutSec     int `yaml:"readTimeoutSec" json:"readTimeoutSec"`
	WriteTimeoutSec    int `yaml:"writeTimeoutSec" json:"writeTimeoutSec"`
	IdleTimeoutSec     int `yaml:"idleTimeoutSec" json:"idleTimeoutSec"`
	UpstreamTimeoutSec int `yaml:"upstreamTimeoutSec" json:"upstreamTimeoutSec"`
}

// ProxyConfig is the global upstream HTTP proxy used only by providers that
// opt in via Provider.UseProxy.
type ProxyConfig struct {
	Enabled bool   `yaml:"enabled" json:"enabled"`
	Host    string `yaml:"host" json:"host"`
	Port    string `yaml:"port" json:"port"`
}

// DownloadConfig controls the video download feature.
type DownloadConfig struct {
	Enabled             bool   `yaml:"enabled" json:"enabled"`
	DefaultDir          string `yaml:"defaultDir,omitempty" json:"defaultDir,omitempty"`
	YtDlpPath           string `yaml:"ytDlpPath,omitempty" json:"ytDlpPath,omitempty"`
	FfmpegPath          string `yaml:"ffmpegPath,omitempty" json:"ffmpegPath,omitempty"`
	ConcurrentFragments int    `yaml:"concurrentFragments,omitempty" json:"concurrentFragments,omitempty"`
	MaxConcurrent       int    `yaml:"maxConcurrent,omitempty" json:"maxConcurrent,omitempty"`
	Proxy               string `yaml:"proxy,omitempty" json:"proxy,omitempty"`
	BrowserCookies      string `yaml:"browserCookies,omitempty" json:"browserCookies,omitempty"`
	CookiesPath         string `yaml:"cookiesPath,omitempty" json:"cookiesPath,omitempty"`
}

// Config is the top-level configuration structure.
type Config struct {
	Port               int            `yaml:"port" json:"port"`
	ConsoleLogMaxLines int            `yaml:"consoleLogMaxLines" json:"consoleLogMaxLines"`
	UsageRingSize      int            `yaml:"usageRingSize" json:"usageRingSize"`
	Rotation           RotationConfig `yaml:"rotation" json:"rotation"`
	EnablePlayground   bool           `yaml:"enablePlayground" json:"enablePlayground"`
	Providers          []Provider     `yaml:"providers" json:"providers"`
	Combos             []Combo        `yaml:"combos" json:"combos"`
	QuickSlots         []QuickSlot    `yaml:"quickSlots" json:"quickSlots"`
	Security           SecurityConfig `yaml:"security" json:"security"`
	Monitor            MonitorConfig  `yaml:"monitor" json:"monitor"`
	Proxy              ProxyConfig    `yaml:"proxy" json:"proxy"`
	Server             ServerConfig   `yaml:"server" json:"server"`
	Download           DownloadConfig `yaml:"download" json:"download"`
}
