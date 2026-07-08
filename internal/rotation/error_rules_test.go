package rotation

import (
	"testing"
)

func TestClassifyError_TextMatchPriority(t *testing.T) {
	// "rate limit" body -> ActionBackoff (text rule takes priority over status).
	r := ClassifyError(500, `{"error":"rate limit exceeded"}`)
	if r.Action != ActionBackoff {
		t.Errorf("status=500 body='rate limit' -> action=%v, want ActionBackoff", r.Action)
	}
}

func TestClassifyError_BalanceDailyQuota(t *testing.T) {
	// insufficient_balance in body -> ActionDailyQuota regardless of status.
	r := ClassifyError(402, `{"error":"insufficient_balance_error"}`)
	if r.Action != ActionDailyQuota {
		t.Errorf("402 insufficient_balance -> action=%v, want ActionDailyQuota", r.Action)
	}
}

func TestClassifyError_StatusCodeFallback(t *testing.T) {
	// 401 with no recognizable body -> ActionCooldown (status 401 rule).
	r := ClassifyError(401, `{"error":"unauthorized"}`)
	if r.Action != ActionCooldown {
		t.Errorf("401 unauthorized -> action=%v, want ActionCooldown", r.Action)
	}
	if r.CooldownSec != 120 {
		t.Errorf("401 cooldown = %d, want 120", r.CooldownSec)
	}
}

func TestClassifyError_TransientFallback(t *testing.T) {
	// Unrecognized 500 with no matching text -> ActionTransient.
	r := ClassifyError(500, `{"error":"some unknown upstream failure"}`)
	if r.Action != ActionTransient {
		t.Errorf("500 unknown -> action=%v, want ActionTransient", r.Action)
	}
}

func TestClassifyError_RequestNotAllowed(t *testing.T) {
	// "request not allowed" -> ActionCooldown 5s (per rule table).
	r := ClassifyError(400, `{"error":"request not allowed"}`)
	if r.Action != ActionCooldown || r.CooldownSec != 5 {
		t.Errorf("'request not allowed' -> action=%v cooldown=%d, want ActionCooldown/5", r.Action, r.CooldownSec)
	}
}
