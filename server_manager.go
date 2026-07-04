package main

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/console"
)

// ServerManager wraps an *http.Server so it can be gracefully restarted
// on a new address without restarting the entire process.
type ServerManager struct {
	mu      sync.Mutex
	srv     *http.Server
	handler http.Handler
	addr    string
	logger  *console.Logger
}

// NewServerManager creates a ServerManager that will serve handler on addr.
func NewServerManager(handler http.Handler, addr string, logger *console.Logger) *ServerManager {
	return &ServerManager{handler: handler, addr: addr, logger: logger}
}

// Start begins listening on the configured address.
func (m *ServerManager) Start() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.startLocked()
}

// startLocked creates and starts the http.Server. Caller must hold m.mu.
func (m *ServerManager) startLocked() {
	m.srv = &http.Server{
		Addr:         m.addr,
		Handler:      m.handler,
		ReadTimeout:  300 * time.Second,
		WriteTimeout: 300 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	go func() {
		m.logger.Info("TinyRouter v%s starting on http://%s", Version, m.addr)
		if err := m.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()
}

// Restart gracefully shuts down the current server and starts a new one on
// newAddr. The HTTP handler is reused; only the listening address changes.
func (m *ServerManager) Restart(newAddr string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := m.srv.Shutdown(ctx); err != nil {
			m.logger.Warn("server shutdown error during restart: %v", err)
		}
	}
	m.addr = newAddr
	m.startLocked()
	return nil
}

// Shutdown gracefully stops the current server.
func (m *ServerManager) Shutdown(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.srv != nil {
		return m.srv.Shutdown(ctx)
	}
	return nil
}