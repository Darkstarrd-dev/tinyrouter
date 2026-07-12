package download

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// RuntimeSettings 是运行时下载设置（从配置注入）。
type RuntimeSettings struct {
	DownloadDir         string // 默认下载目录
	BrowserCookies      string // 浏览器 cookies (如 "chrome", "firefox:profile")
	CookiesPath         string // cookies 文件路径
	Proxy               string // 代理地址
	FfmpegPath          string // ffmpeg 目录或文件路径
	YtDlpPath           string // yt-dlp 二进制路径
	ConcurrentFragments int    // 单视频分片并行数，默认 4
	MaxConcurrent       int    // 任务级并发数，默认 3
}

const (
	defaultFilenameTemplate   = "%(title)s.%(ext)s"
	windowsFilenameTrimLength = "120"
	defaultRetries            = "30"
	defaultFragmentRetries    = "30"
	defaultRetrySleep         = "2"
	defaultSocketTimeout      = "30"
	youtubeSafePlayerClients  = "default,-web"
)

// BuildDownloadArgs 构建 yt-dlp 下载参数。
// 移植自 VidBee buildDownloadArgs()，新增 --concurrent-fragments 参数。
//
// 参数：
//   - rawURL: 下载地址
//   - downloadType: "video" 或 "audio"
//   - quality: 质量预设
//   - container: 输出容器格式
//   - downloadDir: 下载目录
//   - concurrentFragments: 分片并行数 (1=不并行, 推荐 4-8)
//   - settings: cookies/proxy 等运行时设置
//
// 返回：yt-dlp 命令行参数列表（不含 yt-dlp 路径本身）
func BuildDownloadArgs(rawURL string, downloadType DownloadType, quality QualityPreset,
	container ContainerFormat, downloadDir string, concurrentFragments int,
	settings RuntimeSettings) []string {

	args := []string{"--no-playlist", "--no-mtime", "--encoding", "utf-8", "--newline"}

	// 分片并行加速（新增）
	if concurrentFragments > 1 {
		args = append(args, "--concurrent-fragments", fmt.Sprintf("%d", concurrentFragments))
	}

	// 格式选择器
	if downloadType == TypeAudio {
		args = append(args, "-f", resolveAudioFormatSelector(quality))
	} else {
		sel := resolveVideoFormatSelector(quality)
		if sel != "" {
			args = append(args, "-f", sel)
		}
		// 容器格式
		switch container {
		case ContainerAuto:
			args = append(args, "--merge-output-format", "mp4/mkv")
		case ContainerOriginal:
			// 不添加
		default:
			if container != "" {
				args = append(args, "--merge-output-format", string(container), "--remux-video", string(container))
			}
		}
	}

	// 字幕/嵌入选项
	args = append(args, "--sub-langs", "all", "--embed-subs")
	args = append(args, "--no-embed-thumbnail", "--embed-metadata", "--embed-chapters")

	// 输出路径
	template := defaultFilenameTemplate
	dir := downloadDir
	if dir == "" {
		dir = settings.DownloadDir
	}
	args = append(args, "-o", filepath.Join(dir, template))

	// 续传与安全
	args = append(args, "--continue", "--no-playlist-reverse")
	if runtime.GOOS == "windows" {
		args = append(args, "--windows-filenames")
	}
	args = append(args, "--trim-filenames", windowsFilenameTrimLength)

	// 网络韧性
	args = append(args,
		"--retries", defaultRetries,
		"--fragment-retries", defaultFragmentRetries,
		"--retry-sleep", defaultRetrySleep,
		"--socket-timeout", defaultSocketTimeout,
	)

	// Cookies
	if settings.BrowserCookies != "" && settings.BrowserCookies != "none" {
		args = append(args, "--cookies-from-browser", settings.BrowserCookies)
	}
	if settings.CookiesPath != "" {
		args = append(args, "--cookies", settings.CookiesPath)
	}

	// 代理
	if settings.Proxy != "" {
		args = append(args, "--proxy", settings.Proxy)
	}

	// YouTube 安全提取器参数
	if isYouTubeURL(rawURL) {
		args = append(args, "--extractor-args", "youtube:player_client="+youtubeSafePlayerClients)
	}

	// ffmpeg 位置（在 URL 之前插入）
	if settings.FfmpegPath != "" {
		args = append(args, "--ffmpeg-location", resolveFfmpegDir(settings.FfmpegPath))
	}

	// URL（最后一个参数）
	args = append(args, rawURL)
	return args
}

