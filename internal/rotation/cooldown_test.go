package rotation

import (
	"math"
	"testing"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/registry"
)

func setupTest(t *testing.T) (*registry.Registry, *Selector) {
	t.Helper()
	cfg := &config.Config{
		Providers: []config.Provider{
			{
				ID:       "test",
				Name:     "Test",
				BaseURL:  "https://api.example.com",
				IsActive: true,
				Keys: []config.Key{
					{ID: "a", Key: "sk-a", Name: "Key A", Priority: 1, IsActive: true},
					{ID: "b", Key: "sk-b", Name: "Key B", Priority: 2, IsActive: true},
				},
			},
		},
		Rotation: config.RotationConfig{
			Strategy:      "fill-first",
			StickyLimit:   3,
			BackoffMaxSec: 240,
		},
	}
	reg := registry.New(cfg)
	sel := New(reg, &cfg.Rotation)
	return reg, sel
}

func TestMarkUnavailable_ExponentialBackoff(t *testing.T) {
	reg, sel := setupTest(t)
	state := reg.GetKeyState("test", "a")

	state.Lock()
	initialLevel := state.BackoffLevel
	state.Unlock()

	unlock1 := sel.MarkUnavailable("test", "a", "gpt-4", 500, "internal error")

	state.Lock()
	if state.BackoffLevel != initialLevel+1 {
		t.Fatalf("expected BackoffLevel %d, got %d", initialLevel+1, state.BackoffLevel)
	}
	state.Unlock()

	if unlock1.IsZero() {
		t.Fatal("expected non-zero unlock time")
	}

	expectedBackoff := 1 * time.Second
	if time.Until(unlock1) < expectedBackoff-100*time.Millisecond {
		t.Fatalf("expected unlock at least %v from now, got %v", expectedBackoff, time.Until(unlock1))
	}

	unlock2 := sel.MarkUnavailable("test", "a", "gpt-4", 500, "internal error")

	state.Lock()
	if state.BackoffLevel != initialLevel+2 {
		t.Fatalf("expected BackoffLevel %d, got %d", initialLevel+2, state.BackoffLevel)
	}
	state.Unlock()

	if time.Until(unlock2) < time.Until(unlock1) {
		t.Fatal("expected second backoff to be longer than first")
	}
}

func TestMarkUnavailable_429DailyQuota(t *testing.T) {
	reg, sel := setupTest(t)
	state := reg.GetKeyState("test", "a")

	state.Lock()
	state.BackoffLevel = 5
	state.Unlock()

	unlock := sel.MarkUnavailable("test", "a", "gpt-4", 429, "you exceeded your current quota, please try again tomorrow")

	state.Lock()
	if state.BackoffLevel != 5 {
		t.Fatalf("expected BackoffLevel unchanged (5), got %d", state.BackoffLevel)
	}
	if state.Status != "locked" {
		t.Fatalf("expected status 'locked', got %s", state.Status)
	}
	state.Unlock()

	if unlock.IsZero() {
		t.Fatal("expected non-zero unlock time")
	}

	loc, _ := time.LoadLocation("Asia/Shanghai")
	expectedUnlock := time.Now().In(loc).Add(24 * time.Hour)
	if unlock.Sub(expectedUnlock) > time.Minute {
		t.Fatalf("expected unlock around %v (+24h from now), got %v", expectedUnlock, unlock)
	}
}

func TestMarkUnavailable_429Temp(t *testing.T) {
	reg, sel := setupTest(t)
	state := reg.GetKeyState("test", "a")

	state.Lock()
	state.BackoffLevel = 3
	state.Unlock()

	unlock := sel.MarkUnavailable("test", "a", "gpt-4", 429, "Too many requests, slow down")

	state.Lock()
	if state.BackoffLevel != 4 {
		t.Fatalf("expected BackoffLevel 4, got %d", state.BackoffLevel)
	}
	if state.Status != "cooldown" {
		t.Fatalf("expected status 'cooldown', got %s", state.Status)
	}
	state.Unlock()

	if unlock.IsZero() {
		t.Fatal("expected non-zero unlock time")
	}

	expectedBackoff := time.Duration(math.Pow(2, 3)) * time.Second
	if time.Until(unlock) < expectedBackoff-100*time.Millisecond {
		t.Fatalf("expected unlock at least %v from now, got %v", expectedBackoff, time.Until(unlock))
	}
}

