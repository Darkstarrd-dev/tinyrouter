package main

//go:generate rsrc -ico web/static/favicon.ico -o rsrc.syso

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/api"
	"github.com/tinyrouter/tinyrouter/internal/combo"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/console"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
	"github.com/tinyrouter/tinyrouter/internal/registry"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/usage"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	// Load or create config
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// Sync ID counter with existing IDs to prevent collisions after restart.
	api.SyncIDCounter(cfg)

	// Initialize components
	logger := console.New(cfg.ConsoleLogMaxLines)
	usageBuf := usage.New(cfg.UsageRingSize)
	quotaTracker := usage.NewQuotaTracker()
	reg := registry.New(cfg)
	selector := rotation.New(reg, &cfg.Rotation)
	comboRes := combo.New(reg)
	proxyHandler := proxy.New(reg, selector, comboRes, usageBuf, quotaTracker, logger)

	// Shutdown is triggered by the UI via POST /api/shutdown.
	shutdownCtx, triggerShutdown := context.WithCancel(context.Background())
	apiRouter := api.New(reg, cfg, *configPath, usageBuf, quotaTracker, logger, proxyHandler, triggerShutdown, selector, comboRes)

	// Build HTTP server
	handler := apiRouter.Routes(proxyHandler)

	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  300 * time.Second,
		WriteTimeout: 300 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start server in goroutine
	go func() {
		logger.Info("TinyRouter v%s starting on http://%s", Version, addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Open browser after a short delay so the server is ready.
	go func() {
		time.Sleep(300 * time.Millisecond)
		if err := openBrowser(fmt.Sprintf("http://%s", addr)); err != nil {
			logger.Info("failed to open browser: %v", err)
		}
	}()

	// Graceful shutdown: wait for OS signal or UI-triggered shutdown.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-quit:
		logger.Info("shutting down (signal)...")
	case <-shutdownCtx.Done():
		logger.Info("shutting down (UI)...")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("forced shutdown: %v", err)
	}
	logger.Info("stopped")
}

// openBrowser opens the default browser for the current OS.
func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}
