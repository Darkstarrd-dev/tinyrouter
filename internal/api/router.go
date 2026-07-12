package api

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/tinyrouter/tinyrouter/internal/combo"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/console"
	"github.com/tinyrouter/tinyrouter/internal/download"
	"github.com/tinyrouter/tinyrouter/internal/monitor"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
	"github.com/tinyrouter/tinyrouter/internal/registry"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/terminal"
	"github.com/tinyrouter/tinyrouter/internal/usage"
	"github.com/tinyrouter/tinyrouter/web"
)

// Router holds all dependencies needed to wire up HTTP routes.
type Router struct {
	reg               *registry.Registry
	cfg               *config.Config
	configPath        string
	usage             *usage.RingBuffer
	quotaTracker      *usage.QuotaTracker
	logger            *console.Logger
	proxyHandler      *proxy.Handler
	selector          *rotation.Selector
	comboRes          *combo.Resolver
	testClient        *http.Client
	shutdown          context.CancelFunc
	restartFn         func(string)
	serverCfgFn       func(config.ServerConfig)
	upstreamTimeoutFn func(int)
	stateSaveFunc     func()
	debugMode         atomic.Bool
	monitorMgr        *monitor.Manager
	downloadMgr       *download.Manager
	terminalMu        sync.Mutex
	activeTerm        *terminal.Session
}

// New creates an API Router.
func New(reg *registry.Registry, cfg *config.Config, configPath string, usageBuf *usage.RingBuffer, quotaTracker *usage.QuotaTracker, logger *console.Logger, proxyHandler *proxy.Handler, shutdown context.CancelFunc, selector *rotation.Selector, comboRes *combo.Resolver, downloadMgr *download.Manager) *Router {
	return &Router{
		reg:          reg,
		cfg:          cfg,
		configPath:   configPath,
		usage:        usageBuf,
		quotaTracker: quotaTracker,
		logger:       logger,
		proxyHandler: proxyHandler,
		shutdown:     shutdown,
		selector:     selector,
		comboRes:     comboRes,
		testClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		monitorMgr:  monitor.New(500, cfg.Monitor.MaxLineLength),
		downloadMgr: downloadMgr,
	}
}

// SetRestartFunc configures a callback that will gracefully restart the HTTP
// server on a new address. Used by updateSettings when the port changes.
func (rt *Router) SetRestartFunc(fn func(string)) {
	rt.restartFn = fn
}

// SetServerConfigFunc configures a callback that pushes updated server timeout
// settings to the live ServerManager so a subsequent restart applies them.
func (rt *Router) SetServerConfigFunc(fn func(config.ServerConfig)) {
	rt.serverCfgFn = fn
}

// SetUpstreamTimeoutFunc configures a callback that pushes the updated
// upstream timeout to the live proxy handler so non-streaming requests
// pick up the new value without a restart.
func (rt *Router) SetUpstreamTimeoutFunc(fn func(int)) {
	rt.upstreamTimeoutFn = fn
}

// SetStateSaveFunc configures a callback that triggers a debounced state
// persistence write (state.yaml). Used by the reset-quota endpoint.
func (rt *Router) SetStateSaveFunc(fn func()) {
	rt.stateSaveFunc = fn
}

func (rt *Router) DebugMode() bool {
	return rt.debugMode.Load()
}

func (rt *Router) SetDebugMode(on bool) {
	rt.debugMode.Store(on)
}

// Cleanup stops the monitor manager and closes any active terminal session.
// This should be called during graceful shutdown.
func (rt *Router) Cleanup() {
	if err := rt.monitorMgr.Stop(); err != nil {
		rt.logger.Warn("monitor cleanup: %v", err)
	}
	rt.terminalMu.Lock()
	if rt.activeTerm != nil {
		rt.activeTerm.Close()
		rt.activeTerm = nil
	}
	rt.terminalMu.Unlock()
	if rt.downloadMgr != nil {
		rt.downloadMgr.Stop()
	}
}

