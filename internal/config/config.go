package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// RotationConfig controls key selection behavior.
type RotationConfig struct {
	Strategy     string `yaml:"strategy"`      // "fill-first" | "round-robin"
	StickyLimit  int    `yaml:"stickyLimit"`   // round-robin sticky consecutive uses
	MaxRetries   int    `yaml:"maxRetries"`    // per-key 429 temp retries
	RetryDelaySec int   `yaml:"retryDelaySec"` // retry interval seconds
	BackoffMaxSec int   `yaml:"backoffMaxSec"` // exponential backoff cap
}

// Key represents one API key within a provider.
type Key struct {
	ID       string `yaml:"id"`
	Key      string `yaml:"key"`
	Name     string `yaml:"name"`
	Priority int    `yaml:"priority"`
	IsActive bool   `yaml:"isActive"`
}

// Provider represents one upstream OpenAI-compatible endpoint.
type Provider struct {
	ID       string `yaml:"id"`
	Name     string `yaml:"name"`
	Prefix   string `yaml:"prefix"`
	BaseURL  string `yaml:"baseUrl"`
	APIType  string `yaml:"apiType"`
	IsActive bool   `yaml:"isActive"`
	Keys     []Key  `yaml:"keys"`
}

// Combo represents a model combination with a routing strategy.
type Combo struct {
	ID          string   `yaml:"id"`
	Name        string   `yaml:"name"`
	Strategy    string   `yaml:"strategy"` // "fallback" | "round-robin" | "fusion"
	Models      []string `yaml:"models"`
	FusionJudge string   `yaml:"fusionJudge"`
}

// Config is the top-level configuration structure.
type Config struct {
	Port               int             `yaml:"port"`
	ConsoleLogMaxLines int             `yaml:"consoleLogMaxLines"`
	UsageRingSize      int             `yaml:"usageRingSize"`
	Rotation           RotationConfig  `yaml:"rotation"`
	Providers          []Provider      `yaml:"providers"`
	Combos             []Combo         `yaml:"combos"`
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
			BackoffMaxSec: 240,
		},
		Providers: []Provider{},
		Combos:    []Combo{},
	}
}

// Load reads config from path, or creates a default config there if not found.
func Load(path string) (*Config, error) {
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
	return &cfg, nil
}

// Save writes config to path atomically (temp file + rename).
func Save(path string, cfg *Config) error {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Now is a convenience alias for tests that need to mock time.
var Now = time.Now
