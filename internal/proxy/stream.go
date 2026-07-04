package proxy

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/rotation"
)

type sseLineBuffer struct {
	buf []byte
}

func (b *sseLineBuffer) feed(data []byte) []string {
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

func (b *sseLineBuffer) remaining() string {
	if len(b.buf) > 0 {
		s := string(b.buf)
		b.buf = nil
		return s
	}
	return ""
}

func (h *Handler) streamResponse(w http.ResponseWriter, resp *http.Response, model string, sel *rotation.SelectedKey, latencyMs int64) {
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
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if sel != nil {
		w.Header().Set("X-TinyRouter-Provider", sel.Provider.Name)
		w.Header().Set("X-TinyRouter-Key", sel.KeyName)
	}
	w.WriteHeader(http.StatusOK)

	buf := make([]byte, 32*1024)
	totalOutput := 0
	inputTokens := 0
	outputTokens := 0
	sb := &sseLineBuffer{}

	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			flusher.Flush()
			totalOutput += n
			if reqID != 0 {
				if !firstChunkDone {
					h.Inflight.SetFirstChunk(reqID)
					firstChunkDone = true
				}
				h.Inflight.AddBytes(reqID, n)
				if time.Since(lastSSEPush) > 1500*time.Millisecond {
					select {
					case h.InflightUpdateCh <- struct{}{}:
					default:
					}
					lastSSEPush = time.Now()
				}
			}
			for _, line := range sb.feed(buf[:n]) {
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
		}
		if err != nil {
			remaining := sb.remaining()
			if remaining != "" {
				line := strings.TrimSpace(remaining)
				if strings.HasPrefix(line, "data:") {
					payload := strings.TrimSpace(line[5:])
					if payload != "[DONE]" {
						if in, out := extractTokens([]byte(payload)); in > 0 || out > 0 {
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
	h.recordUsage(sel.Provider.Name, model, sel, "success", totalLatencyMs, latencyMs, inputTokens, outputTokens, "")
}

func (h *Handler) passThroughResponse(w http.ResponseWriter, resp *http.Response, model string, sel *rotation.SelectedKey, latencyMs int64) {
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if sel != nil {
		w.Header().Set("X-TinyRouter-Provider", sel.Provider.Name)
		w.Header().Set("X-TinyRouter-Key", sel.KeyName)
	}
	w.WriteHeader(resp.StatusCode)

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		h.logger.Error("failed to read upstream response: %v", err)
		return
	}
	w.Write(bodyBytes)

	inputTokens, outputTokens := extractTokens(bodyBytes)
	if sel == nil {
		h.logger.Warn("pass-through response with nil selector, skipping usage recording")
		return
	}
	h.logger.Info("\U0001f4ca [response] %s | in=%d | out=%d | conn=%s", sel.Provider.Name, inputTokens, outputTokens, sel.KeyName)
	h.logger.Info("\U0001f300 [RESPONSE] %s | %s | %dms | %d", sel.Provider.Name, model, latencyMs, resp.StatusCode)
	h.recordUsage(sel.Provider.Name, model, sel, "success", latencyMs, 0, inputTokens, outputTokens, "")
}
