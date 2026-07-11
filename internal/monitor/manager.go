package monitor

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Manager manages a single running monitor command. Only one command runs at a time.
type Manager struct {
	mu              sync.Mutex
	cmd             *exec.Cmd
	cancel          context.CancelFunc
	running         bool
	command         string
	args            []string
	startTime       time.Time
	subscribers     map[chan string]struct{}
	subscriberMutex sync.RWMutex
	lineBuffer      []string
	maxBufferLines  int
	maxLineLength   int
}

// New creates a new Monitor Manager.
func New(maxBufferLines int, maxLineLength int) *Manager {
	if maxBufferLines <= 0 {
		maxBufferLines = 500
	}
	if maxLineLength <= 0 {
		maxLineLength = 4096
	}
	return &Manager{
		subscribers:    make(map[chan string]struct{}),
		maxBufferLines: maxBufferLines,
		maxLineLength:  maxLineLength,
	}
}

// Start runs a command and streams its stdout/stderr line by line.
func (m *Manager) Start(command string, args []string, allowedCommands []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return fmt.Errorf("a monitor command is already running: %s", m.command)
	}

	if len(allowedCommands) > 0 {
		allowed := false
		for _, c := range allowedCommands {
			if strings.EqualFold(c, command) {
				allowed = true
				break
			}
		}
		if !allowed {
			return fmt.Errorf("command %q is not in the allowed list", command)
		}
	}

	path, err := exec.LookPath(command)
	if err != nil {
		return fmt.Errorf("command not found: %s", command)
	}

	// The resolved path is available via m.command at runtime for visibility.
	// PATH shadowing: exec.LookPath walks PATH, so a malicious binary earlier
	// in PATH could shadow whitelisted commands. This is an accepted limitation.

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, path, args...)

	setProcessGroup(cmd)

	m.cmd = cmd
	m.cancel = cancel
	m.running = true
	m.command = command
	m.args = args
	m.startTime = time.Now()
	m.lineBuffer = nil

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.running = false
		cancel()
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		m.running = false
		cancel()
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		m.running = false
		cancel()
		return fmt.Errorf("failed to start command: %w", err)
	}

	go m.readPipe(stdout)
	go m.readPipe(stderr)

	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		cmdName := m.command
		m.running = false
		m.cmd = nil
		if m.cancel != nil {
			m.cancel()
		}
		m.cancel = nil
		m.mu.Unlock()

		exitMsg := fmt.Sprintf("[%s] Monitor command finished: %s", time.Now().Format("2006-01-02 15:04:05"), cmdName)
		if err != nil {
			exitMsg += fmt.Sprintf(" - %v", err)
		}
		m.broadcastLine(exitMsg)
	}()

	return nil
}

func (m *Manager) readPipe(r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) > m.maxLineLength {
			line = line[:m.maxLineLength] + " [truncated]"
		}
		m.broadcastLine(line)
	}
}

func (m *Manager) broadcastLine(line string) {
	m.subscriberMutex.Lock()
	m.lineBuffer = append(m.lineBuffer, line)
	if len(m.lineBuffer) > m.maxBufferLines {
		m.lineBuffer = m.lineBuffer[len(m.lineBuffer)-m.maxBufferLines:]
	}
	subs := make([]chan string, 0, len(m.subscribers))
	for ch := range m.subscribers {
		subs = append(subs, ch)
	}
	m.subscriberMutex.Unlock()

	for _, ch := range subs {
		select {
		case ch <- line:
		default:
		}
	}
}

// Stop stops the running command.
func (m *Manager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.running || m.cancel == nil {
		return nil
	}

	m.cancel()
	if m.cmd != nil && m.cmd.Process != nil {
		killProcessGroup(m.cmd)
	}
	return nil
}

// Status returns the current monitor status.
func (m *Manager) Status() map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()

	st := map[string]interface{}{
		"running": m.running,
	}
	if m.running {
		st["command"] = m.command
		st["args"] = m.args
		st["uptime"] = time.Since(m.startTime).Truncate(time.Second).String()
	}
	return st
}

// BufferedLines returns lines accumulated since the command started.
func (m *Manager) BufferedLines() []string {
	m.subscriberMutex.RLock()
	defer m.subscriberMutex.RUnlock()

	result := make([]string, len(m.lineBuffer))
	copy(result, m.lineBuffer)
	return result
}

// Subscribe returns a channel that receives new output lines.
func (m *Manager) Subscribe() chan string {
	ch := make(chan string, 256)
	m.subscriberMutex.Lock()
	m.subscribers[ch] = struct{}{}
	m.subscriberMutex.Unlock()
	return ch
}

// Unsubscribe removes a subscriber channel.
func (m *Manager) Unsubscribe(ch chan string) {
	m.subscriberMutex.Lock()
	delete(m.subscribers, ch)
	m.subscriberMutex.Unlock()
}