func TestClearError_ClearsModelLock(t *testing.T) {
	reg, sel := setupTest(t)
	sel.MarkUnavailable("test", "a", "gpt-4", 500, "error")
	state := reg.GetKeyState("test", "a")

	state.Lock()
	if _, ok := state.ModelLocks["gpt-4"]; !ok {
		t.Fatal("expected model lock to exist before ClearError")
	}
	if state.BackoffLevel == 0 {
		t.Fatal("expected BackoffLevel > 0 before ClearError")
	}
	state.Unlock()

	sel.ClearError("test", "a", "gpt-4")

	state.Lock()
	if _, ok := state.ModelLocks["gpt-4"]; ok {
		t.Fatal("expected model lock to be removed after ClearError")
	}
	if state.BackoffLevel != 0 {
		t.Fatalf("expected BackoffLevel reset to 0, got %d", state.BackoffLevel)
	}
	if state.Status != "active" {
		t.Fatalf("expected status 'active', got %s", state.Status)
	}
	state.Unlock()
}

func TestClearError_KeepsOtherModelLocks(t *testing.T) {
	reg, sel := setupTest(t)
	sel.MarkUnavailable("test", "a", "gpt-4", 500, "error")
	sel.MarkUnavailable("test", "a", "claude-3", 500, "error")
	state := reg.GetKeyState("test", "a")

	sel.ClearError("test", "a", "gpt-4")

	state.Lock()
	if _, ok := state.ModelLocks["gpt-4"]; ok {
		t.Fatal("expected gpt-4 lock to be removed")
	}
	if _, ok := state.ModelLocks["claude-3"]; !ok {
		t.Fatal("expected claude-3 lock to remain")
	}
	if state.BackoffLevel == 0 {
		t.Fatal("expected BackoffLevel > 0 because other locks remain")
	}
	state.Unlock()
}

func TestIsKeyAvailable_ExpiredLockCleaned(t *testing.T) {
	reg, sel := setupTest(t)
	state := reg.GetKeyState("test", "a")

	state.Lock()
	state.ModelLocks["gpt-4"] = time.Now().Add(-time.Hour)
	state.ModelLocks["claude-3"] = time.Now().Add(1 * time.Hour)
	state.Unlock()

	if !sel.isKeyAvailable(state, "gpt-4") {
		t.Fatal("expected key to be available for gpt-4 (expired lock)")
	}

	state.Lock()
	if _, ok := state.ModelLocks["gpt-4"]; ok {
		t.Fatal("expected expired gpt-4 lock to be removed")
	}
	if _, ok := state.ModelLocks["claude-3"]; !ok {
		t.Fatal("expected claude-3 lock to remain")
	}
	state.Unlock()

	if sel.isKeyAvailable(state, "claude-3") {
		t.Fatal("expected key to be unavailable for claude-3 (active lock)")
	}
}

func TestIsDailyQuota(t *testing.T) {
	tests := []struct {
		body string
		want bool
	}{
		{"daily quota exceeded", true},
		{"DAILY LIMIT reached", true},
		{"Quota Exceeded", true},
		{"rate_limit_exceeded", true},
		{"you exceeded your current quota", true},
		{"too many requests", false},
		{"rate limited", false},
		{"", false},
	}
	for _, tt := range tests {
		got := isDailyQuota(tt.body)
		if got != tt.want {
			t.Errorf("isDailyQuota(%q) = %v, want %v", tt.body, got, tt.want)
		}
	}
}

func TestIs429TempError(t *testing.T) {
	if !Is429TempError(429, "too many requests") {
		t.Fatal("expected Is429TempError to return true for 429 with non-quota body")
	}
	if Is429TempError(429, "daily quota exceeded") {
		t.Fatal("expected Is429TempError to return false for 429 with daily quota body")
	}
	if Is429TempError(500, "error") {
		t.Fatal("expected Is429TempError to return false for non-429 status")
	}
}