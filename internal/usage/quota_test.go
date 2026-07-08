package usage

import (
	"testing"
)

func TestQuotaTracker_UpdateAndAll(t *testing.T) {
	qt := NewQuotaTracker()
	qt.Update("DeepSeek", "gpt-4", "k1", "Key1", 100, 80, 2)
	qt.Update("DeepSeek", "gpt-4", "k2", "Key2", 100, 50, 2)

	bars := qt.All()
	if len(bars) != 1 {
		t.Fatalf("expected 1 quota bar (grouped by provider/model), got %d", len(bars))
	}
	bar := bars[0]
	if bar.Provider != "DeepSeek" || bar.Model != "gpt-4" {
		t.Errorf("unexpected bar: %+v", bar)
	}
	// TotalCapacity = perKeyLimit * totalKeyCount; TotalUsed = sum(limit - remaining)
	if bar.TotalCapacity != 200 {
		t.Errorf("expected TotalCapacity=200 (100*2), got %d", bar.TotalCapacity)
	}
	if bar.TotalUsed != 70 {
		t.Errorf("expected TotalUsed=70 ((100-80)+(100-50)), got %d", bar.TotalUsed)
	}
}

func TestQuotaTracker_RemoveKey(t *testing.T) {
	qt := NewQuotaTracker()
	qt.Update("P", "m", "k1", "Key1", 100, 80, 1)
	qt.Update("P", "m", "k2", "Key2", 100, 50, 2)
	qt.RemoveKey("P", "m", "k1")

	bars := qt.All()
	if len(bars) != 1 {
		t.Fatalf("expected 1 bar after RemoveKey, got %d", len(bars))
	}
	if bars[0].TotalUsed != 50 {
		t.Errorf("expected TotalUsed=50 after removing k1, got %d", bars[0].TotalUsed)
	}
}

func TestQuotaTracker_RenameProvider(t *testing.T) {
	qt := NewQuotaTracker()
	qt.Update("Old", "m", "k1", "Key1", 100, 80, 1)
	qt.RenameProvider("Old", "New")

	bars := qt.All()
	if len(bars) != 1 {
		t.Fatalf("expected 1 bar after rename, got %d", len(bars))
	}
	if bars[0].Provider != "New" {
		t.Errorf("provider not renamed: %q", bars[0].Provider)
	}
}

func TestQuotaTracker_Clear(t *testing.T) {
	qt := NewQuotaTracker()
	qt.Update("P", "m", "k1", "Key1", 100, 80, 1)
	qt.Clear()
	if len(qt.All()) != 0 {
		t.Error("expected empty after Clear")
	}
}
