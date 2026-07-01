package console

import (
	"fmt"
	"sync"
	"time"
)

// Logger captures application logs into a ring buffer and broadcasts to SSE subscribers.
type Logger struct {
	mu       sync.RWMutex
	buffer   []string
	maxLines int
	head     int
	size     int
	subs     map[chan string]struct{}
}

// New creates a Logger with the given buffer capacity.
func New(maxLines int) *Logger {
	if maxLines <= 0 {
		maxLines = 200
	}
	return &Logger{
		buffer:   make([]string, maxLines),
		maxLines: maxLines,
		subs:     make(map[chan string]struct{}),
	}
}

func (l *Logger) timestamp() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

func (l *Logger) write(line string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.buffer[l.head] = line
	l.head = (l.head + 1) % l.maxLines
	if l.size < l.maxLines {
		l.size++
	}

	// Broadcast to subscribers (non-blocking)
	for ch := range l.subs {
		select {
		case ch <- line:
		default:
			// drop if subscriber is slow
		}
	}
}

// Log writes a log line at info level.
func (l *Logger) Log(format string, args ...any) {
	line := fmt.Sprintf("[%s] %s", l.timestamp(), fmt.Sprintf(format, args...))
	fmt.Println(line)
	l.write(line)
}

// Info writes an info-level log line.
func (l *Logger) Info(format string, args ...any) {
	l.Log(format, args...)
}

// Warn writes a warning-level log line.
func (l *Logger) Warn(format string, args ...any) {
	line := fmt.Sprintf("[%s] ⚠ %s", l.timestamp(), fmt.Sprintf(format, args...))
	fmt.Println(line)
	l.write(line)
}

// Error writes an error-level log line.
func (l *Logger) Error(format string, args ...any) {
	line := fmt.Sprintf("[%s] [ERROR] %s", l.timestamp(), fmt.Sprintf(format, args...))
	fmt.Println(line)
	l.write(line)
}

// Debug writes a debug-level log line.
func (l *Logger) Debug(format string, args ...any) {
	line := fmt.Sprintf("[%s] [DEBUG] %s", l.timestamp(), fmt.Sprintf(format, args...))
	fmt.Println(line)
	l.write(line)
}

// AllLines returns all buffered lines in chronological order.
func (l *Logger) AllLines() []string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	result := make([]string, l.size)
	for i := 0; i < l.size; i++ {
		idx := (l.head - l.size + i + l.maxLines) % l.maxLines
		result[i] = l.buffer[idx]
	}
	return result
}

// Subscribe returns a channel that receives new log lines.
func (l *Logger) Subscribe() chan string {
	ch := make(chan string, 100)
	l.mu.Lock()
	l.subs[ch] = struct{}{}
	l.mu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber channel.
func (l *Logger) Unsubscribe(ch chan string) {
	l.mu.Lock()
	delete(l.subs, ch)
	l.mu.Unlock()
	close(ch)
}

// Clear empties the log buffer.
func (l *Logger) Clear() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.head = 0
	l.size = 0
}
