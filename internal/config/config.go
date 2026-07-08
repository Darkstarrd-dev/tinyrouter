package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
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

// SecurityConfig controls password protection for the admin UI.
type SecurityConfig struct {
	PasswordEnabled   bool   `yaml:"passwordEnabled" json:"passwordEnabled"`
	PasswordEncrypted string `yaml:"passwordEncrypted,omitempty" json:"passwordEncrypted,omitempty"`
	EncryptionKey     string `yaml:"encryptionKey,omitempty" json:"encryptionKey,omitempty"`
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
	Security           SecurityConfig `yaml:"security" json:"security"`
}

// DefaultConfig returns a sane default configuration.
func DefaultConfig() *Config {
	return &Config{
		Port:               20128,
		ConsoleLogMaxLines: 200,
		UsageRingSize:      500,
		Rotation: RotationConfig{
			Strategy:      "fill-first",
			StickyLimit:   3,
			MaxRetries:    5,
			RetryDelaySec: 5,
			BackoffMaxSec: 300,
			StatePersist:  true,
			StatePath:     "state.yaml",
		},
		EnablePlayground: true,
		Providers:        []Provider{},
		Combos:           []Combo{},
	}
}

// Load reads config from path, or creates a default config there if not found.
//
// If a pending .tmp file exists (from a previous Save whose rename failed),
// Load attempts to apply it in order of preference:
//  1. os.Rename(tmp → path)          — succeeds when the lock is gone.
//  2. overwrite path with tmp data    — succeeds when the lock was transient.
//  3. parse tmp data directly         — last resort so user's pending changes
//     are visible in the running instance even if path is still locked.
//
// In case 3 the .tmp file is left on disk for the next restart to retry.
func Load(path string) (*Config, error) {
	tmp := path + ".tmp"
	if tmpInfo, err := os.Stat(tmp); err == nil {
		pathInfo, pathErr := os.Stat(path)
		applyTmp := true
		if pathErr == nil && pathInfo != nil && tmpInfo != nil {
			// 只当 .tmp 比 path 更新时才恢复；否则 .tmp 为过期残留，删除它。
			applyTmp = tmpInfo.ModTime().After(pathInfo.ModTime())
		}
		if applyTmp {
			if renameErr := os.Rename(tmp, path); renameErr != nil {
				tmpData, readErr := os.ReadFile(tmp)
				if readErr == nil {
					if writeErr := os.WriteFile(path, tmpData, 0600); writeErr == nil {
						_ = os.Remove(tmp)
					} else {
						var cfg Config
						dec := yaml.NewDecoder(bytes.NewReader(tmpData))
						dec.KnownFields(true)
						if err := dec.Decode(&cfg); err != nil {
							return nil, fmt.Errorf("parse pending config (.tmp): %w", err)
						}
						return finalizeConfig(&cfg, tmpData), nil
					}
				}
			}
		} else {
			// .tmp 比 path 旧，可能是过时残留，删除它。
			_ = os.Remove(tmp)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg := DefaultConfig()
			if saveErr := Save(path, cfg); saveErr != nil {
				return nil, fmt.Errorf("create default config: %w", saveErr)
			}
			return cfg, nil
		}
		return nil, err
	}
	var cfg Config
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return finalizeConfig(&cfg, data), nil
}

