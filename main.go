package main

//go:generate rsrc -ico web/static/favicon.ico -manifest rsrc.manifest -o rsrc.syso

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/api"
	"github.com/tinyrouter/tinyrouter/internal/combo"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/console"
	"github.com/tinyrouter/tinyrouter/internal/download"
	"github.com/tinyrouter/tinyrouter/internal/proxy"
	"github.com/tinyrouter/tinyrouter/internal/registry"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/state"
	"github.com/tinyrouter/tinyrouter/internal/usage"
)

// hostContext carries everything the host loop needs to drive exit + UI without
// leaking platform specifics (tray/webview/console) back into main.
type hostContext struct {
	logger     *console.Logger
	consoleURL string // full URL to the admin UI (e.g. http://127.0.0.1:7700)
	sm         *ServerManager
	// quit returns a channel that closes when the UI requests shutdown (POST /api/shutdown).
	quit func() <-chan struct{}
}

func main() {
	configPath := flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	// Load or create config
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// Single-instance check: create an exclusive lockfile next to config.yaml.
	// This prevents multiple processes from racing on config.yaml / state.yaml
	// file writes, which was a root cause of the "config.yaml locked on Windows"
	// issue during iterative debugging.
	configDir := filepath.Dir(*configPath)
	lockPath := filepath.Join(configDir, ".tinyrouter.lock")
	lockFile, lockErr := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if lockErr != nil {
		if os.IsExist(lockErr) {
			log.Fatalf("另一个 TinyRouter 实例已在运行。请先关闭它，或删除 %s 后重试。", lockPath)
		}
	} else {
		fmt.Fprintf(lockFile, "%d\n", os.Getpid())
		lockFile.Close()
		defer os.Remove(lockPath)
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
	proxyHandler := proxy.New(reg, selector, comboRes, usageBuf, quotaTracker, logger, cfg.Server.UpstreamTimeoutSec)
	proxyHandler.SetProxy(cfg.Proxy.Enabled, cfg.Proxy.Host, cfg.Proxy.Port)

	// Download manager
	downloadSettings := download.RuntimeSettings{
		DownloadDir:         cfg.Download.DefaultDir,
		YtDlpPath:           cfg.Download.YtDlpPath,
		FfmpegPath:          cfg.Download.FfmpegPath,
		ConcurrentFragments: cfg.Download.ConcurrentFragments,
		MaxConcurrent:       cfg.Download.MaxConcurrent,
		Proxy:               cfg.Download.Proxy,
		BrowserCookies:      cfg.Download.BrowserCookies,
		CookiesPath:         cfg.Download.CookiesPath,
	}
	downloadMgr := download.NewManager(downloadSettings, logger)
	if cfg.Download.Enabled {
		downloadMgr.Start()
		logger.Info("download manager started (concurrent=%d, fragments=%d)",
			cfg.Download.MaxConcurrent, cfg.Download.ConcurrentFragments)
	}

	// State persistence
	statePath := cfg.Rotation.StatePath
	if statePath == "" {
		statePath = "state.yaml"
	}
	var stateManager *state.Manager
	if cfg.Rotation.StatePersist {
		stateManager = state.NewManager(statePath, logger,
			state.WithKeyStateProvider(reg.SnapshotKeyStates, reg.RestoreKeyState),
			state.WithComboStateProvider(comboRes.SnapshotComboStates, comboRes.RestoreComboState),
		)
		selector.SetStateHook(stateManager.ScheduleWrite)
		comboRes.SetStateHook(stateManager.ScheduleWrite)

		// Restore persisted state
		if snapshot, err := state.Load(statePath); err != nil {
			logger.Warn("failed to load state: %v", err)
		} else if len(snapshot.Keys) > 0 || len(snapshot.Combos) > 0 {
			if err := stateManager.Restore(snapshot); err != nil {
				logger.Warn("failed to restore state: %v", err)
			}
			logger.Info("restored state: %d keys, %d combos", len(snapshot.Keys), len(snapshot.Combos))
		}
	}

	// Shutdown is triggered by the UI via POST /api/shutdown.
	shutdownCtx, triggerShutdown := context.WithCancel(context.Background())
	apiRouter := api.New(reg, cfg, *configPath, usageBuf, quotaTracker, logger, proxyHandler, triggerShutdown, selector, comboRes, downloadMgr)
	proxyHandler.SetDebugModeProvider(apiRouter.DebugMode)

	// Build HTTP server
	handler := apiRouter.Routes(proxyHandler)
	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	sm := NewServerManager(handler, addr, logger, cfg.Server)
	sm.Start()
	apiRouter.SetRestartFunc(sm.Restart)
	apiRouter.SetServerConfigFunc(sm.SetServerConfig)
	apiRouter.SetUpstreamTimeoutFunc(proxyHandler.SetUpstreamTimeout)
	if stateManager != nil {
		apiRouter.SetStateSaveFunc(stateManager.ScheduleWrite)
	}

	// Auto-open browser on the default (console) host; tray/webview hosts override
	// openBrowserOnStartHost to false so the tray/window is the entry point, not a popped browser.
	if openBrowserOnStartHost() {
		go func() {
			time.Sleep(300 * time.Millisecond)
			if err := openBrowser(fmt.Sprintf("http://%s", addr)); err != nil {
				logger.Info("failed to open browser: %v", err)
			}
		}()
	}

	// Block on the host loop until shutdown is requested (signal or UI or tray quit).
	// runHostLoop (and its shutdown wiring) is implemented per build tag in host_*.go.
	runHostLoop(&hostContext{
		logger:     logger,
		consoleURL: fmt.Sprintf("http://%s", addr),
		sm:         sm,
		quit:       shutdownCtx.Done,
	})

	// Graceful HTTP server shutdown.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := sm.Shutdown(ctx); err != nil {
		log.Fatalf("forced shutdown: %v", err)
	}
	if stateManager != nil {
		if err := stateManager.FlushSync(); err != nil {
			logger.Warn("failed to flush state: %v", err)
		}
	}
	apiRouter.Cleanup()
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
