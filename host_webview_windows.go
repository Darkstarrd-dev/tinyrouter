//go:build webview && windows

package main

import (
	"runtime"
	"sync"
	"time"

	"fyne.io/systray"
	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
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

	// Auto-open the native window once at startup (independent of the click loop).
	go openWebviewAfterReady(hctx)

	return m
}

// openWebviewAfterReady waits briefly for the HTTP server to be listening, then
// launches the first native window. Launched in a goroutine so systray.Run can
// block the main goroutine concurrently.
func openWebviewAfterReady(hctx *hostContext) {
	// The HTTP server is started just before runHostLoop, but on a slow boot it
	// may not yet be bound. Polling gctx.consoleURL is overkill; a short sleep is
	// enough since the server goroutine has already been scheduled by main.
	time.Sleep(500 * time.Millisecond)
	openWebviewWindow(hctx)
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
//
// WebView2 (COM-backed) REQUIRES its message pump to run on a thread that:
//   1) Is locked with runtime.LockOSThread so the Go scheduler won't move the
//      goroutine mid-pump (otherwise COM vtable calls jump threads and panic).
//   2) Has been initialized into the STA concurrency model via CoInitializeEx.
//
// Without LockOSThread, systray + webview interact to corrupt COM state and the
// process crashes the moment the WebView2 controller tries to dispatch a message.
func openWebviewWindow(hctx *hostContext) {
	// Isolate panics from this window's goroutine so a creation failure doesn't
	// propagate to systray and kill the process. We log + recover instead.
	defer func() {
		if r := recover(); r != nil {
			hctx.logger.Error("webview window panic: %v", r)
		}
	}()

	// Acquire the creation lock OUTSIDE the locked thread, so other clicks don't
	// hold it while we run a message pump for an arbitrary amount of time.
	webviewWindowMu.Lock()
	defer webviewWindowMu.Unlock()

	// Pin this goroutine to a single OS thread for the lifetime of the window.
	// Combined with CoInitializeEx this gives WebView2 a stable STA apartment.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// Initialize COM STA for this thread. COINIT_APARTMENTTHREADED = 0x2.
	// S_FALSE (1) and RPC_E_CHANGED_MODE (0x80010106) are tolerable here.
	if err := windows.CoInitializeEx(0, 2); err != nil {
		// RPC_E_CHANGED_MODE means the thread already entered MTA. We explicitly
		// want STA; if we can't get it, fail with a log line instead of crashing.
		if err != windows.Errno(0x80010106) {
			hctx.logger.Error("CoInitializeEx failed: %v", err)
			return
		}
	}
	// CoUninitialize must run on the same thread that called CoInitializeEx.
	// Deferred here runs before the UnlockOSThread defer (LIFO), which is correct.
	defer windows.CoUninitialize()

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
	if w == nil {
		hctx.logger.Error("failed to create WebView2 window (WebView2 runtime missing?)")
		return
	}
	w.SetTitle("TinyRouter")
	w.Navigate(hctx.consoleURL)

	// Maximize the window after creation. jchv/go-webview2 creates the window
	// at the requested Width/Height but doesn't expose a Maximize API; we call
	// Win32 ShowWindow directly with SW_MAXIMIZE = 3.
	// w.Window() returns unsafe.Pointer to the HWND (uintptr).
	// Must do this after Navigate so the WebView2 controller is fully created;
	// calling it earlier can race the controller's window attachment.
	hwnd := uintptr(w.Window())
	if hwnd != 0 {
		const swMaximize = 3
		_, _, _ = windows.NewLazySystemDLL("user32.dll").NewProc("ShowWindow").Call(hwnd, swMaximize)
	}

	// w.Run() pumps Win32 messages for this thread until the window is closed.
	// On close it returns; the deferred cleanup runs and the goroutine exits, but
	// the systray host loop keeps the process alive.
	w.Run()
}
