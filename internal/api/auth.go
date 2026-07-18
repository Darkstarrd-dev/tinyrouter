package api

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/config"
)

const sessionCookieName = "tinyrouter_session"
const sessionMaxAge = 24 * time.Hour

type sessionStoreType struct {
	sync.RWMutex
	tokens map[string]time.Time
}

var sessionStore = &sessionStoreType{tokens: make(map[string]time.Time)}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (rt *Router) isAuthEnabled() bool {
	cfg := rt.reg.Config()
	return cfg.Security.PasswordEnabled
}

func isValidSession(token string) bool {
	if token == "" {
		return false
	}
	sessionStore.RLock()
	createdAt, ok := sessionStore.tokens[token]
	sessionStore.RUnlock()
	if !ok {
		return false
	}
	if time.Since(createdAt) > sessionMaxAge {
		sessionStore.Lock()
		delete(sessionStore.tokens, token)
		sessionStore.Unlock()
		return false
	}
	return true
}

func (s *sessionStoreType) ClearAll() {
	s.Lock()
	defer s.Unlock()
	s.tokens = make(map[string]time.Time)
}

func (rt *Router) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rt.isAuthEnabled() {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil || !isValidSession(cookie.Value) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (rt *Router) LoginHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	cfg := rt.reg.Config()
	if !cfg.Security.PasswordEnabled {
		setSessionCookie(w, "")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
		return
	}
	// Defensive: password protection is enabled but no password was ever saved
	// (e.g., user toggled it on but didn't save a password, then restarted).
	// Treat as not enabled to prevent permanent lockout.
	if cfg.Security.PasswordEncrypted == "" || cfg.Security.EncryptionKey == "" {
		setSessionCookie(w, "")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
		return
	}
	plaintext, err := config.Decrypt(cfg.Security.EncryptionKey, cfg.Security.PasswordEncrypted)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to decrypt password")
		return
	}
	if subtle.ConstantTimeCompare([]byte(req.Password), []byte(plaintext)) != 1 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "wrong password"})
		return
	}
	token, err := generateToken()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}
	sessionStore.Lock()
	sessionStore.tokens[token] = time.Now()
	sessionStore.Unlock()
	setSessionCookie(w, token)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func (rt *Router) AuthStatusHandler(w http.ResponseWriter, r *http.Request) {
	passwordEnabled := rt.isAuthEnabled()
	authenticated := false
	if passwordEnabled {
		cookie, err := r.Cookie(sessionCookieName)
		if err == nil && isValidSession(cookie.Value) {
			authenticated = true
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{
		"passwordEnabled": passwordEnabled,
		"authenticated":   authenticated,
	})
}

func (rt *Router) LogoutHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookieName)
	if err == nil && cookie.Value != "" {
		sessionStore.Lock()
		delete(sessionStore.tokens, cookie.Value)
		sessionStore.Unlock()
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(sessionMaxAge.Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}
