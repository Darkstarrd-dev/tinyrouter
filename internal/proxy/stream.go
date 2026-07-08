package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/util"
)

type SSELineBuffer struct {
	buf []byte
}

func (b *SSELineBuffer) Feed(data []byte) []string {
	b.buf = append(b.buf, data...)
	var lines []string
	for {
		idx := bytes.IndexByte(b.buf, '\n')
		if idx < 0 {
			break
		}
		lines = append(lines, string(b.buf[:idx]))
		b.buf = b.buf[idx+1:]
	}
	return lines
}

func (b *SSELineBuffer) Remaining() string {
	if len(b.buf) > 0 {
		s := string(b.buf)
		b.buf = nil
		return s
	}
	return ""
}

// normalizeSSEChunk normalizes a single SSE line coming from an upstream.
// It only rewrites "data:" payloads where "choices" is null and no "error"
// field is present, turning "choices":null into "choices":[] so that strict
// OpenAI-chunk validators (which require choices to be an array) accept the
// usage-only preamble chunks emitted by some providers (e.g. ModelScope).
// All other lines (blank separators, comments, [DONE], error chunks, valid
// chunks) are returned unchanged. Parse failures fall back to the original
// line to avoid dropping data.
func normalizeSSEChunk(line string) string {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "data:") {
		return line
	}
	payload := strings.TrimSpace(trimmed[5:])
	if payload == "[DONE]" {
		return line
	}

	var obj map[string]any
	if err := json.Unmarshal([]byte(payload), &obj); err != nil {
		return line
	}
	// Never touch error chunks: they must reach the client as-is.
	if _, hasErr := obj["error"]; hasErr {
		return line
	}
	// Only fix the specific malformed case: choices is explicitly null.
	choices, exists := obj["choices"]
	if !exists {
		return line
	}
	if choices == nil {
		obj["choices"] = []any{}
	} else if arr, ok := choices.([]any); ok && len(arr) == 0 {
		// already an empty array; nothing to do
	} else {
		return line
	}

	out, err := json.Marshal(obj)
	if err != nil {
		return line
	}
	return "data: " + string(out)
}

