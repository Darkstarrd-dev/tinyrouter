package proxy

import (
	"sync"
	"time"
)

// inflightEntry tracks a single in-flight streaming request's real-time output.
type inflightEntry struct {
	ProviderID   string
	KeyID        string
	FirstChunkAt time.Time
	Bytes        int64
}

// InflightTracker tracks real-time output bytes for in-flight streaming requests,
// enabling live output speed calculation per key.
type InflightTracker struct {
	mu      sync.RWMutex
	entries map[int64]*inflightEntry
	nextID  int64
}

// NewInflightTracker creates a new InflightTracker.
func NewInflightTracker() *InflightTracker {
	return &InflightTracker{entries: make(map[int64]*inflightEntry)}
}

// Register adds a new in-flight request and returns its unique tracking ID.
func (t *InflightTracker) Register(providerID, keyID string) int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.nextID++
	id := t.nextID
	t.entries[id] = &inflightEntry{ProviderID: providerID, KeyID: keyID}
	return id
}

// SetFirstChunk records the time the first chunk was received for a request.
func (t *InflightTracker) SetFirstChunk(id int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if e, ok := t.entries[id]; ok && e.FirstChunkAt.IsZero() {
		e.FirstChunkAt = time.Now()
	}
}

// AddBytes adds output bytes to an in-flight request.
func (t *InflightTracker) AddBytes(id int64, n int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if e, ok := t.entries[id]; ok {
		e.Bytes += int64(n)
	}
}

// Unregister removes an in-flight request.
func (t *InflightTracker) Unregister(id int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.entries, id)
}

// LiveSpeedForKeys returns estimated tok/s per key, keyed by "providerID/keyID".
// Each request's speed = bytes / 4 / elapsed_seconds (1 token ≈ 4 bytes).
// Multiple concurrent requests on the same key have their speeds summed.
// Requests with elapsed < 1s are skipped to avoid unstable values.
func (t *InflightTracker) LiveSpeedForKeys() map[string]float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()
	result := make(map[string]float64)
	now := time.Now()
	for _, e := range t.entries {
		if e.FirstChunkAt.IsZero() {
			continue
		}
		elapsed := now.Sub(e.FirstChunkAt).Seconds()
		if elapsed < 1.0 {
			continue
		}
		estimatedTokens := float64(e.Bytes) / 4.0
		speed := estimatedTokens / elapsed
		key := e.ProviderID + "/" + e.KeyID
		result[key] += speed
	}
	return result
}
