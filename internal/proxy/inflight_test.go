package proxy

import (
	"math"
	"sync"
	"testing"
	"time"
)

func TestInflightRegisterAndLiveSpeed(t *testing.T) {
	tracker := NewInflightTracker()
	id := tracker.Register("provider-a", "key-1")

	tracker.SetFirstChunk(id)
	// Manually set FirstChunkAt to 2 seconds ago for deterministic test
	tracker.mu.Lock()
	tracker.entries[id].FirstChunkAt = time.Now().Add(-2 * time.Second)
	tracker.mu.Unlock()

	tracker.AddBytes(id, 400) // ~100 tokens

	speeds := tracker.LiveSpeedForKeys()
	key := "provider-a/key-1"
	speed, ok := speeds[key]
	if !ok {
		t.Fatalf("expected key %s in live speeds", key)
	}

	expected := 100.0 / 2.0 // 100 tokens / 2 sec = 50 tok/s
	if math.Abs(speed-expected) > 0.1 {
		t.Fatalf("expected speed %.2f, got %.2f", expected, speed)
	}
}

func TestInflightMultipleConcurrentRequestsSumSpeeds(t *testing.T) {
	tracker := NewInflightTracker()

	id1 := tracker.Register("provider-a", "key-1")
	id2 := tracker.Register("provider-a", "key-1")
	id3 := tracker.Register("provider-b", "key-2")

	for _, id := range []int64{id1, id2, id3} {
		tracker.SetFirstChunk(id)
	}

	// Manually set all to 2 seconds ago
	tracker.mu.Lock()
	tracker.entries[id1].FirstChunkAt = time.Now().Add(-2 * time.Second)
	tracker.entries[id2].FirstChunkAt = time.Now().Add(-2 * time.Second)
	tracker.entries[id3].FirstChunkAt = time.Now().Add(-2 * time.Second)
	tracker.mu.Unlock()

	tracker.AddBytes(id1, 400) // ~100 tokens
	tracker.AddBytes(id2, 800) // ~200 tokens
	tracker.AddBytes(id3, 400) // ~100 tokens

	speeds := tracker.LiveSpeedForKeys()

	// provider-a/key-1: 100/2 + 200/2 = 150 tok/s
	keyA := "provider-a/key-1"
	speedA, ok := speeds[keyA]
	if !ok {
		t.Fatalf("expected key %s in live speeds", keyA)
	}
	expectedA := 150.0
	if math.Abs(speedA-expectedA) > 0.1 {
		t.Fatalf("expected speed %.2f for key-1, got %.2f", expectedA, speedA)
	}

	// provider-b/key-2: 100/2 = 50 tok/s
	keyB := "provider-b/key-2"
	speedB, ok := speeds[keyB]
	if !ok {
		t.Fatalf("expected key %s in live speeds", keyB)
	}
	expectedB := 50.0
	if math.Abs(speedB-expectedB) > 0.1 {
		t.Fatalf("expected speed %.2f for key-2, got %.2f", expectedB, speedB)
	}
}

func TestInflightUnregisterExcluded(t *testing.T) {
	tracker := NewInflightTracker()
	id := tracker.Register("provider-a", "key-1")
	tracker.SetFirstChunk(id)

	tracker.mu.Lock()
	tracker.entries[id].FirstChunkAt = time.Now().Add(-2 * time.Second)
	tracker.mu.Unlock()

	tracker.AddBytes(id, 400)
	tracker.Unregister(id)

	speeds := tracker.LiveSpeedForKeys()
	if _, ok := speeds["provider-a/key-1"]; ok {
		t.Fatal("expected unregistered key to be excluded from live speeds")
	}
}

func TestInflightSkipsNoFirstChunk(t *testing.T) {
	tracker := NewInflightTracker()
	id := tracker.Register("provider-a", "key-1")
	// Register but never call SetFirstChunk
	tracker.AddBytes(id, 400)

	speeds := tracker.LiveSpeedForKeys()
	if _, ok := speeds["provider-a/key-1"]; ok {
		t.Fatal("expected request without FirstChunkAt to be skipped")
	}
}

func TestInflightSkipsElapsedLessThanOneSecond(t *testing.T) {
	tracker := NewInflightTracker()
	id := tracker.Register("provider-a", "key-1")
	tracker.SetFirstChunk(id)
	// FirstChunkAt is just now, so elapsed < 1s
	tracker.AddBytes(id, 400)

	speeds := tracker.LiveSpeedForKeys()
	if _, ok := speeds["provider-a/key-1"]; ok {
		t.Fatal("expected request with elapsed < 1s to be skipped")
	}
}

func TestInflightConcurrentSafety(t *testing.T) {
	tracker := NewInflightTracker()
	var wg sync.WaitGroup

	// Spawn multiple goroutines doing concurrent Register/AddBytes/Unregister
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id := tracker.Register("p", "k")
			tracker.SetFirstChunk(id)
			for j := 0; j < 10; j++ {
				tracker.AddBytes(id, 100)
			}
			tracker.Unregister(id)
		}()
	}
	wg.Wait()

	// Should have no entries left
	speeds := tracker.LiveSpeedForKeys()
	if len(speeds) != 0 {
		t.Fatalf("expected empty speeds after all unregistered, got %d entries", len(speeds))
	}
}