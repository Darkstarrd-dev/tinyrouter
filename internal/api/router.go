package api

import (
	"context"
	"io/fs"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/tinyrouter/tinyrouter/internal/combo"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/console"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
	"github.com/tinyrouter/tinyrouter/internal/registry"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/usage"
	"github.com/tinyrouter/tinyrouter/web"
)

// Router holds all dependencies needed to wire up HTTP routes.
type Router struct {
	reg          *registry.Registry
	cfg          *config.Config
	configPath   string
	usage        *usage.RingBuffer
	quotaTracker *usage.QuotaTracker
	logger       *console.Logger
	proxyHandler *proxy.Handler
	selector     *rotation.Selector
	comboRes     *combo.Resolver
	client       *http.Client
	testClient   *http.Client
	shutdown     context.CancelFunc
	restartFn    func(string)
	debugMode    atomic.Bool
}

// New creates an API Router.
func New(reg *registry.Registry, cfg *config.Config, configPath string, usageBuf *usage.RingBuffer, quotaTracker *usage.QuotaTracker, logger *console.Logger, proxyHandler *proxy.Handler, shutdown context.CancelFunc, selector *rotation.Selector, comboRes *combo.Resolver) *Router {
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
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		testClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// SetRestartFunc configures a callback that will gracefully restart the HTTP
// server on a new address. Used by updateSettings when the port changes.
func (rt *Router) SetRestartFunc(fn func(string)) {
	rt.restartFn = fn
}

func (rt *Router) DebugMode() bool {
	return rt.debugMode.Load()
}

func (rt *Router) SetDebugMode(on bool) {
	rt.debugMode.Store(on)
}

// securityHeaders applies security-related HTTP headers to all responses
// except proxy routes (/v1/*) which transparently pass through upstream headers.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v1/") {
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "SAMEORIGIN")
			w.Header().Set("X-XSS-Protection", "1; mode=block")
		}
		next.ServeHTTP(w, r)
	})
}

// Routes returns the root HTTP handler with all routes registered.
func (rt *Router) Routes(proxyHandler *proxy.Handler) http.Handler {
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			// Expose custom response headers (X-TinyRouter-*) to clients.
			w.Header().Set("Access-Control-Expose-Headers", "X-TinyRouter-Provider, X-TinyRouter-Key")
			next.ServeHTTP(w, r)
		})
	})
	r.Use(securityHeaders)
	// Compress responses (brotli/gzip) for compressible content types.
	// SSE responses and pre-compressed binaries are auto-skipped inside.
	r.Use(Compress)

	// Proxy routes (OpenAI-compatible)
	r.Post("/v1/chat/completions", proxyHandler.ChatCompletions)
	r.Post("/v1/completions", proxyHandler.Completions)
	r.Get("/v1/models", proxyHandler.ListModels)

	// API routes
	r.Route("/api", func(r chi.Router) {
		// Settings
		r.Get("/settings", rt.getSettings)
		r.Patch("/settings", rt.updateSettings)
		r.Post("/reload", rt.reload)

		// Shutdown
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

		// Usage
		r.Get("/usage", rt.getUsage)
		r.Get("/usage/summary", rt.getUsageSummary)
		r.Get("/usage/quotas", rt.getQuotas)
		r.Get("/usage/model-keys", rt.getModelKeys)
		r.Get("/usage/events", rt.streamUsageEvents)
		r.Delete("/usage", rt.clearUsage)

		// Console logs
		r.Get("/console-logs", rt.getConsoleLogs)
		r.Get("/console-logs/stream", rt.streamConsoleLogs)
		r.Delete("/console-logs", rt.clearConsoleLogs)

		// Models
		r.Get("/models", rt.listModels)
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
			}
			for _, f := range pgJSFiles {
				r.Get("/"+f, pgFSRoot.ServeHTTP)
			}
		}
	}
	r.Get("/*", rt.serveUI)

	return r
}
