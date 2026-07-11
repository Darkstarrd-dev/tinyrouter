package proxy

import (
	"encoding/json"
	"sync"

	"github.com/tinyrouter/tinyrouter/internal/usage"
)

// EntryTracker keeps a concurrent-safe map of in-flight (processing) usage
// entries keyed by their request ID. It is separate from InflightTracker
// which tracks byte-level streaming stats by int64 IDs.
type EntryTracker struct {
	mu      sync.RWMutex
	entries map[string]usage.Entry
}

// NewEntryTracker creates a new EntryTracker.
func NewEntryTracker() *EntryTracker {
	return &EntryTracker{entries: make(map[string]usage.Entry)}
}

// Register stores a processing entry. Returns true if the entry was newly
// added (false if it already existed with the same ID).
func (t *EntryTracker) Register(e usage.Entry) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, exists := t.entries[e.ID]; exists {
		return false
	}
	t.entries[e.ID] = e
	return true
}

// Get returns the entry for the given ID or zero value.
func (t *EntryTracker) Get(id string) (usage.Entry, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	e, ok := t.entries[id]
	return e, ok
}

// Remove deletes the entry for the given ID.
func (t *EntryTracker) Remove(id string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	_, ok := t.entries[id]
	if ok {
		delete(t.entries, id)
	}
	return ok
}

// All returns a snapshot of all in-flight entries. The caller must treat the
// returned slice as immutable.
func (t *EntryTracker) All() []usage.Entry {
	t.mu.RLock()
	defer t.mu.RUnlock()
	result := make([]usage.Entry, 0, len(t.entries))
	for _, e := range t.entries {
		result = append(result, e)
	}
	return result
}

// Exists returns true if an entry with the given ID is currently tracked.
func (t *EntryTracker) Exists(id string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	_, ok := t.entries[id]
	return ok
}

// MarshalEntryJSON returns the JSON representation of an entry, or nil bytes
// if marshalling fails.
func MarshalEntryJSON(e usage.Entry) json.RawMessage {
	b, err := json.Marshal(e)
	if err != nil {
		return nil
	}
	return b
}