func (h *Handler) streamResponse(w http.ResponseWriter, resp *http.Response, model string, sel *rotation.SelectedKey, latencyMs int64, reqBody []byte, normalize bool) {
	defer resp.Body.Close()

	streamStart := time.Now()
	var reqID int64
	if sel != nil {
		reqID = h.Inflight.Register(sel.Provider.ID, sel.Key.ID)
		defer h.Inflight.Unregister(reqID)
	}
	var lastSSEPush time.Time
	firstChunkDone := false

	flusher, ok := w.(http.Flusher)
	if !ok {
		h.logger.Error("streaming not supported by response writer")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	if sel != nil {
		w.Header().Set("X-TinyRouter-Provider", sel.Provider.Name)
		w.Header().Set("X-TinyRouter-Key", sel.KeyName)
	}
	w.WriteHeader(http.StatusOK)

	buf := make([]byte, 32*1024)
	totalOutput := 0
	inputTokens := 0
	outputTokens := 0
	sb := &SSELineBuffer{}

	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if normalize {
				// Line-based rewrite path: normalize each data: line before
				// forwarding so malformed chunks (choices:null) are fixed.
				for _, line := range sb.Feed(buf[:n]) {
					out := normalizeSSEChunk(line)
					if _, werr := w.Write([]byte(out + "\n")); werr != nil {
						h.logger.Debug("client disconnected during SSE stream: %v", werr)
						return
					}
					totalOutput += len(out) + 1
					if strings.HasPrefix(strings.TrimSpace(line), "data:") {
						payload := strings.TrimSpace(strings.TrimSpace(line)[5:])
						if payload != "[DONE]" {
							if in, out := util.ExtractTokens([]byte(payload)); in > 0 || out > 0 {
								inputTokens = in
								outputTokens = out
							}
						}
					}
				}
			} else {
				if _, err := w.Write(buf[:n]); err != nil {
					h.logger.Debug("client disconnected during SSE stream: %v", err)
					return
				}
				// Token extraction still needs to scan the raw lines.
				for _, line := range sb.Feed(buf[:n]) {
					line = strings.TrimSpace(line)
					if strings.HasPrefix(line, "data:") {
						payload := strings.TrimSpace(line[5:])
						if payload == "[DONE]" {
							continue
						}
						if in, out := util.ExtractTokens([]byte(payload)); in > 0 || out > 0 {
							inputTokens = in
							outputTokens = out
						}
					}
				}
			}
			flusher.Flush()
			if reqID != 0 {
				if !firstChunkDone {
					h.Inflight.SetFirstChunk(reqID)
					firstChunkDone = true
				}
				h.Inflight.AddBytes(reqID, n)
				if time.Since(lastSSEPush) > 1500*time.Millisecond {
					h.InflightUpdates.Signal()
					lastSSEPush = time.Now()
				}
			}
		}
	if err != nil {
		remaining := sb.Remaining()
		if remaining != "" {
			if normalize {
				// normalize 路径未在循环中原样写出过整块，需要在这里写出规范化后的 remaining
				out := normalizeSSEChunk(remaining)
				if _, werr := w.Write([]byte(out + "\n")); werr != nil {
					h.logger.Debug("client disconnected during SSE stream: %v", werr)
					return
				}
				totalOutput += len(out) + 1
				remaining = out
			} else {
				// 非 normalize 路径：remaining 已经在循环中通过 w.Write(buf[:n]) 原样发出，
				// 不应重复写出。仅提取 token 计入 totalOutput/usage。
			}
			// 统一提取 token（两个路径都需要）
			line := strings.TrimSpace(remaining)
			if strings.HasPrefix(line, "data:") {
				payload := strings.TrimSpace(line[5:])
				if payload != "[DONE]" {
					if in, out := util.ExtractTokens([]byte(payload)); in > 0 || out > 0 {
						inputTokens = in
						outputTokens = out
					}
				}
			}
		}
		break
	}
	}

	if sel == nil {
		h.logger.Warn("stream response with nil selector, skipping usage recording")
		return
	}
	totalLatencyMs := latencyMs + time.Since(streamStart).Milliseconds()
	h.logger.Info("\U0001f4ca [stream] %s | in=%d | out=%d | conn=%s", sel.Provider.Name, inputTokens, outputTokens, sel.KeyName)
	h.logger.Info("\U0001f300 [STREAM] %s | %s | %dms | %d", sel.Provider.Name, model, totalLatencyMs, resp.StatusCode)
	h.recordUsage(sel.Provider.Name, model, sel, "success", totalLatencyMs, latencyMs, inputTokens, outputTokens, "", reqBody, nil, resp.Header, resp.StatusCode)
}

func (h *Handler) passThroughResponse(w http.ResponseWriter, resp *http.Response, model string, sel *rotation.SelectedKey, latencyMs int64, reqBody []byte) {
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	if sel != nil {
		w.Header().Set("X-TinyRouter-Provider", sel.Provider.Name)
		w.Header().Set("X-TinyRouter-Key", sel.KeyName)
	}
	w.WriteHeader(resp.StatusCode)

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		h.logger.Error("failed to read upstream response: %v", err)
		return
	}
	_, werr := w.Write(bodyBytes)

	inputTokens, outputTokens := util.ExtractTokens(bodyBytes)
	if sel == nil {
		h.logger.Warn("pass-through response with nil selector, skipping usage recording")
		return
	}
	status := "success"
	errMsg := ""
	if werr != nil {
		status = "client_disconnected"
		errMsg = werr.Error()
		h.logger.Warn("client disconnected during pass-through: %v", werr)
	}
	h.logger.Info("\U0001f4ca [response] %s | in=%d | out=%d | conn=%s", sel.Provider.Name, inputTokens, outputTokens, sel.KeyName)
	h.logger.Info("\U0001f300 [RESPONSE] %s | %s | %dms | %d", sel.Provider.Name, model, latencyMs, resp.StatusCode)
	h.recordUsage(sel.Provider.Name, model, sel, status, latencyMs, 0, inputTokens, outputTokens, errMsg, reqBody, bodyBytes, resp.Header, resp.StatusCode)
}
