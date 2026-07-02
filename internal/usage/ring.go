package usage

import (
	"sync"
	"time"
)

// Entry records a single request's usage.
type Entry struct {
	Timestamp    time.Time `json:"timestamp"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	KeyID        string    `json:"keyId"`
	KeyName      string    `json:"keyName"`
	Status       string    `json:"status"` // "success" | "error" | "retry"
	LatencyMs    int64     `json:"latencyMs"`
	InputTokens  int       `json:"inputTokens"`
	OutputTokens int       `json:"outputTokens"`
	Error        string    `json:"error,omitempty"`
}

// Summary is an aggregate view of usage entries.
type Summary struct {
	Total        int            `json:"total"`
	Success      int            `json:"success"`
	Error        int            `json:"error"`
	ByProvider   map[string]int `json:"byProvider"`
	ByModel      map[string]int `json:"byModel"`
	ByKey        map[string]int `json:"byKey"`
	AvgLatencyMs int64          `json:"avgLatencyMs"`
}

// RingBuffer is a fixed-size circular buffer for usage entries.
type RingBuffer struct {
	mu     sync.RWMutex
	entries []Entry
	head    int
	size    int
	max     int
}

// New creates a RingBuffer with the given capacity.
func New(max int) *RingBuffer {
	if max <= 0 {
		max = 500
	}
	return &RingBuffer{
		entries: make([]Entry, max),
		max:     max,
	}
}

// Add appends an entry to the buffer.
func (rb *RingBuffer) Add(entry Entry) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.entries[rb.head] = entry
	rb.head = (rb.head + 1) % rb.max
	if rb.size < rb.max {
		rb.size++
	}
}

// allLocked returns all entries in reverse chronological order. Caller must hold the lock.
func (rb *RingBuffer) allLocked() []Entry {
	result := make([]Entry, rb.size)
	for i := 0; i < rb.size; i++ {
		idx := (rb.head - 1 - i + rb.max) % rb.max
		result[i] = rb.entries[idx]
	}
	return result
}

// All returns all entries in reverse chronological order.
func (rb *RingBuffer) All() []Entry {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	return rb.allLocked()
}

// Summary returns aggregate statistics.
func (rb *RingBuffer) Summary() Summary {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	s := Summary{
		ByProvider: make(map[string]int),
		ByModel:    make(map[string]int),
		ByKey:      make(map[string]int),
	}
	var totalLatency int64
	for i := 0; i < rb.size; i++ {
		idx := (rb.head - 1 - i + rb.max) % rb.max
		e := rb.entries[idx]
		s.Total++
		if e.Status == "success" {
			s.Success++
		} else {
			s.Error++
		}
		s.ByProvider[e.Provider]++
		s.ByModel[e.Model]++
		s.ByKey[e.KeyName]++
		totalLatency += e.LatencyMs
	}
	if s.Total > 0 {
		s.AvgLatencyMs = totalLatency / int64(s.Total)
	}
	return s
}

// Clear empties the buffer.
func (rb *RingBuffer) Clear() {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.head = 0
	rb.size = 0
}

// Resize changes the buffer capacity.
func (rb *RingBuffer) Resize(newMax int) {
	if newMax <= 0 {
		return
	}
	rb.mu.Lock()
	defer rb.mu.Unlock()
	old := rb.allLocked()
	if newMax < len(old) {
		old = old[:newMax]
	}
	rb.entries = make([]Entry, newMax)
	rb.max = newMax
	rb.size = 0
	rb.head = 0
	for i := len(old) - 1; i >= 0; i-- {
		e := old[i]
		rb.entries[rb.head] = e
		rb.head = (rb.head + 1) % rb.max
		if rb.size < rb.max {
			rb.size++
		}
	}
}

// Size returns the current number of entries.
func (rb *RingBuffer) Size() int {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	return rb.size
}
