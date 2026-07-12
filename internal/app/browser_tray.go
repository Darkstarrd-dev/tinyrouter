//go:build tray

package app

// openBrowserOnStart: tray (and webview, which implies tray) hosts do NOT
// auto-open a browser; the tray icon / native window is the entry point.
func openBrowserOnStart() bool { return false }
