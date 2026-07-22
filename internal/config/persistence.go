package config

import (
	"bytes"
	"fmt"
	"os"

	"github.com/tinyrouter/tinyrouter/internal/fsutil"
	"gopkg.in/yaml.v3"
)

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

// Save writes config to path atomically (temp file + rename) via fsutil.AtomicWrite.
//
// On Windows the target file may be locked by another process or a stale
// handle, causing os.Rename to fail. AtomicWrite then falls back to a direct
// write; if that also fails the .tmp file remains on disk and will be applied
// on the next startup via Load.
func Save(path string, cfg *Config) error {
	marshalCfg := cfg
	if cfg.Security.PasswordEnabled && cfg.Security.EncryptionKey != "" {
		marshalCfg = encryptKeysCopy(cfg)
	}
	data, err := yaml.Marshal(marshalCfg)
	if err != nil {
		return err
	}
	if err := fsutil.AtomicWrite(path, data, 0600); err != nil {
		return fmt.Errorf("config file is locked (both rename and direct write failed); pending changes saved to %s.tmp and will be applied on next restart", path)
	}
	return nil
}
