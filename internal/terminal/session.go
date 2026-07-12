package terminal

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
	"github.com/gorilla/websocket"
)

// Session represents a single interactive terminal session.
type Session struct {
	mu      sync.Mutex
	pty     pty.Pty
	cmd     *pty.Cmd
	conn    *websocket.Conn
	cancel  context.CancelFunc
	closed  bool
	onClose func()
}

// NewSession creates and starts an interactive terminal session.
func NewSession(shellPath string, conn *websocket.Conn, onClose func()) (*Session, error) {
	if shellPath == "" {
		shellPath = defaultShell()
	}

	path, err := exec.LookPath(shellPath)
	if err != nil {
		return nil, fmt.Errorf("shell not found: %s", shellPath)
	}

	pt, err := pty.New()
	if err != nil {
		return nil, fmt.Errorf("failed to create PTY: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := pt.CommandContext(ctx, path)
	cmd.Env = []string{
		"TERM=xterm-256color",
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + os.Getenv("HOME"),
		"USER=" + os.Getenv("USER"),
		"USERNAME=" + os.Getenv("USERNAME"),
		"USERPROFILE=" + os.Getenv("USERPROFILE"),
		"APPDATA=" + os.Getenv("APPDATA"),
		"LOCALAPPDATA=" + os.Getenv("LOCALAPPDATA"),
		"SystemRoot=" + os.Getenv("SystemRoot"),
		"TEMP=" + os.Getenv("TEMP"),
		"TMP=" + os.Getenv("TMP"),
	}

	if err := cmd.Start(); err != nil {
		cancel()
		_ = pt.Close()
		return nil, fmt.Errorf("failed to start shell: %w", err)
	}

	session := &Session{
		pty:     pt,
		cmd:     cmd,
		conn:    conn,
		cancel:  cancel,
		onClose: onClose,
	}

	_ = session.pty.Resize(80, 24)

	go session.readFromPTY()
	go session.readFromWebSocket()
	go session.waitForProcess()

	return session, nil
}

// GetConn returns the underlying WebSocket connection for the session.
func (s *Session) GetConn() *websocket.Conn {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn
}

// Close terminates the session, cleaning up all resources.
func (s *Session) Close() {
	s.cleanup()
}

func defaultShell() string {
	if runtime.GOOS == "windows" {
		for _, shell := range []string{"pwsh.exe", "powershell.exe", "cmd.exe"} {
			if _, err := exec.LookPath(shell); err == nil {
				return shell
			}
		}
		return "cmd.exe"
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	if _, err := exec.LookPath(shell); err != nil {
		shell = "/bin/sh"
	}
	return shell
}

func (s *Session) readFromPTY() {
	defer s.cleanup()
	buf := make([]byte, 32*1024)
	for {
		n, err := s.pty.Read(buf)
		if err != nil {
			if err == io.EOF {
				return
			}
			return
		}
		if n > 0 {
			s.mu.Lock()
			if s.conn != nil && !s.closed {
				_ = s.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				_ = s.conn.WriteMessage(websocket.BinaryMessage, buf[:n])
				_ = s.conn.SetWriteDeadline(time.Time{})
			}
			s.mu.Unlock()
		}
	}
}

func (s *Session) readFromWebSocket() {
	defer s.cleanup()
	for {
		msgType, data, err := s.conn.ReadMessage()
		if err != nil {
			return
		}

		switch msgType {
		case websocket.TextMessage:
			s.mu.Lock()
			if s.pty != nil && !s.closed {
				_, _ = s.pty.Write([]byte(data))
			}
			s.mu.Unlock()
		case websocket.BinaryMessage:
			if len(data) < 1 {
				continue
			}
			switch data[0] {
			case 0x01:
				if len(data) >= 5 {
					rows := uint16(data[1])<<8 | uint16(data[2])
					cols := uint16(data[3])<<8 | uint16(data[4])
					s.mu.Lock()
					if s.pty != nil && !s.closed {
						_ = s.pty.Resize(int(cols), int(rows))
					}
					s.mu.Unlock()
				}
			}
		}
	}
}

func (s *Session) waitForProcess() {
	_ = s.cmd.Wait()
	s.cleanup()
}

func (s *Session) cleanup() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	if s.cancel != nil {
		s.cancel()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		killProcessGroup(s.cmd.Process.Pid)
	}
	if s.pty != nil {
		_ = s.pty.Close()
	}
	if s.conn != nil {
		_ = s.conn.Close()
	}
	s.mu.Unlock()

	if s.onClose != nil {
		s.onClose()
	}
}
