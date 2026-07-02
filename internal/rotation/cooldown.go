package rotation

import (
	"fmt"
	"math"
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

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// Ensure imports are used.
var _ = config.RotationConfig{}
var _ = registry.KeyRuntimeState{}
