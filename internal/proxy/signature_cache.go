package proxy

import (
	"sync"
	"time"
)

// SignatureCacheProvider is the read/write surface used to cache Gemini
// thought_signature values keyed by tool_call id. It is an interface so tests
// can supply a mock and callers can swap implementations.
type SignatureCacheProvider interface {
	Put(toolCallID, signature string)
	Get(toolCallID string) (string, bool)
}

type sigEntry struct {
	signature string
	putAt     time.Time
}

// SignatureCache is an in-memory, TTL + LRU-bounded cache of Gemini
// thought_signature values keyed by tool_call id. It mirrors the concurrency
// and mounting model of InflightTracker (a single mutex-guarded map). Entries
// are evicted lazily (on Put) so no background goroutine is required.
type SignatureCache struct {
	mu         sync.RWMutex
	entries    map[string]sigEntry
	maxEntries int
	ttl        time.Duration
}

const (
	defaultSigTTL        = 10 * time.Minute
	defaultSigMaxEntries = 10000
)

// NewSignatureCache returns a SignatureCache with the default TTL (10m) and
// capacity (10000 entries). Google does not document the lifetime of a session
// thought_signature, so 10m is a conservative upper bound for a single
// tool-calling round trip.
func NewSignatureCache() *SignatureCache {
	return &SignatureCache{
		entries:    make(map[string]sigEntry),
		maxEntries: defaultSigMaxEntries,
		ttl:        defaultSigTTL,
	}
}

// Put writes or refreshes a signature for toolCallID. It performs lazy
// eviction, removing expired entries and, when at capacity, the oldest entry
// by putAt.
func (c *SignatureCache) Put(toolCallID, signature string) {
	if toolCallID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	c.evictExpired(now)

	if len(c.entries) >= c.maxEntries {
		var oldestID string
		var oldest time.Time
		first := true
		for id, e := range c.entries {
			if first || e.putAt.Before(oldest) {
				oldest = e.putAt
				oldestID = id
				first = false
			}
		}
		if oldestID != "" {
			delete(c.entries, oldestID)
		}
	}

	c.entries[toolCallID] = sigEntry{signature: signature, putAt: now}
}

// Get returns the cached signature for toolCallID. It does NOT refresh putAt on
// hit, so reads never "keep alive" an entry and extend its TTL indefinitely.
func (c *SignatureCache) Get(toolCallID string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[toolCallID]
	if !ok {
		return "", false
	}
	if time.Since(e.putAt) > c.ttl {
		return "", false
	}
	return e.signature, true
}

// evictExpired removes entries older than the TTL. Callers must hold the write
// lock.
func (c *SignatureCache) evictExpired(now time.Time) {
	for id, e := range c.entries {
		if now.Sub(e.putAt) > c.ttl {
			delete(c.entries, id)
		}
	}
}
