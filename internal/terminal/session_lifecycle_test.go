package terminal

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// ---------------------------------------------------------------------------
// 1. Close idempotency and onClose callback
// ---------------------------------------------------------------------------

// TestCloseOnCloseCallback verifies that onClose is called exactly once and
// that Close() is idempotent (no panic on double-close).
func TestCloseOnCloseCallback(t *testing.T) {
	var callCount atomic.Int32

	s := &Session{
		closed:  false,
		onClose: func() { callCount.Add(1) },
	}

	// First Close — should invoke onClose
	s.Close()
	if c := callCount.Load(); c != 1 {
		t.Errorf("onClose called %d time(s), want 1", c)
	}
	if !s.closed {
		t.Error("expected closed to be true after first Close")
	}

	// Second Close — idempotent, no panic, onClose NOT called again
	s.Close()
	if c := callCount.Load(); c != 1 {
		t.Errorf("onClose called %d time(s) after second Close, want 1", c)
	}
}

// TestCloseNilSessionFields verifies that Close works safely when the Session
// has nil pty, cmd, conn, cancel, and onClose fields.
func TestCloseNilSessionFields(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Close panicked with nil fields: %v", r)
		}
	}()

	s := &Session{closed: false}
	s.Close()
	s.Close() // second call should also not panic
}

// ---------------------------------------------------------------------------
// 2. Resize message parsing
// ---------------------------------------------------------------------------

