package rotation

import (
	"testing"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/registry"
)

func setupTestProvider(t *testing.T, priorities []int, strategy string, stickyLimit int) (*registry.Registry, *Selector) {
	t.Helper()
	keys := make([]config.Key, len(priorities))
	for i, p := range priorities {
		keys[i] = config.Key{
			ID:       string(rune('a' + i)),
			Key:      "sk-test-" + string(rune('a'+i)),
			Name:     "Key " + string(rune('a'+i)),
			Priority: p,
			IsActive: true,
		}
	}
	cfg := &config.Config{
		Providers: []config.Provider{
			{
				ID:       "test",
				Name:     "Test",
				BaseURL:  "https://api.example.com",
				IsActive: true,
				Keys:     keys,
			},
		},
		Rotation: config.RotationConfig{
			Strategy:      strategy,
			StickyLimit:   stickyLimit,
			BackoffMaxSec: 240,
		},
	}
	reg := registry.New(cfg)
	sel := New(reg, &cfg.Rotation)
	return reg, sel
}

func TestSelectFillFirst_PicksLowestPriority(t *testing.T) {
	_, sel := setupTestProvider(t, []int{3, 1, 2}, "fill-first", 3)
	sk, err := sel.SelectKey("test", "gpt-4", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sk.Key.ID != "b" {
		t.Fatalf("expected key 'b' (priority 1), got %s (priority %d)", sk.Key.ID, sk.Key.Priority)
	}
}

func TestSelectFillFirst_ExcludesKeys(t *testing.T) {
	_, sel := setupTestProvider(t, []int{1, 2, 3}, "fill-first", 3)
	sk, err := sel.SelectKey("test", "gpt-4", []string{"a"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sk.Key.ID != "b" {
		t.Fatalf("expected key 'b' (priority 2), got %s (priority %d)", sk.Key.ID, sk.Key.Priority)
	}
}

func TestSelectFillFirst_SkipsInactiveKeys(t *testing.T) {
	reg, sel := setupTestProvider(t, []int{1, 2, 3}, "fill-first", 3)
	reg.UpdateKey("test", "a", config.Key{ID: "a", Key: "sk-test-a", Name: "Key a", Priority: 1, IsActive: false})
	sk, err := sel.SelectKey("test", "gpt-4", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sk.Key.ID != "b" {
		t.Fatalf("expected key 'b' (priority 2), got %s (priority %d)", sk.Key.ID, sk.Key.Priority)
	}
}

func TestSelectFillFirst_SkipsCooldownKeys(t *testing.T) {
	_, sel := setupTestProvider(t, []int{1, 2, 3}, "fill-first", 3)
	sel.MarkUnavailable("test", "a", "gpt-4", 500, "server error")
	sk, err := sel.SelectKey("test", "gpt-4", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sk.Key.ID != "b" {
		t.Fatalf("expected key 'b' (priority 2), got %s (priority %d)", sk.Key.ID, sk.Key.Priority)
	}
}

func TestSelectRoundRobin_StickyUntilLimit(t *testing.T) {
	_, sel := setupTestProvider(t, []int{1, 2}, "round-robin", 3)

	first, err := sel.SelectKey("test", "gpt-4", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for i := 0; i < 2; i++ {
		sk, err := sel.SelectKey("test", "gpt-4", nil)
		if err != nil {
			t.Fatalf("unexpected error on call %d: %v", i+2, err)
		}
		if sk.Key.ID != first.Key.ID {
			t.Fatalf("call %d: expected sticky key %s, got %s", i+2, first.Key.ID, sk.Key.ID)
		}
	}

	sk, err := sel.SelectKey("test", "gpt-4", nil)
	if err != nil {
		t.Fatalf("unexpected error on call 4: %v", err)
	}
	if sk.Key.ID == first.Key.ID {
		t.Fatalf("expected switch to different key after sticky limit, but got %s again", sk.Key.ID)
	}
}

func TestSelectRoundRobin_SwitchesToLRU(t *testing.T) {
	_, sel := setupTestProvider(t, []int{1, 2}, "round-robin", 3)

	keyA, _ := sel.SelectKey("test", "gpt-4", nil)

	for i := 0; i < 2; i++ {
		sel.SelectKey("test", "gpt-4", nil)
	}

	keyB, _ := sel.SelectKey("test", "gpt-4", nil)

	if keyA.Key.ID == keyB.Key.ID {
		t.Fatal("expected switch to other key after exhausting sticky limit on key A")
	}

	for i := 0; i < 2; i++ {
		sel.SelectKey("test", "gpt-4", nil)
	}

	keyC, _ := sel.SelectKey("test", "gpt-4", nil)

	if keyC.Key.ID != keyA.Key.ID {
		t.Fatalf("expected switch back to key %s (LRU), got %s", keyA.Key.ID, keyC.Key.ID)
	}
}

func TestSelectRoundRobin_FirstUsePicksFirstKey(t *testing.T) {
	_, sel := setupTestProvider(t, []int{2, 1}, "round-robin", 3)

	sk, err := sel.SelectKey("test", "gpt-4", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sk.Key.ID != "a" {
		t.Fatalf("expected first key 'a' (all unused), got %s", sk.Key.ID)
	}
}

func TestSelectRoundRobin_SwitchesOnExhaustedSticky_ThreeKeys(t *testing.T) {
	_, sel := setupTestProvider(t, []int{1, 2, 3}, "round-robin", 2)

	used := make(map[string]int)
	for i := 0; i < 6; i++ {
		sk, err := sel.SelectKey("test", "gpt-4", nil)
		if err != nil {
			t.Fatalf("call %d: %v", i+1, err)
		}
		used[sk.Key.ID]++
	}

	if len(used) < 2 {
		t.Fatalf("expected at least 2 different keys across 6 calls, got %d: %v", len(used), used)
	}
}