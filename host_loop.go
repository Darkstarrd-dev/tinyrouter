package main

import (
	"os"
	"os/signal"
	"syscall"
)

// runHostLoopConsole blocks on OS signal (SIGINT/SIGTERM) or UI-triggered
// shutdown via the quit channel. Shared by console-host builds and by
// non-Windows platform tray/webview builds as a fallback.
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
