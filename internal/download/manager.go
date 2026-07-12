package download

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/tinyrouter/tinyrouter/internal/console"
)

// Event 是推送给 SSE 订阅者的事件。
type Event struct {
	Type string `json:"type"` // "task-updated" | "queue-updated"
	Task *Task  `json:"task,omitempty"`
}

// Manager 管理下载任务队列和执行。
// 内存模式：无持久化，进程退出即丢失。
type Manager struct {
	mu       sync.RWMutex
	tasks    map[string]*Task
	order    []string
	executor *Executor
	settings RuntimeSettings
	logger   *console.Logger
	controls map[string]*taskControl // 每个任务的 context + cancel

	pendingCh chan string
	active    map[string]bool

	eventSubs map[chan Event]struct{}

	maxConcurrent int
	stopCh        chan struct{}
	wg            sync.WaitGroup
}

// taskControl 绑定每个任务的 context 与取消函数。
type taskControl struct {
	ctx    context.Context
	cancel context.CancelFunc
}

// NewManager 创建下载管理器。
func NewManager(settings RuntimeSettings, logger *console.Logger) *Manager {
	maxConcurrent := settings.MaxConcurrent
	if maxConcurrent <= 0 {
		maxConcurrent = 3
	}
	return &Manager{
		tasks:         make(map[string]*Task),
		order:         make([]string, 0),
		executor:      NewExecutor(settings, logger),
		settings:      settings,
		logger:        logger,
		controls:      make(map[string]*taskControl),
		pendingCh:     make(chan string, 100),
		active:        make(map[string]bool),
		eventSubs:     make(map[chan Event]struct{}),
		maxConcurrent: maxConcurrent,
		stopCh:        make(chan struct{}),
	}
}

// UpdateSettings 更新管理器与执行器的运行时设置（尤其是 yt-dlp / ffmpeg 路径），
// 使正在运行和后续的下载无需重启即可生效。
func (m *Manager) UpdateSettings(settings RuntimeSettings) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.settings = settings
	if m.executor != nil {
		m.executor.settings = settings
	}
	if settings.MaxConcurrent > 0 {
		m.maxConcurrent = settings.MaxConcurrent
	}
}

// Start 启动 worker 池。
func (m *Manager) Start() {
	for i := 0; i < m.maxConcurrent; i++ {
		m.wg.Add(1)
		go m.worker()
	}
	if m.logger != nil {
		m.logger.Info("download workers started (concurrent=%d)", m.maxConcurrent)
	}
}

// Stop 停止所有 worker 并取消进行中的任务。
func (m *Manager) Stop() {
	m.mu.Lock()
	select {
	case <-m.stopCh:
	default:
		close(m.stopCh)
	}
	// 取消所有进行中的任务。
	for _, tc := range m.controls {
		tc.cancel()
	}
	m.mu.Unlock()
	m.wg.Wait()
}

// worker 从 pendingCh 取任务并执行，直到 stopCh 关闭或 channel 关闭。
func (m *Manager) worker() {
	defer m.wg.Done()
	for {
		select {
		case <-m.stopCh:
			return
		case taskID, ok := <-m.pendingCh:
			if !ok {
				return
			}
			m.processTask(taskID)
		}
	}
}

// processTask 执行单个任务（在 worker goroutine 中调用）。
func (m *Manager) processTask(taskID string) {
	m.mu.RLock()
	task := m.tasks[taskID]
	tc := m.controls[taskID]
	m.mu.RUnlock()
	if task == nil || tc == nil {
		return
	}

	// 已被取消（例如排队期间取消），直接终态处理，跳过执行。
	if tc.ctx.Err() != nil {
		m.finalizeTask(taskID, StatusCancelled, "", 0)
		return
	}

	// 标记开始。
	m.mu.Lock()
	task.Status = StatusDownloading
	task.StartedAt = time.Now()
	m.active[taskID] = true
	m.mu.Unlock()
	m.publishEvent(Event{Type: "task-updated", Task: m.snapshot(task)})

	progressCh := make(chan Progress, 10)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for p := range progressCh {
			m.updateTaskProgress(taskID, p)
		}
	}()

	filePath, err := m.executor.Execute(tc.ctx, task, progressCh)
	close(progressCh)
	<-done

	m.mu.Lock()
	delete(m.active, taskID)
	delete(m.controls, taskID)
	m.mu.Unlock()

	switch {
	case err != nil && err.Error() == "cancelled":
		m.finalizeTask(taskID, StatusCancelled, "", 0)
	case err != nil:
		m.finalizeTask(taskID, StatusError, err.Error(), 0)
	default:
		if info, statErr := fileSizeOf(filePath); statErr == nil {
			m.finalizeTask(taskID, StatusCompleted, "", info)
		} else {
			m.finalizeTask(taskID, StatusCompleted, "", 0)
		}
		task, _ := m.GetTask(taskID)
		if task != nil {
			m.mu.Lock()
			task.FilePath = filePath
			task.SavedFile = filePath
			m.mu.Unlock()
		}
	}
}

