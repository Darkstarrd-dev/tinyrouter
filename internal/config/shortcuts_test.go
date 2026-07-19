package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestFinalizeConfig_ShortcutsNilNormalized verifies that a config with a nil
// Shortcuts map is normalized to an empty (non-nil) map so the JSON API emits
// {} instead of null and callers can safely range over it.
func TestFinalizeConfig_ShortcutsNilNormalized(t *testing.T) {
	cfg := &Config{}
	finalizeConfig(cfg, nil)
	if cfg.Shortcuts == nil {
		t.Fatal("Shortcuts should be non-nil after finalizeConfig")
	}
	if len(cfg.Shortcuts) != 0 {
		t.Fatalf("Shortcuts should be empty by default, got %d entries", len(cfg.Shortcuts))
	}
}

// TestFinalizeConfig_ShortcutsOverridesPreserved verifies that user
// overrides already present on the config survive finalizeConfig unchanged.
func TestFinalizeConfig_ShortcutsOverridesPreserved(t *testing.T) {
	cfg := &Config{
		Shortcuts: ShortcutsConfig{
			"global.goto-usage": {Key: "F7"},
		},
	}
	finalizeConfig(cfg, nil)
	if got := cfg.Shortcuts["global.goto-usage"]; got.Key != "F7" {
		t.Fatalf("override lost, got %+v", got)
	}
	if len(cfg.Shortcuts) != 1 {
		t.Fatalf("expected 1 override, got %d", len(cfg.Shortcuts))
	}
}

// TestDefaultConfig_ShortcutsEmpty verifies that a brand-new default config
// starts with an empty (non-nil) Shortcuts map — i.e. the system preset lives
// in the frontend and the config file only carries user overrides.
func TestDefaultConfig_ShortcutsEmpty(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.Shortcuts != nil && len(cfg.Shortcuts) != 0 {
		t.Fatalf("DefaultConfig Shortcuts should be empty, got %d entries", len(cfg.Shortcuts))
	}
	// After finalizeConfig (the path Load takes) it must be normalized to non-nil.
	finalizeConfig(cfg, nil)
	if cfg.Shortcuts == nil {
		t.Fatal("DefaultConfig Shortcuts should be non-nil after finalizeConfig")
	}
}

// TestLoad_ShortcutsRoundTrip verifies that user-overridden shortcuts are
// written to config.yaml by Save and read back unchanged by Load, and that a
// config without a shortcuts: block still comes back with a non-nil empty map.
func TestLoad_ShortcutsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	in := DefaultConfig()
	in.Shortcuts = ShortcutsConfig{
		"global.goto-usage":    {Key: "F7"},
		"pg.send-message":      {Key: "Enter"},
		"gallery.toggle-split": {Key: "s"},
	}
	if err := Save(path, in); err != nil {
		t.Fatalf("Save: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if !strings.Contains(string(data), "shortcuts:") {
		t.Fatalf("expected shortcuts: section in file, got:\n%s", string(data))
	}
	if strings.Contains(string(data), "global.goto-endpoint") {
		t.Fatalf("non-overridden action should not be persisted, got:\n%s", string(data))
	}

	out, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if out.Shortcuts == nil {
		t.Fatal("Shortcuts should be non-nil after Load")
	}
	if got := out.Shortcuts["global.goto-usage"]; got.Key != "F7" {
		t.Fatalf("global.goto-usage lost, got %+v", got)
	}
	if got := out.Shortcuts["pg.send-message"]; got.Key != "Enter" {
		t.Fatalf("pg.send-message lost, got %+v", got)
	}
	if got := out.Shortcuts["gallery.toggle-split"]; got.Key != "s" {
		t.Fatalf("gallery.toggle-split lost, got %+v", got)
	}
	if len(out.Shortcuts) != 3 {
		t.Fatalf("expected 3 overrides, got %d", len(out.Shortcuts))
	}
}

// TestLoad_ShortcutsAbsentYieldsEmptyMap verifies that a config.yaml without a
// shortcuts: block produces a non-nil empty map (so JSON marshaling yields {}
// rather than null, matching the frontend's expectation).
func TestLoad_ShortcutsAbsentYieldsEmptyMap(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte("port: 20128\n"), 0600); err != nil {
		t.Fatal(err)
	}
	out, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if out.Shortcuts == nil {
		t.Fatal("Shortcuts should be non-nil empty map when section absent")
	}
	if len(out.Shortcuts) != 0 {
		t.Fatalf("expected empty map, got %d entries", len(out.Shortcuts))
	}
}

// TestLoad_ShortcutsEmptyYamlBlockYieldsEmptyMap verifies that an explicitly
// empty `shortcuts:` block in config.yaml still results in a non-nil empty map
// (rather than nil), and that loading the file works without error.
func TestLoad_ShortcutsEmptyYamlBlockYieldsEmptyMap(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte("port: 20128\nshortcuts: {}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	out, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if out.Shortcuts == nil {
		t.Fatal("Shortcuts should be non-nil empty map for empty block")
	}
	if len(out.Shortcuts) != 0 {
		t.Fatalf("expected empty map, got %d entries", len(out.Shortcuts))
	}
}
