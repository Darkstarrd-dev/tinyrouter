package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"

	// 注册所有 Gallery 支持的图片格式解码器，使 image.Decode 能正确解码。
	// 没有这些空白导入，image.Decode 对 PNG/GIF/WebP/BMP 会返回
	// "unknown format"，触发 analyzeImage 的 fallback 路径发送错误数据。
	_ "image/gif"
	_ "image/png"

	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/gallery"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff" // tiff 已在 gallery/tiff.go 导入，这里冗余但无害
	_ "golang.org/x/image/webp"
)

// reviewTask 管理单个审核任务
type reviewTask struct {
	SessionID    string
	Status       gallery.ReviewStatus
	Total        int
	Processed    int
	Failed       int                    // 审核失败的图片数量（代理错误/解码失败等）
	Results      []gallery.ReviewResult // 只存储 isMatch=true 的结果
	SystemPrompt string
	UserPrompt   string
	MatchField   string
	mu           sync.Mutex
	cancel       context.CancelFunc
	done         chan struct{}
	err          error
}

// reviewTasks 全局审核任务映射
var reviewTasks sync.Map

// startReviewRequest 启动审核的请求体
type startReviewRequest struct {
	SessionID    string `json:"sessionId"`
	Provider     string `json:"provider"`     // 视觉审核的 provider
	Model        string `json:"model"`        // 视觉审核的 model
	SystemPrompt string `json:"systemPrompt"`
	UserPrompt   string `json:"userPrompt,omitempty"`
	MatchField   string `json:"matchField,omitempty"`
	Strategy     string `json:"strategy"`
	HeadSize     int    `json:"headSize"`
	TailSize     int    `json:"tailSize"`
	Concurrency  int    `json:"concurrency"`
}

// genPromptRequest 生成提示词的请求体
type genPromptRequest struct {
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	JudgeTarget string `json:"judgeTarget"`
}

// galleryStartReview 启动图片审核任务
//
// POST /api/gallery/review/start
// Content-Type: application/json
//
//	{
//	    "sessionId": "abc123",
//	    "provider": "openai",
//	    "model": "gpt-4o",
//	    "systemPrompt": "...",
//	    "userPrompt": "...",
//	    "matchField": "match",
//	    "strategy": "all",
//	    "headSize": 5,
//	    "tailSize": 5,
//	    "concurrency": 3
//	}
func (rt *Router) galleryStartReview(w http.ResponseWriter, r *http.Request) {
	var req startReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.SessionID == "" || req.Provider == "" || req.Model == "" {
		writeAPIError(w, http.StatusBadRequest, "sessionId, provider, and model are required")
		return
	}
	if req.Strategy == "" {
		req.Strategy = string(gallery.ReviewStrategyAll)
	}
	if req.Concurrency <= 0 {
		req.Concurrency = 3
	}
	if req.HeadSize <= 0 {
		req.HeadSize = 5
	}
	if req.TailSize <= 0 {
		req.TailSize = 5
	}
	if req.UserPrompt == "" {
		req.UserPrompt = gallery.DefaultUserPrompt
	}

	// 检查是否有已有审核任务在运行
	if _, loaded := reviewTasks.Load(req.SessionID); loaded {
		writeAPIError(w, http.StatusConflict, "review already in progress for this session")
		return
	}

	// 获取 ZIP session 数据并 pin 防止淘汰
	zipData, ok := gallerySessions.get(req.SessionID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "zip session not found")
		return
	}
	gallerySessions.pin(req.SessionID)

	// 解析 manifest 获取条目列表
	reader := bytes.NewReader(zipData)
	manifest, err := gallery.ListZipEntries(reader, int64(len(zipData)))
	if err != nil {
		gallerySessions.unpin(req.SessionID)
		writeAPIError(w, http.StatusBadRequest, "failed to list zip entries: "+err.Error())
		return
	}

	if manifest.Total == 0 {
		gallerySessions.unpin(req.SessionID)
		writeAPIError(w, http.StatusBadRequest, "no image entries found in zip")
		return
	}

	// 根据策略筛选需要审核的条目索引
	indices := selectReviewIndices(manifest.Total, req.Strategy, req.HeadSize, req.TailSize)
	if len(indices) == 0 {
		gallerySessions.unpin(req.SessionID)
		writeAPIError(w, http.StatusBadRequest, "no entries selected for review")
		return
	}

	// 创建审核任务
	ctx, cancel := context.WithCancel(context.Background())
	task := &reviewTask{
		SessionID:    req.SessionID,
		Status:       gallery.ReviewStatusRunning,
		Total:        len(indices),
		Results:      make([]gallery.ReviewResult, 0),
		SystemPrompt: req.SystemPrompt,
		UserPrompt:   req.UserPrompt,
		MatchField:   req.MatchField,
		cancel:       cancel,
		done:         make(chan struct{}),
	}

	reviewTasks.Store(req.SessionID, task)

	// 启动审核 goroutine
	go rt.runReview(ctx, task, zipData, manifest.Entries, indices, req.Provider, req.Model, req.Concurrency)

	rt.logger.Info("gallery: started AI review for session %s, %d entries, strategy=%s, provider=%s, model=%s",
		req.SessionID, len(indices), req.Strategy, req.Provider, req.Model)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"total":   len(indices),
	})
}

