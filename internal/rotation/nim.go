package rotation

import (
	"fmt"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
)

// getNIMDefaults returns default NIMSettings values.
func getNIMDefaults() (int, int, []int) {
	return 30, 2200, []int{15, 30}
}

// getNIMSettings reads the provider's NIMConfig and returns effective values.
func (s *Selector) getNIMSettings(providerID string) (reqCount int, minIntervalMs int, ladderMin []int) {
	provider, ok := s.reg.GetProvider(providerID)
	if !ok || provider.NIMConfig == nil {
		return getNIMDefaults()
	}
	nc := provider.NIMConfig
	reqCount = nc.RequestCountPerKey
	if reqCount <= 0 {
		reqCount = 30
	}
	minIntervalMs = nc.MinIntervalMs
	if minIntervalMs <= 0 {
		minIntervalMs = 2200
	}
	if len(nc.CooldownLadderMin) > 0 {
		ladderMin = nc.CooldownLadderMin
	} else {
		ladderMin = []int{15, 30}
	}
	return
}

// WaitNIMInterval returns the duration to wait before sending the next request on
// this (key, model) pair to satisfy min_interval. Returns 0 if no wait is needed.
func (s *Selector) WaitNIMInterval(providerID, keyID string) time.Duration {
	state := s.reg.GetKeyState(providerID, keyID)
	if state == nil {
		return 0
	}
	state.Lock()
	defer state.Unlock()

	_, minIntervalMs, _ := s.getNIMSettings(providerID)
	if state.NIMLastSendTime.IsZero() {
		return 0
	}
	elapsed := time.Since(state.NIMLastSendTime)
	interval := time.Duration(minIntervalMs) * time.Millisecond
	if elapsed < interval {
		return interval - elapsed
	}
	return 0
}

// OnNIMRequestSuccess increments the NIM request count for the key and updates
// the last send timestamp. If the count reaches RequestCountPerKey, the key is
// rotated to the back of the queue (count reset, RotatedAt = now).
func (s *Selector) OnNIMRequestSuccess(providerID, keyID, model string) {
	state := s.reg.GetKeyState(providerID, keyID)
	if state == nil {
		return
	}
	state.Lock()
	defer state.Unlock()

	state.NIMRequestCount++
	state.NIMLastSendTime = time.Now()

	reqCount, _, _ := s.getNIMSettings(providerID)
	if state.NIMRequestCount >= reqCount {
		state.NIMRequestCount = 0
		state.RotatedAt = time.Now()
	}
}

// MarkNIM429 applies the cooldown ladder for a NIM 429 response. It increments
// the cooldown level, computes the lock duration from the ladder (capped at the
// last entry), sets ModelLocks[model], rotates the key to back, and records the
// 429 time for 24h level reset.
func (s *Selector) MarkNIM429(providerID, keyID, model string) time.Time {
	state := s.reg.GetKeyState(providerID, keyID)
	if state == nil {
		return time.Time{}
	}
	state.Lock()
	defer state.Unlock()

	_, _, ladderMin := s.getNIMSettings(providerID)

	if state.NIMLast429Time.IsZero() || time.Since(state.NIMLast429Time) > 24*time.Hour {
		state.NIMCooldownLevel = 0
	}

	state.NIMCooldownLevel++

	idx := state.NIMCooldownLevel - 1
	if idx >= len(ladderMin) {
		idx = len(ladderMin) - 1
	}
	duration := time.Duration(ladderMin[idx]) * time.Minute
	unlock := time.Now().Add(duration)

	state.ModelLocks[model] = unlock
	state.Status = "cooldown"
	state.NIMLast429Time = time.Now()
	state.RotatedAt = time.Now()
	state.LastError = fmt.Sprintf("429 NIM cooldown: %v", duration)
	state.LastErrorAt = time.Now()
	return unlock
}

// filterNIMCandidates filters the candidate key list for NIM providers: keys
// whose NIMRequestCount has reached RequestCountPerKey are excluded (they
// have been rotated to the back after hitting their per-round quota and must
// wait until they naturally return to the front of the failover queue).
// If all candidates are excluded (i.e. the whole pool has used its
// round quota but no key is in 429 cooldown), all keys are reset to begin
// the next round — this models "rotate-to-back without cooldown": a key that
// has finished its 30 requests is reusable as soon as it naturally reaches
// the front of the queue again.
func (s *Selector) filterNIMCandidates(providerID string, candidates []config.Key) []config.Key {
	reqCount, _, _ := s.getNIMSettings(providerID)

	var filtered []config.Key
	for _, k := range candidates {
		state := s.reg.GetKeyState(providerID, k.ID)
		if state == nil {
			continue
		}
		state.Lock()
		if state.NIMRequestCount < reqCount {
			filtered = append(filtered, k)
		}
		state.Unlock()
	}

	if len(filtered) > 0 {
		return filtered
	}

	// All candidates have hit their per-round quota without any of them
	// being in 429 cooldown: start a fresh round for the whole pool.
	for _, k := range candidates {
		state := s.reg.GetKeyState(providerID, k.ID)
		if state == nil {
			continue
		}
		state.Lock()
		state.NIMRequestCount = 0
		// Keep existing RotatedAt ordering so the next-pick respects the
		// current queue position rather than resetting all keys to "now".
		state.Unlock()
	}
	return candidates
}
