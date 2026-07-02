package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// RotationConfig controls key selection behavior.
type RotationConfig struct {
	Strategy      string `yaml:"strategy" json:"strategy"`
	StickyLimit   int    `yaml:"stickyLimit" json:"stickyLimit"`
	MaxRetries    int    `yaml:"maxRetries" json:"maxRetries"`
	RetryDelaySec int    `yaml:"retryDelaySec" json:"retryDelaySec"`
	BackoffMaxSec int    `yaml:"backoffMaxSec" json:"backoffMaxSec"`
}

// Key represents one API key within a provider.
type Key struct {
	ID       string `yaml:"id" json:"id"`
	Key      string `yaml:"key" json:"key"`
	Name     string `yaml:"name" json:"name"`
	Priority int    `yaml:"priority" json:"priority"`
	IsActive bool   `yaml:"isActive" json:"isActive"`
}

// Provider represents one upstream OpenAI-compatible endpoint.
type Provider struct {
	ID               string   `yaml:"id" json:"id"`
	Name             string   `yaml:"name" json:"name"`
	Prefix           string   `yaml:"prefix" json:"prefix"`
	BaseURL          string   `yaml:"baseUrl" json:"baseUrl"`
	APIType          string   `yaml:"apiType" json:"apiType"`
	IsActive         bool     `yaml:"isActive" json:"isActive"`
	Keys             []Key    `yaml:"keys" json:"keys"`
	Models           []string `yaml:"models,omitempty" json:"models,omitempty"`
	RotationStrategy string   `yaml:"rotationStrategy,omitempty" json:"rotationStrategy,omitempty"`
	StickyLimit      int      `yaml:"stickyLimit,omitempty" json:"stickyLimit,omitempty"`
}

// Combo represents a model combination with a routing strategy.
type Combo struct {
	ID          string   `yaml:"id" json:"id"`
	Name        string   `yaml:"name" json:"name"`
	Strategy    string   `yaml:"strategy" json:"strategy"`
	Models      []string `yaml:"models" json:"models"`
	FusionJudge string   `yaml:"fusionJudge" json:"fusionJudge"`
}

// Config is the top-level configuration structure.
type Config struct {
	Port               int            `yaml:"port" json:"port"`
	ConsoleLogMaxLines int            `yaml:"consoleLogMaxLines" json:"consoleLogMaxLines"`
	UsageRingSize      int            `yaml:"usageRingSize" json:"usageRingSize"`
	Rotation           RotationConfig `yaml:"rotation" json:"rotation"`
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