// galleryReviewStatus 查询审核任务状态
//
// GET /api/gallery/review/status/{sessionId}
func (rt *Router) galleryReviewStatus(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")

	val, ok := reviewTasks.Load(sessionID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "review task not found")
		return
	}

	task := val.(*reviewTask)
	task.mu.Lock()
	status := task.Status
	total := task.Total
	processed := task.Processed
	failed := task.Failed
	results := make([]gallery.ReviewResult, len(task.Results))
	copy(results, task.Results)
	task.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":    status,
		"total":     total,
		"processed": processed,
		"failed":    failed,
		"results":   results,
	})
}

// galleryCancelReview 取消审核任务
//
// POST /api/gallery/review/cancel/{sessionId}
func (rt *Router) galleryCancelReview(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")

	val, ok := reviewTasks.Load(sessionID)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "review task not found")
		return
	}

	task := val.(*reviewTask)
	task.cancel()

	// 等待任务完成（runReview 的 defer 负责关闭 done、清理任务映射、取消会话固定）
	<-task.done

	// Delete 幂等（runReview 的 defer 已 Delete 一次，这里兜底处理竞态）
	reviewTasks.Delete(sessionID)

	rt.logger.Info("gallery: cancelled AI review for session %s", sessionID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
	})
}

// runReview 审核引擎核心，使用 worker pool 并发处理。
// indices 是排序后 manifest.Entries 切片的 0-based 位置索引，
// 直接用 entries[idx] 访问，不能通过 Entry.Index 查找（两者空间不同）。
func (rt *Router) runReview(ctx context.Context, task *reviewTask, zipData []byte, entries []gallery.Entry, indices []int, provider, model string, concurrency int) {
	defer func() {
		// CRITICAL-4：自然完成后从任务映射删除，防止无限累积内存泄漏。
		// 放在 close(done) 之前，确保 cancel 路径查 task 时 done 仍可读。
		task.mu.Lock()
		if task.Status == gallery.ReviewStatusRunning {
			task.Status = gallery.ReviewStatusCompleted
		}
		task.mu.Unlock()
		// 删除映射条目：cancel 路径在 <-task.done 后也会 Delete，sync.Map 幂等。
		reviewTasks.Delete(task.SessionID)
		gallerySessions.unpin(task.SessionID)
		close(task.done)
	}()

	// 使用 worker pool 并发处理。indices 直接索引 entries 切片。
	workCh := make(chan int, len(indices))
	for _, idx := range indices {
		workCh <- idx
	}
	close(workCh)

	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for entryIdx := range workCh {
				select {
				case <-ctx.Done():
					task.mu.Lock()
					task.Status = gallery.ReviewStatusCancelled
					task.mu.Unlock()
					return
				default:
				}

				if entryIdx < 0 || entryIdx >= len(entries) {
					task.mu.Lock()
					task.Processed++
					task.Failed++
					task.mu.Unlock()
					continue
				}

				entry := entries[entryIdx]
				result, err := rt.analyzeImage(ctx, zipData, entry, provider, model, task.SystemPrompt, task.UserPrompt, task.MatchField)
				task.mu.Lock()
				task.Processed++
				if err != nil {
					task.Failed++
					rt.logger.Warn("gallery: review error for %s (session %s): %v", entry.Path, task.SessionID, err)
				} else if result != nil && result.IsMatch {
					task.Results = append(task.Results, *result)
				}
				task.mu.Unlock()
			}
		}()
	}
	wg.Wait()
}

