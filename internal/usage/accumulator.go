package usage

import (
	"sync"
)

// CumulativeSummary is an aggregate view of all usage entries since process start.
// Unlike Summary which is computed from the ring buffer (capped at UsageRingSize),
// CumulativeSummary values are monotonically increasing and never lose data when
// old entries are evicted from the ring.
type CumulativeSummary struct {
	Total             int   `json:"total"`
	Success           int   `json:"success"`
	Error             int   `json:"error"`
	AvgLatencyMs      int64 `json:"avgLatencyMs"`
	TotalInputTokens  int   `json:"totalInputTokens"`
	TotalOutputTokens int   `json:"totalOutputTokens"`
}

// cumulativeModelStat holds per-model aggregate statistics kept by the accumulator.
type cumulativeModelStat struct {
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	SuccessCount int    `json:"successCount"`
	ErrorCount   int    `json:"errorCount"`
	InputTokens  int    `json:"inputTokens"`
	OutputTokens int    `json:"outputTokens"`
}

// Accumulator maintains process-level cumulative statistics independent of the
// ring buffer capacity. Every call to RingBuffer.Add also feeds the accumulator,
// so cumulative numbers survive ring eviction.
type Accumulator struct {
	mu                sync.RWMutex
	total             int
	success           int
	error             int
	totalInputTokens  int
	totalOutputTokens int
	totalLatencyMs    int64
	latencyCount      int
	modelStats        map[string]*cumulativeModelStat
}

// NewAccumulator creates a new Accumulator.
func NewAccumulator() *Accumulator {
	return &Accumulator{modelStats: make(map[string]*cumulativeModelStat)}
}

// Record feeds a single entry into the accumulator. It is called by the
// ring buffer on every Add.
func (a *Accumulator) Record(entry Entry) {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.total++
	a.totalInputTokens += entry.InputTokens
	a.totalOutputTokens += entry.OutputTokens
	a.totalLatencyMs += entry.LatencyMs
	a.latencyCount++

	if entry.Status == "success" {
		a.success++
	} else {
		a.error++
	}

	key := entry.Provider + "/" + entry.Model
	s, ok := a.modelStats[key]
	if !ok {
		s = &cumulativeModelStat{Provider: entry.Provider, Model: entry.Model}
		a.modelStats[key] = s
	}
	if entry.Status == "success" {
		s.SuccessCount++
	} else {
		s.ErrorCount++
	}
	s.InputTokens += entry.InputTokens
	s.OutputTokens += entry.OutputTokens
}

// Summary returns the cumulative summary since process start.
func (a *Accumulator) Summary() CumulativeSummary {
	a.mu.RLock()
	defer a.mu.RUnlock()
	s := CumulativeSummary{
		Total:             a.total,
		Success:           a.success,
		Error:             a.error,
		TotalInputTokens:  a.totalInputTokens,
		TotalOutputTokens: a.totalOutputTokens,
	}
	if a.latencyCount > 0 {
		s.AvgLatencyMs = a.totalLatencyMs / int64(a.latencyCount)
	}
	return s
}

// ModelStats returns per-model cumulative statistics.
func (a *Accumulator) ModelStats() []ModelStatEntry {
	a.mu.RLock()
	defer a.mu.RUnlock()
	result := make([]ModelStatEntry, 0, len(a.modelStats))
	for _, s := range a.modelStats {
		result = append(result, ModelStatEntry{
			Provider:     s.Provider,
			Model:        s.Model,
			SuccessCount: s.SuccessCount,
			ErrorCount:   s.ErrorCount,
			InputTokens:  s.InputTokens,
			OutputTokens: s.OutputTokens,
		})
	}
	return result
}

// Clear resets all cumulative statistics. This is only called when the user
// explicitly clears cumulative data; the ring buffer Clear() does NOT call this.
func (a *Accumulator) Clear() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.total = 0
	a.success = 0
	a.error = 0
	a.totalInputTokens = 0
	a.totalOutputTokens = 0
	a.totalLatencyMs = 0
	a.latencyCount = 0
	a.modelStats = make(map[string]*cumulativeModelStat)
}