// finalizeConfig fills in default values for zero-valued fields and normalizes
// model quota types. raw is the original YAML bytes (used to detect whether
// enablePlayground was explicitly set in the file).
func finalizeConfig(cfg *Config, raw []byte) *Config {
	if cfg.Port == 0 {
		cfg.Port = 20128
	}
	if cfg.ConsoleLogMaxLines == 0 {
		cfg.ConsoleLogMaxLines = 200
	}
	if cfg.UsageRingSize == 0 {
		cfg.UsageRingSize = 500
	}
	// Default EnablePlayground to true if not explicitly set in config.
	// Existing configs from before this field was added would otherwise
	// get the zero value (false) and silently hide the playground.
	if !bytes.Contains(raw, []byte("enablePlayground")) {
		cfg.EnablePlayground = true
	}
	// StatePersist 默认 true（向后兼容旧 config 无此字段时启用持久化）。
	// 仅当文件里没有出现 state_persist 时才填默认值，避免用户显式写 false 被覆盖。
	if !cfg.Rotation.StatePersist && !bytes.Contains(raw, []byte("state_persist")) {
		cfg.Rotation.StatePersist = true
	}
	if cfg.Rotation.StatePath == "" {
		cfg.Rotation.StatePath = "state.yaml"
	}
	for i := range cfg.Providers {
		for j := range cfg.Providers[i].Models {
			if cfg.Providers[i].Models[j].QuotaType == "" {
				cfg.Providers[i].Models[j].QuotaType = "limited"
			}
		}
	}
	// Decrypt API keys if password protection is enabled.
	// Encrypted keys are prefixed with "enc:" in the YAML file.
	if cfg.Security.PasswordEnabled && cfg.Security.EncryptionKey != "" {
		for i := range cfg.Providers {
			for j := range cfg.Providers[i].Keys {
				k := &cfg.Providers[i].Keys[j]
				if strings.HasPrefix(k.Key, "enc:") {
					encrypted := strings.TrimPrefix(k.Key, "enc:")
					if decrypted, err := Decrypt(cfg.Security.EncryptionKey, encrypted); err == nil {
						k.Key = decrypted
					}
				}
			}
		}
	}
	return cfg
}

// encryptKeysCopy returns a deep copy of cfg with all API key values encrypted.
// The original cfg is not modified — in-memory keys stay plaintext.
// Encrypted keys are prefixed with "enc:" so Load can distinguish them.
func encryptKeysCopy(cfg *Config) *Config {
	cp := *cfg
	cp.Providers = make([]Provider, len(cfg.Providers))
	for i := range cfg.Providers {
		cp.Providers[i] = cfg.Providers[i]
		cp.Providers[i].Keys = make([]Key, len(cfg.Providers[i].Keys))
		for j := range cfg.Providers[i].Keys {
			cp.Providers[i].Keys[j] = cfg.Providers[i].Keys[j]
			k := &cp.Providers[i].Keys[j]
			if k.Key != "" && !strings.HasPrefix(k.Key, "enc:") {
				if encrypted, err := Encrypt(cfg.Security.EncryptionKey, k.Key); err == nil {
					k.Key = "enc:" + encrypted
				}
			}
		}
	}
	return &cp
}

// Save writes config to path atomically (temp file + rename).
//
// On Windows the target file may be locked by another process or a stale
// handle, causing os.Rename to fail with ERROR_ACCESS_DENIED. Save then
// falls back to a direct write of path; if that also fails the .tmp file
// remains on disk and will be applied on the next startup via Load.
// In either fallback case Save returns nil — the data is not lost.
func Save(path string, cfg *Config) error {
	marshalCfg := cfg
	if cfg.Security.PasswordEnabled && cfg.Security.EncryptionKey != "" {
		marshalCfg = encryptKeysCopy(cfg)
	}
	data, err := yaml.Marshal(marshalCfg)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	if renameErr := os.Rename(tmp, path); renameErr != nil {
		// Fallback: direct write to target (works if the lock was transient).
		if writeErr := os.WriteFile(path, data, 0600); writeErr != nil {
			// Both rename and direct write failed — target is actively locked.
			// .tmp retains the data; it will be applied on next restart via Load.
			// Do NOT remove tmp — it is the only persistent copy of the change.
			// 返回 error 让调用方知道状态未立即落盘到 path（pending 改动在 .tmp，
			// 下次重启 Load 会自动应用）。
			return fmt.Errorf("config file is locked (both rename and direct write failed); pending changes saved to %s and will be applied on next restart", tmp)
		}
		// Direct write succeeded; clean up the now-redundant .tmp file.
		_ = os.Remove(tmp)
		return nil
	}
	return nil
}