// resolveVideoFormatSelector 根据质量预设生成视频格式选择器。
// 移植自 VidBee buildVideoFormatPreference()。
//
// 质量映射：
//
//	best:   bestvideo+bestaudio/best (不限制)
//	good:   bestvideo[height<=1080]+bestaudio[abr<=256]/bestvideo+bestaudio/best
//	normal: bestvideo[height<=720]+bestaudio[abr<=192]/bestvideo+bestaudio/best
//	bad:    bestvideo[height<=480]+bestaudio[abr<=128]/bestvideo+bestaudio/best
//	worst:  worstvideo+worstaudio/worst/best
func resolveVideoFormatSelector(quality QualityPreset) string {
	switch quality {
	case QualityBest:
		return "bestvideo+bestaudio/best"
	case QualityWorst:
		return "worstvideo+worstaudio/worst/best"
	}
	videoCandidates := []string{}
	if maxHeight := qualityToVideoHeight(quality); maxHeight > 0 {
		videoCandidates = append(videoCandidates, fmt.Sprintf("bestvideo[height<=%d]", maxHeight))
	}
	videoCandidates = append(videoCandidates, "bestvideo")

	audioSelectors := []string{}
	if abr := qualityToAudioAbr(quality); abr > 0 {
		audioSelectors = append(audioSelectors, fmt.Sprintf("bestaudio[abr<=%d]", abr))
	}
	audioSelectors = append(audioSelectors, "bestaudio")

	combinations := []string{}
	for _, video := range videoCandidates {
		for _, audio := range audioSelectors {
			combinations = append(combinations, video+"+"+audio)
		}
	}
	combinations = append(combinations, "bestvideo+bestaudio", "best")
	return strings.Join(dedupe(combinations), "/")
}

// resolveAudioFormatSelector 根据质量预设生成音频格式选择器。
// 移植自 VidBee buildAudioFormatPreference()。
func resolveAudioFormatSelector(quality QualityPreset) string {
	if quality == QualityWorst {
		return "worstaudio/bestaudio/best"
	}
	selectors := []string{}
	if abr := qualityToAudioAbr(quality); abr > 0 {
		selectors = append(selectors, fmt.Sprintf("bestaudio[abr<=%d]", abr))
	}
	selectors = append(selectors, "bestaudio")
	selectors = append(selectors, "best")
	return strings.Join(dedupe(selectors), "/")
}

// qualityToVideoHeight 返回质量预设对应的视频高度上限（0 表示无限制）。
func qualityToVideoHeight(quality QualityPreset) int {
	switch quality {
	case QualityGood:
		return 1080
	case QualityNormal:
		return 720
	case QualityBad:
		return 480
	case QualityWorst:
		return 360
	default:
		return 0
	}
}

// qualityToAudioAbr 返回质量预设对应的音频码率上限（0 表示无限制，将回退到 bestaudio）。
func qualityToAudioAbr(quality QualityPreset) int {
	switch quality {
	case QualityBest:
		return 320
	case QualityGood:
		return 256
	case QualityNormal:
		return 192
	case QualityBad:
		return 128
	case QualityWorst:
		return 96
	default:
		return 0
	}
}

// dedupe 去除切片中的重复元素（保持顺序）。
func dedupe(items []string) []string {
	seen := make(map[string]struct{}, len(items))
	result := make([]string, 0, len(items))
	for _, it := range items {
		if it == "" {
			continue
		}
		if _, ok := seen[it]; ok {
			continue
		}
		seen[it] = struct{}{}
		result = append(result, it)
	}
	return result
}

