package rotation

import (
	"strings"
)

// ErrorAction defines the action to take for a classified error.
type ErrorAction int

const (
	ActionBackoff    ErrorAction = iota // exponential backoff
	ActionCooldown                      // fixed-duration cooldown
	ActionDailyQuota                    // daily quota lock (until next CST 00:05)
	ActionTransient                     // transient cooldown (default 30s)
)

// ErrorRule defines one error classification rule.
type ErrorRule struct {
	StatusCode  int         // HTTP status code (0 means wildcard)
	BodyMatch   string      // case-insensitive substring match on body (empty = skip)
	Action      ErrorAction // action to take
	CooldownSec int         // fixed cooldown seconds (for ActionCooldown)
}

// DefaultErrorRules is the ordered error classification table,
// ported from 9router open-sse/config/errorConfig.js → ERROR_RULES.
// Text rules are checked first (top-to-bottom priority), then status rules.
var DefaultErrorRules = []ErrorRule{
	// --- Text-based rules (checked first, order = priority) ---
	{BodyMatch: "no credentials", Action: ActionCooldown, CooldownSec: 120},
	{BodyMatch: "request not allowed", Action: ActionCooldown, CooldownSec: 5},
	{BodyMatch: "improperly formed request", Action: ActionCooldown, CooldownSec: 120},
	{BodyMatch: "rate limit", Action: ActionBackoff},
	{BodyMatch: "too many requests", Action: ActionBackoff},
	{BodyMatch: "quota exceeded", Action: ActionBackoff},
	{BodyMatch: "capacity", Action: ActionBackoff},
	{BodyMatch: "overloaded", Action: ActionBackoff},

	// --- Status-based rules (fallback when text doesn't match) ---
	{StatusCode: 401, Action: ActionCooldown, CooldownSec: 120},
	{StatusCode: 402, Action: ActionCooldown, CooldownSec: 120},
	{StatusCode: 403, Action: ActionCooldown, CooldownSec: 120},
	{StatusCode: 404, Action: ActionCooldown, CooldownSec: 120},
	{StatusCode: 429, Action: ActionBackoff},
}

// DefaultTransientCooldownSec is the default cooldown for unmatched errors.
const DefaultTransientCooldownSec = 30

// ClassifyError matches an HTTP error (statusCode + body) against DefaultErrorRules.
// Text rules are checked first by order; then status rules.
// Returns the first matching rule, or a transient fallback if no rule matches.
func ClassifyError(statusCode int, body string) ErrorRule {
	lower := strings.ToLower(body)

	for _, rule := range DefaultErrorRules {
		if rule.BodyMatch != "" && strings.Contains(lower, rule.BodyMatch) {
			return rule
		}
	}

	for _, rule := range DefaultErrorRules {
		if rule.StatusCode == statusCode {
			return rule
		}
	}

	return ErrorRule{Action: ActionTransient, CooldownSec: DefaultTransientCooldownSec}
}
