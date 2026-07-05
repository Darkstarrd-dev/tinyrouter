package registry

import (
	"fmt"
	"sync"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/state"
)

// QuotaInfo holds the latest known quota snapshot for a model.
type QuotaInfo struct {
	ModelLimit      int
	ModelRemaining  int
	GlobalLimit     int
	GlobalRemaining int
	LastUpdated     time.Time
}

// KeyRuntimeState holds mutable per-key runtime state (not persisted to YAML).
type KeyRuntimeState struct {
	mu           sync.Mutex
	Status       string // "active" | "cooldown" | "locked"
	BackoffLevel int
	ModelLocks   map[string]time.Time
	LastUsedAt   time.Time
	ConsecCount  int
	RotatedAt    time.Time
	LastError    string
	LastErrorAt  time.Time
	ModelQuotas  map[string]*QuotaInfo

	// InFlight tracks the number of in-flight requests currently using this key.
	InFlight int

	// NIM-specific fields (only used when provider.APIType == "nim").
	NIMRequestCount  int       // Requests sent this rotation cycle
	NIMLastSendTime  time.Time // Last successful send time, for min_interval
	NIMCooldownLevel int       // 429 cooldown level (0=no cooldown)
	NIMLast429Time   time.Time // Last 429 time, for 24h level reset
}

// IncInFlight atomically increments the in-flight counter.
func (s *KeyRuntimeState) IncInFlight() { s.Lock(); s.InFlight++; s.Unlock() }

// DecInFlight atomically decrements the in-flight counter (clamped at 0).
func (s *KeyRuntimeState) DecInFlight() {
	s.Lock()
	if s.InFlight > 0 {
		s.InFlight--
	}
	s.Unlock()
}

// GetInFlight atomically returns the current in-flight count.
func (s *KeyRuntimeState) GetInFlight() int { s.Lock(); defer s.Unlock(); return s.InFlight }

// Lock acquires the state's mutex.
func (s *KeyRuntimeState) Lock() { s.mu.Lock() }

// Unlock releases the state's mutex.
func (s *KeyRuntimeState) Unlock() { s.mu.Unlock() }

// GetKeyState returns the runtime state for a key, or nil if not found.
func (r *Registry) GetKeyState(providerID, keyID string) *KeyRuntimeState {
	r.stateMu.RLock()
	defer r.stateMu.RUnlock()
	return r.states[stateKey(providerID, keyID)]
}

// SnapshotKeyStates returns a map of key snapshot data for all known keys.
// The map key is "providerID::keyID".
func (r *Registry) SnapshotKeyStates() map[string]state.KeySnapshot {
	r.stateMu.RLock()
	defer r.stateMu.RUnlock()

	result := make(map[string]state.KeySnapshot, len(r.states))
	for sk, ks := range r.states {
		s := snapshotKeyState(ks)
		// Convert internal key format "providerID/keyID" to "providerID::keyID"
		result[convertKey(sk)] = s
	}
	return result
}

func snapshotKeyState(ks *KeyRuntimeState) state.KeySnapshot {
	ks.Lock()
	defer ks.Unlock()
	s := state.KeySnapshot{
		Status:           ks.Status,
		BackoffLevel:     ks.BackoffLevel,
		RotatedAt:        ks.RotatedAt,
		ConsecCount:      ks.ConsecCount,
		LastUsedAt:       ks.LastUsedAt,
		NIMRequestCount:  ks.NIMRequestCount,
		NIMLastSendTime:  ks.NIMLastSendTime,
		NIMCooldownLevel: ks.NIMCooldownLevel,
		NIMLast429Time:   ks.NIMLast429Time,
	}
	if len(ks.ModelLocks) > 0 {
		s.ModelLocks = make(map[string]time.Time, len(ks.ModelLocks))
		for k, v := range ks.ModelLocks {
			s.ModelLocks[k] = v
		}
	}
	return s
}

// convertKey converts registry internal key format "a/b" to "a::b".
func convertKey(internal string) string {
	for i := 0; i < len(internal); i++ {
		if internal[i] == '/' {
			return internal[:i] + "::" + internal[i+1:]
		}
	}
	return internal
}

// RestoreKeyState restores a key's runtime state from a snapshot. Returns an
// error if the provider/key combination does not exist in the current config.
func (r *Registry) RestoreKeyState(providerID, keyID string, s state.KeySnapshot) error {
	state := r.GetKeyState(providerID, keyID)
	if state == nil {
		return fmt.Errorf("key not found: %s/%s", providerID, keyID)
	}
	state.Lock()
	defer state.Unlock()

	state.Status = s.Status
	state.BackoffLevel = s.BackoffLevel
	state.RotatedAt = s.RotatedAt
	state.ConsecCount = s.ConsecCount
	state.LastUsedAt = s.LastUsedAt
	state.NIMRequestCount = s.NIMRequestCount
	state.NIMLastSendTime = s.NIMLastSendTime
	state.NIMCooldownLevel = s.NIMCooldownLevel
	state.NIMLast429Time = s.NIMLast429Time
	if len(s.ModelLocks) > 0 {
		if state.ModelLocks == nil {
			state.ModelLocks = make(map[string]time.Time, len(s.ModelLocks))
		}
		for k, v := range s.ModelLocks {
			state.ModelLocks[k] = v
		}
	}
	return nil
}

// UpdateQuota stores the latest quota snapshot for a model on this key.
func (s *KeyRuntimeState) UpdateQuota(model string, modelLimit, modelRemaining, globalLimit, globalRemaining int) {
	s.Lock()
	defer s.Unlock()
	if s.ModelQuotas == nil {
		s.ModelQuotas = make(map[string]*QuotaInfo)
	}
	s.ModelQuotas[model] = &QuotaInfo{
		ModelLimit:      modelLimit,
		ModelRemaining:  modelRemaining,
		GlobalLimit:     globalLimit,
		GlobalRemaining: globalRemaining,
		LastUpdated:     time.Now(),
	}
}

// GetQuota returns the latest quota snapshot for a model, or nil.
func (s *KeyRuntimeState) GetQuota(model string) *QuotaInfo {
	s.Lock()
	defer s.Unlock()
	return s.ModelQuotas[model]
}
