package usage

import (
	"testing"
	"time"
)

func entry(provider, model, status string, latencyMs int64) Entry {
	return Entry{
		Timestamp:    time.Now(),
		Provider:     provider,
		Model:        model,
		KeyID:        "key1",
		KeyName:      "test-key",
		Status:       status,
		LatencyMs:    latencyMs,
		InputTokens:  100,
		OutputTokens: 50,
	}
}

func TestRingBuffer_AddAndAll(t *testing.T) {
	rb := New(10)
	e1 := entry("p1", "m1", "success", 100)
	e2 := entry("p2", "m2", "success", 200)
	e3 := entry("p3", "m3", "error", 300)

	rb.Add(e1)
	rb.Add(e2)
	rb.Add(e3)

	all := rb.All()
	if len(all) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(all))
	}
	if all[0].Provider != "p3" {
		t.Errorf("expected newest first p3, got %s", all[0].Provider)
	}
	if all[1].Provider != "p2" {
		t.Errorf("expected p2, got %s", all[1].Provider)
	}
	if all[2].Provider != "p1" {
		t.Errorf("expected oldest last p1, got %s", all[2].Provider)
	}
}

func TestRingBuffer_Overflow(t *testing.T) {
	rb := New(3)
	for i := 0; i < 5; i++ {
		rb.Add(entry("p", "m", "success", int64(i*100)))
	}

	all := rb.All()
	if len(all) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(all))
	}
	if all[0].LatencyMs != 400 {
		t.Errorf("expected newest latency 400, got %d", all[0].LatencyMs)
	}
	if all[1].LatencyMs != 300 {
		t.Errorf("expected 300, got %d", all[1].LatencyMs)
	}
	if all[2].LatencyMs != 200 {
		t.Errorf("expected 200, got %d", all[2].LatencyMs)
	}
}

func TestRingBuffer_Summary(t *testing.T) {
	rb := New(10)
	rb.Add(entry("p1", "m1", "success", 100))
	rb.Add(entry("p1", "m2", "success", 200))
	rb.Add(entry("p2", "m1", "error", 300))
	rb.Add(entry("p2", "m2", "error", 400))

	s := rb.Summary()
	if s.Total != 4 {
		t.Errorf("expected total 4, got %d", s.Total)
	}
	if s.Success != 2 {
		t.Errorf("expected success 2, got %d", s.Success)
	}
	if s.Error != 2 {
		t.Errorf("expected error 2, got %d", s.Error)
	}
	if s.ByProvider["p1"] != 2 {
		t.Errorf("expected p1 count 2, got %d", s.ByProvider["p1"])
	}
	if s.ByModel["m1"] != 2 {
		t.Errorf("expected m1 count 2, got %d", s.ByModel["m1"])
	}
	if s.ByKey["test-key"] != 4 {
		t.Errorf("expected test-key count 4, got %d", s.ByKey["test-key"])
	}
	if s.AvgLatencyMs != 250 {
		t.Errorf("expected avg latency 250, got %d", s.AvgLatencyMs)
	}
}

func TestRingBuffer_Clear(t *testing.T) {
	rb := New(10)
	rb.Add(entry("p", "m", "success", 100))
	rb.Clear()

	all := rb.All()
	if len(all) != 0 {
		t.Errorf("expected 0 entries after clear, got %d", len(all))
	}
	if rb.Size() != 0 {
		t.Errorf("expected Size() 0 after clear, got %d", rb.Size())
	}
}

func TestRingBuffer_Resize_Grow(t *testing.T) {
	rb := New(3)
	rb.Add(entry("p1", "m1", "success", 100))
	rb.Add(entry("p2", "m2", "success", 200))

	rb.Resize(5)
	if rb.Size() != 2 {
		t.Fatalf("expected size 2 after grow, got %d", rb.Size())
	}
	all := rb.All()
	if all[0].Provider != "p2" {
		t.Errorf("expected newest p2, got %s", all[0].Provider)
	}
	if all[1].Provider != "p1" {
		t.Errorf("expected p1, got %s", all[1].Provider)
	}
}

func TestRingBuffer_Resize_Shrink(t *testing.T) {
	rb := New(5)
	rb.Add(entry("p1", "m1", "success", 100))
	rb.Add(entry("p2", "m2", "success", 200))
	rb.Add(entry("p3", "m3", "success", 300))
	rb.Add(entry("p4", "m4", "success", 400))

	rb.Resize(2)
	if rb.Size() != 2 {
		t.Fatalf("expected size 2 after shrink, got %d", rb.Size())
	}
	all := rb.All()
	if len(all) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(all))
	}
	if all[0].Provider != "p4" {
		t.Errorf("expected newest p4, got %s", all[0].Provider)
	}
	if all[1].Provider != "p3" {
		t.Errorf("expected p3, got %s", all[1].Provider)
	}
}

func TestRingBuffer_Size(t *testing.T) {
	rb := New(10)
	if rb.Size() != 0 {
		t.Errorf("expected size 0 initially, got %d", rb.Size())
	}
	rb.Add(entry("p", "m", "success", 100))
	if rb.Size() != 1 {
		t.Errorf("expected size 1, got %d", rb.Size())
	}
	rb.Add(entry("p", "m", "success", 100))
	if rb.Size() != 2 {
		t.Errorf("expected size 2, got %d", rb.Size())
	}
}
