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
	ID               string       `yaml:"id" json:"id"`
	Name             string       `yaml:"name" json:"name"`
	Prefix           string       `yaml:"prefix" json:"prefix"`
	BaseURL          string       `yaml:"baseUrl" json:"baseUrl"`
	APIType          string       `yaml:"apiType" json:"apiType"`
	IsActive         bool         `yaml:"isActive" json:"isActive"`
	Keys             []Key        `yaml:"keys" json:"keys"`
	Models           []ModelDef   `yaml:"models,omitempty" json:"models,omitempty"`
	RotationStrategy string       `yaml:"rotationStrategy,omitempty" json:"rotationStrategy,omitempty"`
	StickyLimit      int          `yaml:"stickyLimit,omitempty" json:"stickyLimit,omitempty"`
	InjectStreamOpts bool         `yaml:"injectStreamOptions,omitempty" json:"injectStreamOptions,omitempty"`
	NIMConfig        *NIMSettings `yaml:"nim,omitempty" json:"nim,omitempty"`
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
	ID       string   `yaml:"id" json:"id"`
	Name     string   `yaml:"name" json:"name"`
	Strategy string   `yaml:"strategy" json:"strategy"`
	Models   []string `yaml:"models" json:"models"`
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
// If a pending .tmp file exists (from a previous Save that could not rename),
// it is applied first.
func Load(path string) (*Config, error) {
	tmp := path + ".tmp"
	if _, err := os.Stat(tmp); err == nil {
		os.Rename(tmp, path)
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
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
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
	if !bytes.Contains(data, []byte("enablePlayground")) {
		cfg.EnablePlayground = true
	}
	for i := range cfg.Providers {
		for j := range cfg.Providers[i].Models {
			if cfg.Providers[i].Models[j].QuotaType == "" {
				cfg.Providers[i].Models[j].QuotaType = "limited"
			}
		}
	}
	return &cfg, nil
}

// Save writes config to path atomically (temp file + rename).
// If the rename fails (e.g. config.yaml is locked on Windows), the tmp
// file is left in place and will be applied on the next startup via Load.
// In that case Save returns nil — the data is safely persisted in the tmp file.
func Save(path string, cfg *Config) error {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	if renameErr := os.Rename(tmp, path); renameErr != nil {
		return nil
	}
	return nil
}
