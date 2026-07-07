package console

import (
	"strings"
	"testing"
	"time"
)

func TestLogger_Info(t *testing.T) {
	l := New(10)
	l.Info("hello %s", "world")

	lines := l.AllLines()
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if !strings.Contains(lines[0], "hello world") {
		t.Errorf("expected 'hello world' in line, got %s", lines[0])
	}
}

func TestLogger_Warn(t *testing.T) {
	l := New(10)
	l.Warn("something suspicious")

	lines := l.AllLines()
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if !strings.Contains(lines[0], "⚠") {
		t.Errorf("expected ⚠ in warn line, got %s", lines[0])
	}
	if !strings.Contains(lines[0], "something suspicious") {
		t.Errorf("expected message in line, got %s", lines[0])
	}
}

func TestLogger_Error(t *testing.T) {
	l := New(10)
	l.Error("something broke")

	lines := l.AllLines()
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if !strings.Contains(lines[0], "[ERROR]") {
		t.Errorf("expected [ERROR] in error line, got %s", lines[0])
	}
}

func TestLogger_Debug(t *testing.T) {
	l := New(10)
	l.Debug("debug info")

	lines := l.AllLines()
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if !strings.Contains(lines[0], "[DEBUG]") {
		t.Errorf("expected [DEBUG] in debug line, got %s", lines[0])
	}
}

func TestLogger_Overflow(t *testing.T) {
	l := New(3)
	for i := 0; i < 5; i++ {
		l.Info("line %d", i)
	}

	lines := l.AllLines()
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(lines))
	}
	if !strings.Contains(lines[0], "line 2") {
		t.Errorf("expected oldest kept 'line 2' at [0], got %s", lines[0])
	}
	if !strings.Contains(lines[2], "line 4") {
		t.Errorf("expected newest 'line 4' at [2], got %s", lines[2])
	}
}

func TestLogger_Clear(t *testing.T) {
	l := New(10)
	l.Info("hello")
	l.Clear()

	lines := l.AllLines()
	if len(lines) != 0 {
		t.Errorf("expected 0 lines after clear, got %d", len(lines))
	}
}

func TestLogger_Subscribe(t *testing.T) {
	l := New(10)
	ch := l.Subscribe()
	defer l.Unsubscribe(ch)

	l.Info("test message")

	select {
	case line := <-ch:
		if !strings.Contains(line, "test message") {
			t.Errorf("expected 'test message' in line, got %s", line)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout waiting for subscribed message")
	}
}

func TestLogger_SubscribeMultiple(t *testing.T) {
	l := New(10)
	ch1 := l.Subscribe()
	ch2 := l.Subscribe()
	defer l.Unsubscribe(ch1)
	defer l.Unsubscribe(ch2)

	l.Info("broadcast")

	for i, ch := range []chan string{ch1, ch2} {
		select {
		case line := <-ch:
			if !strings.Contains(line, "broadcast") {
				t.Errorf("subscriber %d: expected 'broadcast', got %s", i, line)
			}
		case <-time.After(100 * time.Millisecond):
			t.Errorf("subscriber %d: timeout", i)
		}
	}
}

func TestLogger_Unsubscribe(t *testing.T) {
	l := New(10)
	ch := l.Subscribe()
	l.Unsubscribe(ch)

	// After unsubscribe, the channel should not receive new messages.
	l.Info("after unsubscribe")

	time.Sleep(20 * time.Millisecond)
	select {
	case <-ch:
		t.Error("expected no messages after unsubscribe")
	case <-time.After(50 * time.Millisecond):
	}
}
