package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type saveImageRequest struct {
	URL string `json:"url"`
}

func (rt *Router) saveImage(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 32<<20))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	var req saveImageRequest
	if err := json.Unmarshal(body, &req); err != nil || req.URL == "" {
		writeAPIError(w, http.StatusBadRequest, "invalid request: url required")
		return
	}

	// Determine extension and extract raw data from the URL.
	// Supports data: URLs (data:image/png;base64,...) and raw http(s) URLs.
	var rawData []byte
	var ext string

	if strings.HasPrefix(req.URL, "data:") {
		// Parse data URL: "data:image/png;base64,<data>"
		commaIdx := strings.Index(req.URL, ",")
		if commaIdx < 0 {
			writeAPIError(w, http.StatusBadRequest, "invalid data URL")
			return
		}
		header := req.URL[5:commaIdx] // strip "data:"
		ext = ".png"
		if idx := strings.Index(header, "/"); idx >= 0 {
			subType := header[idx+1:]
			if semiIdx := strings.Index(subType, ";"); semiIdx >= 0 {
				subType = subType[:semiIdx]
			}
			ext = "." + subType
			if ext == ".jpeg" {
				ext = ".jpg"
			}
		}
		isBase64 := strings.Contains(header, "base64")
		b64Data := req.URL[commaIdx+1:]
		if isBase64 {
			rawData, err = base64.StdEncoding.DecodeString(b64Data)
		} else {
			rawData = []byte(b64Data)
		}
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "failed to decode image data")
			return
		}
	} else if strings.HasPrefix(req.URL, "http://") || strings.HasPrefix(req.URL, "https://") {
		// Fetch the external URL
		resp, err := rt.testClient.Get(req.URL)
		if err != nil {
			writeAPIError(w, http.StatusBadGateway, "failed to fetch image: "+err.Error())
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			writeAPIError(w, http.StatusBadGateway, fmt.Sprintf("upstream returned %d", resp.StatusCode))
			return
		}
		rawData, err = io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		if err != nil {
			writeAPIError(w, http.StatusBadGateway, "failed to read image: "+err.Error())
			return
		}
		contentType := resp.Header.Get("Content-Type")
		ext = extensionFromContentType(contentType)
		if ext == "" {
			ext = ".png"
		}
	} else {
		writeAPIError(w, http.StatusBadRequest, "unsupported URL scheme")
		return
	}

	// Ensure imgs directory exists
	imgsDir := "imgs"
	if err := os.MkdirAll(imgsDir, 0755); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to create imgs directory")
		return
	}

	// Generate filename
	ts := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("%s_%d%s", ts, time.Now().UnixNano()%100000, ext)
	filePath := filepath.Join(imgsDir, filename)

	if err := os.WriteFile(filePath, rawData, 0644); err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to save image")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"path":     filePath,
		"filename": filename,
	})
}

// imageProxy streams a remote image through the server so the browser can fetch
// it from a same-origin URL. This avoids cross-origin (CORS) failures when the
// frontend reads image bytes (e.g. for clipboard copy or size/format metadata).
func (rt *Router) imageProxy(w http.ResponseWriter, r *http.Request) {
	u := r.URL.Query().Get("url")
	if u == "" {
		writeAPIError(w, http.StatusBadRequest, "url required")
		return
	}
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		writeAPIError(w, http.StatusBadRequest, "only http(s) urls supported")
		return
	}
	resp, err := rt.testClient.Get(u)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "failed to fetch image: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		writeAPIError(w, http.StatusBadGateway, fmt.Sprintf("upstream returned %d", resp.StatusCode))
		return
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if resp.ContentLength > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(resp.ContentLength, 10))
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func extensionFromContentType(ct string) string {
	ct = strings.TrimSpace(strings.SplitN(ct, ";", 2)[0])
	switch ct {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/svg+xml":
		return ".svg"
	case "image/bmp":
		return ".bmp"
	case "image/tiff":
		return ".tiff"
	default:
		return ""
	}
}