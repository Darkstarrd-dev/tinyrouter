package usage

import (
	"sync"
	"time"
)

// KeyQuota holds per-key quota info for the UI.
type KeyQuota struct {
	KeyID      string    `json:"keyId"`
	KeyName    string    `json:"keyName"`
	Limit      int       `json:"limit"`
	Remaining  int       `json:"remaining"`
	LastUpdate time.Time `json:"lastUpdate"`
}

// QuotaBar represents a model's aggregate quota across all keys.
type QuotaBar struct {
	Provider      string     `json:"provider"`
	Model         string     `json:"model"`
	PerKeyLimit   int        `json:"perKeyLimit"`
	TotalCapacity int        `json:"totalCapacity"`
	TotalUsed     int        `json:"totalUsed"`
	HasQuota      bool       `json:"hasQuota"`
	SuccessCount  int        `json:"successCount"`
	InputTokens   int        `json:"inputTokens"`
	OutputTokens  int        `json:"outputTokens"`
	Keys          []KeyQuota `json:"keys"`
}

// QuotaTracker tracks quota snapshots across providers/models/keys.
type QuotaTracker struct {
	mu   sync.RWMutex
	bars map[string]*QuotaBar // key = "providerName/model"
}

// NewQuotaTracker creates a new QuotaTracker.
func NewQuotaTracker() *QuotaTracker {
	return &QuotaTracker{bars: make(map[string]*QuotaBar)}
}

// Update records a quota snapshot for a specific key/model.
// totalKeyCount is the total number of active keys for the provider (not just probed ones),
// used to estimate TotalCapacity = perKeyLimit × totalKeyCount.
func (qt *QuotaTracker) Update(providerName, model, keyID, keyName string, limit, remaining, totalKeyCount int) {
	if limit <= 0 {
		return
	}
	if totalKeyCount < 1 {
		totalKeyCount = 1
	}
	qt.mu.Lock()
	defer qt.mu.Unlock()

	key := providerName + "/" + model
	bar, exists := qt.bars[key]
	if !exists {
		bar = &QuotaBar{
			Provider: providerName,
			Model:    model,
			Keys:     []KeyQuota{},
		}
		qt.bars[key] = bar
	}

	found := false
	for i, k := range bar.Keys {
		if k.KeyID == keyID {
			bar.Keys[i].Limit = limit
			bar.Keys[i].Remaining = remaining
			bar.Keys[i].LastUpdate = time.Now()
			found = true
			break
		}
	}
	if !found {
		bar.Keys = append(bar.Keys, KeyQuota{
			KeyID:      keyID,
			KeyName:    keyName,
			Limit:      limit,
			Remaining:  remaining,
			LastUpdate: time.Now(),
		})
	}

	bar.PerKeyLimit = limit
	bar.TotalCapacity = limit * totalKeyCount
	bar.TotalUsed = 0
	for _, k := range bar.Keys {
		bar.TotalUsed += (k.Limit - k.Remaining)
	}
}

// All returns all quota bars.
func (qt *QuotaTracker) All() []QuotaBar {
	qt.mu.RLock()
	defer qt.mu.RUnlock()
	result := make([]QuotaBar, 0, len(qt.bars))
	for _, bar := range qt.bars {
		result = append(result, *bar)
	}
	return result
}

// Clear resets all quota data.
func (qt *QuotaTracker) Clear() {
	qt.mu.Lock()
	defer qt.mu.Unlock()
	qt.bars = make(map[string]*QuotaBar)
}