func TestParseResizeMessage(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		wantRows uint16
		wantCols uint16
		wantOK   bool
	}{
		{
			name:     "valid 24x80",
			data:     []byte{0x01, 0x00, 0x18, 0x00, 0x50},
			wantRows: 24,
			wantCols: 80,
			wantOK:   true,
		},
		{
			name:     "valid 40x120",
			data:     []byte{0x01, 0x00, 0x28, 0x00, 0x78},
			wantRows: 40,
			wantCols: 120,
			wantOK:   true,
		},
		{
			name:     "zero dimensions",
			data:     []byte{0x01, 0x00, 0x00, 0x00, 0x00},
			wantRows: 0,
			wantCols: 0,
			wantOK:   true,
		},
		{
			name:     "too short (4 bytes)",
			data:     []byte{0x01, 0x00, 0x18, 0x00},
			wantRows: 0,
			wantCols: 0,
			wantOK:   false,
		},
		{
			name:     "wrong type byte",
			data:     []byte{0x02, 0x00, 0x18, 0x00, 0x50},
			wantRows: 0,
			wantCols: 0,
			wantOK:   false,
		},
		{
			name:     "empty slice",
			data:     nil,
			wantRows: 0,
			wantCols: 0,
			wantOK:   false,
		},
		{
			name:     "single byte non-0x01",
			data:     []byte{0x00},
			wantRows: 0,
			wantCols: 0,
			wantOK:   false,
		},
		{
			name:     "max values",
			data:     []byte{0x01, 0xFF, 0xFF, 0xFF, 0xFF},
			wantRows: 65535,
			wantCols: 65535,
			wantOK:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows, cols, ok := parseResizeMessage(tt.data)
			if ok != tt.wantOK {
				t.Errorf("parseResizeMessage() ok = %v, want %v", ok, tt.wantOK)
			}
			if rows != tt.wantRows {
				t.Errorf("parseResizeMessage() rows = %d, want %d", rows, tt.wantRows)
			}
			if cols != tt.wantCols {
				t.Errorf("parseResizeMessage() cols = %d, want %d", cols, tt.wantCols)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 3. NewSession failure cleanup
// ---------------------------------------------------------------------------

// TestNewSessionFailureInvalidShell verifies that NewSession returns an error
// for a non-existent shell and does not leak goroutines.
func TestNewSessionFailureInvalidShell(t *testing.T) {
	goroutinesBefore := runtime.NumGoroutine()

	_, err := NewSession(
		"nonexistent-shell-that-definitely-does-not-exist-xyzzy",
		nil, nil,
	)
	if err == nil {
		t.Fatal("expected error for non-existent shell path")
	}

	// Give any stray goroutines time to settle
	time.Sleep(200 * time.Millisecond)

	goroutinesAfter := runtime.NumGoroutine()
	if goroutinesAfter > goroutinesBefore {
		t.Errorf("potential goroutine leak: before=%d, after=%d",
			goroutinesBefore, goroutinesAfter)
	}
}

// TestNewSessionFailureEmptyShell verifies that passing an empty shell path
// falls back to defaultShell, which should succeed (since the test is running
// on a machine with a shell). If defaultShell() itself fails we skip.
func TestNewSessionFailureEmptyShell(t *testing.T) {
	shell := defaultShell()
	if _, err := exec.LookPath(shell); err != nil {
		t.Skipf("defaultShell()=%q not found: %v", shell, err)
	}

	server, clientConn := wsPair(t)
	defer server.Close()
	defer clientConn.Close()

	sess, err := NewSession("", clientConn, nil)
	if err != nil {
		t.Fatalf("NewSession with empty shell failed: %v", err)
	}
	sess.Close()
}

// ---------------------------------------------------------------------------
// 4. End-to-end PTY session test
// ---------------------------------------------------------------------------

// TestEndToEndPTY starts a real shell session, sends a command, and verifies
// the output.  Skipped when no shell is available.
//
// IMPORTANT: do NOT use SetReadDeadline in a drain loop before sending the
// command — it corrupts the gorilla/websocket connection state. Instead,
// send the command after a simple time.Sleep and collect all output with
// a single SetReadDeadline call.
func TestEndToEndPTY(t *testing.T) {
	shell := detectShell()
	if shell == "" {
		t.Skip("no shell available for end-to-end PTY test")
	}

	server, clientConn := wsPair(t)
	defer server.Close()
	defer clientConn.Close()

	serverConn := server.accepted()
	defer serverConn.Close()

	sess, err := NewSession(shell, clientConn, nil)
	if err != nil {
		t.Fatalf("NewSession(%q) failed: %v", shell, err)
	}
	defer sess.Close()

	// Wait for the shell to start and output its banner + prompt.
	// Do NOT drain with SetReadDeadline — just let the PTY output buffer
	// and we'll read everything after sending the command.
	time.Sleep(2 * time.Second)

	// Send a simple command via the WebSocket
	msg := "echo PTY_TEST_HELLO\r\n"
	t.Logf("sending: %q", msg)
	serverConn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	if err := serverConn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
		t.Fatalf("write message: %v", err)
	}
	serverConn.SetWriteDeadline(time.Time{})

	// Read ALL messages (initial output + command echo + command output)
	// with a single read deadline.
	serverConn.SetReadDeadline(time.Now().Add(10 * time.Second))
	accumulated := make([]byte, 0)
	for !bytes.Contains(accumulated, []byte("PTY_TEST_HELLO")) {
		_, data, err := serverConn.ReadMessage()
		if err != nil {
			t.Fatalf("did not find expected output in PTY response: %v\nraw output (%d bytes):\n%s",
				err, len(accumulated), string(accumulated))
		}
		accumulated = append(accumulated, data...)
	}
	t.Logf("PTY output contains marker (total %d bytes)", len(accumulated))

	// Verify clean close
	sess.Close()

	// After Close, the WebSocket should be closed by the session
	serverConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err = serverConn.ReadMessage()
	if err == nil {
		t.Error("expected WebSocket read to fail after session Close")
	}
}

// ---------------------------------------------------------------------------
// test helpers
// ---------------------------------------------------------------------------

// wsPair starts a local HTTP server with a WebSocket endpoint and returns
// both the server handle and a client *websocket.Conn.
//
// The server handle's accepted() method returns the server-side *websocket.Conn
// that corresponds to the returned client connection.
func wsPair(t *testing.T) (*wsServer, *websocket.Conn) {
	t.Helper()

	ch := make(chan *websocket.Conn, 1)
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("wsPair: upgrade error: %v", err)
			return
		}
		ch <- conn
	}))

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	clientConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		httpServer.Close()
		t.Fatalf("wsPair: dial %s: %v", wsURL, err)
	}

	return &wsServer{http: httpServer, ch: ch}, clientConn
}

// wsServer holds a test HTTP server and the channel of accepted server-side
// WebSocket connections.
type wsServer struct {
	http *httptest.Server
	ch   chan *websocket.Conn
}

func (s *wsServer) Close() {
	if s.http != nil {
		s.http.Close()
	}
}

// accepted returns the server-side WebSocket connection for the first
// accepted client.  Must be called exactly once per wsPair.
func (s *wsServer) accepted() *websocket.Conn {
	return <-s.ch
}

// detectShell returns the path to a usable shell, or "" if none is found.
func detectShell() string {
	for _, name := range []string{"cmd.exe", "pwsh.exe", "powershell.exe", "/bin/bash", "/bin/sh"} {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	return ""
}

