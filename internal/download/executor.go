package download

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/tinyrouter/tinyrouter/internal/console"
)

// ErrCancelled is returned when a download is cancelled via context.
var ErrCancelled = errors.New("cancelled")

// Executor 负责单个下载任务的 yt-dlp 进程管理。
// 移植自 VidBee YtDlpExecutor，简化为不依赖外部队列接口的独立执行器。
type Executor struct {
	settings RuntimeSettings
	logger   *console.Logger
}

// NewExecutor 创建执行器。
func NewExecutor(settings RuntimeSettings, logger *console.Logger) *Executor {
	return &Executor{settings: settings, logger: logger}
}

// Execute 执行一次 yt-dlp 下载，阻塞直到完成或取消。
// 通过 context.Context 实现取消（SIGTERM 进程树）。
// 通过 progressCh 推送进度更新（非阻塞）。
//
// 返回：输出文件路径（如果成功）、完整 stdout 日志、错误（如果失败）。
func (e *Executor) Execute(ctx context.Context, task *Task, progressCh chan<- Progress) (string, string, error) {
	ytDlpPath, err := e.resolveYtDlpPath()
	if err != nil {
		return "", "", err
	}
	if _, err := e.resolveFfmpegPath(); err != nil {
		return "", "", err
	}

	args := BuildDownloadArgs(task.URL, task.Type, task.Quality, task.Container,
		task.DownloadDir, e.settings.ConcurrentFragments, e.settings)

	if e.logger != nil {
		e.logger.Debug("yt-dlp %s", FormatYtDlpCommand(ytDlpPath, args))
	}

	cmd := exec.CommandContext(ctx, ytDlpPath, args...)
	setupProcessGroup(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", "", fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", "", fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return "", "", fmt.Errorf("start yt-dlp: %w", err)
	}

	// 取消时杀整棵进程树（yt-dlp + ffmpeg 子进程）。
	cmd.Cancel = func() error {
		if cmd.Process != nil {
			return killProcessTree(cmd.Process.Pid)
		}
		return nil
	}

	var (
		stdoutTail = newTailBuffer(64 * 1024) // 64KB buffer for full output log
		stderrTail = newTailBuffer(64 * 1024)
		processing bool
		mu         sync.Mutex
	)
	// Prepend the full command line to the log output so users can verify
	// type/quality/container settings in View Log.
	cmdLine := FormatYtDlpCommand(ytDlpPath, args)
	stdoutTail.Append("[command] " + cmdLine + "\n")

	// 扫描 stderr（用于错误分类），同时累积尾部缓冲。
	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			mu.Lock()
			stderrTail.Append(line + "\n")
			mu.Unlock()
		}
	}()

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		mu.Lock()
		stdoutTail.Append(line + "\n")
		mu.Unlock()

		if hasPostprocessSignal(line) {
			processing = true
		}
		if p, ok := parseProgressLine(line); ok {
			if processing {
				p.Processing = true
			}
			select {
			case progressCh <- p:
			default:
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		if ctx.Err() == context.Canceled {
			mu.Lock()
			log := stdoutTail.Read()
			mu.Unlock()
			return "", log, ErrCancelled
		}
		mu.Lock()
		stderrText := stderrTail.Read()
		log := stdoutTail.Read()
		mu.Unlock()
		return "", log, classifyExitError(stderrText)
	}

	mu.Lock()
	tail := stdoutTail.Read()
	mu.Unlock()
	filePath := extractSavedFilePath(tail)
	if filePath == "" {
		return "", tail, fmt.Errorf("yt-dlp finished but output file path not found")
	}
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return "", tail, fmt.Errorf("failed to resolve output path: %w", err)
	}
	filePath = absPath
	if info, statErr := os.Stat(filePath); statErr != nil || info.Size() == 0 {
		return "", tail, fmt.Errorf("downloaded file missing or empty: %s", filePath)
	}
	return filePath, tail, nil
}

