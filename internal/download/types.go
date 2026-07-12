package download

import "time"

// TaskStatus 表示任务的生命周期状态。
type TaskStatus string

const (
	StatusPending     TaskStatus = "pending"     // 等待执行
	StatusDownloading TaskStatus = "downloading" // 正在下载
	StatusProcessing  TaskStatus = "processing"  // ffmpeg 后处理中
	StatusCompleted   TaskStatus = "completed"   // 完成
	StatusError       TaskStatus = "error"       // 失败
	StatusCancelled   TaskStatus = "cancelled"   // 已取消
)

// DownloadType 区分视频下载与音频提取。
type DownloadType string

const (
	TypeVideo DownloadType = "video"
	TypeAudio DownloadType = "audio"
)

// QualityPreset 控制格式选择器的质量上限。
type QualityPreset string

const (
	QualityBest   QualityPreset = "best"   // 不限制，最佳可用
	QualityGood   QualityPreset = "good"   // ≤1080p, ≤256kbps
	QualityNormal QualityPreset = "normal" // ≤720p, ≤192kbps
	QualityBad    QualityPreset = "bad"    // ≤480p, ≤128kbps
	QualityWorst  QualityPreset = "worst"  // ≤360p, ≤96kbps
)

// ContainerFormat 指定输出容器。
type ContainerFormat string

const (
	ContainerAuto     ContainerFormat = "auto" // 自动 mp4/mkv
	ContainerMP4      ContainerFormat = "mp4"
	ContainerMKV      ContainerFormat = "mkv"
	ContainerWebM     ContainerFormat = "webm"
	ContainerOriginal ContainerFormat = "original" // 不强制
)

// Progress 表示下载进度快照。
type Progress struct {
	Percent    float64 `json:"percent"`    // 0.0 ~ 1.0
	SpeedBytes int64   `json:"speedBytes"` // bytes/sec, 0 未知
	Downloaded int64   `json:"downloaded"` // bytes, 0 未知
	TotalBytes int64   `json:"totalBytes"` // bytes, 0 未知
	ETASeconds int     `json:"etaSeconds"` // 0 未知
	Processing bool    `json:"processing"` // 是否处于 ffmpeg 后处理阶段
}

// Task 表示一个下载任务。
type Task struct {
	ID            string          `json:"id"`
	URL           string          `json:"url"`
	Type          DownloadType    `json:"type"`
	Status        TaskStatus      `json:"status"`
	Title         string          `json:"title,omitempty"`
	Thumbnail     string          `json:"thumbnail,omitempty"`
	Quality       QualityPreset   `json:"quality,omitempty"`
	Container     ContainerFormat `json:"container,omitempty"`
	Progress      Progress        `json:"progress"`
	DownloadDir   string          `json:"downloadDir,omitempty"`
	SavedFile     string          `json:"savedFile,omitempty"`
	FilePath      string          `json:"filePath,omitempty"`
	FileSize      int64           `json:"fileSize,omitempty"`
	Error         string          `json:"error,omitempty"`
	PlaylistID    string          `json:"playlistId,omitempty"`
	PlaylistTitle string          `json:"playlistTitle,omitempty"`
	PlaylistIndex int             `json:"playlistIndex,omitempty"`
	PlaylistSize  int             `json:"playlistSize,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	StartedAt     time.Time       `json:"startedAt,omitempty"`
	CompletedAt   time.Time       `json:"completedAt,omitempty"`
	LogTail       string          `json:"-"` // 不暴露给前端
}

// CreateTaskInput 是创建下载任务的请求体。
type CreateTaskInput struct {
	URL         string          `json:"url"`
	Type        DownloadType    `json:"type"`
	Quality     QualityPreset   `json:"quality"`
	Container   ContainerFormat `json:"container"`
	DownloadDir string          `json:"downloadDir"`
	// 可选：用于播放列表批量下载
	PlaylistID    string `json:"playlistId,omitempty"`
	PlaylistTitle string `json:"playlistTitle,omitempty"`
	PlaylistIndex int    `json:"playlistIndex,omitempty"`
	PlaylistSize  int    `json:"playlistSize,omitempty"`
	// 可选：元数据（从 videoInfo 预取获得）
	Title     string `json:"title,omitempty"`
	Thumbnail string `json:"thumbnail,omitempty"`
}

// VideoInfo 是 yt-dlp -j 返回的精简视频信息。
type VideoInfo struct {
	Title       string `json:"title"`
	Thumbnail   string `json:"thumbnail,omitempty"`
	Duration    int    `json:"duration,omitempty"`
	Uploader    string `json:"uploader,omitempty"`
	Description string `json:"description,omitempty"`
	Extractor   string `json:"extractor_key,omitempty"`
	WebpageURL  string `json:"webpage_url,omitempty"`
}

// PlaylistEntry 是播放列表中的一个条目。
type PlaylistEntry struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Index     int    `json:"index"`
	Thumbnail string `json:"thumbnail,omitempty"`
}

// PlaylistInfo 是 yt-dlp -J --flat-playlist 返回的播放列表信息。
type PlaylistInfo struct {
	ID      string          `json:"id"`
	Title   string          `json:"title"`
	Entries []PlaylistEntry `json:"entries"`
}
