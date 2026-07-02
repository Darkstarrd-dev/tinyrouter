package proxy

import (
	"strings"
	"testing"
)

func TestSSELineBuffer_Normal(t *testing.T) {
	sb := &sseLineBuffer{}
	lines := sb.feed([]byte("line1\nline2\nline3\n"))
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d: %v", len(lines), lines)
	}
	if lines[0] != "line1" || lines[1] != "line2" || lines[2] != "line3" {
		t.Fatalf("unexpected lines: %v", lines)
	}
}

func TestSSELineBuffer_CrossChunk(t *testing.T) {
	sb := &sseLineBuffer{}

	// Feed first part - incomplete line
	lines := sb.feed([]byte("line"))
	if len(lines) != 0 {
		t.Fatalf("expected 0 lines from incomplete chunk, got %d", len(lines))
	}

	// Feed rest - completes the first line and adds second
	lines = sb.feed([]byte("1 end\nline2\n"))
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d: %v", len(lines), lines)
	}
	if lines[0] != "line1 end" || lines[1] != "line2" {
		t.Fatalf("unexpected lines: %v", lines)
	}
}

func TestSSELineBuffer_DataAcrossChunks(t *testing.T) {
	sb := &sseLineBuffer{}

	// Simulate a data: line split across reads (real SSE scenario)
	chunk1 := `data: {"id":"abc","usage":{"prompt_tokens":123`
	lines := sb.feed([]byte(chunk1))
	if len(lines) != 0 {
		t.Fatalf("expected 0 lines from partial chunk, got %d", len(lines))
	}

	chunk2 := `,"completion_tokens":456,"total_tokens":579}}

data: [DONE]

`

	lines = sb.feed([]byte(chunk2))
	if len(lines) < 1 {
		t.Fatalf("expected at least 1 line, got %d: %v", len(lines), lines)
	}

	// The first line should be the complete data: line
	if !strings.HasPrefix(lines[0], "data: ") {
		t.Fatalf("expected data: prefix, got: %s", lines[0])
	}

	// Parse the payload after "data: "
	payload := strings.TrimSpace(lines[0][5:])
	if payload == "[DONE]" {
		t.Fatalf("expected usage payload, got [DONE]")
	}

	in, out := extractTokens([]byte(payload))
	if in != 123 || out != 456 {
		t.Fatalf("expected tokens in=123 out=456, got in=%d out=%d", in, out)
	}
}

func TestSSELineBuffer_Remaining(t *testing.T) {
	sb := &sseLineBuffer{}

	sb.feed([]byte("line1\nline"))
	rem := sb.remaining()
	if rem != "line" {
		t.Fatalf("expected remaining 'line', got %q", rem)
	}

	// Second call should be empty
	rem = sb.remaining()
	if rem != "" {
		t.Fatalf("expected empty remaining, got %q", rem)
	}
}

func TestSSELineBuffer_Empty(t *testing.T) {
	sb := &sseLineBuffer{}
	lines := sb.feed([]byte{})
	if len(lines) != 0 {
		t.Fatalf("expected 0 lines, got %d", len(lines))
	}
	rem := sb.remaining()
	if rem != "" {
		t.Fatalf("expected empty remaining, got %q", rem)
	}
}

func TestSSE_DataWithoutSpace(t *testing.T) {
	line := `data:{"id":"test","object":"chat.completion.chunk","usage":{"input_tokens":100,"output_tokens":50}}`
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "data:") {
		t.Fatal("expected data: prefix")
	}
	payload := strings.TrimSpace(line[5:])
	if payload == "[DONE]" {
		t.Fatal("expected payload, got [DONE]")
	}

	in, out := extractTokens([]byte(payload))
	if in != 100 || out != 50 {
		t.Fatalf("expected tokens in=100 out=50, got in=%d out=%d", in, out)
	}
}

func TestSSE_DataWithSpace(t *testing.T) {
	line := `data: {"object":"chat.completion","usage":{"prompt_tokens":200,"completion_tokens":300}}`
	line = strings.TrimSpace(line)
	payload := strings.TrimSpace(line[5:])
	if payload == "[DONE]" {
		t.Fatal("expected payload, got [DONE]")
	}

	in, out := extractTokens([]byte(payload))
	if in != 200 || out != 300 {
		t.Fatalf("expected tokens in=200 out=300, got in=%d out=%d", in, out)
	}
}

func TestExtractTokens_MultipleChunks(t *testing.T) {
	// Simulate a stream: first chunk has no usage, second chunk has it
	chunks := []string{
		`data: {"id":"abc","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}`,
		`data: {"id":"abc","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":55,"completion_tokens":22}}`,
	}

	inputTokens, outputTokens := 0, 0
	for _, line := range chunks {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			payload := strings.TrimSpace(line[5:])
			if payload == "[DONE]" {
				continue
			}
			if in, out := extractTokens([]byte(payload)); in > 0 || out > 0 {
				inputTokens = in
				outputTokens = out
			}
		}
	}

	if inputTokens != 55 || outputTokens != 22 {
		t.Fatalf("expected tokens in=55 out=22, got in=%d out=%d", inputTokens, outputTokens)
	}
}

func TestExtractTokens_NoUsageChunk(t *testing.T) {
	// Simulate a stream with no usage in any chunk
	chunks := []string{
		`data: {"id":"abc","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"}}]}`,
		`data: {"id":"abc","object":"chat.completion.chunk","choices":[]}`,
	}

	inputTokens, outputTokens := 0, 0
	for _, line := range chunks {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			payload := strings.TrimSpace(line[5:])
			if payload == "[DONE]" {
				continue
			}
			if in, out := extractTokens([]byte(payload)); in > 0 || out > 0 {
				inputTokens = in
				outputTokens = out
			}
		}
	}

	if inputTokens != 0 || outputTokens != 0 {
		t.Fatalf("expected tokens 0/0 for stream without usage, got in=%d out=%d", inputTokens, outputTokens)
	}
}

func TestExtractTokens_TotalTokensFallback(t *testing.T) {
	// Provider returns only total_tokens, not individual counts
	line := `data: {"usage":{"total_tokens":500}}`
	line = strings.TrimSpace(line)
	payload := strings.TrimSpace(line[5:])

	in, out := extractTokens([]byte(payload))
	if in != 500 || out != 0 {
		t.Fatalf("expected in=500 (total_tokens fallback), out=0, got in=%d out=%d", in, out)
	}
}
