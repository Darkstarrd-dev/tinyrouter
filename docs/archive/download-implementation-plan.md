# VidBee 核心下载功能 Go 原生移植实施计划

> **文档目的**：本文档包含完整的项目上下文、架构分析、参考代码、实施规范，
> 供新对话中无当前上下文的 AI agent 直接使用进行任务派发与审核。
>
> **生成时间**：2026-07-12
> **源项目**：VidBee (https://github.com/nexmoe/VidBee) 已克隆至 `Z:\Playground\VidBee`
> **目标项目**：TinyRouter，源码位于 `Z:\Playground\tinyrouter`

---

## 目录

1. [项目背景与目标](#1-项目背景与目标)
2. [VidBee 架构分析（完整）](#2-vidbee-架构分析完整)
3. [TinyRouter 架构分析（完整）](#3-tinyrouter-架构分析完整)
4. [设计决策](#4-设计决策)
5. [依赖分析](#5-依赖分析)
6. [实施步骤总览](#6-实施步骤总览)
7. [步骤 1：internal/download/types.go](#步骤-1internaldownloadtypesgo)
8. [步骤 2：internal/download/args.go](#步骤-2internaldownloadargsgo)
9. [步骤 3：internal/download/executor.go](#步骤-3internaldownloadexecutorgo)
10. [步骤 4：internal/download/manager.go](#步骤-4internaldownloadmanagergo)
11. [步骤 5：internal/api/download.go](#步骤-5internalapidownloadgo)
12. [步骤 6：internal/api/router.go 修改](#步骤-6internalapiroutergo-修改)
13. [步骤 7：internal/config/config.go 修改](#步骤-7internalconfigconfiggo-修改)
14. [步骤 8：main.go 修改](#步骤-8maingo-修改)
15. [步骤 9：web/static/download.js](#步骤-9webstaticdownloadjs)
16. [步骤 10：web/static/index.html 修改](#步骤-10webstaticindexhtml-修改)
17. [步骤 11：web/static/app.js 修改](#步骤-11webstaticappjs-修改)
18. [步骤 12：web/static/i18n.js 修改](#步骤-12webstatici18njs-修改)
19. [VidBee 参考代码（关键逻辑摘录）](#vidbee-参考代码关键逻辑摘录)
20. [验证计划](#验证计划)
21. [风险与注意事项](#风险与注意事项)

---

## 1. 项目背景与目标

### 1.1 需求

用户在 Go + WebView2 项目 **TinyRouter** (`Z:\Playground\tinyrouter`) 中，
需要集成视频下载功能。功能来源为开源项目 **VidBee** (https://github.com/nexmoe/VidBee)，
该项目的核心下载逻辑基于 Node.js/TypeScript + `yt-dlp-wrap-plus` 库。

### 1.2 目标

将 VidBee 的核心下载解析逻辑用 **Go 原生重写**，集成到 TinyRouter 中：

- **自动解析地址并下载**：输入 URL → 调用 yt-dlp 下载
- **单视频分片并行加速**：使用 yt-dlp 的 `--concurrent-fragments N` 参数
- **播放列表支持**：解析播放列表 → 顺序下载每个视频
- **多任务队列**：多个单视频/播放列表形成下载队列，支持并发执行
- **内存模式**：不需要持久化，进程退出即丢失状态
- **yt-dlp 和 ffmpeg 二进制由用户自行准备**，放在 PATH 中或通过环境变量指定

### 1.3 不需要的

- 不需要 Node.js 运行时
- 不需要 `yt-dlp-wrap-plus` 库
- 不需要数据库 (SQLite/better-sqlite3)
- 不需要 RSS 订阅功能
- 不需要 Electron 桌面框架
- 不需要 oRPC/RPC 框架

---

## 2. VidBee 架构分析（完整）

### 2.1 项目结构

```
VidBee/
├── packages/
│   ├── downloader-core/     # 核心下载逻辑（移植目标）
│   │   └── src/
│   │       ├── index.ts                    # barrel 导出
│   │       ├── types.ts                    # 类型定义
│   │       ├── schemas.ts                  # zod schema
│   │       ├── contract.ts                # oRPC 契约
│   │       ├── downloader-core.ts          # 遗留单体队列（DownloaderCore 类）
│   │       ├── download-file.ts            # 文件名/路径构建工具
│   │       ├── format-preferences.ts       # 质量预设 → 格式选择器
│   │       ├── yt-dlp-args.ts              # yt-dlp 参数构建（核心）
│   │       ├── yt-dlp-executor.ts          # yt-dlp 执行器（spawn+进度解析+取消）
│   │       └── browser-cookies-setting.ts  # cookies 字符串解析
│   ├── task-queue/           # 任务队列内核（FSM+调度器+持久化）
│   ├── db/                   # SQLite schema
│   └── subscriptions-core/   # RSS 订阅核心
├── apps/
│   ├── api/                  # Fastify API 服务器
│   ├── cli/                  # CLI 工具
│   ├── desktop/              # Electron 桌面应用
│   └── web/                  # TanStack Start web 客户端
```

### 2.2 核心下载链路

```
URL 输入 → buildDownloadArgs() 构建 yt-dlp argv
         → YtDlpExecutor.run() spawn yt-dlp 二进制
         → yt-dlp-wrap-plus 解析 [download] 进度行 → progress 事件
         → yt-dlp 内部调用 ffmpeg 做合并/转码 (通过 --ffmpeg-location 传参)
         → 退出码 0 → statSync 校验文件 → completed
```

### 2.3 yt-dlp 调用方式

VidBee 通过 `yt-dlp-wrap-plus` (CJS) 包 spawn yt-dlp 二进制：

```typescript
const YTDlpWrapModule = require('yt-dlp-wrap-plus')
const YTDlpWrapCtor = (YTDlpWrapModule.default ?? YTDlpWrapModule)
new YTDlpWrapCtor(ytDlpPath).exec(args, { signal })
```

**关键**：`yt-dlp-wrap-plus` 本质上只是 `child_process.spawn` + stdout 行解析的包装。
Go 用 `exec.CommandContext` + `cmd.StdoutPipe()` + `bufio.Scanner` 可等价实现。

### 2.4 ffmpeg 调用方式

**ffmpeg 从不被直接 spawn**。只通过 `--ffmpeg-location <dir>` 传给 yt-dlp，
由 yt-dlp 内部拉起 ffmpeg 子进程做合并/转码。

### 2.5 多线程/并发现状

**VidBee 当前未使用 `--concurrent-fragments`（单任务内分片并行下载）。**
现有并发仅是**任务级并发**（同时跑 N 个 yt-dlp 子进程，默认 maxConcurrent=3 或 4）。

yt-dlp 原生支持 `--concurrent-fragments N`（简写 `-N N`）实现单视频分片并行下载加速，
但 VidBee 的 `buildDownloadArgs()` 没有传递这个参数。**这是本次移植的新增功能。**

### 2.6 VidBee 的两套执行架构

VidBee 存在两套并行的执行架构（技术债）：

1. **遗留单体队列** `DownloaderCore`（`downloader-core.ts`）：单进程内存队列 + spawn，
   含大量 Electron 资源路径假设。**不建议移植。**
2. **新任务队列执行器** `YtDlpExecutor`（`yt-dlp-executor.ts`）：实现 `Executor` 接口，
   host-neutral 设计（通过回调注入 resolveYtDlpPath/resolveFfmpegLocation）。**这是移植参考。**

### 2.7 VidBee 外部依赖

| 依赖 | 用途 | Go 是否需要 |
|---|---|---|
| `yt-dlp-wrap-plus` | spawn yt-dlp + 进度解析 | **不需要**，Go 用 `os/exec` 替代 |
| `zod` | schema 校验 | **不需要**，Go 用 struct tag |
| `@orpc/contract` | RPC 契约 | **不需要** |
| `better-sqlite3` | 任务持久化 | **不需要**，内存模式 |
| `drizzle-orm` | DB schema | **不需要** |
| Node.js 内置 (`child_process`, `crypto`, `events`, `fs`, `os`, `path`) | - | Go 用标准库等价替代 |

---

## 3. TinyRouter 架构分析（完整）

### 3.1 基本信息

| 项 | 值 |
|---|---|
| 模块路径 | `github.com/tinyrouter/tinyrouter` |
| Go 版本 | 1.25.0 |
| 版本号 | `Version = "1.5.4"` (version.go) |
| HTTP 路由 | `github.com/go-chi/chi/v5` |
| 配置 | `gopkg.in/yaml.v3` → `config.yaml` |
| 前端 | 原生 HTML + vanilla JS + CSS (embed.FS 内嵌) |
| 通信 | localhost REST + SSE (无 webview 原生 Bind) |

### 3.2 目录结构

```
Z:\Playground\tinyrouter\
├── main.go                     # 入口
├── server_manager.go           # HTTP 服务器封装
├── version.go                  # 版本号
├── host_*.go                   # 平台宿主 (build tag 分派)
├── go.mod / go.sum
├── build.ps1                   # 构建脚本
├── internal/
│   ├── config/                 # 配置结构 + YAML 加载/保存
│   ├── registry/               # Provider/Key/Combo CRUD
│   ├── rotation/               # Key 选择策略 + 冷却/退避
│   ├── combo/                  # Combo 解析
│   ├── proxy/                  # /v1/* 代理处理器 (SSE 透传)
│   ├── usage/                  # 内存环形缓冲统计
│   ├── console/                # 控制台日志 + SSE 推送
│   ├── api/                    # 管理 REST API
│   │   ├── router.go           # 路由注册
│   │   ├── handlers.go         # 通用 handler + writeAPIError
│   │   ├── monitor_terminal.go # SSE 推送参考实现
│   │   └── ...
│   ├── state/                  # state.yaml 持久化
│   ├── monitor/                # 命令输出流式订阅
│   ├── terminal/               # PTY 终端
│   └── util/
├── web/
│   ├── embed.go                # embed.FS
│   └── static/
│       ├── index.html          # 主页面
│       ├── style.css
│       ├── api.js              # fetch 封装 (apiGet/apiPost/apiPatch/apiPut/apiDelete)
│       ├── app.js              # 导航 (navigateTo) + 通用工具
│       ├── i18n.js             # 国际化 (en/cn 字典)
│       └── *.js                # 各页面 JS
```

### 3.3 Go ↔ WebView 通信方式

**不存在原生 webview Bind/MessageReceived。** 通信模型是 HTTP 本地环回：

1. `ServerManager` 在 `127.0.0.1:<port>` 起 chi HTTP 服务
2. WebView2 窗口加载本机 admin UI 的普通 HTTP 页面
3. 前端通过 `fetch('/api/...')` 调 REST，通过 `EventSource` 收 SSE 推送
4. **新增功能只需加 HTTP 路由，无需触碰 webview 原生 API**

### 3.4 路由注册方式 (router.go)

```go
// internal/api/router.go
func (rt *Router) Routes(proxyHandler *proxy.Handler) http.Handler {
    r := chi.NewRouter()
    r.Use(middleware.Recoverer)
    r.Use(middleware.RequestID)
    r.Use(securityHeaders(rt.cfg.Port))
    r.Use(Compress)

    // Proxy routes
    r.Post("/v1/chat/completions", proxyHandler.ChatCompletions)
    // ...

    // API routes
    r.Route("/api", func(r chi.Router) {
        r.Use(func(next http.Handler) http.Handler {
            return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB limit
                next.ServeHTTP(w, r)
            })
        })

        // Public routes (no auth)
        r.Get("/auth/status", rt.AuthStatusHandler)

        // Protected routes (auth required)
        r.Group(func(r chi.Router) {
            r.Use(rt.AuthMiddleware)
            // Settings, Providers, Keys, Combos, QuickSlots, Usage, Console, Monitor, Terminal
        })
    })

    r.Get("/*", rt.serveUI)
    return r
}
```

### 3.5 Router 结构体

```go
// internal/api/router.go
type Router struct {
    reg           *registry.Registry
    cfg           *config.Config
    configPath    string
    usage         *usage.RingBuffer
    quotaTracker  *usage.QuotaTracker
    logger        *console.Logger
    proxyHandler  *proxy.Handler
    selector      *rotation.Selector
    comboRes      *combo.Resolver
    testClient    *http.Client
    shutdown      context.CancelFunc
    restartFn     func(string)
    stateSaveFunc func()
    debugMode     atomic.Bool
    monitorMgr    *monitor.Manager
    terminalMu    sync.Mutex
    activeTerm    *terminal.Session
}
```

### 3.6 SSE 推送参考实现 (monitor_terminal.go)

```go
// internal/api/monitor_terminal.go — SSE 推送范式
func (rt *Router) streamMonitor(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        writeAPIError(w, http.StatusInternalServerError, "streaming not supported")
        return
    }

    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")
    w.WriteHeader(http.StatusOK)

    // 先发送已缓冲的内容
    for _, line := range rt.monitorMgr.BufferedLines() {
        payload, _ := json.Marshal(map[string]string{"type": "line", "line": line})
        fmt.Fprintf(w, "data: %s\n\n", payload)
        flusher.Flush()
    }

    // 订阅新内容
    ch := rt.monitorMgr.Subscribe()
    defer rt.monitorMgr.Unsubscribe(ch)

    ctx := r.Context()
    for {
        select {
        case line, ok := <-ch:
            if !ok { return }
            payload, _ := json.Marshal(map[string]string{"type": "line", "line": line})
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
```

### 3.7 错误处理工具函数

```go
// internal/api/handlers.go:520
func writeAPIError(w http.ResponseWriter, status int, msg string) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(map[string]any{"error": msg})
}
```

### 3.8 配置结构 (config.go)

```go
// internal/config/config.go
type Config struct {
    Port               int            `yaml:"port" json:"port"`
    ConsoleLogMaxLines int            `yaml:"consoleLogMaxLines" json:"consoleLogMaxLines"`
    UsageRingSize      int            `yaml:"usageRingSize" json:"usageRingSize"`
    Rotation           RotationConfig `yaml:"rotation" json:"rotation"`
    EnablePlayground   bool           `yaml:"enablePlayground" json:"enablePlayground"`
    Providers          []Provider     `yaml:"providers" json:"providers"`
    Combos             []Combo        `yaml:"combos" json:"combos"`
    QuickSlots         []QuickSlot    `yaml:"quickSlots" json:"quickSlots"`
    Security           SecurityConfig `yaml:"security" json:"security"`
    Monitor            MonitorConfig  `yaml:"monitor" json:"monitor"`
    Proxy              ProxyConfig    `yaml:"proxy" json:"proxy"`
}

func DefaultConfig() *Config { ... }
func Load(path string) (*Config, error) { ... }
func Save(path string, cfg *Config) error { ... }  // 原子写入 (temp+rename)
```

### 3.9 日志接口 (console.Logger)

```go
// internal/console/logger.go
type Logger struct { ... }

func New(maxLines int) *Logger
func (l *Logger) Log(format string, args ...any)   // [timestamp] msg
func (l *Logger) Info(format string, args ...any)  // 同 Log
func (l *Logger) Warn(format string, args ...any)  // [timestamp] ⚠ msg
func (l *Logger) Error(format string, args ...any)  // [timestamp] [ERROR] msg
func (l *Logger) Debug(format string, args ...any)  // [timestamp] [DEBUG] msg
```

### 3.10 main.go 组装方式

```go
// main.go
func main() {
    cfg, _ := config.Load(*configPath)
    logger := console.New(cfg.ConsoleLogMaxLines)
    // ...
    apiRouter := api.New(reg, cfg, *configPath, usageBuf, quotaTracker, logger, proxyHandler, triggerShutdown, selector, comboRes)
    handler := apiRouter.Routes(proxyHandler)
    // ...
}
```

### 3.11 前端导航 (app.js)

```javascript
// web/static/app.js
function navigateTo(page) {
    currentPage = page;
    var gen = ++navGen;
    // ...
    const container = document.getElementById('page-content');
    container.innerHTML = '';
    const p = (() => {
        switch (page) {
            case 'endpoint': return renderEndpoint(container);
            case 'providers': return renderProviders(container);
            case 'combos': return renderCombos(container);
            case 'playground': return renderPlayground(container);
            case 'usage': return renderUsage(container);
            case 'console': return renderConsole(container);
        }
    })();
    // ...
}
```

前端导航通过 `<nav>` 中的 `data-page` 按钮触发：
```html
<!-- web/static/index.html -->
<nav class="top-header-nav">
    <button class="nav-item active" type="button" data-page="usage">Usage</button>
    <button class="nav-item" type="button" data-page="endpoint">Settings</button>
    <button class="nav-item" type="button" data-page="console">Console</button>
    <button class="nav-item" type="button" data-page="playground">Playground</button>
</nav>
```

### 3.12 前端 API 封装 (api.js)

```javascript
// web/static/api.js
const API = '/api';
async function apiGet(path, signal) { ... }
async function apiPost(path, body, signal) { ... }
async function apiPatch(path, body, signal) { ... }
async function apiPut(path, body, signal) { ... }
async function apiDelete(path, signal) { ... }
```

### 3.13 国际化 (i18n.js)

```javascript
// web/static/i18n.js
const L = {
    en: { endpoint: 'Settings', usage: 'Usage', ... },
    cn: { endpoint: '设置', usage: '用量', ... }
};
function t(key, args) { ... }  // 取当前语言对应 key 的翻译
```

### 3.14 代码规范 (AGENTS.md)

- **Go 标准格式** `gofmt` / `goimports`
- **错误显式处理**，不允许 panic（仅 main.go 启动阶段 `log.Fatalf` 兜底）
- **共享状态用 `sync.RWMutex`** 保护
- **日志用 `internal/console.Logger`**，不直接用 `log` 标准库
- **导出函数需有文档注释**
- **核心逻辑需有单元测试**
- **禁止引数据库、前端框架、对外鉴权（JWT/OAuth）**
- **文件写入用临时文件 + rename** 保证原子性
- **无构建步骤**，前端为 vanilla JS 直接内嵌

---

## 4. 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 实现方式 | Go 原生重写 | 单二进制，无 Node.js 依赖 |
| yt-dlp 调用 | `os/exec` + `context` | 等价替代 yt-dlp-wrap-plus |
| 进度解析 | `bufio.Scanner` 解析 stdout | 解析 `[download]` 行 |
| 任务队列 | channel + goroutine 池 | Go 原生并发 |
| 持久化 | 不需要 | 内存模式，进程退出即丢失 |
| 前端 | vanilla JS 新增页面 | 遵循 TinyRouter 约定 |
| 通信 | REST + SSE | 遵循 TinyRouter 约定 |
| 外部 Go 库 | 零 | 仅用标准库 |

---

## 5. 依赖分析

### 5.1 Go 依赖（全部标准库，零外部库）

| 标准库包 | 用途 |
|---|---|
| `os/exec` | spawn yt-dlp 二进制 |
| `context` | 取消/超时控制 |
| `bufio` | 扫描 stdout 进度行 |
| `regexp` | 解析进度百分比/速度/ETA |
| `crypto/rand` | 生成任务 ID |
| `encoding/hex` | ID 编码 |
| `encoding/json` | API 序列化 |
| `fmt` | 格式化 |
| `net/http` | HTTP handler |
| `os` | 文件/路径/环境变量 |
| `os/exec` | `which`/`where` 查找二进制 |
| `path/filepath` | 路径拼接 |
| `runtime` | 平台判断 |
| `strconv` | 数字解析 |
| `strings` | 字符串处理 |
| `sync` | RWMutex 互斥锁 |
| `time` | 时间戳/计时 |

### 5.2 外部二进制依赖

| 二进制 | 来源 | 路径解析顺序 |
|---|---|---|
| yt-dlp | 用户自行准备 | 1. 环境变量 `YTDLP_PATH` 2. PATH 中的 `yt-dlp` |
| ffmpeg/ffprobe | 用户自行准备 | 1. 环境变量 `FFMPEG_PATH` 2. PATH 中的 `ffmpeg` |

---

## 6. 实施步骤总览

| 步骤 | 文件 | 操作 | 说明 |
|---|---|---|---|
| 1 | `internal/download/types.go` | 新增 | 任务/状态/进度类型定义 |
| 2 | `internal/download/args.go` | 新增 | yt-dlp 参数构建（移植自 VidBee） |
| 3 | `internal/download/executor.go` | 新增 | yt-dlp 进程执行 + 进度解析 + 取消 |
| 4 | `internal/download/manager.go` | 新增 | 任务队列 + 管理器 |
| 5 | `internal/api/download.go` | 新增 | HTTP REST + SSE handler |
| 6 | `internal/api/router.go` | 修改 | 注册下载路由 + Router 结构体加字段 |
| 7 | `internal/config/config.go` | 修改 | 添加 DownloadConfig |
| 8 | `main.go` | 修改 | 初始化 DownloadManager |
| 9 | `web/static/download.js` | 新增 | 前端下载页面 |
| 10 | `web/static/index.html` | 修改 | 添加导航按钮 + script 引用 |
| 11 | `web/static/app.js` | 修改 | 添加 navigateTo case |
| 12 | `web/static/i18n.js` | 修改 | 添加翻译 key |

---

## 步骤 1：internal/download/types.go

**路径**：`Z:\Playground\tinyrouter\internal\download\types.go`
**包名**：`package download`
**操作**：新增文件

### 完整规格

定义以下类型：

```go
package download

import "time"

// TaskStatus 表示任务的生命周期状态。
type TaskStatus string

const (
    StatusPending    TaskStatus = "pending"     // 等待执行
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
    ContainerAuto     ContainerFormat = "auto"     // 自动 mp4/mkv
    ContainerMP4      ContainerFormat = "mp4"
    ContainerMKV      ContainerFormat = "mkv"
    ContainerWebM     ContainerFormat = "webm"
    ContainerOriginal ContainerFormat = "original" // 不强制
)

// Progress 表示下载进度快照。
type Progress struct {
    Percent      float64 `json:"percent"`       // 0.0 ~ 1.0
    SpeedBytes   int64   `json:"speedBytes"`    // bytes/sec, 0 未知
    Downloaded   int64   `json:"downloaded"`    // bytes, 0 未知
    TotalBytes   int64   `json:"totalBytes"`    // bytes, 0 未知
    ETASeconds   int     `json:"etaSeconds"`    // 0 未知
    Processing   bool    `json:"processing"`    // 是否处于 ffmpeg 后处理阶段
}

// Task 表示一个下载任务。
type Task struct {
    ID            string        `json:"id"`
    URL           string        `json:"url"`
    Type          DownloadType  `json:"type"`
    Status        TaskStatus    `json:"status"`
    Title         string        `json:"title,omitempty"`
    Thumbnail     string        `json:"thumbnail,omitempty"`
    Quality       QualityPreset `json:"quality,omitempty"`
    Container     ContainerFormat `json:"container,omitempty"`
    Progress      Progress      `json:"progress"`
    DownloadDir   string        `json:"downloadDir,omitempty"`
    SavedFile     string        `json:"savedFile,omitempty"`
    FilePath     string        `json:"filePath,omitempty"`
    FileSize     int64         `json:"fileSize,omitempty"`
    Error         string        `json:"error,omitempty"`
    PlaylistID    string        `json:"playlistId,omitempty"`
    PlaylistTitle string        `json:"playlistTitle,omitempty"`
    PlaylistIndex int           `json:"playlistIndex,omitempty"`
    PlaylistSize  int           `json:"playlistSize,omitempty"`
    CreatedAt     time.Time     `json:"createdAt"`
    StartedAt     time.Time     `json:"startedAt,omitempty"`
    CompletedAt   time.Time     `json:"completedAt,omitempty"`
    LogTail       string        `json:"-"`         // 不暴露给前端
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
    ID        string           `json:"id"`
    Title     string           `json:"title"`
    Entries   []PlaylistEntry `json:"entries"`
}
```

---

## 步骤 2：internal/download/args.go

**路径**：`Z:\Playground\tinyrouter\internal\download\args.go`
**包名**：`package download`
**操作**：新增文件

### 移植来源

移植自 VidBee 的 `packages/downloader-core/src/yt-dlp-args.ts`（完整文件见下方 [参考代码](#vidbee-参考代码关键逻辑摘录) 章节）。

需要实现以下函数：

### 2.1 BuildDownloadArgs

```go
// BuildDownloadArgs 构建 yt-dlp 下载参数。
// 移植自 VidBee buildDownloadArgs()，新增 --concurrent-fragments 参数。
//
// 参数：
//   - url: 下载地址
//   - downloadType: "video" 或 "audio"
//   - quality: 质量预设
//   - container: 输出容器格式
//   - downloadDir: 下载目录
//   - concurrentFragments: 分片并行数 (1=不并行, 推荐 4-8)
//   - settings: cookies/proxy 等运行时设置
//
// 返回：yt-dlp 命令行参数列表（不含 yt-dlp 路径本身）
func BuildDownloadArgs(url string, downloadType DownloadType, quality QualityPreset,
    container ContainerFormat, downloadDir string, concurrentFragments int,
    settings RuntimeSettings) []string
```

参数构建逻辑（按顺序）：

1. **基础参数**：
   - `--no-playlist`（单视频不下载整个播放列表）
   - `--no-mtime`
   - `--encoding utf-8`
   - `--newline`（进度行换行输出，便于解析）

2. **分片并行加速（新增）**：
   - 如果 `concurrentFragments > 1`，添加 `--concurrent-fragments <N>`

3. **格式选择器**：
   - video 类型：调用 `resolveVideoFormatSelector(quality)` 生成选择器
   - audio 类型：调用 `resolveAudioFormatSelector(quality)` 生成选择器
   - 添加 `-f <selector>`

4. **容器格式**：
   - `auto` → `--merge-output-format mp4/mkv`
   - `mp4`/`mkv`/`webm` → `--merge-output-format <container>` + `--remux-video <container>`
   - `original` → 不添加

5. **字幕/嵌入选项**：
   - `--sub-langs all` + `--embed-subs`（默认嵌入字幕）
   - `--no-embed-thumbnail`（默认不嵌入封面，减少 ffmpeg 耗时）
   - `--embed-metadata`（默认嵌入元数据）
   - `--embed-chapters`（默认嵌入章节）

6. **输出路径**：
   - 模板：`%(title)s.%(ext)s`（文件名用视频标题）
   - `-o <downloadDir>/<template>`

7. **续传与安全**：
   - `--continue`
   - `--no-playlist-reverse`
   - Windows: `--windows-filenames`
   - 全平台: `--trim-filenames 120`

8. **网络韧性**：
   - `--retries 30`
   - `--fragment-retries 30`
   - `--retry-sleep 2`
   - `--socket-timeout 30`

9. **Cookies**（可选）：
   - 如果 `settings.BrowserCookies` 非空且不是 "none"：`--cookies-from-browser <value>`
   - 如果 `settings.CookiesPath` 非空：`--cookies <path>`

10. **代理**（可选）：
    - 如果 `settings.Proxy` 非空：`--proxy <value>`

11. **YouTube 安全提取器参数**：
    - 如果 URL 是 YouTube：`--extractor-args youtube:player_client=default,-web`
    - （排除 `web` client 避免 403）

12. **ffmpeg 位置**：
    - 如果 `settings.FfmpegPath` 非空：在 URL 之前插入 `--ffmpeg-location <dir>`

13. **URL**（最后一个参数）

### 2.2 resolveVideoFormatSelector

移植自 VidBee 的 `format-preferences.ts` 的 `buildVideoFormatPreference()` 函数。

```go
// resolveVideoFormatSelector 根据质量预设生成视频格式选择器。
// 移植自 VidBee buildVideoFormatPreference()。
//
// 质量映射：
//   best:   bestvideo+bestaudio/best (不限制)
//   good:   bestvideo[height<=1080]+bestaudio[abr<=256]/bestvideo+bestaudio/best
//   normal: bestvideo[height<=720]+bestaudio[abr<=192]/bestvideo+bestaudio/best
//   bad:    bestvideo[height<=480]+bestaudio[abr<=128]/bestvideo+bestaudio/best
//   worst:  worstvideo+worstaudio/worst/best
func resolveVideoFormatSelector(quality QualityPreset) string
```

质量预设到限制值的映射：

| 预设 | 视频高度上限 | 音频码率上限 |
|---|---|---|
| best | 无限制 | 320 |
| good | 1080 | 256 |
| normal | 720 | 192 |
| bad | 480 | 128 |
| worst | 360 | 96 |

视频选择器构建逻辑：
1. 如果 `best`：`bestvideo+bestaudio/best`
2. 如果 `worst`：`worstvideo+worstaudio/worst/best`
3. 其他：
   - 视频候选：`bestvideo[height<=N]` + 后备 `bestvideo`
   - 音频候选：`bestaudio[abr<=N]` + 后备 `bestaudio`
   - 组合：每个视频×音频组合用 `+` 连接
   - 后备链：加 `bestvideo+bestaudio` 和 `best`
   - 所有候选用 `/` 连接

### 2.3 resolveAudioFormatSelector

```go
// resolveAudioFormatSelector 根据质量预设生成音频格式选择器。
// 移植自 VidBee buildAudioFormatPreference()。
func resolveAudioFormatSelector(quality QualityPreset) string
```

逻辑：
1. 如果 `worst`：`worstaudio/bestaudio/best`
2. 其他：`bestaudio[abr<=N]/bestaudio/best`

### 2.4 BuildVideoInfoArgs

```go
// BuildVideoInfoArgs 构建 yt-dlp 视频信息查询参数 (-j)。
// 移植自 VidBee buildVideoInfoArgs()。
func BuildVideoInfoArgs(url string, settings RuntimeSettings) []string
```

参数：
- `-j` `--no-playlist` `--no-warnings` `--encoding utf-8`
- `--socket-timeout 30`
- cookies/proxy（同上）
- YouTube 安全参数（同上）
- URL

### 2.5 BuildPlaylistInfoArgs

```go
// BuildPlaylistInfoArgs 构建 yt-dlp 播放列表信息查询参数 (-J --flat-playlist)。
// 移植自 VidBee buildPlaylistInfoArgs()。
func BuildPlaylistInfoArgs(url string, settings RuntimeSettings) []string
```

参数：
- `-J` `--flat-playlist` `--ignore-errors` `--no-warnings` `--encoding utf-8`
- `--socket-timeout 30`
- cookies/proxy（同上）
- YouTube 安全参数（同上）
- URL

### 2.6 RuntimeSettings 类型

```go
// RuntimeSettings 是运行时下载设置（从配置注入）。
type RuntimeSettings struct {
    DownloadDir     string // 默认下载目录
    BrowserCookies   string // 浏览器 cookies (如 "chrome", "firefox:profile")
    CookiesPath      string // cookies 文件路径
    Proxy            string // 代理地址
    FfmpegPath       string // ffmpeg 目录或文件路径
    YtDlpPath        string // yt-dlp 二进制路径
    ConcurrentFragments int  // 单视频分片并行数，默认 4
    MaxConcurrent    int    // 任务级并发数，默认 3
}
```

### 2.7 辅助函数

```go
// isYouTubeURL 判断 URL 是否为 YouTube。
// 移植自 VidBee isYouTubeUrl()。
func isYouTubeURL(url string) bool
// 匹配 youtube.com, youtu.be, youtube-nocookie.com 及其子域名

// isBilibiliURL 判断 URL 是否为 Bilibili。
// 移植自 VidBee isBilibiliUrl()。
func isBilibiliURL(url string) bool
// 匹配 bilibili.com, b23.tv, bili.tv

// resolveFfmpegDir 从文件路径或目录路径获取 ffmpeg 目录。
func resolveFfmpegDir(path string) string
// 如果是文件，返回 filepath.Dir(path)；如果是目录，直接返回

// FormatYtDlpCommand 返回可读的 yt-dlp 命令字符串（用于日志/调试）。
// 移植自 VidBee formatYtDlpCommand()。
func FormatYtDlpCommand(binaryPath string, args []string) string
```

---

## 步骤 3：internal/download/executor.go

**路径**：`Z:\Playground\tinyrouter\internal\download\executor.go`
**包名**：`package download`
**操作**：新增文件

### 移植来源

移植自 VidBee 的 `packages/downloader-core/src/yt-dlp-executor.ts`（完整文件见 [参考代码](#vidbee-参考代码关键逻辑摘录) 章节）。

### 3.1 Executor 结构

```go
// Executor 负责单个下载任务的 yt-dlp 进程管理。
// 移植自 VidBee YtDlpExecutor，简化为不依赖外部队列接口的独立执行器。
type Executor struct {
    settings RuntimeSettings
    logger  *console.Logger
}
```

### 3.2 Execute 方法

```go
// Execute 执行一次 yt-dlp 下载，阻塞直到完成或取消。
// 通过 context.Context 实现取消（SIGTERM 进程树）。
// 通过 progressCh 推送进度更新（非阻塞）。
//
// 返回：输出文件路径（如果成功）、错误（如果失败）。
func (e *Executor) Execute(ctx context.Context, task *Task, progressCh chan<- Progress) (string, error)
```

执行流程：

1. **解析 yt-dlp 路径**：
   - `settings.YtDlpPath` 非空直接用
   - 否则用 `exec.LookPath("yt-dlp")` 查 PATH
   - 都失败返回错误

2. **解析 ffmpeg 路径**：
   - `settings.FfmpegPath` 非空直接用
   - 否则用 `exec.LookPath("ffmpeg")` 查 PATH
   - 都失败返回错误

3. **构建参数**：
   - 调用 `BuildDownloadArgs(task.URL, task.Type, task.Quality, task.Container,
     task.DownloadDir, settings.ConcurrentFragments, settings)`

4. **创建命令**：
   ```go
   cmd := exec.CommandContext(ctx, ytDlpPath, args...)
   ```

5. **获取 stdout/stderr pipe**：
   ```go
   stdout, _ := cmd.StdoutPipe()
   stderr, _ := cmd.StderrPipe()
   ```

6. **启动进程**：
   ```go
   cmd.Start()
   ```

7. **扫描 stdout（进度解析）**：
   - 用 `bufio.NewScanner` 逐行扫描
   - 对每行调用 `parseProgressLine(line)`
   - 如果匹配到进度，非阻塞发送到 `progressCh`
   - 如果匹配到后处理信号（Merging/Embedding/FFmpeg 等），设置 `processing=true`
   - 累积 stdout 尾部到 8KB 环形缓冲（用于输出文件路径提取）

8. **扫描 stderr**：
   - 累积 stderr 尾部到 8KB（用于错误分类）

9. **等待进程退出**：
   ```go
   err := cmd.Wait()
   ```

10. **退出处理**：
    - `ctx.Err() == context.Canceled` → 返回 `fmt.Errorf("cancelled")`
    - `err == nil` (exit code 0)：
      - 从 stdout 尾部提取输出文件路径 `extractSavedFilePath(stdoutTail)`
      - `os.Stat` 验证文件存在且 `size > 0`
      - 返回 `filePath, nil`
    - `err != nil`：
      - 分类错误 `classifyExitError(stderr)`
      - 返回分类后的错误

### 3.3 ExecuteInfo 方法

```go
// ExecuteInfo 执行 yt-dlp -j 查询视频信息，返回解析后的 VideoInfo。
func (e *Executor) ExecuteInfo(ctx context.Context, url string) (*VideoInfo, error)
```

流程：
1. 构建 `BuildVideoInfoArgs(url, settings)`
2. spawn yt-dlp
3. 收集全部 stdout
4. `json.Unmarshal` 到 `map[string]json.RawMessage`，提取 title/thumbnail/duration/uploader 等字段
5. 返回 `*VideoInfo`

### 3.4 ExecutePlaylistInfo 方法

```go
// ExecutePlaylistInfo 执行 yt-dlp -J --flat-playlist 查询播放列表信息。
func (e *Executor) ExecutePlaylistInfo(ctx context.Context, url string) (*PlaylistInfo, error)
```

流程：
1. 构建 `BuildPlaylistInfoArgs(url, settings)`
2. spawn yt-dlp
3. 收集 stdout
4. `json.Unmarshal` 解析 `id`/`title`/`entries` (每个 entry 有 `id`/`title`/`url`/`index`)
5. 返回 `*PlaylistInfo`

### 3.5 进度解析函数

```go
// parseProgressLine 解析 yt-dlp 的 [download] 进度行。
// 返回解析出的 Progress 和是否匹配到进度行。
//
// yt-dlp 进度行格式：
//   [download]  50.0% of 100.00MiB at 5.00MiB/s ETA 00:10
//   [download]  50.0% of   100.00MiB at    5.00MiB/s ETA 00:10 (00:10 / 00:20)
//   [download]   1.2% of 100.00MiB at  500.00KiB/s ETA 02:30
//
// 也匹配后处理信号行：
//   [Merger] Merging formats into "output.mp4"
//   [ExtractAudio] Extracting audio
//   [FFmpeg] ...
func parseProgressLine(line string) (Progress, bool)
```

正则表达式（Go syntax）：
```go
var progressRe = regexp.MustCompile(
    `\[download\]\s+([\d.]+)%\s+of\s+([\d.]+)(KiB|MiB|GiB|TiB|B)\s+at\s+([\d.]+)(KiB|MiB|GiB|TiB|B)/s\s+ETA\s+(\d{2}:\d{2}(?::\d{2})?)`,
)
```

解析：
- group 1: 百分比 → `percent = value / 100.0`
- group 2+3: 已下载大小 → `parseSize(value, unit)`
- group 4+5: 速度 → `parseSpeed(value, unit)` (unit 带 `/s`)
- group 6: ETA → `parseETA(time)` (格式 `MM:SS` 或 `HH:MM:SS`)

字节单位转换函数：
```go
func parseSize(value float64, unit string) int64
// KiB → ×1024, MiB → ×1024², GiB → ×1024³, TiB → ×1024⁴, B → ×1
```

ETA 解析：
```go
func parseETA(s string) int
// "00:10" → 10 秒
// "02:30" → 150 秒
// "01:02:03" → 3723 秒
```

### 3.6 后处理检测

```go
var processingPatterns = []*regexp.Regexp{
    regexp.MustCompile(`(?i)\bMerging formats?\b`),
    regexp.MustCompile(`(?i)^\[Postprocess\]`),
    regexp.MustCompile(`(?i)\b(?:Embedding|Adding|Fixing|Converting)\b`),
    regexp.MustCompile(`(?i)\b(?:ExtractAudio|VideoConvertor|FFmpeg)\b`),
}

func hasPostprocessSignal(text string) bool
```

### 3.7 输出文件路径提取

```go
// extractSavedFilePath 从 yt-dlp stdout 日志中提取输出文件路径。
// 移植自 VidBee extractSavedFilePath()。
//
// 匹配模式（按优先级）：
//   Merging formats into "path"     → 提取 path
//   Destination: "path"             → 提取 path
//   [download] path has already been → 提取 path
func extractSavedFilePath(stdoutTail string) string
```

正则模式：
```go
var mergeRe = regexp.MustCompile(`Merging formats into "([^"]+)"`)
var destRe = regexp.MustCompile(`Destination:\s+"([^"]+)"`)
var alreadyRe = regexp.MustCompile(`\[download\]\s+(.+?)\s+has already been downloaded`)
```

### 3.8 错误分类

```go
// classifyExitError 根据 stderr 内容分类 yt-dlp 退出错误。
// 移植自 VidBee classifyYtDlpExit()。
func classifyExitError(stderr string) error
```

分类规则（按优先级，Go 不区分大小写匹配）：

| 正则模式 | 错误消息 |
|---|---|
| `http error 429\|too many requests\|rate.?limit` | `rate limited (HTTP 429)` |
| `login required\|requires (cookies\|authentication)\|sign in to confirm` | `authentication required` |
| `not available in your country\|geo.?restricted\|geographic` | `geo-blocked` |
| `video unavailable\|not found\|404` | `video not found` |
| `no space left\|disk full\|enospc` | `disk full` |
| `permission denied\|eacces` | `permission denied` |
| `ffmpeg\|ffprobe` | `ffmpeg error` |
| `network\|timeout\|econnreset\|enotfound\|ehostunreach` | `network error` |
| (默认) | `yt-dlp exited with error` |

### 3.9 尾部缓冲

```go
// tailBuffer 是一个定长环形文本缓冲，保留最后 N 字节。
// 移植自 VidBee createTailBuffer()。
type tailBuffer struct {
    buf      []byte
    maxBytes int
}

func newTailBuffer(maxBytes int) *tailBuffer
func (t *tailBuffer) Append(s string)
func (t *tailBuffer) Read() string
```

### 3.10 进程取消

Go 的 `exec.CommandContext` 在 context 被取消时会自动发送 `os.Kill`（Windows）或 `SIGKILL`（Unix）。

但更好的做法是在取消时先 SIGTERM 再 SIGKILL（给 yt-dlp 清理机会）：

```go
// 取消时：
// 1. context.cancel() → CommandContext 自动 kill
// 或手动实现：
//   Windows: taskkill /PID <pid> /T /F
//   Unix:    先 SIGTERM，等待 grace period，再 SIGKILL
```

由于 `exec.CommandContext` 在 Go 1.20+ 会先发 SIGTERM 等待 2 秒再 SIGKILL（可通过 `cmd.Cancel` 和 `cmd.WaitDelay` 自定义），可以满足需求。

对于进程树 kill（VidBee 使用 `taskkill /T /F` 杀整棵树），可以简化处理：
```go
func killProcessTree(pid int) error {
    if runtime.GOOS == "windows" {
        return exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F").Run()
    }
    // Unix: 发 SIGTERM 给进程组
    pgid, err := syscall.Getpgid(pid)
    if err == nil {
        syscall.Kill(-pgid, syscall.SIGTERM)
    }
    return nil
}
```

---

## 步骤 4：internal/download/manager.go

**路径**：`Z:\Playground\tinyrouter\internal\download\manager.go`
**包名**：`package download`
**操作**：新增文件

### 4.1 Manager 结构

```go
// Manager 管理下载任务队列和执行。
// 内存模式：无持久化，进程退出即丢失。
type Manager struct {
    mu       sync.RWMutex
    tasks    map[string]*Task      // 所有任务（含已完成）
    order    []string              // 任务顺序（按创建时间）
    executor *Executor
    settings RuntimeSettings
    logger   *console.Logger

    // 任务队列
    pendingCh chan string          // 待执行任务 ID 队列
    active    map[string]bool      // 正在执行的任务 ID

    // 事件订阅
    eventSubs map[chan Event]struct{}

    maxConcurrent int
    stopCh    chan struct{}
    wg        sync.WaitGroup
}
```

### 4.2 Event 类型

```go
// Event 是推送给 SSE 订阅者的事件。
type Event struct {
    Type string `json:"type"` // "task-updated" | "queue-updated"
    Task *Task `json:"task,omitempty"`
}
```

### 4.3 构造函数

```go
// NewManager 创建下载管理器。
func NewManager(settings RuntimeSettings, logger *console.Logger) *Manager
```

初始化：
- `tasks` map
- `pendingCh` 缓冲 100
- `active` map
- `eventSubs` map
- `maxConcurrent` 从 `settings.MaxConcurrent`（默认 3）
- `executor` = `&Executor{settings: settings, logger: logger}`
- 启动 worker goroutine 池

### 4.4 Start/Stop

```go
// Start 启动 worker 池。
func (m *Manager) Start()

// Stop 停止所有 worker 并取消进行中的任务。
func (m *Manager) Stop()
```

`Start` 启动 `maxConcurrent` 个 worker goroutine，每个 worker 循环从 `pendingCh` 取任务执行。

### 4.5 worker 逻辑

```go
func (m *Manager) worker()
```

每个 worker 的循环：
1. 从 `pendingCh` 取 `taskID`
2. `m.mu.Lock()` → 标记 active → 设置 status=downloading → `startedAt=now` → `m.mu.Unlock()`
3. 发送 task-updated 事件
4. 创建 `progressCh := make(chan Progress, 10)`
5. 启动 goroutine 读取 progressCh → 更新 task → 发送事件
6. 调用 `m.executor.Execute(ctx, task, progressCh)`
7. 处理结果：
   - 成功：status=completed, filePath, fileSize, completedAt=now
   - 取消：status=cancelled, completedAt=now
   - 失败：status=error, error=msg, completedAt=now
8. `m.mu.Lock()` → 从 active 移除 → `m.mu.Unlock()`
9. 发送 task-updated + queue-updated 事件

### 4.6 CreateTask

```go
// CreateTask 创建单个下载任务并加入队列。
// 返回任务 ID。
func (m *Manager) CreateTask(input CreateTaskInput) string
```

流程：
1. 生成 ID（`crypto/rand` 8 字节 → hex 编码，或用 `crypto/rand` + `hex.EncodeToString`）
2. 创建 `Task` 对象，status=pending, createdAt=now
3. 从 input 填充字段
4. 如果 DownloadDir 为空，用 `m.settings.DownloadDir`
5. `m.mu.Lock()` → 存入 tasks + order → `m.mu.Unlock()`
6. 发送到 `pendingCh`
7. 发送 queue-updated 事件
8. 返回 ID

### 4.7 CreatePlaylistTask

```go
// CreatePlaylistTask 创建播放列表下载任务。
// 先查询播放列表信息，然后为每个条目创建子任务。
// 播放列表内的视频按顺序下载（不并发），多个播放列表/单视频之间并发。
//
// 返回：所有创建的任务 ID 列表、播放列表标题、错误（如果有）。
func (m *Manager) CreatePlaylistTask(input CreateTaskInput) ([]string, string, error)
```

流程：
1. 调用 `m.executor.ExecutePlaylistInfo(ctx, input.URL)` 获取播放列表信息
2. 对每个 entry：
   - 创建 `CreateTaskInput`，URL=entry.URL
   - 填充 PlaylistID/PlaylistTitle/PlaylistIndex/PlaylistSize
   - 调用 `m.CreateTask(childInput)`
3. 返回所有子任务 ID 和播放列表标题

### 4.8 GetVideoInfo

```go
// GetVideoInfo 查询视频信息（不下载）。
func (m *Manager) GetVideoInfo(url string) (*VideoInfo, error)
```

调用 `m.executor.ExecuteInfo(ctx, url)`。

### 4.9 CancelTask

```go
// CancelTask 取消指定任务。
// 如果任务在队列中等待，直接移除。
// 如果任务正在执行，取消其 context。
func (m *Manager) CancelTask(taskID string) error
```

### 4.10 ListTasks

```go
// ListTasks 返回所有任务（含已完成）。
func (m *Manager) ListTasks() []*Task
```

### 4.11 GetTask

```go
// GetTask 返回指定任务。
func (m *Manager) GetTask(taskID string) (*Task, bool)
```

### 4.12 ClearCompleted

```go
// ClearCompleted 清除所有已完成的任务。
func (m *Manager) ClearCompleted()
```

### 4.13 RemoveTask

```go
// RemoveTask 从列表中移除指定任务（仅允许终态任务）。
func (m *Manager) RemoveTask(taskID string) error
```

### 4.14 事件订阅

```go
// Subscribe 订阅事件流（用于 SSE 推送）。
func (m *Manager) Subscribe() chan Event

// Unsubscribe 取消订阅。
func (m *Manager) Unsubscribe(ch chan Event)
```

```go
// publishEvent 非阻塞地向所有订阅者发送事件。
func (m *Manager) publishEvent(evt Event)
// 用 select + default 实现非阻塞发送，避免慢订阅者阻塞 worker
```

### 4.15 updateTaskProgress（内部）

```go
// updateTaskProgress 更新任务进度并发送事件。
func (m *Manager) updateTaskProgress(taskID string, p Progress)
```

---

## 步骤 5：internal/api/download.go

**路径**：`Z:\Playground\tinyrouter\internal\api\download.go`
**包名**：`package api`
**操作**：新增文件

### 5.1 Router 结构体新增字段

在 `internal/api/router.go` 的 `Router` 结构体中添加：

```go
type Router struct {
    // ... 现有字段 ...
    downloadMgr *download.Manager  // 新增：下载管理器
}
```

同时修改 `New()` 函数签名，增加 `downloadMgr *download.Manager` 参数。

### 5.2 HTTP Handler 实现

```go
// internal/api/download.go
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
func (rt *Router) createDownload(w http.ResponseWriter, r *http.Request)

// getVideoInfo 查询视频信息
// POST /api/downloads/info
// Body: { "url": "..." }
func (rt *Router) getVideoInfo(w http.ResponseWriter, r *http.Request)

// getPlaylistInfo 查询播放列表信息
// POST /api/downloads/playlist
// Body: { "url": "..." }
func (rt *Router) getPlaylistInfo(w http.ResponseWriter, r *http.Request)

// createPlaylistDownload 创建播放列表批量下载
// POST /api/downloads/playlist
// Body: { "url": "...", "type": "video"|"audio", "quality": "...", "container": "...", "downloadDir": "..." }
func (rt *Router) createPlaylistDownload(w http.ResponseWriter, r *http.Request)

// listDownloads 列出所有下载任务
// GET /api/downloads
func (rt *Router) listDownloads(w http.ResponseWriter, r *http.Request)

// getDownload 获取单个下载任务详情
// GET /api/downloads/{id}
func (rt *Router) getDownload(w http.ResponseWriter, r *http.Request)

// cancelDownload 取消下载任务
// POST /api/downloads/{id}/cancel
func (rt *Router) cancelDownload(w http.ResponseWriter, r *http.Request)

// removeDownload 移除已完成的下载任务
// DELETE /api/downloads/{id}
func (rt *Router) removeDownload(w http.ResponseWriter, r *http.Request)

// clearCompletedDownloads 清除所有已完成的任务
// POST /api/downloads/clear-completed
func (rt *Router) clearCompletedDownloads(w http.ResponseWriter, r *http.Request)

// streamDownloadEvents SSE 推送下载事件
// GET /api/downloads/stream
func (rt *Router) streamDownloadEvents(w http.ResponseWriter, r *http.Request)
```

### 5.3 Handler 实现细节

#### createDownload

```go
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
```

#### streamDownloadEvents（SSE 参考）

```go
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
            if !ok { return }
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
```

---

## 步骤 6：internal/api/router.go 修改

**路径**：`Z:\Playground\tinyrouter\internal\api\router.go`
**操作**：修改

### 6.1 添加 import

```go
import (
    // 现有 import...
    "github.com/tinyrouter/tinyrouter/internal/download"
)
```

### 6.2 Router 结构体添加字段

```go
type Router struct {
    // ... 现有字段 ...
    downloadMgr *download.Manager
}
```

### 6.3 New() 函数添加参数

```go
func New(reg *registry.Registry, cfg *config.Config, configPath string,
    usageBuf *usage.RingBuffer, quotaTracker *usage.QuotaTracker,
    logger *console.Logger, proxyHandler *proxy.Handler,
    shutdown context.CancelFunc, selector *rotation.Selector,
    comboRes *combo.Resolver,
    downloadMgr *download.Manager,  // 新增
) *Router {
    return &Router{
        // ... 现有字段 ...
        downloadMgr: downloadMgr,
    }
}
```

### 6.4 Routes() 添加路由注册

在 `r.Group(func(r chi.Router) { r.Use(rt.AuthMiddleware) ... })` 内的 `// Terminal` 块之后添加：

```go
// Downloads
r.Get("/downloads", rt.listDownloads)
r.Post("/downloads", rt.createDownload)
r.Get("/downloads/stream", rt.streamDownloadEvents)
r.Post("/downloads/info", rt.getVideoInfo)
r.Post("/downloads/playlist", rt.createPlaylistDownload)
r.Get("/downloads/{id}", rt.getDownload)
r.Post("/downloads/{id}/cancel", rt.cancelDownload)
r.Delete("/downloads/{id}", rt.removeDownload)
r.Post("/downloads/clear-completed", rt.clearCompletedDownloads)
```

### 6.5 Cleanup() 方法添加

```go
func (rt *Router) Cleanup() {
    // ... 现有清理 ...
    if rt.downloadMgr != nil {
        rt.downloadMgr.Stop()
    }
}
```

---

## 步骤 7：internal/config/config.go 修改

**路径**：`Z:\Playground\tinyrouter\internal\config\config.go`
**操作**：修改

### 7.1 添加 DownloadConfig 结构

```go
// DownloadConfig controls the video download feature.
type DownloadConfig struct {
    Enabled             bool   `yaml:"enabled" json:"enabled"`
    DefaultDir          string `yaml:"defaultDir,omitempty" json:"defaultDir,omitempty"`
    YtDlpPath           string `yaml:"ytDlpPath,omitempty" json:"ytDlpPath,omitempty"`
    FfmpegPath          string `yaml:"ffmpegPath,omitempty" json:"ffmpegPath,omitempty"`
    ConcurrentFragments int    `yaml:"concurrentFragments,omitempty" json:"concurrentFragments,omitempty"`
    MaxConcurrent       int    `yaml:"maxConcurrent,omitempty" json:"maxConcurrent,omitempty"`
    Proxy               string `yaml:"proxy,omitempty" json:"proxy,omitempty"`
    BrowserCookies      string `yaml:"browserCookies,omitempty" json:"browserCookies,omitempty"`
    CookiesPath         string `yaml:"cookiesPath,omitempty" json:"cookiesPath,omitempty"`
}
```

### 7.2 Config 结构体添加字段

```go
type Config struct {
    // ... 现有字段 ...
    Download DownloadConfig `yaml:"download" json:"download"`
}
```

### 7.3 DefaultConfig 添加默认值

```go
func DefaultConfig() *Config {
    return &Config{
        // ... 现有默认值 ...
        Download: DownloadConfig{
            Enabled:             true,
            DefaultDir:          "",  // 运行时默认为用户 "下载" 目录
            ConcurrentFragments: 4,
            MaxConcurrent:       3,
        },
    }
}
```

### 7.4 finalizeConfig 添加默认值回填

```go
func finalizeConfig(cfg *Config, raw []byte) *Config {
    // ... 现有逻辑 ...

    // Download defaults
    if cfg.Download.ConcurrentFragments == 0 {
        cfg.Download.ConcurrentFragments = 4
    }
    if cfg.Download.MaxConcurrent == 0 {
        cfg.Download.MaxConcurrent = 3
    }
    if cfg.Download.DefaultDir == "" {
        // 使用用户主目录下的 "Downloads" 文件夹
        if home, err := os.UserHomeDir(); err == nil {
            cfg.Download.DefaultDir = filepath.Join(home, "Downloads")
        }
    }

    // ... return cfg ...
}
```

注意：需要在 import 中添加 `path/filepath`（如果尚未导入）。

---

## 步骤 8：main.go 修改

**路径**：`Z:\Playground\tinyrouter\main.go`
**操作**：修改

### 8.1 添加 import

```go
import (
    // 现有 import...
    "github.com/tinyrouter/tinyrouter/internal/download"
)
```

### 8.2 初始化 DownloadManager

在 `proxyHandler.SetProxy(...)` 之后、`state persistence` 之前添加：

```go
// Download manager
downloadSettings := download.RuntimeSettings{
    DownloadDir:          cfg.Download.DefaultDir,
    YtDlpPath:            cfg.Download.YtDlpPath,
    FfmpegPath:           cfg.Download.FfmpegPath,
    ConcurrentFragments:  cfg.Download.ConcurrentFragments,
    MaxConcurrent:        cfg.Download.MaxConcurrent,
    Proxy:                cfg.Download.Proxy,
    BrowserCookies:       cfg.Download.BrowserCookies,
    CookiesPath:          cfg.Download.CookiesPath,
}
downloadMgr := download.NewManager(downloadSettings, logger)
if cfg.Download.Enabled {
    downloadMgr.Start()
    logger.Info("download manager started (concurrent=%d, fragments=%d)",
        cfg.Download.MaxConcurrent, cfg.Download.ConcurrentFragments)
}
```

### 8.3 修改 api.New 调用

```go
apiRouter := api.New(reg, cfg, *configPath, usageBuf, quotaTracker, logger,
    proxyHandler, triggerShutdown, selector, comboRes, downloadMgr)  // 新增 downloadMgr
```

---

## 步骤 9：web/static/download.js

**路径**：`Z:\Playground\tinyrouter\web\static\download.js`
**操作**：新增文件

### 设计要点

- 纯 vanilla JS，无框架，无构建步骤
- 遵循 TinyRouter 前端风格：使用 `api.js` 的 `apiGet/apiPost`、`app.js` 的 `toast/escapeHtml/emptyState`
- SSE 用 `EventSource` 连接 `/api/downloads/stream`
- 页面包含：URL 输入框、下载按钮、视频信息预览、任务列表（进度条）

### 页面结构

```
┌──────────────────────────────────────────┐
│  下载                                    │
├──────────────────────────────────────────┤
│  [URL 输入框] [解析] [下载]              │
│  类型: [video ▼] 质量: [best ▼]          │
│  容器: [auto ▼]  目录: [Downloads]        │
├──────────────────────────────────────────┤
│  视频信息 (解析后显示):                   │
│  缩略图 | 标题 | 时长 | UP主              │
├──────────────────────────────────────────┤
│  下载队列                                 │
│  ┌────────────────────────────────────┐  │
│  │ [缩略图] 标题                      │  │
│  │ ████████████░░░░ 75% 5.2MB/s ETA  │  │
│  │ [取消] [打开目录]                   │  │
│  └────────────────────────────────────┘  │
│  ...更多任务...                           │
│  [清除已完成]                             │
└──────────────────────────────────────────┘
```

### 完整实现规格

```javascript
// web/static/download.js

var downloadEventSource = null;
var downloadTasksCache = [];

function renderDownload(container) {
    container.innerHTML = `
        <div class="page-header">
            <h2>${t('download')}</h2>
        </div>
        <div class="card download-input-card">
            <div class="download-input-row">
                <input type="text" id="dl-url" class="input flex-1"
                    placeholder="${t('downloadUrlPlaceholder')}" />
                <button class="btn btn-ghost" id="dl-parse-btn" onclick="parseDownloadUrl()">
                    ${t('parse')}
                </button>
                <button class="btn btn-primary" id="dl-start-btn" onclick="startDownload()">
                    ${t('download')}
                </button>
            </div>
            <div class="download-options-row">
                <label>${t('type')}
                    <select id="dl-type" class="select">
                        <option value="video">${t('video')}</option>
                        <option value="audio">${t('audio')}</option>
                    </select>
                </label>
                <label>${t('quality')}
                    <select id="dl-quality" class="select">
                        <option value="best">${t('qualityBest')}</option>
                        <option value="good">1080p</option>
                        <option value="normal">720p</option>
                        <option value="bad">480p</option>
                        <option value="worst">360p</option>
                    </select>
                </label>
                <label>${t('container')}
                    <select id="dl-container" class="select">
                        <option value="auto">Auto (MP4/MKV)</option>
                        <option value="mp4">MP4</option>
                        <option value="mkv">MKV</option>
                        <option value="webm">WebM</option>
                        <option value="original">${t('original')}</option>
                    </select>
                </label>
                <label>${t('downloadDir')}
                    <input type="text" id="dl-dir" class="input" placeholder="Downloads" />
                </label>
            </div>
            <div id="dl-info-preview" class="dl-info-preview" style="display:none;">
                <!-- 解析后填充 -->
            </div>
        </div>
        <div class="download-queue">
            <div class="download-queue-header">
                <h3>${t('downloadQueue')}</h3>
                <button class="btn btn-ghost btn-sm" onclick="clearCompletedDownloads()">
                    ${t('clearCompleted')}
                </button>
            </div>
            <div id="dl-tasks" class="dl-tasks"></div>
        </div>
    `;

    // 加载已有任务
    loadDownloadTasks();
    // 连接 SSE
    connectDownloadSSE();
}

// parseDownloadUrl 解析视频信息
async function parseDownloadUrl() { ... }

// startDownload 开始下载
async function startDownload() { ... }

// startPlaylistDownload 播放列表下载
async function startPlaylistDownload(url) { ... }

// loadDownloadTasks 加载已有任务列表
async function loadDownloadTasks() { ... }

// connectDownloadSSE 连接 SSE 事件流
function connectDownloadSSE() { ... }

// renderDownloadTask 渲染单个任务卡片
function renderDownloadTask(task) { ... }

// updateDownloadTask 更新任务卡片（SSE 事件触发）
function updateDownloadTask(task) { ... }

// cancelDownload 取消下载
async function cancelDownload(taskId) { ... }

// removeDownload 移除已完成任务
async function removeDownload(taskId) { ... }

// clearCompletedDownloads 清除已完成
async function clearCompletedDownloads() { ... }

// formatBytes 格式化字节数
function formatBytes(bytes) { ... }

// formatSpeed 格式化速度
function formatSpeed(bytesPerSec) { ... }

// formatETA 格式化 ETA
function formatETA(seconds) { ... }

// formatProgress 格式化进度百分比
function formatProgress(percent) { ... }
```

### SSE 连接逻辑

```javascript
function connectDownloadSSE() {
    if (downloadEventSource) downloadEventSource.close();
    downloadEventSource = new EventSource('/api/downloads/stream');
    downloadEventSource.onmessage = function(event) {
        var evt = JSON.parse(event.data);
        if (evt.type === 'task-updated' && evt.task) {
            updateDownloadTask(evt.task);
        }
    };
    downloadEventSource.onerror = function() {
        // 重连
        setTimeout(connectDownloadSSE, 3000);
    };
}
```

### 进度条 HTML

```html
<div class="dl-task-card" data-task-id="abc123">
    <div class="dl-task-thumb">
        <img src="thumbnail_url" alt="" onerror="this.style.display='none'">
    </div>
    <div class="dl-task-info">
        <div class="dl-task-title">视频标题</div>
        <div class="dl-task-status">
            <span class="dl-status-badge dl-status-downloading">下载中</span>
            <span class="dl-task-progress-text">75.0% · 5.2 MB/s · ETA 00:10</span>
        </div>
        <div class="progress-bar">
            <div class="progress-bar-fill" style="width: 75%"></div>
        </div>
        <div class="dl-task-actions">
            <button class="btn btn-ghost btn-sm" onclick="cancelDownload('abc123')">取消</button>
        </div>
    </div>
</div>
```

### CSS 样式

在 `web/static/style.css` 中追加下载页面相关样式。关键 class：
- `.download-input-card` — 输入区域卡片
- `.download-input-row` — URL+按钮行（flex）
- `.download-options-row` — 选项行（flex gap）
- `.dl-info-preview` — 视频信息预览
- `.download-queue` — 队列容器
- `.dl-tasks` — 任务列表
- `.dl-task-card` — 单个任务卡片（flex）
- `.dl-task-thumb` — 缩略图（固定宽 120px）
- `.dl-task-info` — 任务信息（flex-1）
- `.progress-bar` — 进度条容器
- `.progress-bar-fill` — 进度条填充
- `.dl-status-*` — 各状态 badge 颜色

---

## 步骤 10：web/static/index.html 修改

**路径**：`Z:\Playground\tinyrouter\web\static\index.html`
**操作**：修改

### 10.1 添加导航按钮

在 `<nav class="top-header-nav">` 中，在 Playground 按钮之前添加：

```html
<button class="nav-item" type="button" data-page="download">Download</button>
```

修改后：
```html
<nav class="top-header-nav">
    <button class="nav-item active" type="button" data-page="usage">Usage</button>
    <button class="nav-item" type="button" data-page="endpoint">Settings</button>
    <button class="nav-item" type="button" data-page="console">Console</button>
    <button class="nav-item" type="button" data-page="download">Download</button>
    <button class="nav-item" type="button" data-page="playground">Playground</button>
</nav>
```

### 10.2 添加 script 引用

在 `</body>` 之前，在 `console.js` 之后添加：

```html
<script src="/download.js"></script>
```

---

## 步骤 11：web/static/app.js 修改

**路径**：`Z:\Playground\tinyrouter\web\static\app.js`
**操作**：修改

### 11.1 navigateTo 添加 case

在 `navigateTo` 函数的 switch 中添加：

```javascript
case 'download': return renderDownload(container);
```

修改后：
```javascript
const p = (() => {
    switch (page) {
        case 'endpoint': return renderEndpoint(container);
        case 'providers': return renderProviders(container);
        case 'combos': return renderCombos(container);
        case 'playground': return renderPlayground(container);
        case 'usage': return renderUsage(container);
        case 'console': return renderConsole(container);
        case 'download': return renderDownload(container);  // 新增
    }
})();
```

---

## 步骤 12：web/static/i18n.js 修改

**路径**：`Z:\Playground\tinyrouter\web\static\i18n.js`
**操作**：修改

### 12.1 添加翻译 key

在 `en` 字典中添加：

```javascript
// Download page
download: 'Download',
downloadQueue: 'Download Queue',
downloadUrlPlaceholder: 'Paste video or playlist URL here...',
parse: 'Parse',
type: 'Type',
video: 'Video',
audio: 'Audio',
quality: 'Quality',
qualityBest: 'Best',
container: 'Container',
original: 'Original',
downloadDir: 'Download Dir',
clearCompleted: 'Clear Completed',
parsing: 'Parsing...',
parseFailed: 'Parse failed: {0}',
downloadStarted: 'Download started',
downloadCompleted: '{0} downloaded',
downloadFailed: 'Download failed: {0}',
downloadCancelled: 'Download cancelled',
cancelDownload: 'Cancel',
removeDownload: 'Remove',
openDir: 'Open Folder',
noDownloads: 'No downloads yet.',
playlistDetected: 'Playlist detected: {0} videos',
playlistDownloadAll: 'Download All',
statusPending: 'Pending',
statusDownloading: 'Downloading',
statusProcessing: 'Processing',
statusCompleted: 'Completed',
statusError: 'Error',
statusCancelled: 'Cancelled',
```

在 `cn` 字典中添加对应中文：

```javascript
// Download page
download: '下载',
downloadQueue: '下载队列',
downloadUrlPlaceholder: '粘贴视频或播放列表地址...',
parse: '解析',
type: '类型',
video: '视频',
audio: '音频',
quality: '画质',
qualityBest: '最佳',
container: '容器',
original: '原格式',
downloadDir: '下载目录',
clearCompleted: '清除已完成',
parsing: '解析中...',
parseFailed: '解析失败: {0}',
downloadStarted: '下载已开始',
downloadCompleted: '{0} 已下载',
downloadFailed: '下载失败: {0}',
downloadCancelled: '下载已取消',
cancelDownload: '取消',
removeDownload: '移除',
openDir: '打开目录',
noDownloads: '暂无下载任务。',
playlistDetected: '检测到播放列表: {0} 个视频',
playlistDownloadAll: '全部下载',
statusPending: '等待中',
statusDownloading: '下载中',
statusProcessing: '处理中',
statusCompleted: '已完成',
statusError: '失败',
statusCancelled: '已取消',
```

---

## VidBee 参考代码（关键逻辑摘录）

以下为 VidBee 源码中需要移植的关键文件的完整内容。
**文件路径**：`Z:\Playground\VidBee\packages\downloader-core\src\`

### yt-dlp-args.ts（完整，464 行）

```typescript
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseBrowserCookiesSetting } from './browser-cookies-setting'
import type { OneClickContainerOption } from './format-preferences'

export interface YtDlpDownloadSettings {
  downloadPath?: string
  browserForCookies?: string
  cookiesPath?: string
  proxy?: string
  configPath?: string
  embedSubs?: boolean
  embedThumbnail?: boolean
  embedMetadata?: boolean
  embedChapters?: boolean
}

export interface YtDlpDownloadOptions {
  url: string
  type: 'video' | 'audio'
  format?: string
  audioFormat?: string
  audioFormatIds?: string[]
  startTime?: string
  endTime?: string
  customDownloadPath?: string
  customFilenameTemplate?: string
  containerFormat?: OneClickContainerOption
}

const YOUTUBE_HOST_SUFFIXES = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] as const
const YOUTUBE_SAFE_PLAYER_CLIENTS = 'default,-web'
const DEFAULT_FILENAME_TEMPLATE = '%(title)s via VidBee.%(ext)s'
const WINDOWS_FILENAME_TRIM_LENGTH = '120'

const DEFAULT_RETRIES = '30'
const DEFAULT_FRAGMENT_RETRIES = '30'
const DEFAULT_RETRY_SLEEP = '2'
const DEFAULT_SOCKET_TIMEOUT = '30'

const appendNetworkResilienceArgs = (args: string[]): void => {
  args.push('--retries', DEFAULT_RETRIES)
  args.push('--fragment-retries', DEFAULT_FRAGMENT_RETRIES)
  args.push('--retry-sleep', DEFAULT_RETRY_SLEEP)
  args.push('--socket-timeout', DEFAULT_SOCKET_TIMEOUT)
}

const hasYouTubeHost = (host: string): boolean =>
  YOUTUBE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))

const trim = (value?: string | null): string => value?.trim() ?? ''

export const normalizeBrowserCookiesSettingForYtDlp = (value?: string | null): string => {
  const rawValue = trim(value)
  if (!rawValue || rawValue === 'none') { return 'none' }
  const { browser, profile } = parseBrowserCookiesSetting(rawValue)
  if (!profile) { return browser }
  if (browser === 'safari') { return 'safari' }
  const looksLikePath = profile.includes('/') || profile.includes('\\')
  if (!looksLikePath) { return `${browser}:${profile}` }
  const isWindowsPath = profile.includes('\\')
  const isAbsolutePath = isWindowsPath
    ? path.win32.isAbsolute(profile)
    : path.posix.isAbsolute(profile)
  if (browser === 'firefox' && isAbsolutePath && existsSync(path.join(profile, 'cookies.sqlite'))) {
    return `${browser}:${profile}`
  }
  const profileName = isWindowsPath
    ? path.win32.basename(profile)
    : path.posix.basename(profile)
  return profileName ? `${browser}:${profileName}` : browser
}

const isBilibiliUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.includes('bilibili.com') || host.includes('b23.tv') || host.includes('bili.tv')
  } catch { return false }
}

const isTwitchUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.includes('twitch.tv')
  } catch { return false }
}

export const resolvePathWithHome = (rawPath?: string | null): string | undefined => {
  const trimmed = trim(rawPath)
  if (!trimmed) { return undefined }
  if (trimmed === '~') { return os.homedir() }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return trimmed
}

export const sanitizeFilenameTemplate = (template: string): string => {
  const trimmed = template.trim()
  if (!trimmed) { return DEFAULT_FILENAME_TEMPLATE }
  const normalized = trimmed.replace(/\\/g, '/')
  const safeParts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*]/g, '-').replace(/[. ]+$/g, ''))
    .filter((part) => part !== '')
  return safeParts.length === 0 ? DEFAULT_FILENAME_TEMPLATE : safeParts.join('/')
}

export const appendPlatformFilenameSafetyArgs = (
  args: string[],
  platform: NodeJS.Platform = process.platform
): void => {
  if (platform === 'win32') { args.push('--windows-filenames') }
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    args.push('--trim-filenames', WINDOWS_FILENAME_TRIM_LENGTH)
    return
  }
}

export const isYouTubeUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return hasYouTubeHost(host)
  } catch { return false }
}

export const appendYouTubeSafeExtractorArgs = (args: string[], url: string): void => {
  if (!isYouTubeUrl(url)) { return }
  args.push('--extractor-args', `youtube:player_client=${YOUTUBE_SAFE_PLAYER_CLIENTS}`)
}

export const formatYtDlpCommand = (args: string[]): string => {
  const quoted = args.map((arg) => {
    if (arg === '') { return '""' }
    if (/[\s"'\\]/.test(arg)) { return `"${arg.replace(/(["\\])/g, '\\$1')}"` }
    return arg
  })
  return `yt-dlp ${quoted.join(' ')}`
}

export const resolveFfmpegLocationFromPath = (ffmpegPath: string): string =>
  path.dirname(ffmpegPath)

const BEST_FORMAT_FALLBACK = 'bestvideo+bestaudio/best'

const withBestFallback = (selector: string): string =>
  selector.includes('/') ? selector : `${selector}/${BEST_FORMAT_FALLBACK}`

export const resolveVideoFormatSelector = (options: YtDlpDownloadOptions): string => {
  const format = options.format
  const audioFormat = options.audioFormat
  const audioFormatIds = (options.audioFormatIds ?? []).filter((id) => id.trim() !== '')

  if (format && audioFormat === '') { return format }
  if (format && (format.includes('/') || format.includes('+') || format.includes('['))) { return format }
  if (audioFormatIds.length > 0) {
    const baseVideo = format && format !== 'best' ? format : 'bestvideo*'
    return `${baseVideo}+${audioFormatIds.join('+')}`
  }
  if (!format || format === 'best') {
    if (audioFormat === 'none') { return 'bestvideo+none' }
    if (!audioFormat || audioFormat === 'best') { return 'bestvideo+bestaudio/best' }
    return withBestFallback(`bestvideo+${audioFormat}`)
  }
  if (audioFormat === 'none') { return `${format}+none` }
  if (!audioFormat || audioFormat === 'best') { return `${format}+bestaudio/best` }
  return withBestFallback(`${format}+${audioFormat}`)
}

export const resolveAudioFormatSelector = (options: YtDlpDownloadOptions): string => {
  const format = options.format
  if (!format) { return 'bestaudio' }
  if (format.includes('/') || format.includes('+') || format.includes('[')) { return format }
  return format
}

export const buildDownloadArgs = (
  options: YtDlpDownloadOptions,
  fallbackDownloadPath: string,
  settings: YtDlpDownloadSettings,
  jsRuntimeArgs: string[] = []
): string[] => {
  const args: string[] = ['--no-playlist', '--no-mtime', '--encoding', 'utf-8']

  if (options.type === 'video') {
    const formatSelector = resolveVideoFormatSelector(options)
    if (formatSelector) { args.push('-f', formatSelector) }
    if ((options.audioFormatIds?.length ?? 0) > 0 || formatSelector.includes('mergeall')) {
      args.push('--audio-multistreams')
    }
    const container = options.containerFormat ?? 'auto'
    if (container === 'auto') {
      args.push('--merge-output-format', 'mp4/mkv')
    } else if (container !== 'original') {
      args.push('--merge-output-format', container)
      args.push('--remux-video', container)
    }
  } else if (options.type === 'audio') {
    args.push('-f', resolveAudioFormatSelector(options))
  }

  if (options.startTime || options.endTime) {
    const start = options.startTime || '0'
    const end = options.endTime || ''
    args.push('--download-sections', `*${start}-${end}`)
  }

  const embedSubs = settings.embedSubs ?? true
  const embedThumbnail = settings.embedThumbnail ?? false
  const embedMetadata = settings.embedMetadata ?? true
  const embedChapters = settings.embedChapters ?? true
  const browserForCookies = normalizeBrowserCookiesSettingForYtDlp(settings.browserForCookies)
  const cookiesPath = trim(settings.cookiesPath)
  const hasSubtitleAuth =
    (browserForCookies && browserForCookies !== 'none') || Boolean(cookiesPath)
  const shouldAttemptSubtitles =
    (!isBilibiliUrl(options.url) && !isTwitchUrl(options.url)) || hasSubtitleAuth

  if (shouldAttemptSubtitles) {
    if (embedSubs) { args.push('--sub-langs', 'all') }
    else { args.push('--write-subs') }
    args.push(embedSubs ? '--embed-subs' : '--no-embed-subs')
  } else {
    args.push('--no-embed-subs')
  }

  args.push(embedThumbnail ? '--embed-thumbnail' : '--no-embed-thumbnail')
  args.push(embedMetadata ? '--embed-metadata' : '--no-embed-metadata')
  args.push(embedChapters ? '--embed-chapters' : '--no-embed-chapters')

  const baseDownloadPath =
    trim(options.customDownloadPath) || trim(settings.downloadPath) || fallbackDownloadPath
  const filenameTemplate = sanitizeFilenameTemplate(
    options.customFilenameTemplate ?? DEFAULT_FILENAME_TEMPLATE
  )
  const safeTemplate = filenameTemplate.replace(/^[\\/]+/, '')
  args.push('-o', path.join(baseDownloadPath, safeTemplate))
  args.push('--continue')
  args.push('--no-playlist-reverse')

  appendPlatformFilenameSafetyArgs(args)
  appendNetworkResilienceArgs(args)

  if (browserForCookies && browserForCookies !== 'none') {
    args.push('--cookies-from-browser', browserForCookies)
  }
  if (cookiesPath) { args.push('--cookies', cookiesPath) }

  const proxy = trim(settings.proxy)
  if (proxy) { args.push('--proxy', proxy) }

  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  } else {
    appendYouTubeSafeExtractorArgs(args, options.url)
  }

  if (jsRuntimeArgs.length > 0) { args.push(...jsRuntimeArgs) }
  args.push(options.url)
  return args
}

export const buildVideoInfoArgs = (
  url: string,
  settings: YtDlpDownloadSettings,
  jsRuntimeArgs: string[] = []
): string[] => {
  const args = ['-j', '--no-playlist', '--no-warnings', '--encoding', 'utf-8']
  const proxy = trim(settings.proxy)
  if (proxy) { args.push('--proxy', proxy) }
  args.push('--socket-timeout', DEFAULT_SOCKET_TIMEOUT)
  const browserForCookies = normalizeBrowserCookiesSettingForYtDlp(settings.browserForCookies)
  if (browserForCookies && browserForCookies !== 'none') {
    args.push('--cookies-from-browser', browserForCookies)
  }
  const cookiesPath = trim(settings.cookiesPath)
  if (cookiesPath) { args.push('--cookies', cookiesPath) }
  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  } else {
    appendYouTubeSafeExtractorArgs(args, url)
  }
  if (jsRuntimeArgs.length > 0) { args.push(...jsRuntimeArgs) }
  args.push(url)
  return args
}

export const buildPlaylistInfoArgs = (
  url: string,
  settings: YtDlpDownloadSettings,
  jsRuntimeArgs: string[] = []
): string[] => {
  const args = ['-J', '--flat-playlist', '--ignore-errors', '--no-warnings', '--encoding', 'utf-8']
  const proxy = trim(settings.proxy)
  if (proxy) { args.push('--proxy', proxy) }
  args.push('--socket-timeout', DEFAULT_SOCKET_TIMEOUT)
  const browserForCookies = normalizeBrowserCookiesSettingForYtDlp(settings.browserForCookies)
  if (browserForCookies && browserForCookies !== 'none') {
    args.push('--cookies-from-browser', browserForCookies)
  }
  const cookiesPath = trim(settings.cookiesPath)
  if (cookiesPath) { args.push('--cookies', cookiesPath) }
  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  } else {
    appendYouTubeSafeExtractorArgs(args, url)
  }
  if (jsRuntimeArgs.length > 0) { args.push(...jsRuntimeArgs) }
  args.push(url)
  return args
}
```

### format-preferences.ts（完整，92 行）

```typescript
export type OneClickQualityPreset = 'best' | 'good' | 'normal' | 'bad' | 'worst'
export type OneClickContainerOption = 'auto' | 'mp4' | 'mkv' | 'webm' | 'original'

const qualityPresetToVideoHeight: Record<OneClickQualityPreset, number | null> = {
  best: null, good: 1080, normal: 720, bad: 480, worst: 360
}

const qualityPresetToAudioAbr: Record<OneClickQualityPreset, number | null> = {
  best: 320, good: 256, normal: 192, bad: 128, worst: 96
}

const dedupe = (candidates: Array<string | undefined>): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    result.push(candidate)
  }
  return result
}

export const buildVideoFormatPreference = (settings: OneClickFormatSettings): string => {
  const preset = getQualityPreset(settings)
  if (preset === 'worst') { return 'worstvideo+worstaudio/worst/best' }
  const maxHeight = qualityPresetToVideoHeight[preset]
  const videoCandidates = dedupe([
    maxHeight ? `bestvideo[height<=${maxHeight}]` : undefined,
    'bestvideo'
  ])
  const audioSelectors = buildAudioSelectors(preset)
  const combinations: string[] = []
  for (const video of videoCandidates) {
    for (const audio of audioSelectors) {
      combinations.push(`${video}+${audio}`)
    }
  }
  combinations.push('bestvideo+bestaudio')
  combinations.push('best')
  return dedupe(combinations).join('/')
}

export const buildAudioFormatPreference = (settings: OneClickFormatSettings): string => {
  const selectors = buildAudioSelectors(getQualityPreset(settings))
  return dedupe([...selectors, 'best']).join('/')
}

// buildAudioSelectors (内部)
const buildAudioSelectors = (preset: OneClickQualityPreset): string[] => {
  if (preset === 'worst') { return dedupe(['worstaudio', 'bestaudio']) }
  const abrLimit = qualityPresetToAudioAbr[preset]
  return dedupe([abrLimit ? `bestaudio[abr<=${abrLimit}]` : undefined, 'bestaudio'])
}
```

### yt-dlp-executor.ts 关键函数（摘录）

#### 进度解析 (mapProgress)

```typescript
function mapProgress(payload: ProgressPayload): TaskProgress {
  const percent = typeof payload.percent === 'number' && !Number.isNaN(payload.percent)
    ? Math.max(0, Math.min(1, payload.percent / 100))
    : null
  return {
    percent,
    bytesDownloaded: parseSize(payload.downloaded),
    bytesTotal: parseSize(payload.total),
    speedBps: parseSpeed(payload.currentSpeed),
    etaMs: parseEtaMs(payload.eta),
    ticks: 0
  }
}

function parseSize(value: string | undefined): number | null {
  if (!value) return null
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)/i.exec(value)
  if (!m) return null
  const n = Number.parseFloat(m[1] ?? '')
  if (!Number.isFinite(n)) return null
  const unit = (m[2] ?? 'B').toLowerCase()
  const factor = unit === 'kb' || unit === 'kib' ? 1024
    : unit === 'mb' || unit === 'mib' ? 1024 ** 2
    : unit === 'gb' || unit === 'gib' ? 1024 ** 3
    : unit === 'tb' || unit === 'tib' ? 1024 ** 4
    : 1
  return Math.round(n * factor)
}

function parseSpeed(value: string | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/\/s$/i, '').trim()
  return parseSize(cleaned)
}

function parseEtaMs(value: string | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'Unknown') return null
  const parts = trimmed.split(':').map((p) => Number.parseInt(p, 10))
  if (parts.some((n) => !Number.isFinite(n))) return null
  let seconds = 0
  for (const p of parts) seconds = seconds * 60 + p
  return seconds * 1000
}
```

#### 后处理检测

```typescript
const PROCESSING_DETECT_PATTERNS = [
  /\bMerging formats?\b/i,
  /^\[Postprocess\]/m,
  /\b(?:Embedding|Adding|Fixing|Converting)\b/i,
  /\b(?:ExtractAudio|VideoConvertor|FFmpeg)\b/i
]

function hasPostprocessSignal(text: string): boolean {
  return PROCESSING_DETECT_PATTERNS.some((re) => re.test(text))
}
```

#### 输出文件路径提取

```typescript
function extractSavedFilePath(rawLog: string): string | undefined {
  const log = rawLog.trim()
  if (!log) return undefined
  const patterns = [
    /Merging formats into "([^"]+)"/g,
    /Destination:\s+"([^"]+)"/g,
    /Destination:\s+'([^']+)'/g,
    /\[download\]\s+([^\r\n]+?)\s+has already been downloaded/g
  ]
  for (const re of patterns) {
    const matches = Array.from(log.matchAll(re))
    const last = matches.at(-1)
    const candidate = last?.[1]?.trim()
    if (candidate) return candidate
  }
  const lines = log.split(/\r?\n/).reverse()
  for (const line of lines) {
    const idx = line.indexOf('Destination:')
    if (idx >= 0) {
      const candidate = line.slice(idx + 'Destination:'.length).trim()
      if (candidate) return candidate
    }
  }
  return undefined
}
```

#### 错误分类

```typescript
function classifyYtDlpExit(exitCode: number | null, stderr: string): ClassifiedError {
  const txt = stderr.toLowerCase()
  if (/(http error 429|too many requests|rate.?limit)/.test(txt))
    return virtualError('http-429', stderr || `yt-dlp exited ${exitCode}`)
  if (/(login required|requires (?:cookies|authentication)|sign in to confirm)/.test(txt))
    return virtualError('auth-required', stderr || `yt-dlp exited ${exitCode}`)
  if (/(not available in your country|geo.?restricted|geographic)/.test(txt))
    return virtualError('geo-blocked', stderr || `yt-dlp exited ${exitCode}`)
  if (/(video unavailable|not found|404)/.test(txt))
    return virtualError('not-found', stderr || `yt-dlp exited ${exitCode}`)
  if (/(no space left|disk full|enospc)/.test(txt))
    return virtualError('disk-full', stderr || `yt-dlp exited ${exitCode}`)
  if (/(permission denied|eacces)/.test(txt))
    return virtualError('permission-denied', stderr || `yt-dlp exited ${exitCode}`)
  if (/(ffmpeg|ffprobe)/.test(txt))
    return virtualError('ffmpeg', stderr || `yt-dlp exited ${exitCode}`)
  if (/(network|timeout|econnreset|enotfound|ehostunreach)/.test(txt))
    return virtualError('network-transient', stderr || `yt-dlp exited ${exitCode}`)
  return virtualError('unknown', stderr || `yt-dlp exited with code ${exitCode ?? -1}`)
}
```

#### 进程取消（killProcessTree）

```typescript
// VidBee 使用 killProcessTree 杀整棵进程树（yt-dlp + ffmpeg 子进程）
// Windows: taskkill /PID x /T /F
// Unix: process.kill(pid, signal)
```

### browser-cookies-setting.ts（完整）

```typescript
export const parseBrowserCookiesSetting = (value: string): { browser: string; profile?: string } => {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'none') { return { browser: 'none' } }

  const colonIdx = trimmed.indexOf(':')
  if (colonIdx === -1) { return { browser: trimmed } }

  const browser = trimmed.slice(0, colonIdx).trim()
  const profile = trimmed.slice(colonIdx + 1).trim()
  if (!browser || !profile) { return { browser: browser || 'none' } }
  return { browser, profile }
}

export const buildBrowserCookiesSetting = (browser: string, profile?: string): string => {
  if (!browser || browser === 'none') { return 'none' }
  if (!profile) { return browser }
  return `${browser}:${profile}`
}
```

---

## 验证计划

### 编译验证

```bash
# 在 Z:\Playground\tinyrouter 目录下
go build -o tinyrouter-test .  # 编译
go vet ./...                    # 静态检查
go test ./internal/download/... # 单元测试
```

### 功能验证

1. **启动程序**：
   ```bash
   ./tinyrouter-test -config test-config.yaml
   ```

2. **验证 yt-dlp/ffmpeg 可被发现**：
   - 确保 `yt-dlp` 和 `ffmpeg` 在 PATH 中，或设置 `YTDLP_PATH` / `FFMPEG_PATH` 环境变量
   - 检查 console 日志是否有 "download manager started"

3. **验证视频信息解析**：
   - 打开浏览器访问 `http://127.0.0.1:20128`
   - 导航到 Download 页面
   - 粘贴一个 YouTube/TikTok/Bilibili URL
   - 点击 Parse 按钮
   - 验证返回视频标题、缩略图、时长等信息

4. **验证单视频下载**：
   - 粘贴 URL → 点击 Download
   - 验证进度条实时更新（百分比、速度、ETA）
   - 验证 `--concurrent-fragments` 参数被传递（检查日志中的 yt-dlp 命令）
   - 验证下载完成后文件存在于指定目录

5. **验证播放列表下载**：
   - 粘贴播放列表 URL → 点击 Parse
   - 验证显示 "检测到播放列表: N 个视频"
   - 点击 Download All
   - 验证每个视频按顺序下载

6. **验证多任务队列**：
   - 同时粘贴 3+ 个 URL 并点击 Download
   - 验证同时下载的任务数不超过 `maxConcurrent`（默认 3）

7. **验证取消功能**：
   - 在下载中点击 Cancel 按钮
   - 验证 yt-dlp 进程被终止
   - 验证任务状态变为 cancelled

8. **验证 SSE 推送**：
   - 在下载过程中刷新页面
   - 验证已存在的任务状态被恢复
   - 验证进度持续更新

### 单元测试要点

为 `internal/download/` 包编写以下测试：

| 测试 | 验证内容 |
|---|---|
| `TestBuildDownloadArgs` | 参数构建正确性（格式选择器、容器、cookies、代理等） |
| `TestResolveVideoFormatSelector` | 各质量预设的格式选择器 |
| `TestResolveAudioFormatSelector` | 各质量预设的音频选择器 |
| `TestParseProgressLine` | 进度行解析（各种格式） |
| `TestExtractSavedFilePath` | 输出文件路径提取 |
| `TestClassifyExitError` | 错误分类 |
| `TestIsYouTubeURL` | YouTube URL 判断 |
| `TestIsBilibiliURL` | Bilibili URL 判断 |

---

## 风险与注意事项

### 1. yt-dlp 进度行格式变化

yt-dlp 的 `[download]` 进度行格式可能随版本变化。正则需要容错处理。
建议添加 `--newline` 参数确保进度行换行输出。

### 2. Windows 进程树 kill

在 Windows 上取消下载时，只 kill yt-dlp 主进程不够，ffmpeg 子进程可能残留。
必须使用 `taskkill /PID <pid> /T /F` 杀整棵进程树。

Go 1.20+ 的 `exec.CommandContext` 默认在 context 取消时发 `os.Kill` (Windows) 或 `SIGKILL` (Unix)。
但不会杀子进程。需要手动实现进程树 kill。

### 3. yt-dlp -j 输出解析

yt-dlp `-j` 输出的 JSON 结构非常复杂（formats 数组可能有几十个元素）。
Go 端只需要提取关键字段（title, thumbnail, duration, uploader, extractor_key, webpage_url）。
用 `map[string]json.RawMessage` 解析后逐字段提取，避免定义完整 struct。

### 4. 播放列表 URL 判断

yt-dlp 的 `--no-playlist` 参数用于单视频下载时避免误下载整个播放列表。
但播放列表下载时需要去掉 `--no-playlist`，改用 `--yes-playlist`。

在 `BuildDownloadArgs` 中，应该根据任务是否为播放列表子任务来决定是否添加 `--no-playlist`。
可以为 `BuildDownloadArgs` 添加一个 `isPlaylistItem bool` 参数，或者在 `RuntimeSettings` 中标记。

### 5. 并发安全

- `Manager` 的 `tasks` map 和 `order` slice 必须用 `sync.RWMutex` 保护
- `eventSubs` map 修改时也需要加锁
- `pendingCh` 是 channel，天然线程安全
- `progressCh` 用缓冲 channel + `select default` 避免阻塞

### 6. 环境变量优先级

yt-dlp 和 ffmpeg 路径解析顺序：
1. 配置文件 `config.yaml` 中的 `download.ytDlpPath` / `download.ffmpegPath`
2. 环境变量 `YTDLP_PATH` / `FFMPEG_PATH`
3. PATH 中的 `yt-dlp` / `ffmpeg`（`exec.LookPath`）
4. 都失败则返回错误

### 7. 下载目录默认值

如果配置中未指定 `downloadDir`，默认使用用户主目录下的 `Downloads` 文件夹：
```go
home, _ := os.UserHomeDir()
defaultDir = filepath.Join(home, "Downloads")
```

### 8. SSE 连接管理

- 前端 `EventSource` 会在断开后自动重连
- 后端需要在 `ctx.Done()`（客户端断开）时清理订阅
- 30 秒 keepalive 防止代理超时

### 9. 大文件 statSync

下载完成后需要 `os.Stat` 验证文件存在且 `size > 0`。
如果 yt-dlp 正在做 ffmpeg 后处理，文件可能在写入中。
应该在 yt-dlp 进程退出后再 stat。

### 10. 不引入新的 Go 外部依赖

严格遵守 TinyRouter AGENTS.md 约定，不引入任何新的 Go 第三方库。
所有功能用标准库实现。

---

## 附录：文件路径汇总

| 文件 | 路径 | 操作 |
|---|---|---|
| types.go | `Z:\Playground\tinyrouter\internal\download\types.go` | 新增 |
| args.go | `Z:\Playground\tinyrouter\internal\download\args.go` | 新增 |
| executor.go | `Z:\Playground\tinyrouter\internal\download\executor.go` | 新增 |
| manager.go | `Z:\Playground\tinyrouter\internal\download\manager.go` | 新增 |
| download.go | `Z:\Playground\tinyrouter\internal\api\download.go` | 新增 |
| router.go | `Z:\Playground\tinyrouter\internal\api\router.go` | 修改 |
| config.go | `Z:\Playground\tinyrouter\internal\config\config.go` | 修改 |
| main.go | `Z:\Playground\tinyrouter\main.go` | 修改 |
| download.js | `Z:\Playground\tinyrouter\web\static\download.js` | 新增 |
| index.html | `Z:\Playground\tinyrouter\web\static\index.html` | 修改 |
| app.js | `Z:\Playground\tinyrouter\web\static\app.js` | 修改 |
| i18n.js | `Z:\Playground\tinyrouter\web\static\i18n.js` | 修改 |
| style.css | `Z:\Playground\tinyrouter\web\static\style.css` | 修改（追加） |

### VidBee 参考文件路径

| 文件 | 路径 |
|---|---|
| yt-dlp-args.ts | `Z:\Playground\VidBee\packages\downloader-core\src\yt-dlp-args.ts` |
| yt-dlp-executor.ts | `Z:\Playground\VidBee\packages\downloader-core\src\yt-dlp-executor.ts` |
| format-preferences.ts | `Z:\Playground\VidBee\packages\downloader-core\src\format-preferences.ts` |
| browser-cookies-setting.ts | `Z:\Playground\VidBee\packages\downloader-core\src\browser-cookies-setting.ts` |
| types.ts | `Z:\Playground\VidBee\packages\downloader-core\src\types.ts` |
| download-file.ts | `Z:\Playground\VidBee\packages\downloader-core\src\download-file.ts` |

### TinyRouter 参考文件路径

| 文件 | 路径 | 参考内容 |
|---|---|---|
| router.go | `Z:\Playground\tinyrouter\internal\api\router.go` | 路由注册范式 |
| monitor_terminal.go | `Z:\Playground\tinyrouter\internal\api\monitor_terminal.go` | SSE 推送参考 |
| handlers.go | `Z:\Playground\tinyrouter\internal\api\handlers.go` | writeAPIError 工具 |
| config.go | `Z:\Playground\tinyrouter\internal\config\config.go` | 配置结构 + DefaultConfig + finalizeConfig |
| logger.go | `Z:\Playground\tinyrouter\internal\console\logger.go` | 日志接口 |
| main.go | `Z:\Playground\tinyrouter\main.go` | 组件组装范式 |
| app.js | `Z:\Playground\tinyrouter\web\static\app.js` | navigateTo 导航 |
| api.js | `Z:\Playground\tinyrouter\web\static\api.js` | apiGet/apiPost 封装 |
| i18n.js | `Z:\Playground\tinyrouter\web\static\i18n.js` | 国际化字典 |
| index.html | `Z:\Playground\tinyrouter\web\static\index.html` | 导航按钮 + script 引用 |
| AGENTS.md | `Z:\Playground\tinyrouter\AGENTS.md` | 代码规范 |
| go.mod | `Z:\Playground\tinyrouter\go.mod` | 模块路径 + Go 版本 |
```

模块路径：`github.com/tinyrouter/tinyrouter`
Go 版本：1.25.0
```
