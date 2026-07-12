//go:build !tray

package app

// openBrowserOnStart reports whether the default (console) host should
// auto-open a browser window on startup. Tray/webview hosts override this to
// false so they — not a popped browser — are the entry point.
func openBrowserOnStart() bool { return true }
