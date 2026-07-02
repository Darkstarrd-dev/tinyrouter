package proxy

import (
	"io"
	"net/http"
	"strings"

	"github.com/tinyrouter/tinyrouter/internal/rotation"
)

func (h *Handler) streamResponse(w http.ResponseWriter, resp *http.Response, provider, model string, sel *rotation.SelectedKey, latencyMs int64) {
	defer resp.Body.Close()

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
	w.WriteHeader(http.StatusOK)

	buf := make([]byte, 32*1024)
	totalOutput := 0
	var lastDataLine string
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			flusher.Flush()
			totalOutput += n
			chunk := string(buf[:n])
			for _, line := range strings.Split(chunk, "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "data: ") && line != "data: [DONE]" {
					lastDataLine = line[6:]
				}
			}
		}
		if err != nil {
			break
		}
	}

	inputTokens, outputTokens := extractTokens([]byte(lastDataLine))
	h.logger.Info("\U0001f4ca [stream] %s | in=%d | out=%d | conn=%s", provider, inputTokens, outputTokens, sel.KeyName)
	h.logger.Info("\U0001f300 [STREAM] %s | %s | %dms | %d", provider, model, latencyMs, resp.StatusCode)
	h.recordUsage(provider, model, sel, "success", latencyMs, inputTokens, outputTokens, "")
}

func (h *Handler) passThroughResponse(w http.ResponseWriter, resp *http.Response, provider, model string, sel *rotation.SelectedKey, latencyMs int64) {
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(resp.StatusCode)

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		h.logger.Error("failed to read upstream response: %v", err)
		return
	}
	w.Write(bodyBytes)

	inputTokens, outputTokens := extractTokens(bodyBytes)
	h.logger.Info("\U0001f4ca [response] %s | in=%d | out=%d | conn=%s", provider, inputTokens, outputTokens, sel.KeyName)
	h.logger.Info("\U0001f300 [RESPONSE] %s | %s | %dms | %d", provider, model, latencyMs, resp.StatusCode)
	h.recordUsage(provider, model, sel, "success", latencyMs, inputTokens, outputTokens, "")
}
