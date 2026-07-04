//go:build tray && windows && !webview

package main

// addWebviewMenuItem when the `webview` tag is NOT set is a no-op: the tray
// menu omits the "独立窗口" entry. Returns nil — caller ignores the value.
// This stub keeps host_tray_windows.go build-tag-agnostic.
func addWebviewMenuItem(hctx *hostContext) interface{} { return nil }
