//go:build webview && windows

package main

import (
	"sync"

	"fyne.io/systray"
	"github.com/jchv/go-webview2"
)

// addWebviewMenuItem adds an "打开独立窗口" item to the tray menu and wires its
// click channel to launch a native WebView2 window per click. Only compiled when
// the `webview` build tag is set.
//
// Returns interface{} so the caller (host_tray_windows.go) stays build-tag-
// agnostic; the matching stub when `webview` is absent returns nil.
func addWebviewMenuItem(hctx *hostContext) interface{} {
	m := systray.AddMenuItem("打开独立窗口", "Open TinyRouter UI in a native WebView2 window")
	go runWebviewClickLoop(hctx, m)
	return m
}

// runWebviewClickLoop listens for clicks on the "独立窗口" menu item and launches
// a new WebView2 window on each click. The window runs in its own goroutine;
// closing it only ends that goroutine, not the whole process.
func runWebviewClickLoop(hctx *hostContext, m *systray.MenuItem) {
	for range m.ClickedCh {
		go openWebviewWindow(hctx)
	}
}

// webviewWindowMu serializes window creation: jchv/go-webview2 is not designed
// to create two windows in parallel from different goroutines (shared window class).
var webviewWindowMu sync.Mutex

// openWebviewWindow creates and runs a single WebView2 window. Each invocation
// blocks until the user closes the window, then returns. Multiple concurrent
// windows are allowed as long as creation itself is serialized.
func openWebviewWindow(hctx *hostContext) {
	webviewWindowMu.Lock()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "TinyRouter",
			Width:  1280,
			Height: 800,
			IconId: 1, // resource ID 1 in rsrc.syso (the embedded favicon)
			Center: true,
		},
	})
	webviewWindowMu.Unlock()
	if w == nil {
		hctx.logger.Error("failed to create WebView2 window (WebView2 runtime missing?)")
		return
	}
	w.SetTitle("TinyRouter")
	w.Navigate(hctx.consoleURL)
	// w.Run() blocks this goroutine until the user closes the window.
	w.Run()
}
