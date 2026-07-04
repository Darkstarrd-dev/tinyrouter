//go:build tray && windows

package main

import (
	"embed"
	"os"
	"os/signal"
	"syscall"

	"fyne.io/systray"
	"github.com/tinyrouter/tinyrouter/web"
)

//go:embed web/static/favicon.ico
var trayIconFS embed.FS

// openBrowserOnStartHost: tray host does NOT auto-open a browser; the tray icon
// is the entry point. User opens the console from the tray menu.
func openBrowserOnStartHost() bool { return false }

// runHostLoop drives the systray lifecycle. systray.Run blocks the calling
// goroutine and processes menu events until systray.Quit is called. We forward
// OS signals (SIGINT/SIGTERM) to systray.Quit so service stops and Ctrl+C still work.
func runHostLoop(hctx *hostContext) {
	// OS signal listener forwards SIGINT/SIGTERM to a graceful tray quit.
	// Buffered so the sender never blocks if the tray already exited.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		hctx.logger.Info("shutting down (signal)...")
		systray.Quit()
	}()

	// UI shutdown (POST /api/shutdown) also triggers a graceful tray quit.
	go func() {
		<-hctx.quit()
		hctx.logger.Info("shutting down (UI)...")
		systray.Quit()
	}()

	systray.Run(func() {
		iconBytes, err := trayIconFS.ReadFile("web/static/favicon.ico")
		if err != nil {
			// Fallback to the embed.FS already bundled with web.Static (same file).
			if b, e := web.Static.ReadFile("static/favicon.ico"); e == nil {
				iconBytes = b
			}
		}
		if len(iconBytes) > 0 {
			systray.SetIcon(iconBytes)
		}
		systray.SetTitle("TinyRouter")
		systray.SetTooltip("TinyRouter — lightweight LLM API proxy")

		mOpen := systray.AddMenuItem("打开控制台", "Open the admin UI in your browser")
		// "打开独立窗口" entry is only present when the `webview` tag is set;
		// otherwise addWebviewMenuItem is nil-typed and the menu skips it.
		_ = addWebviewMenuItem(hctx)
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("退出", "Quit TinyRouter")

		go handleTrayMenu(hctx, mOpen, mQuit)
	}, func() {
		// onExit: nothing to clean — main proceeds to HTTP server shutdown.
	})
}

// handleTrayMenu dispatches menu item clicks. Runs in its own goroutine since
// systray.Run is already blocking the main goroutine.
func handleTrayMenu(hctx *hostContext, mOpen, mQuit *systray.MenuItem) {
	for {
		select {
		case <-mOpen.ClickedCh:
			if err := openBrowser(hctx.consoleURL); err != nil {
				hctx.logger.Info("failed to open browser from tray: %v", err)
			}
		case <-mQuit.ClickedCh:
			systray.Quit()
			return
		}
	}
}
