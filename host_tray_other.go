//go:build tray && !windows

package main

// openBrowserOnStartHost: even on the tray variant of non-Windows hosts we keep
// auto-open disabled (the tray is the entry point), but the actual tray impl
// differs per OS; this stub lets Linux/macOS builds compile without dragging in
// platform-specific tray libs.
func openBrowserOnStartHost() bool { return false }

// runHostLoop on non-Windows tray builds falls back to console behavior: there
// is no systray wired here yet. Linux/macOS tray support can be added later
// without touching main.go.
func runHostLoop(hctx *hostContext) {
	runHostLoopConsole(hctx)
}
