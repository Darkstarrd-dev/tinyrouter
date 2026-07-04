//go:build !tray && !webview

package main

import (
	"os"
	"os/signal"
	"syscall"
)

// openBrowserOnStartHost reports whether the default (console) host should
// auto-open a browser window on startup. Tray/webview hosts set this to false
// so they — not a popped browser — are the entry point.
func openBrowserOnStartHost() bool { return true }

// runHostLoopConsole is the original console-host wait: blocks on OS signal
// (SIGINT/SIGTERM) or UI-triggered /api/shutdown. Used directly by the default
// build and reused by other hosts (e.g. tray-on-non-Windows) as a fallback.
func runHostLoopConsole(hctx *hostContext) {
	quitSig := make(chan os.Signal, 1)
	signal.Notify(quitSig, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-quitSig:
		hctx.logger.Info("shutting down (signal)...")
	case <-hctx.quit():
		hctx.logger.Info("shutting down (UI)...")
	}
}

// runHostLoop blocks the main goroutine until an OS signal (SIGINT/SIGTERM) is
// received or the UI requests shutdown via POST /api/shutdown (quit channel).
// This is the original console-host behavior.
func runHostLoop(hctx *hostContext) {
	runHostLoopConsole(hctx)
}
