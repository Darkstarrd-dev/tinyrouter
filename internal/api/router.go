package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/tinyrouter/tinyrouter/internal/combo"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/console"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
	"github.com/tinyrouter/tinyrouter/internal/registry"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/usage"
)

// Router holds all dependencies needed to wire up HTTP routes.
type Router struct {
	reg         *registry.Registry
	cfg         *config.Config
	configPath  string
	usage       *usage.RingBuffer
	logger      *console.Logger
	proxyHandler *proxy.Handler
	selector    *rotation.Selector
	comboRes    *combo.Resolver
}

// New creates an API Router.
func New(reg *registry.Registry, cfg *config.Config, configPath string, usageBuf *usage.RingBuffer, logger *console.Logger, proxyHandler *proxy.Handler) *Router {
	return &Router{
		reg:          reg,
		cfg:          cfg,
		configPath:   configPath,
		usage:        usageBuf,
		logger:       logger,
		proxyHandler: proxyHandler,
	}
}

// Routes returns the root HTTP handler with all routes registered.
func (rt *Router) Routes(proxyHandler *proxy.Handler) http.Handler {
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)

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

		// Providers
		r.Get("/providers", rt.listProviders)
		r.Post("/providers", rt.createProvider)
		r.Put("/providers/{id}", rt.updateProvider)
		r.Delete("/providers/{id}", rt.deleteProvider)

		// Keys
		r.Get("/providers/{id}/keys", rt.listKeys)
		r.Post("/providers/{id}/keys", rt.createKey)
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
		r.Delete("/usage", rt.clearUsage)

		// Console logs
		r.Get("/console-logs", rt.getConsoleLogs)
		r.Get("/console-logs/stream", rt.streamConsoleLogs)
		r.Delete("/console-logs", rt.clearConsoleLogs)

		// Models
		r.Get("/models", rt.listModels)
	})

	// Embedded UI (fallback to index.html)
	r.Get("/*", rt.serveUI)

	return r
}