// ExecuteInfo 执行 yt-dlp -j 查询视频信息，返回解析后的 VideoInfo。
func (e *Executor) ExecuteInfo(ctx context.Context, rawURL string) (*VideoInfo, error) {
	ytDlpPath, err := e.resolveYtDlpPath()
	if err != nil {
		return nil, err
	}
	args := BuildVideoInfoArgs(rawURL, e.settings)
	out, stderr, err := e.runCapture(ctx, ytDlpPath, args)
	if err != nil {
		return nil, wrapInfoError(err, stderr)
	}
	return parseVideoInfoJSON(out)
}

// ExecutePlaylistInfo 执行 yt-dlp -J --flat-playlist 查询播放列表信息。
func (e *Executor) ExecutePlaylistInfo(ctx context.Context, rawURL string) (*PlaylistInfo, error) {
	ytDlpPath, err := e.resolveYtDlpPath()
	if err != nil {
		return nil, err
	}
	args := BuildPlaylistInfoArgs(rawURL, e.settings)
	out, stderr, err := e.runCapture(ctx, ytDlpPath, args)
	if err != nil {
		return nil, wrapInfoError(err, stderr)
	}
	return parsePlaylistInfoJSON(out)
}

// runCapture 运行 yt-dlp 并捕获全部 stdout 与 stderr。
func (e *Executor) runCapture(ctx context.Context, ytDlpPath string, args []string) ([]byte, string, error) {
	cmd := exec.CommandContext(ctx, ytDlpPath, args...)
	setupProcessGroup(cmd)
	cmd.Cancel = func() error {
		if cmd.Process != nil {
			return killProcessTree(cmd.Process.Pid)
		}
		return nil
	}
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	runErr := cmd.Run()
	if ctx.Err() == context.Canceled {
		return nil, stderrBuf.String(), ErrCancelled
	}
	if runErr != nil {
		return stdoutBuf.Bytes(), stderrBuf.String(), runErr
	}
	return stdoutBuf.Bytes(), stderrBuf.String(), nil
}

// resolveYtDlpPath 解析 yt-dlp 二进制路径：
// 1. 配置 settings.YtDlpPath
// 2. 环境变量 YTDLP_PATH
// 3. PATH 中的 yt-dlp
func (e *Executor) resolveYtDlpPath() (string, error) {
	if e.settings.YtDlpPath != "" {
		return e.settings.YtDlpPath, nil
	}
	if env := os.Getenv("YTDLP_PATH"); env != "" {
		return env, nil
	}
	path, err := exec.LookPath("yt-dlp")
	if err != nil {
		return "", fmt.Errorf("yt-dlp not found (set download.ytDlpPath, YTDLP_PATH, or put yt-dlp in PATH)")
	}
	return path, nil
}

// resolveFfmpegPath 解析 ffmpeg 二进制路径：
// 1. 配置 settings.FfmpegPath
// 2. 环境变量 FFMPEG_PATH
// 3. PATH 中的 ffmpeg
func (e *Executor) resolveFfmpegPath() (string, error) {
	if e.settings.FfmpegPath != "" {
		return e.settings.FfmpegPath, nil
	}
	if env := os.Getenv("FFMPEG_PATH"); env != "" {
		return env, nil
	}
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("ffmpeg not found (set download.ffmpegPath, FFMPEG_PATH, or put ffmpeg in PATH)")
	}
	return path, nil
}

// --- 进度解析 ---

var progressRe = regexp.MustCompile(
	`\[download\]\s+([\d.]+)%\s+of\s+([\d.]+)(KiB|MiB|GiB|TiB|B)\s+at\s+([\d.]+)(KiB|MiB|GiB|TiB|B)/s\s+ETA\s+(\d{2}:\d{2}(?::\d{2})?)`,
)