// BuildVideoInfoArgs 构建 yt-dlp 视频信息查询参数 (-j)。
// 移植自 VidBee buildVideoInfoArgs()。
func BuildVideoInfoArgs(rawURL string, settings RuntimeSettings) []string {
	args := []string{"-j", "--no-playlist", "--no-warnings", "--encoding", "utf-8"}
	args = appendNetworkArgs(args, settings, rawURL)
	args = append(args, rawURL)
	return args
}

// BuildPlaylistInfoArgs 构建 yt-dlp 播放列表信息查询参数 (-J --flat-playlist)。
// 移植自 VidBee buildPlaylistInfoArgs()。
func BuildPlaylistInfoArgs(rawURL string, settings RuntimeSettings) []string {
	args := []string{"-J", "--flat-playlist", "--ignore-errors", "--no-warnings", "--encoding", "utf-8"}
	args = appendNetworkArgs(args, settings, rawURL)
	args = append(args, rawURL)
	return args
}

// appendNetworkArgs 追加网络相关参数（代理/cookies/超时/YouTube 安全参数）。
func appendNetworkArgs(args []string, settings RuntimeSettings, rawURL string) []string {
	if settings.Proxy != "" {
		args = append(args, "--proxy", settings.Proxy)
	}
	args = append(args, "--socket-timeout", defaultSocketTimeout)
	if settings.BrowserCookies != "" && settings.BrowserCookies != "none" {
		args = append(args, "--cookies-from-browser", settings.BrowserCookies)
	}
	if settings.CookiesPath != "" {
		args = append(args, "--cookies", settings.CookiesPath)
	}
	if isYouTubeURL(rawURL) {
		args = append(args, "--extractor-args", "youtube:player_client="+youtubeSafePlayerClients)
	}
	return args
}

// isYouTubeURL 判断 URL 是否为 YouTube。
// 匹配 youtube.com, youtu.be, youtube-nocookie.com 及其子域名。
func isYouTubeURL(rawURL string) bool {
	host := hostOf(rawURL)
	if host == "" {
		return false
	}
	suffixes := []string{"youtube.com", "youtu.be", "youtube-nocookie.com"}
	for _, s := range suffixes {
		if host == s || strings.HasSuffix(host, "."+s) {
			return true
		}
	}
	return false
}

// isBilibiliURL 判断 URL 是否为 Bilibili。
// 匹配 bilibili.com, b23.tv, bili.tv。
func isBilibiliURL(rawURL string) bool {
	host := hostOf(rawURL)
	if host == "" {
		return false
	}
	return strings.Contains(host, "bilibili.com") ||
		strings.Contains(host, "b23.tv") ||
		strings.Contains(host, "bili.tv")
}

// hostOf 从 URL 中提取小写主机名（解析失败返回空串）。
func hostOf(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// resolveFfmpegDir 从文件路径或目录路径获取 ffmpeg 目录。
// 如果是文件，返回 filepath.Dir；如果是目录，直接返回。
func resolveFfmpegDir(path string) string {
	if path == "" {
		return ""
	}
	ext := strings.ToLower(filepath.Ext(path))
	if ext != "" && !isDir(path) {
		return filepath.Dir(path)
	}
	return path
}

// isDir 判断路径是否为目录。
func isDir(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

// FormatYtDlpCommand 返回可读的 yt-dlp 命令字符串（用于日志/调试）。
// 移植自 VidBee formatYtDlpCommand()。
func FormatYtDlpCommand(binaryPath string, args []string) string {
	quoted := make([]string, 0, len(args)+1)
	quoted = append(quoted, quoteArg(binaryPath))
	for _, a := range args {
		quoted = append(quoted, quoteArg(a))
	}
	return strings.Join(quoted, " ")
}

// quoteArg 在必要时为参数加引号。
func quoteArg(arg string) string {
	if arg == "" {
		return `""`
	}
	if strings.ContainsAny(arg, " \t\"'\\") {
		return `"` + strings.ReplaceAll(arg, `"`, `\"`) + `"`
	}
	return arg
}