// finalizeTask 设置任务终态并发布事件。
func (m *Manager) finalizeTask(taskID string, status TaskStatus, errMsg string, fileSize int64) {
	m.mu.Lock()
	task, ok := m.tasks[taskID]
	if !ok {
		m.mu.Unlock()
		return
	}
	task.Status = status
	task.CompletedAt = time.Now()
	if errMsg != "" {
		task.Error = errMsg
	}
	if fileSize > 0 {
		task.FileSize = fileSize
	}
	m.mu.Unlock()
	m.publishEvent(Event{Type: "task-updated", Task: m.snapshot(task)})
	m.publishEvent(Event{Type: "queue-updated"})
}

// updateTaskProgress 更新任务进度并发送事件。
func (m *Manager) updateTaskProgress(taskID string, p Progress) {
	m.mu.Lock()
	task, ok := m.tasks[taskID]
	if !ok {
		m.mu.Unlock()
		return
	}
	task.Progress = p
	if p.Processing && task.Status == StatusDownloading {
		task.Status = StatusProcessing
	}
	m.mu.Unlock()
	m.publishEvent(Event{Type: "task-updated", Task: m.snapshot(task)})
}

// CreateTask 创建单个下载任务并加入队列。
// 返回任务 ID。
func (m *Manager) CreateTask(input CreateTaskInput) string {
	id := generateID()
	now := time.Now()
	task := &Task{
		ID:            id,
		URL:           input.URL,
		Type:          input.Type,
		Status:        StatusPending,
		Quality:       input.Quality,
		Container:     input.Container,
		DownloadDir:   input.DownloadDir,
		Title:         input.Title,
		Thumbnail:     input.Thumbnail,
		PlaylistID:    input.PlaylistID,
		PlaylistTitle: input.PlaylistTitle,
		PlaylistIndex: input.PlaylistIndex,
		PlaylistSize:  input.PlaylistSize,
		CreatedAt:     now,
	}
	if task.Type == "" {
		task.Type = TypeVideo
	}
	if task.Quality == "" {
		task.Quality = QualityBest
	}
	if task.Container == "" {
		task.Container = ContainerAuto
	}
	if task.DownloadDir == "" {
		task.DownloadDir = m.settings.DownloadDir
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.tasks[id] = task
	m.order = append(m.order, id)
	m.controls[id] = &taskControl{ctx: ctx, cancel: cancel}
	m.mu.Unlock()

	// 投递到队列（非阻塞失败时丢弃，但缓冲 100 足够）。
	select {
	case m.pendingCh <- id:
	default:
		// 队列满，立即标记错误。
		m.finalizeTask(id, StatusError, "download queue is full", 0)
		return id
	}
	m.publishEvent(Event{Type: "queue-updated"})
	return id
}

// CreatePlaylistTask 创建播放列表下载任务。
// 先查询播放列表信息，然后为每个条目创建子任务。
// 返回：所有创建的任务 ID 列表、播放列表标题、错误（如果有）。
func (m *Manager) CreatePlaylistTask(input CreateTaskInput) ([]string, string, error) {
	info, err := m.executor.ExecutePlaylistInfo(context.Background(), input.URL)
	if err != nil {
		return nil, "", err
	}
	title := info.Title
	ids := make([]string, 0, len(info.Entries))
	size := len(info.Entries)
	for i, entry := range info.Entries {
		childURL := entry.URL
		if childURL == "" {
			childURL = input.URL
		}
		childInput := CreateTaskInput{
			URL:           childURL,
			Type:          input.Type,
			Quality:       input.Quality,
			Container:     input.Container,
			DownloadDir:   input.DownloadDir,
			PlaylistID:    info.ID,
			PlaylistTitle: title,
			PlaylistIndex: i + 1,
			PlaylistSize:  size,
			Title:         entry.Title,
			Thumbnail:     entry.Thumbnail,
		}
		ids = append(ids, m.CreateTask(childInput))
	}
	return ids, title, nil
}

// GetVideoInfo 查询视频信息（不下载）。
func (m *Manager) GetVideoInfo(rawURL string) (*VideoInfo, error) {
	return m.executor.ExecuteInfo(context.Background(), rawURL)
}

// GetPlaylistInfo 查询播放列表信息（不下载）。
func (m *Manager) GetPlaylistInfo(rawURL string) (*PlaylistInfo, error) {
	return m.executor.ExecutePlaylistInfo(context.Background(), rawURL)
}

// CancelTask 取消指定任务。
// 如果任务在队列中等待，直接移除。
// 如果任务正在执行，取消其 context。
func (m *Manager) CancelTask(taskID string) error {
	m.mu.Lock()
	task, ok := m.tasks[taskID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("task not found")
	}
	if isTerminal(task.Status) {
		m.mu.Unlock()
		return nil
	}
	task.Status = StatusCancelled
	task.CompletedAt = time.Now()
	if tc, ok := m.controls[taskID]; ok {
		tc.cancel()
	}
	m.mu.Unlock()
	m.publishEvent(Event{Type: "task-updated", Task: m.snapshot(task)})
	m.publishEvent(Event{Type: "queue-updated"})
	return nil
}

// ListTasks 返回所有任务（含已完成），按创建顺序。
func (m *Manager) ListTasks() []*Task {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*Task, 0, len(m.order))
	for _, id := range m.order {
		if t, ok := m.tasks[id]; ok {
			result = append(result, m.snapshot(t))
		}
	}
	return result
}