// analyzeImage 分析单张图片，调用视觉模型判断是否匹配条件
func (rt *Router) analyzeImage(ctx context.Context, zipData []byte, entry gallery.Entry, provider, model string, systemPrompt, userPrompt, matchField string) (*gallery.ReviewResult, error) {
	// 1. 从 ZIP 中读取图片数据
	reader := bytes.NewReader(zipData)
	imgData, _, err := gallery.GetZipEntry(reader, int64(len(zipData)), entry.Path)
	if err != nil {
		return nil, fmt.Errorf("read entry %s: %w", entry.Path, err)
	}

	// 2. 解码并缩放到 max 1024px
	img, _, err := image.Decode(bytes.NewReader(imgData))
	if err != nil {
		// 解码失败：直接发送原始字节，但需要正确 base64 编码 + 正确 MIME 类型。
		// 旧实现把原始字节当作已 base64 编码的 JPEG 字符串，会发乱码给 LLM。
		mimeType := mimeTypeForEntry(entry.Path)
		return rt.sendVisionRequest(ctx, imgData, mimeType, provider, model, entry, systemPrompt, userPrompt, matchField)
	}

	// 3. 缩放
	resized := resizeImage(img, 1024)

	// 4. 编码为 JPEG
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, resized, &jpeg.Options{Quality: 80}); err != nil {
		return nil, fmt.Errorf("jpeg encode: %w", err)
	}

	// 5. 构建请求体并发送
	return rt.sendVisionRequest(ctx, buf.Bytes(), "image/jpeg", provider, model, entry, systemPrompt, userPrompt, matchField)
}

// mimeTypeForEntry 根据扩展名返回对应的 Content-Type，用于 fallback 路径。
func mimeTypeForEntry(path string) string {
	ext := strings.ToLower(path)
	if i := strings.LastIndexByte(ext, '.'); i >= 0 {
		ext = ext[i+1:]
	}
	switch ext {
	case "png":
		return "image/png"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "gif":
		return "image/gif"
	case "webp":
		return "image/webp"
	case "bmp":
		return "image/bmp"
	case "tif", "tiff":
		return "image/tiff"
	default:
		return "image/jpeg"
	}
}

// sendVisionRequest 发送视觉请求到 LLM 代理。
// imgData 是原始图片字节（未 base64 编码），mimeType 是 imgData 的实际 MIME 类型。
// 这里统一做 base64 编码并构建 data URL，避免调用方处理编码细节。
func (rt *Router) sendVisionRequest(ctx context.Context, imgData []byte, mimeType, provider, model string, entry gallery.Entry, systemPrompt, userPrompt, matchField string) (*gallery.ReviewResult, error) {
	b64Data := base64.StdEncoding.EncodeToString(imgData)
	dataURL := "data:" + mimeType + ";base64," + b64Data

	// 构建 OpenAI 兼容的请求体
	body := map[string]any{
		"model": provider + "/" + model,
		"messages": []any{
			map[string]any{
				"role":    "system",
				"content": systemPrompt,
			},
			map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{
						"type": "text",
						"text": userPrompt,
					},
					map[string]any{
						"type": "image_url",
						"image_url": map[string]any{
							"url": dataURL,
						},
					},
				},
			},
		},
		"max_tokens":  120,
		"temperature": 0,
		"stream":      false,
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// 使用 httptest 调用代理处理器
	req := httptest.NewRequest("POST", "/v1/chat/completions", bytes.NewReader(bodyBytes))
	req = req.WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	rt.proxyHandler.ChatCompletions(rec, req)

	resp := rec.Result()
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read proxy response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("proxy returned status %d: %s", resp.StatusCode, string(respBody))
	}

	// 解析响应
	result, err := gallery.ParseReviewResponse(respBody, matchField)
	if err != nil {
		return nil, err
	}

	return &gallery.ReviewResult{
		Index:   entry.Index,
		Path:    entry.Path,
		IsMatch: result.Match,
		Reason:  result.Reason,
	}, nil
}

