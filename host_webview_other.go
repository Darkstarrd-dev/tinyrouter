//go:build webview && !windows

package main

// addWebviewMenuItem on non-Windows platforms returns nil — the native WebView2
// window is Windows-only. The tray menu simply omits the "独立窗口" entry.
// (Linux/macOS support would require webview/webview with CGO; intentionally
// out of scope for this iteration.)
func addWebviewMenuItem(hctx *hostContext) interface{} { return nil }
