package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestLoad_LegacyMonitorEnabled verifies that config.yaml files generated
// before v1.8.0 (which contain the now-removed `monitor.enabled` field) can
// still be loaded after the v1.8.0 upgrade. The Enabled field is kept in the
// MonitorConfig struct purely for this backward compatibility — strict yaml
// parsing must not reject it.
func TestLoad_LegacyMonitorEnabled(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	// Pre-v1.8.0 config with monitor.enabled: true (the deprecated form)
	legacyYAML := []byte(`port: 20128
consoleLogMaxLines: 200
usageRingSize: 500
rotation:
    strategy: fill-first
    stickyLimit: 3
    maxRetries: 5
    retryDelaySec: 5
    backoffMaxSec: 300
    state_persist: true
    state_path: state.yaml
enablePlayground: true
providers: []
combos: []
quickSlots: []
security:
    passwordEnabled: false
monitor:
    enabled: true
proxy:
    enabled: false
    host: ""
    port: ""
server:
    readTimeoutSec: 300
    writeTimeoutSec: 300
    idleTimeoutSec: 120
    upstreamTimeoutSec: 300
download:
    enabled: true
    concurrentFragments: 4
    maxConcurrent: 3
`)

	if err := os.WriteFile(path, legacyYAML, 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load should succeed with legacy monitor.enabled, got: %v", err)
	}

	// Enabled is parsed for compatibility but never consulted by the app.
	if !cfg.Monitor.Enabled {
		t.Fatal("Monitor.Enabled should be true when config.yaml sets it (parsed for compat)")
	}

	// AllowedCommands and MaxLineLength should still get their defaults (proves
	// finalizeConfig ran and did not skip the Monitor block on the legacy field).
	if len(cfg.Monitor.AllowedCommands) == 0 {
		t.Fatal("Monitor.AllowedCommands defaults should be filled")
	}
	if cfg.Monitor.MaxLineLength == 0 {
		t.Fatal("Monitor.MaxLineLength default should be filled")
	}
}

// TestLoad_LegacyMonitorEnabledFalse mirrors TestLoad_LegacyMonitorEnabled
// for the `enabled: false` variant (the more common pre-v1.8.0 form). No
// deprecation warning is expected because the field is at its zero value.
func TestLoad_LegacyMonitorEnabledFalse(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	legacyYAML := []byte(`port: 20128
monitor:
    enabled: false
`)

	if err := os.WriteFile(path, legacyYAML, 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load should succeed with monitor.enabled: false, got: %v", err)
	}

	if cfg.Monitor.Enabled {
		t.Fatal("Monitor.Enabled should be false")
	}
}

// TestLoad_UnknownFieldStillErrors verifies that strict-mode yaml parsing is
// still active for genuinely unknown fields (e.g. a typo). This guards the
// design intent of KnownFields(true) — catching configuration mistakes —
// while the Enabled exception is handled by the retained deprecated field.
func TestLoad_UnknownFieldStillErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	// "portt" is a typo of "port" — strict mode must reject it.
	badYAML := []byte(`portt: 20128
`)
	if err := os.WriteFile(path, badYAML, 0644); err != nil {
		t.Fatal(err)
	}

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected strict-mode error for unknown field 'portt'")
	}
	if !strings.Contains(err.Error(), "portt") {
		t.Fatalf("error should mention the unknown field 'portt', got: %v", err)
	}
}

// TestLoad_LegacyMonitorEnabledDeprecationWarning verifies that finalizeConfig
// emits a deprecation warning to stderr when monitor.enabled is set. The
// warning guides users to remove the now-meaningless field.
func TestLoad_LegacyMonitorEnabledDeprecationWarning(t *testing.T) {
	// Capture stderr to verify the warning is emitted.
	oldStderr := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stderr = w
	defer func() {
		os.Stderr = oldStderr
	}()

	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	legacyYAML := []byte(`monitor:
    enabled: true
`)
	if err := os.WriteFile(path, legacyYAML, 0644); err != nil {
		t.Fatal(err)
	}

	if _, err := Load(path); err != nil {
		t.Fatalf("Load: %v", err)
	}

	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	if !strings.Contains(output, "monitor.enabled") || !strings.Contains(output, "deprecated") {
		t.Fatalf("stderr should contain deprecation warning mentioning 'monitor.enabled' and 'deprecated', got: %q", output)
	}
}