// parseProgressLine 解析 yt-dlp 的 [download] 进度行。
// 返回解析出的 Progress 和是否匹配到进度行。
func parseProgressLine(line string) (Progress, bool) {
	m := progressRe.FindStringSubmatch(line)
	if m == nil {
		return Progress{}, false
	}
	pct, _ := strconv.ParseFloat(m[1], 64)
	totalBytes := parseSize(parseFloat(m[2]), m[3])
	speed := parseSpeed(parseFloat(m[4]), m[5])
	eta := parseETA(m[6])
	percent := pct / 100.0
	var downloaded int64
	if totalBytes > 0 && percent > 0 {
		downloaded = int64(float64(totalBytes) * percent)
	}
	return Progress{
		Percent:    percent,
		Downloaded: downloaded,
		TotalBytes: totalBytes,
		SpeedBytes: speed,
		ETASeconds: eta,
	}, true
}

func parseFloat(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

// parseSize 将数值 + 单位转换为字节数。
func parseSize(value float64, unit string) int64 {
	var factor float64 = 1
	switch strings.ToLower(unit) {
	case "kib":
		factor = 1024
	case "mib":
		factor = 1024 * 1024
	case "gib":
		factor = 1024 * 1024 * 1024
	case "tib":
		factor = 1024 * 1024 * 1024 * 1024
	case "b":
		factor = 1
	}
	return int64(value * factor)
}

// parseSpeed 解析速度（单位带 /s）。
func parseSpeed(value float64, unit string) int64 {
	// unit 形如 "MiB"，与 parseSize 同单位换算
	return parseSize(value, unit)
}

// parseETA 解析 ETA 时间字符串（MM:SS 或 HH:MM:SS）为秒数。
func parseETA(s string) int {
	parts := strings.Split(s, ":")
	nums := make([]int, len(parts))
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return 0
		}
		nums[i] = n
	}
	seconds := 0
	for _, n := range nums {
		seconds = seconds*60 + n
	}
	return seconds
}

// --- 后处理检测 ---

var processingPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bMerging formats?\b`),
	regexp.MustCompile(`(?i)^\[Postprocess\]`),
	regexp.MustCompile(`(?i)\b(?:Embedding|Adding|Fixing|Converting)\b`),
	regexp.MustCompile(`(?i)\b(?:ExtractAudio|VideoConvertor|FFmpeg)\b`),
}

// hasPostprocessSignal 判断文本是否包含 ffmpeg 后处理信号。
func hasPostprocessSignal(text string) bool {
	for _, re := range processingPatterns {
		if re.MatchString(text) {
			return true
		}
	}
	return false
}

// --- 输出文件路径提取 ---

var (
	mergeRe   = regexp.MustCompile(`Merging formats into "([^"]+)"`)
	destRe    = regexp.MustCompile(`Destination:\s+"([^"]+)"`)
	alreadyRe = regexp.MustCompile(`\[download\]\s+(.+?)\s+has already been downloaded`)
)

