package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/download"
)

// --- Download API Handlers ---

// createDownload 创建下载任务
// POST /api/downloads
// Body: { "url": "...", "type": "video"|"audio", "quality": "best"|"good"|..., "container": "auto"|"mp4"|..., "downloadDir": "..." }
func (rt *Router) createDownload(w http.ResponseWriter, r *http.Request) {
	var input download.CreateTaskInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.URL == "" {
		writeAPIError(w, http.StatusBadRequest, "url is required")
		return
	}
	if input.Type == "" {
		input.Type = download.TypeVideo
	}
	if input.Quality == "" {
		input.Quality = download.QualityBest
	}
	if input.Container == "" {
		input.Container = download.ContainerAuto
	}
	if input.DownloadDir == "" {
		input.DownloadDir = rt.cfg.Download.DefaultDir
	}

	taskID := rt.downloadMgr.CreateTask(input)
	task, _ := rt.downloadMgr.GetTask(taskID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(task)
}

// getVideoInfo 查询视频信息
// POST /api/downloads/info
// Body: { "url": "..." }
func (rt *Router) getVideoInfo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.URL == "" {
		writeAPIError(w, http.StatusBadRequest, "url is required")
		return
	}
	info, err := rt.downloadMgr.GetVideoInfo(req.URL)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, fmt.Sprintf("query failed: %v", err))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

// getPlaylistInfo 查询播放列表信息
// POST /api/downloads/playlist-info
// Body: { "url": "..." }
// 返回 { "title": "...", "entries": [...], "ids": [...] }
func (rt *Router) getPlaylistInfo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.URL == "" {
		writeAPIError(w, http.StatusBadRequest, "url is required")
		return
	}
	info, err := rt.downloadMgr.GetPlaylistInfo(req.URL)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, fmt.Sprintf("query failed: %v", err))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"title":   info.Title,
		"entries": info.Entries,
		"ids":     []string{},
	})
}

// createPlaylistDownload 创建播放列表批量下载
// POST /api/downloads/playlist
// Body: { "url": "...", "type": "video"|"audio", "quality": "...", "container": "...", "downloadDir": "..." }
// 返回 { "ids": [...], "title": "..." }
func (rt *Router) createPlaylistDownload(w http.ResponseWriter, r *http.Request) {
	var input download.CreateTaskInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.URL == "" {
		writeAPIError(w, http.StatusBadRequest, "url is required")
		return
	}
	if input.Type == "" {
		input.Type = download.TypeVideo
	}
	if input.Quality == "" {
		input.Quality = download.QualityBest
	}
	if input.Container == "" {
		input.Container = download.ContainerAuto
	}
	if input.DownloadDir == "" {
		input.DownloadDir = rt.cfg.Download.DefaultDir
	}

	ids, title, err := rt.downloadMgr.CreatePlaylistTask(input)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, fmt.Sprintf("playlist query failed: %v", err))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"ids":   ids,
		"title": title,
	})
}

// listDownloads 列出所有下载任务
// GET /api/downloads
func (rt *Router) listDownloads(w http.ResponseWriter, r *http.Request) {
	tasks := rt.downloadMgr.ListTasks()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tasks)
}

// getDownload 获取单个下载任务详情
// GET /api/downloads/{id}
func (rt *Router) getDownload(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	task, ok := rt.downloadMgr.GetTask(id)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "task not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(task)
}

// cancelDownload 取消下载任务
// POST /api/downloads/{id}/cancel
func (rt *Router) cancelDownload(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := rt.downloadMgr.CancelTask(id); err != nil {
		writeAPIError(w, http.StatusNotFound, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

// removeDownload 移除已完成的下载任务
// DELETE /api/downloads/{id}
func (rt *Router) removeDownload(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := rt.downloadMgr.RemoveTask(id); err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

// clearCompletedDownloads 清除所有已完成的任务
// POST /api/downloads/clear-completed
func (rt *Router) clearCompletedDownloads(w http.ResponseWriter, r *http.Request) {
	rt.downloadMgr.ClearCompleted()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

// streamDownloadEvents SSE 推送下载事件
// GET /api/downloads/stream
func (rt *Router) streamDownloadEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	// 先发送当前所有任务快照
	tasks := rt.downloadMgr.ListTasks()
	for _, task := range tasks {
		payload, _ := json.Marshal(download.Event{Type: "task-updated", Task: task})
		fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
	}

	// 订阅事件
	ch := rt.downloadMgr.Subscribe()
	defer rt.downloadMgr.Unsubscribe(ch)

	ctx := r.Context()
	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return
			}
			payload, _ := json.Marshal(evt)
			fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
