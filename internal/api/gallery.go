package api

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/gallery"
)

var galleryCleanupOnce sync.Once

// newGallerySessionID returns a short random hex identifier for a zip session.
// Returns an error if the system's crypto/rand fails, so the caller can
// respond with 500 instead of silently using a colliding constant.
func newGallerySessionID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate session id: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// galleryListZip receives a raw zip binary, caches it in an in-memory session,
// and returns the image manifest plus the session id the frontend uses to
// fetch individual entries.
func (rt *Router) galleryListZip(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 500<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "failed to read zip body")
		return
	}
	if len(body) == 0 {
		writeAPIError(w, http.StatusBadRequest, "empty zip body")
		return
	}

	reader := bytes.NewReader(body)
	manifest, err := gallery.ListZipEntries(reader, int64(len(body)))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid zip: "+err.Error())
		return
	}

	sessionID, err := newGallerySessionID()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	gallerySessions.put(sessionID, body)

	galleryCleanupOnce.Do(func() {
		go gallerySessionCleanup()
	})

	rt.logger.Info("gallery: received zip, %d image entries (session %s)", manifest.Total, sessionID)

	resp := struct {
		SessionID string          `json:"sessionId"`
		Manifest  gallery.Manifest `json:"manifest"`
	}{
		SessionID: sessionID,
		Manifest:  manifest,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// galleryGetZipEntry streams a single image entry out of a cached zip session.
// The entry path (which may contain slashes) is matched via the `{entryPath:*}`
// chi wildcard.
func (rt *Router) galleryGetZipEntry(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	entryPath := chi.URLParam(r, "entryPath")
	if unescaped, err := url.PathUnescape(entryPath); err == nil {
		entryPath = unescaped
	}

	data, ok := gallerySessions.get(sessionID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "zip session not found")
		return
	}

	reader := bytes.NewReader(data)
	entry, contentType, err := gallery.GetZipEntry(reader, int64(len(data)), entryPath)
	if err != nil {
		if gallery.IsNotFound(err) {
			writeAPIError(w, http.StatusNotFound, "entry not found")
			return
		}
		writeAPIError(w, http.StatusBadRequest, "failed to read entry: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Write(entry)
}

// galleryConvertTiff receives a raw TIFF binary and returns a JPEG re-encoding
// so Chromium/WebView2 can display it inline.
func (rt *Router) galleryConvertTiff(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 50<<20)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "failed to read tiff body")
		return
	}
	if len(data) == 0 {
		writeAPIError(w, http.StatusBadRequest, "empty tiff body")
		return
	}

	out, err := gallery.ConvertTIFFBlobToJPEG(data, 85)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "failed to convert tiff: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(out)
}
