package config

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
)

// DefaultServerConfig returns the default server timeout settings.
func DefaultServerConfig() ServerConfig {
	return ServerConfig{
		ReadTimeoutSec:     300,
		WriteTimeoutSec:    300,
		IdleTimeoutSec:     120,
		UpstreamTimeoutSec: 300,
	}
}

// FinalizeServerConfig fills zero-valued fields with their defaults so a
// partial server config (e.g. from a settings PATCH) keeps sane values.
func FinalizeServerConfig(s *ServerConfig) {
	def := DefaultServerConfig()
	if s.ReadTimeoutSec == 0 {
		s.ReadTimeoutSec = def.ReadTimeoutSec
	}
	if s.WriteTimeoutSec == 0 {
		s.WriteTimeoutSec = def.WriteTimeoutSec
	}
	if s.IdleTimeoutSec == 0 {
		s.IdleTimeoutSec = def.IdleTimeoutSec
	}
	if s.UpstreamTimeoutSec == 0 {
		s.UpstreamTimeoutSec = def.UpstreamTimeoutSec
	}
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
		QuickSlots:       []QuickSlot{},
		Server:           DefaultServerConfig(),
		Download: DownloadConfig{
			Enabled:             true,
			ConcurrentFragments: 4,
			MaxConcurrent:       3,
		},
	}
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
	// Fill zero-valued server timeouts with defaults so a partial `server:`
	// block in config.yaml keeps sane values for the unspecified fields.
	FinalizeServerConfig(&cfg.Server)
	for i := range cfg.Providers {
		for j := range cfg.Providers[i].Models {
			if cfg.Providers[i].Models[j].QuotaType == "" {
				cfg.Providers[i].Models[j].QuotaType = "limited"
			}
		}
	}
	validateProviders(cfg)
	if len(cfg.Monitor.AllowedCommands) == 0 {
		cfg.Monitor.AllowedCommands = []string{"nvidia-smi", "top", "htop", "btop", "systeminfo", "tasklist", "ipconfig", "ifconfig", "df", "free", "vmstat", "iostat", "lscpu", "lspci", "lsblk"}
	}
	if cfg.Monitor.MaxLineLength == 0 {
		cfg.Monitor.MaxLineLength = 4096
	}
	// Download defaults. If the `download:` section is entirely absent from the
	// config file (e.g., config created before this feature was added), default
	// Enabled to true. If the section IS present, respect the user's settings
	// (including an explicit enabled: false).
	hasDownloadSection := bytes.Contains(raw, []byte("\ndownload:")) || bytes.HasPrefix(raw, []byte("download:"))
	if !hasDownloadSection {
		cfg.Download.Enabled = true
	}
	if cfg.Download.ConcurrentFragments == 0 {
		cfg.Download.ConcurrentFragments = 4
	}
	if cfg.Download.MaxConcurrent == 0 {
		cfg.Download.MaxConcurrent = 3
	}
	if cfg.Download.DefaultDir == "" {
		// 使用用户主目录下的 "Downloads" 文件夹
		if home, err := os.UserHomeDir(); err == nil {
			cfg.Download.DefaultDir = filepath.Join(home, "Downloads")
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
