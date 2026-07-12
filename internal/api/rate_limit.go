package api

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

type loginAttempt struct {
	failCount    int
	firstFail    time.Time
	blockedUntil time.Time
}

type loginRateLimiter struct {
	mu       sync.Mutex
	attempts map[string]*loginAttempt
}

const (
	maxLoginAttempts   = 5
	loginWindow        = 1 * time.Minute
	loginBlockDuration = 1 * time.Minute
)

func newLoginRateLimiter() *loginRateLimiter {
	return &loginRateLimiter{
		attempts: make(map[string]*loginAttempt),
	}
}

func (l *loginRateLimiter) cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for ip, a := range l.attempts {
		switch {
		case a.blockedUntil.IsZero() && now.After(a.firstFail.Add(loginWindow)):
			delete(l.attempts, ip)
		case !a.blockedUntil.IsZero() && now.After(a.blockedUntil):
			delete(l.attempts, ip)
		}
	}
}

func (l *loginRateLimiter) IsBlocked(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	a, exists := l.attempts[ip]
	if !exists {
		return false
	}
	if !a.blockedUntil.IsZero() && time.Now().Before(a.blockedUntil) {
		return true
	}
	return false
}

func (l *loginRateLimiter) RecordFailure(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	a, exists := l.attempts[ip]
	if !exists {
		l.attempts[ip] = &loginAttempt{
			failCount: 1,
			firstFail: now,
		}
		return
	}
	if now.After(a.firstFail.Add(loginWindow)) && a.blockedUntil.IsZero() {
		a.failCount = 1
		a.firstFail = now
		return
	}
	a.failCount++
	if a.failCount >= maxLoginAttempts {
		a.blockedUntil = now.Add(loginBlockDuration)
	}
}

func (l *loginRateLimiter) RecordSuccess(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, ip)
}

type loginResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *loginResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

func (l *loginRateLimiter) Wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if idx := strings.IndexByte(xff, ','); idx >= 0 {
				ip = strings.TrimSpace(xff[:idx])
			} else {
				ip = strings.TrimSpace(xff)
			}
		}

		l.cleanup()

		if l.IsBlocked(ip) {
			writeAPIError(w, http.StatusTooManyRequests, "too many login attempts, try again later")
			return
		}

		lrw := &loginResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next(lrw, r)

		if lrw.statusCode == http.StatusOK {
			l.RecordSuccess(ip)
		} else if lrw.statusCode == http.StatusUnauthorized {
			l.RecordFailure(ip)
		}
	}
}