// securityHeaders applies security-related HTTP headers to all responses
// except proxy routes (/v1/*) which transparently pass through upstream headers.
func securityHeaders(port int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.URL.Path, "/v1/") {
				csp := fmt.Sprintf("default-src 'self'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:%d", port)
				w.Header().Set("Content-Security-Policy", csp)
				w.Header().Set("X-Content-Type-Options", "nosniff")
				w.Header().Set("X-Frame-Options", "SAMEORIGIN")
				w.Header().Set("X-XSS-Protection", "1; mode=block")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Routes returns the root HTTP handler with all routes registered.
func (rt *Router) Routes(proxyHandler *proxy.Handler) http.Handler {
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(securityHeaders(rt.cfg.Port))
	// Compress responses (brotli/gzip) for compressible content types.
	// SSE responses and pre-compressed binaries are auto-skipped inside.
	r.Use(Compress)

	// CORS preflight for proxy routes only (/v1/*). Management /api/* routes
	// have NO CORS — the admin UI is same-origin and external pages must not
	// be able to read/modify config or steal API keys via cross-origin fetch.
	r.Options("/v1/*", func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Expose-Headers", "X-TinyRouter-Provider, X-TinyRouter-Key")
		w.WriteHeader(http.StatusNoContent)
	})

	// Proxy routes (OpenAI-compatible)
	r.Post("/v1/chat/completions", proxyHandler.ChatCompletions)
	r.Post("/v1/completions", proxyHandler.Completions)
	r.Get("/v1/models", proxyHandler.ListModels)

	// API routes
	r.Route("/api", func(r chi.Router) {
		// 1 MB API request body limit
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
				next.ServeHTTP(w, r)
			})
		})

		// --- Public routes (no auth required) ---
		r.Get("/auth/status", rt.AuthStatusHandler)
		loginLimiter := newLoginRateLimiter()
		r.Post("/auth/login", loginLimiter.Wrap(rt.LoginHandler))

		// --- Protected routes (auth required) ---
		r.Group(func(r chi.Router) {
			r.Use(rt.AuthMiddleware)

			// Settings
			r.Get("/settings", rt.getSettings)
			r.Patch("/settings", rt.updateSettings)
			r.Post("/reload", rt.reload)
			r.Post("/shutdown", rt.handleShutdown)

			// Providers
			r.Get("/providers", rt.listProviders)
			r.Post("/providers", rt.createProvider)
			r.Post("/providers/validate", rt.validateProvider)
			r.Put("/providers/{id}", rt.updateProvider)
			r.Delete("/providers/{id}", rt.deleteProvider)

			// Provider testing
			r.Post("/providers/{id}/test", rt.testProviderKey)

			// Provider models
			r.Get("/providers/{id}/models", rt.fetchProviderModels)
			r.Post("/providers/{id}/models", rt.addProviderModel)
			r.Post("/providers/{id}/models/test", rt.testProviderModel)
			r.Post("/providers/{id}/models/test-all", rt.testProviderModelAllKeys)
			r.Patch("/providers/{id}/models/quota", rt.updateModelQuota)
			r.Delete("/providers/{id}/models", rt.deleteProviderModel)

			// Keys
			r.Get("/providers/{id}/keys", rt.listKeys)
			r.Post("/providers/{id}/keys", rt.createKey)
			r.Post("/providers/{id}/keys/bulk", rt.bulkAddKeys)
			r.Put("/providers/{id}/keys/{kid}", rt.updateKey)
			r.Delete("/providers/{id}/keys/{kid}", rt.deleteKey)
			r.Get("/providers/{id}/keys/{kid}/state", rt.getKeyState)

			// Combos
			r.Get("/combos", rt.listCombos)
			r.Post("/combos", rt.createCombo)
			r.Put("/combos/{id}", rt.updateCombo)
			r.Delete("/combos/{id}", rt.deleteCombo)

			// QuickSlots
			r.Get("/quickslots", rt.listQuickSlots)
			r.Post("/quickslots", rt.createQuickSlot)
			r.Put("/quickslots/{id}", rt.updateQuickSlot)
			r.Delete("/quickslots/{id}", rt.deleteQuickSlot)

			// Usage
			r.Get("/usage", rt.getUsage)
			r.Get("/usage/summary", rt.getUsageSummary)
			r.Get("/usage/quotas", rt.getQuotas)
			r.Get("/usage/model-keys", rt.getModelKeys)
			r.Get("/usage/events", rt.streamUsageEvents)
			r.Delete("/usage", rt.clearUsage)
			r.Post("/usage/reset-quota", rt.resetQuota)

			// Console logs
			r.Get("/console-logs", rt.getConsoleLogs)
			r.Get("/console-logs/stream", rt.streamConsoleLogs)
			r.Delete("/console-logs", rt.clearConsoleLogs)

			// Monitor
			r.Get("/monitor/status", rt.getMonitorStatus)
			r.Post("/monitor/start", rt.startMonitor)
			r.Post("/monitor/stop", rt.stopMonitor)
			r.Get("/monitor/stream", rt.streamMonitor)

			// Terminal (debug-mode only)
			r.Get("/terminal/ws", rt.handleTerminalWS)
			r.Post("/terminal/stop", rt.stopTerminal)

			// Auth - logout (requires auth)
			r.Post("/auth/logout", rt.LogoutHandler)

			// Models
			r.Get("/models", rt.listModels)

			// Downloads
			r.Get("/downloads", rt.listDownloads)
			r.Post("/downloads", rt.createDownload)
			r.Get("/downloads/stream", rt.streamDownloadEvents)
			r.Post("/downloads/info", rt.getVideoInfo)
			r.Post("/downloads/playlist-info", rt.getPlaylistInfo)
			r.Post("/downloads/playlist", rt.createPlaylistDownload)
			r.Post("/downloads/clear-completed", rt.clearCompletedDownloads)
			r.Get("/downloads/{id}", rt.getDownload)
			r.Get("/downloads/{id}/log", rt.getDownloadLog)
			r.Post("/downloads/{id}/cancel", rt.cancelDownload)
			r.Delete("/downloads/{id}", rt.removeDownload)
		})
	})

	// Embedded UI (fallback to index.html)
	// Playground static routes: only register when the playground module is
	// compiled into the binary (build tag `playground`). At runtime the flag
	// is a no-op when the binary lacks playground resources.
	if web.PlaygroundCompiled() {
		if pgStatic, err := fs.Sub(web.PlaygroundStatic, "playground/static-pg"); err == nil {
			pgFSRoot := http.FileServer(http.FS(pgStatic))
			r.Get("/playground.css", pgFSRoot.ServeHTTP)
			r.Get("/vendor/*", pgFSRoot.ServeHTTP)
			pgJSFiles := []string{
				"playground.js", "pg-i18n.js",
				"pg-core.js", "pg-state.js", "pg-markdown.js",
				"pg-request.js", "pg-stream.js", "pg-render.js",
				"pg-ui.js", "pg-modal.js", "pg-lifecycle.js",
				"pg-autochat.js",
				"pg-setup.js", "pg-director.js",
			}
			for _, f := range pgJSFiles {
				r.Get("/"+f, pgFSRoot.ServeHTTP)
			}
		}
	}
	r.Get("/*", rt.serveUI)

	return r
}