// extractSavedFilePath 从 yt-dlp stdout 日志中提取输出文件路径。
// 匹配模式（按优先级）：
//
//	Merging formats into "path"  → 提取 path
//	Destination: "path"          → 提取 path
//	[download] path has already been → 提取 path
func extractSavedFilePath(stdoutTail string) string {
	if m := mergeRe.FindStringSubmatch(stdoutTail); m != nil {
		return strings.TrimSpace(m[1])
	}
	if m := destRe.FindStringSubmatch(stdoutTail); m != nil {
		return strings.TrimSpace(m[1])
	}
	if m := alreadyRe.FindStringSubmatch(stdoutTail); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// --- 错误分类 ---

var classifyPatterns = []struct {
	re     *regexp.Regexp
	reason string
}{
	{regexp.MustCompile(`(?i)http error 429|too many requests|rate.?limit`), "rate limited (HTTP 429)"},
	{regexp.MustCompile(`(?i)login required|requires (?:cookies|authentication)|sign in to confirm`), "authentication required"},
	{regexp.MustCompile(`(?i)not available in your country|geo.?restricted|geographic`), "geo-blocked"},
	{regexp.MustCompile(`(?i)video unavailable|not found|404`), "video not found"},
	{regexp.MustCompile(`(?i)no space left|disk full|enospc`), "disk full"},
	{regexp.MustCompile(`(?i)permission denied|eacces`), "permission denied"},
	{regexp.MustCompile(`(?i)ffmpeg|ffprobe`), "ffmpeg error"},
	{regexp.MustCompile(`(?i)network|timeout|econnreset|enotfound|ehostunreach`), "network error"},
}

// classifyExitError 根据 stderr 内容分类 yt-dlp 退出错误。
func classifyExitError(stderr string) error {
	txt := strings.ToLower(stderr)
	for _, p := range classifyPatterns {
		if p.re.MatchString(txt) {
			return fmt.Errorf("yt-dlp: %s", p.reason)
		}
	}
	return fmt.Errorf("yt-dlp exited with error: %s", strings.TrimSpace(stderr))
}

// wrapInfoError 包装信息查询阶段的错误。
func wrapInfoError(err error, stderr string) error {
	msg := strings.TrimSpace(stderr)
	if msg == "" {
		return fmt.Errorf("query failed: %w", err)
	}
	return fmt.Errorf("query failed: %s", msg)
}

// --- JSON 解析辅助 ---

func parseVideoInfoJSON(data []byte) (*VideoInfo, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse video info: %w", err)
	}
	info := &VideoInfo{}
	if v, ok := raw["title"]; ok {
		json.Unmarshal(v, &info.Title)
	}
	if v, ok := raw["thumbnail"]; ok {
		json.Unmarshal(v, &info.Thumbnail)
	}
	if v, ok := raw["duration"]; ok {
		json.Unmarshal(v, &info.Duration)
	}
	if v, ok := raw["uploader"]; ok {
		json.Unmarshal(v, &info.Uploader)
	}
	if v, ok := raw["description"]; ok {
		json.Unmarshal(v, &info.Description)
	}
	if v, ok := raw["extractor_key"]; ok {
		json.Unmarshal(v, &info.Extractor)
	}
	if v, ok := raw["webpage_url"]; ok {
		json.Unmarshal(v, &info.WebpageURL)
	}
	return info, nil
}

func parsePlaylistInfoJSON(data []byte) (*PlaylistInfo, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse playlist info: %w", err)
	}
	info := &PlaylistInfo{}
	if v, ok := raw["id"]; ok {
		json.Unmarshal(v, &info.ID)
	}
	if v, ok := raw["title"]; ok {
		json.Unmarshal(v, &info.Title)
	}
	var entries []map[string]json.RawMessage
	if v, ok := raw["entries"]; ok {
		if err := json.Unmarshal(v, &entries); err != nil {
			// 某些情况下 entries 可能是 null
			entries = nil
		}
	}
	for i, e := range entries {
		entry := PlaylistEntry{Index: i + 1}
		if v, ok := e["id"]; ok {
			json.Unmarshal(v, &entry.ID)
		}
		if v, ok := e["title"]; ok {
			json.Unmarshal(v, &entry.Title)
		}
		if v, ok := e["url"]; ok {
			json.Unmarshal(v, &entry.URL)
		}
		if v, ok := e["thumbnail"]; ok {
			json.Unmarshal(v, &entry.Thumbnail)
		}
		info.Entries = append(info.Entries, entry)
	}
	return info, nil
}

// --- 尾部缓冲 ---

// tailBuffer 是一个定长环形文本缓冲，保留最后 N 字节。
type tailBuffer struct {
	buf      []byte
	maxBytes int
}

func newTailBuffer(maxBytes int) *tailBuffer {
	if maxBytes <= 0 {
		maxBytes = 8 * 1024
	}
	return &tailBuffer{maxBytes: maxBytes}
}

// Append 追加文本到尾部缓冲（超出 maxBytes 时丢弃最旧的内容）。
func (t *tailBuffer) Append(s string) {
	t.buf = append(t.buf, s...)
	if len(t.buf) > t.maxBytes {
		t.buf = t.buf[len(t.buf)-t.maxBytes:]
	}
}

// Read 返回当前缓冲内容的拷贝。
func (t *tailBuffer) Read() string {
	return string(t.buf)
}

// --- 进程取消 ---

// killProcessTree 与 setupProcessGroup 的平台相关实现见
// kill_unix.go（!windows）与 kill_windows.go（windows）。
