package rotation

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/registry"
)

func (s *Selector) MarkUnavailable(providerID, keyID, model string, statusCode int, body string) time.Time {
	state := s.reg.GetKeyState(providerID, keyID)
	if state == nil {
		return time.Time{}
	}
	state.Lock()
	defer state.Unlock()

	if statusCode == 429 && isDailyQuota(body) {
		unlock := nextCSTMidnight05()
		state.ModelLocks[model] = unlock
		state.Status = "locked"
		state.LastError = fmt.Sprintf("429 daily quota: %s", truncate(body, 200))
		state.LastErrorAt = time.Now()
		return unlock
	}

	state.BackoffLevel++
	backoff := time.Duration(math.Pow(2, float64(state.BackoffLevel-1))) * time.Second
	maxBackoff := time.Duration(s.Settings().BackoffMaxSec) * time.Second
	if maxBackoff == 0 {
		maxBackoff = 240 * time.Second
	}
	if backoff > maxBackoff {
		backoff = maxBackoff
	}
	unlock := time.Now().Add(backoff)
	state.ModelLocks[model] = unlock
	state.Status = "cooldown"
	state.LastError = fmt.Sprintf("%d: %s", statusCode, truncate(body, 200))
	state.LastErrorAt = time.Now()
	return unlock
}

func (s *Selector) ClearError(providerID, keyID, model string) {
	state := s.reg.GetKeyState(providerID, keyID)
	if state == nil {
		return
	}
	state.Lock()
	defer state.Unlock()

	delete(state.ModelLocks, model)
	if len(state.ModelLocks) == 0 {
		state.BackoffLevel = 0
		state.Status = "active"
		state.LastError = ""
	}
}

func nextCSTMidnight05() time.Time {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	now := time.Now().In(loc)
	next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 5, 0, 0, loc)
	return next
}

func isDailyQuota(body string) bool {
	lower := strings.ToLower(body)
	patterns := []string{
		"daily quota",
		"daily limit",
		"quota exceeded",
		"rate_limit_exceeded",
		"you exceeded your current quota",
	}
	for _, p := range patterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

func Is429TempError(statusCode int, body string) bool {
	if statusCode != 429 {
		return false
	}
	return !isDailyQuota(body)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// Ensure imports are used.
var _ = config.RotationConfig{}
var _ = registry.KeyRuntimeState{}