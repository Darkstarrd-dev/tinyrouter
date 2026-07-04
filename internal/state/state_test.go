package state

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/console"
)

func TestLoadSaveRoundtrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.yaml")

	snap := &Snapshot{
		Version: CurrentVersion,
		SavedAt: time.Date(2026, 1, 15, 10, 30, 0, 0, time.UTC),
		Keys: map[string]*KeySnapshot{
			"provA::key1": {
				Status:       "active",
				BackoffLevel: 0,
				ConsecCount:  2,
			},
			"provA::key2": {
				Status:       "cooldown",
				BackoffLevel: 3,
				ModelLocks: map[string]time.Time{
					"gpt-4": time.Now().Add(30 * time.Second),
				},
				NIMRequestCount:  10,
				NIMCooldownLevel: 1,
			},
		},
		Combos: map[string]*ComboSnapshot{
			"fast": {Index: 1, ConsecCount: 3},
		},
	}
	if err := Save(path, snap); err != nil {
		t.Fatalf("Save: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.Version != CurrentVersion {
		t.Fatalf("Version = %d, want %d", loaded.Version, CurrentVersion)
	}
	if len(loaded.Keys) != 2 {
		t.Fatalf("len(Keys) = %d, want 2", len(loaded.Keys))
	}
	k1 := loaded.Keys["provA::key1"]
	if k1 == nil || k1.Status != "active" || k1.ConsecCount != 2 {
		t.Fatalf("key1 mismatch: %+v", k1)
	}
	k2 := loaded.Keys["provA::key2"]
	if k2 == nil || k2.Status != "cooldown" || k2.NIMRequestCount != 10 {
		t.Fatalf("key2 mismatch: %+v", k2)
	}
	if len(k2.ModelLocks) != 1 {
		t.Fatalf("len(ModelLocks) = %d, want 1", len(k2.ModelLocks))
	}
	if len(loaded.Combos) != 1 || loaded.Combos["fast"].Index != 1 {
		t.Fatalf("combo mismatch: %+v", loaded.Combos["fast"])
	}
}

func TestLoadMissingFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nonexistent.yaml")

	snap, err := Load(path)
	if err != nil {
		t.Fatalf("Load missing file: %v", err)
	}
	if snap.Version != CurrentVersion {
		t.Fatalf("Version = %d, want %d", snap.Version, CurrentVersion)
	}
	if snap.Keys == nil {
		t.Fatal("Keys should be non-nil")
	}
	if snap.Combos == nil {
		t.Fatal("Combos should be non-nil")
	}
}

func TestLoadInvalidYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.yaml")
	if err := os.WriteFile(path, []byte("{{invalid"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("expected error for invalid YAML")
	}
}

func TestManagerNoop(t *testing.T) {
	var m *Manager
	m.ScheduleWrite()
	m.FlushSync()
	m.Restore(&Snapshot{Version: 1})

	logger := console.New(100)
	m2 := NewManager("", logger)
	m2.ScheduleWrite()
	m2.FlushSync()
	m2.Restore(&Snapshot{Version: 1})
}

func TestManagerFlushSync(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.yaml")
	logger := console.New(100)

	m := NewManager(path, logger,
		WithKeyStateProvider(
			func() map[string]KeySnapshot {
				return map[string]KeySnapshot{
					"prov::key": {Status: "active", ConsecCount: 5},
				}
			},
			func(providerID, keyID string, s KeySnapshot) error { return nil },
		),
		WithComboStateProvider(
			func() map[string]ComboSnapshot { return nil },
			func(id string, s ComboSnapshot) error { return nil },
		),
	)

	if err := m.FlushSync(); err != nil {
		t.Fatalf("FlushSync: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.Keys["prov::key"] == nil || loaded.Keys["prov::key"].Status != "active" {
		t.Fatal("state not persisted correctly")
	}
}

func TestManagerScheduleWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.yaml")
	logger := console.New(100)

	m := NewManager(path, logger,
		WithKeyStateProvider(
			func() map[string]KeySnapshot {
				return map[string]KeySnapshot{
					"schedule::test": {Status: "active", ConsecCount: 3},
				}
			},
			func(providerID, keyID string, s KeySnapshot) error { return nil },
		),
		WithComboStateProvider(
			func() map[string]ComboSnapshot { return nil },
			func(id string, s ComboSnapshot) error { return nil },
		),
	)

	m.ScheduleWrite()

	// Wait for debounce (500ms) + a small margin
	time.Sleep(700 * time.Millisecond)

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.Keys["schedule::test"] == nil || loaded.Keys["schedule::test"].ConsecCount != 3 {
		t.Fatal("scheduled state not persisted correctly")
	}
}

func TestRestoreRoundtrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.yaml")
	logger := console.New(100)

	restored := make(map[string]KeySnapshot)
	m := NewManager(path, logger,
		WithKeyStateProvider(
			func() map[string]KeySnapshot {
				return map[string]KeySnapshot{
					"restore::test": {Status: "active", ConsecCount: 7},
				}
			},
			func(providerID, keyID string, s KeySnapshot) error {
				restored[providerID+"::"+keyID] = s
				return nil
			},
		),
		WithComboStateProvider(
			func() map[string]ComboSnapshot { return nil },
			func(id string, s ComboSnapshot) error { return nil },
		),
	)

	if err := m.FlushSync(); err != nil {
		t.Fatalf("FlushSync: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if err := m.Restore(loaded); err != nil {
		t.Fatalf("Restore: %v", err)
	}

	if len(restored) != 1 || restored["restore::test"].ConsecCount != 7 {
		t.Fatalf("restored data mismatch: %+v", restored)
	}
}
