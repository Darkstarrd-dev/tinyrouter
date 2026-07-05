//go:build !tray && !webview

package main

// openBrowserOnStartHost reports whether the default (console) host should
// auto-open a browser window on startup. Tray/webview hosts set this to false
// so they — not a popped browser — are the entry point.
func openBrowserOnStartHost() bool { return true }

// runHostLoop blocks the main goroutine until an OS signal (SIGINT/SIGTERM) is
// received or the UI requests shutdown via POST /api/shutdown (quit channel).
// This is the original console-host behavior.
func runHostLoop(hctx *hostContext) {
	runHostLoopConsole(hctx)
}