// GetTask 返回指定任务的拷贝（含是否存在标志）。
func (m *Manager) GetTask(taskID string) (*Task, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.tasks[taskID]
	if !ok {
		return nil, false
	}
	return m.snapshot(t), true
}

// ClearCompleted 清除所有已完成的任务。
func (m *Manager) ClearCompleted() {
	m.mu.Lock()
	newOrder := m.order[:0]
	for _, id := range m.order {
		t, ok := m.tasks[id]
		if !ok {
			continue
		}
		if isTerminal(t.Status) {
			delete(m.tasks, id)
			delete(m.controls, id)
			delete(m.active, id)
			continue
		}
		newOrder = append(newOrder, id)
	}
	m.order = newOrder
	m.mu.Unlock()
	m.publishEvent(Event{Type: "queue-updated"})
}

// RemoveTask 从列表中移除指定任务（仅允许终态任务）。
func (m *Manager) RemoveTask(taskID string) error {
	m.mu.Lock()
	t, ok := m.tasks[taskID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("task not found")
	}
	if !isTerminal(t.Status) {
		m.mu.Unlock()
		return fmt.Errorf("only completed tasks can be removed")
	}
	delete(m.tasks, taskID)
	delete(m.controls, taskID)
	delete(m.active, taskID)
	newOrder := make([]string, 0, len(m.order))
	for _, id := range m.order {
		if id != taskID {
			newOrder = append(newOrder, id)
		}
	}
	m.order = newOrder
	m.mu.Unlock()
	m.publishEvent(Event{Type: "queue-updated"})
	return nil
}

// Subscribe 订阅事件流（用于 SSE 推送）。
func (m *Manager) Subscribe() chan Event {
	ch := make(chan Event, 64)
	m.mu.Lock()
	m.eventSubs[ch] = struct{}{}
	m.mu.Unlock()
	return ch
}

// Unsubscribe 取消订阅。
func (m *Manager) Unsubscribe(ch chan Event) {
	m.mu.Lock()
	if _, ok := m.eventSubs[ch]; ok {
		delete(m.eventSubs, ch)
		close(ch)
	}
	m.mu.Unlock()
}

// publishEvent 非阻塞地向所有订阅者发送事件。
func (m *Manager) publishEvent(evt Event) {
	m.mu.RLock()
	subs := make([]chan Event, 0, len(m.eventSubs))
	for ch := range m.eventSubs {
		subs = append(subs, ch)
	}
	m.mu.RUnlock()
	for _, ch := range subs {
		select {
		case ch <- evt:
		default:
			// 订阅者过慢，丢弃事件，避免阻塞 worker。
		}
	}
}

// snapshot 返回任务的深拷贝（不拷贝 LogTail）。
func (m *Manager) snapshot(t *Task) *Task {
	cp := *t
	cp.Progress = t.Progress
	return &cp
}

// isTerminal 判断状态是否为终态。
func isTerminal(s TaskStatus) bool {
	return s == StatusCompleted || s == StatusError || s == StatusCancelled
}

// generateID 生成 8 字节随机十六进制任务 ID。
func generateID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand 失败极罕见，退化为时间随机。
		return hex.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	}
	return hex.EncodeToString(b)
}

// fileSizeOf 返回文件大小（不存在返回错误）。
func fileSizeOf(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}