// resizeImage 将图片缩放到最大尺寸，保持宽高比
func resizeImage(img image.Image, maxSize int) image.Image {
	bounds := img.Bounds()
	w := bounds.Dx()
	h := bounds.Dy()
	if w <= maxSize && h <= maxSize {
		return img
	}

	var newW, newH int
	if w > h {
		newW = maxSize
		newH = h * maxSize / w
	} else {
		newH = maxSize
		newW = w * maxSize / h
	}

	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	draw.BiLinear.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Over, nil)
	return dst
}

// selectReviewIndices 根据策略选择需要审核的条目索引
func selectReviewIndices(total int, strategy string, headSize, tailSize int) []int {
	switch gallery.ReviewStrategy(strategy) {
	case gallery.ReviewStrategyHeadTail:
		return selectHeadTailIndices(total, headSize, tailSize)
	default:
		// "all" 或未识别的策略，返回全部
		indices := make([]int, total)
		for i := 0; i < total; i++ {
			indices[i] = i
		}
		return indices
	}
}

// selectHeadTailIndices 选择头部 headSize 张和尾部 tailSize 张图片的索引
func selectHeadTailIndices(total, headSize, tailSize int) []int {
	seen := make(map[int]bool)
	var indices []int

	// 头部
	for i := 0; i < headSize && i < total; i++ {
		if !seen[i] {
			indices = append(indices, i)
			seen[i] = true
		}
	}

	// 尾部
	for i := total - tailSize; i < total; i++ {
		if i >= 0 && !seen[i] {
			indices = append(indices, i)
			seen[i] = true
		}
	}

	return indices
}

// galleryGeneratePrompt 生成审核提示词
//
// POST /api/gallery/review/gen-prompt
// Body: {provider, model, judgeTarget}
// Response: {systemPrompt}
func (rt *Router) galleryGeneratePrompt(w http.ResponseWriter, r *http.Request) {
	var req genPromptRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Provider == "" || req.Model == "" || req.JudgeTarget == "" {
		writeAPIError(w, http.StatusBadRequest, "provider, model, and judgeTarget are required")
		return
	}

	// 构建非流式 chat completions 请求
	body := map[string]any{
		"model": req.Provider + "/" + req.Model,
		"messages": []any{
			map[string]any{
				"role":    "system",
				"content": gallery.PromptGenSystemPrompt,
			},
			map[string]any{
				"role":    "user",
				"content": fmt.Sprintf(gallery.PromptGenUserPromptTemplate, req.JudgeTarget),
			},
		},
		"max_tokens":  800,
		"temperature": 0.3,
		"stream":      false,
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to marshal request: "+err.Error())
		return
	}

	// 使用 httptest 调用代理处理器
	proxyReq := httptest.NewRequest("POST", "/v1/chat/completions", bytes.NewReader(bodyBytes))
	proxyReq.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	rt.proxyHandler.ChatCompletions(rec, proxyReq)

	resp := rec.Result()
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to read proxy response: "+err.Error())
		return
	}

	if resp.StatusCode != http.StatusOK {
		writeAPIError(w, http.StatusBadGateway, fmt.Sprintf("proxy returned status %d: %s", resp.StatusCode, string(respBody)))
		return
	}

	// 解析 chat.completions 响应
	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &chatResp); err != nil || len(chatResp.Choices) == 0 {
		writeAPIError(w, http.StatusBadGateway, "failed to parse proxy response")
		return
	}

	systemPrompt := chatResp.Choices[0].Message.Content

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"systemPrompt": systemPrompt,
	})
}