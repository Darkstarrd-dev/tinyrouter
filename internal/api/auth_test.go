package api

import (
	"testing"
	"time"
)

func TestGenerateToken_Uniqueness(t *testing.T) {
	n := 100
	tokens := make(map[string]bool, n)
	for i := 0; i < n; i++ {
		token, err := generateToken()
		if err != nil {
			t.Fatalf("generateToken: %v", err)
		}
		if tokens[token] {
			t.Fatalf("duplicate token generated: %s", token)
		}
		tokens[token] = true
	}
}

func TestGenerateToken_Length(t *testing.T) {
	token, err := generateToken()
	if err != nil {
		t.Fatalf("generateToken: %v", err)
	}
	if len(token) != 64 {
		t.Fatalf("token length = %d, want 64", len(token))
	}
}

func TestSessionStore_ValidateAfterAdd(t *testing.T) {
	sessionStore.ClearAll()
	token, err := generateToken()
	if err != nil {
		t.Fatalf("generateToken: %v", err)
	}
	sessionStore.Lock()
	sessionStore.tokens[token] = time.Now()
	sessionStore.Unlock()
	if !isValidSession(token) {
		t.Fatal("isValidSession returned false for a token that was just added")
	}
}

func TestSessionStore_ValidateUnknown(t *testing.T) {
	sessionStore.ClearAll()
	if isValidSession("nonexistent-token") {
		t.Fatal("isValidSession returned true for unknown token")
	}
}

func TestSessionStore_ValidateEmpty(t *testing.T) {
	sessionStore.ClearAll()
	if isValidSession("") {
		t.Fatal("isValidSession returned true for empty token")
	}
}

func TestSessionStore_ClearAll(t *testing.T) {
	sessionStore.ClearAll()
	tokens := make([]string, 5)
	for i := range tokens {
		token, err := generateToken()
		if err != nil {
			t.Fatalf("generateToken: %v", err)
		}
		tokens[i] = token
		sessionStore.Lock()
		sessionStore.tokens[token] = time.Now()
		sessionStore.Unlock()
	}
	sessionStore.ClearAll()
	for _, token := range tokens {
		if isValidSession(token) {
			t.Fatalf("isValidSession returned true for token after ClearAll: %s", token)
		}
	}
}

func TestSessionStore_ExpiredToken(t *testing.T) {
	sessionStore.ClearAll()
	token, err := generateToken()
	if err != nil {
		t.Fatalf("generateToken: %v", err)
	}
	sessionStore.Lock()
	sessionStore.tokens[token] = time.Now().Add(-25 * time.Hour)
	sessionStore.Unlock()
	if isValidSession(token) {
		t.Fatal("isValidSession returned true for expired token")
	}
	sessionStore.RLock()
	_, ok := sessionStore.tokens[token]
	sessionStore.RUnlock()
	if ok {
		t.Fatal("expired token should have been removed from store")
	}
}
