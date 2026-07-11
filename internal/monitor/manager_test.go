package monitor

import (
	"io"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func echoCommand() (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd", []string{"/c", "echo", "hello"}
	}
	return "echo", []string{"hello"}
}

func longRunningCommand() (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd", []string{"/c", "ping", "-n", "3", "127.0.0.1", ">", "nul"}
	}
	return "sleep", []string{"3"}
}

func TestNew(t *testing.T) {
	tests := []struct {
		name            string
		bufferLines     int
		lineLength      int
		wantBufferLines int
		wantLineLength  int
	}{
		{"zero values use defaults", 0, 0, 500, 4096},
		{"custom values", 100, 2048, 100, 2048},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New(tt.bufferLines, tt.lineLength)
			if m.maxBufferLines != tt.wantBufferLines {
				t.Errorf("maxBufferLines = %d, want %d", m.maxBufferLines, tt.wantBufferLines)
			}
			if m.maxLineLength != tt.wantLineLength {
				t.Errorf("maxLineLength = %d, want %d", m.maxLineLength, tt.wantLineLength)
			}
		})
	}
}

func TestStartAndStatus(t *testing.T) {
	cmd, args := echoCommand()
	allowed := []string{cmd}
	m := New(0, 0)

	err := m.Start(cmd, args, allowed)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	status := m.Status()
	if status["command"] != cmd {
		t.Errorf("command = %v, want %s", status["command"], cmd)
	}

	for i := 0; i < 100; i++ {
		if !m.Status()["running"].(bool) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if m.Status()["running"].(bool) {
		t.Error("command still running after timeout")
	}

	lines := m.BufferedLines()
	found := false
	for _, line := range lines {
		if strings.Contains(line, "hello") {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected 'hello' in buffered lines, got %v", lines)
	}
}

func TestStartNotAllowed(t *testing.T) {
	m := New(0, 0)
	err := m.Start("rm", []string{}, []string{"echo", "ls"})
	if err == nil {
		t.Fatal("expected error for disallowed command")
	}
	if !strings.Contains(err.Error(), "not in the allowed list") {
		t.Errorf("expected 'not in the allowed list' error, got: %v", err)
	}
}

func TestStartAlreadyRunning(t *testing.T) {
	cmd, args := longRunningCommand()
	allowed := []string{cmd}
	m := New(0, 0)

	err := m.Start(cmd, args, allowed)
	if err != nil {
		t.Fatalf("first Start failed: %v", err)
	}

	defer m.Stop()

	err = m.Start("echo", []string{"hello"}, []string{"echo"})
	if err == nil {
		t.Fatal("expected error for second Start while running")
	}
	if !strings.Contains(err.Error(), "already running") {
		t.Errorf("expected 'already running' error, got: %v", err)
	}
}

func TestStop(t *testing.T) {
	cmd, args := longRunningCommand()
	allowed := []string{cmd}
	m := New(0, 0)

	err := m.Start(cmd, args, allowed)
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	err = m.Stop()
	if err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	for i := 0; i < 50; i++ {
		if !m.Status()["running"].(bool) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if m.Status()["running"].(bool) {
		t.Error("command still running after Stop")
	}
}

func TestSubscribeUnsubscribe(t *testing.T) {
	m := New(0, 0)
	ch := m.Subscribe()

	m.Unsubscribe(ch)

	if _, exists := m.subscribers[ch]; exists {
		t.Error("channel still in subscribers map after unsubscribe")
	}

	select {
	case _, ok := <-ch:
		if !ok {
			t.Error("channel was closed after unsubscribe")
		}
	case <-time.After(50 * time.Millisecond):
	}

	m.broadcastLine("after unsubscribe")
	select {
	case <-ch:
		t.Error("unsubscribed channel should not receive broadcasts")
	default:
	}
}

func TestBroadcastLineNoPanicOnUnsubscribe(t *testing.T) {
	m := New(0, 0)
	ch := m.Subscribe()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			m.broadcastLine("line")
			time.Sleep(time.Microsecond)
		}
	}()

	go func() {
		defer wg.Done()
		time.Sleep(50 * time.Microsecond)
		m.Unsubscribe(ch)
	}()

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("panic occurred: %v", r)
		}
	}()

	wg.Wait()
}

func TestMaxLineLength(t *testing.T) {
	m := New(100, 10)
	r, w := io.Pipe()
	go m.readPipe(r)
	_, _ = w.Write([]byte("this is a very long line that should be truncated\n"))
	_ = w.Close()

	time.Sleep(50 * time.Millisecond)

	lines := m.BufferedLines()
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	expected := "this is a " + " [truncated]"
	if lines[0] != expected {
		t.Errorf("expected %q, got %q", expected, lines[0])
	}
}

func TestBufferedLines(t *testing.T) {
	m := New(3, 4096)
	for i := 0; i < 5; i++ {
		m.broadcastLine("line")
	}

	lines := m.BufferedLines()
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(lines))
	}
}

func TestSubscribeMultiple(t *testing.T) {
	m := New(0, 0)
	ch1 := m.Subscribe()
	ch2 := m.Subscribe()
	defer m.Unsubscribe(ch1)
	defer m.Unsubscribe(ch2)

	m.broadcastLine("broadcast")

	for i, ch := range []chan string{ch1, ch2} {
		select {
		case line := <-ch:
			if line != "broadcast" {
				t.Errorf("subscriber %d: expected 'broadcast', got %s", i, line)
			}
		case <-time.After(100 * time.Millisecond):
			t.Errorf("subscriber %d: timeout", i)
		}
	}
}

func TestBufferedLinesOrder(t *testing.T) {
	m := New(3, 4096)
	lines := []string{"first", "second", "third", "fourth", "fifth"}
	for _, l := range lines {
		m.broadcastLine(l)
	}

	result := m.BufferedLines()
	if len(result) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(result))
	}
	if result[0] != "third" {
		t.Errorf("expected first buffered line 'third', got %s", result[0])
	}
	if result[2] != "fifth" {
		t.Errorf("expected last buffered line 'fifth', got %s", result[2])
	}
}

func TestSubscriberBufferFull(t *testing.T) {
	m := New(0, 0)
	ch := m.Subscribe()
	defer m.Unsubscribe(ch)

	for i := 0; i < 300; i++ {
		m.broadcastLine("line")
	}

	select {
	case line := <-ch:
		if line != "line" {
			t.Errorf("unexpected line: %s", line)
		}
	default:
	}
}