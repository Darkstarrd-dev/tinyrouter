# TinyRouter 实施方案

> 从 [9router](https://github.com/sst9/9router) 中抽取核心代理 + 多 Key 轮询 + Combo + 内存 Usage 功能，用 Go 重写为单二进制轻量化应用。

---

## 1. 需求边界

### 1.1 保留功能

| 功能 | 说明 |
|---|---|
| **控制台日志** | 保留 9router 的 console 输出格式与内容，UI 中可实时查看 |
| **纯本地** | 无 admin 鉴权、无远程访问、无多人场景 |
| **Endpoint 端口设置** | UI 可配置监听端口；无需 API Key，任意 Key 或无 Key 均可访问 |
| **Providers** | 保留自定义端点 (OpenAI-compatible)、API Key 提供商、免费套餐提供商；**去除 OAuth Providers** |
| **Combos** | 保留两种策略：fallback / round-robin |
| **Usage** | 保留用量统计，**仅内存存储**，重启清零；环形缓冲默认 500 条，UI 可配置 |
| **Console Log UI** | 实时控制台日志查看页面 |

### 1.2 去除功能

| 功能 | 对应 9router 模块 |
|---|---|
| Quota Tracker | `/dashboard/quota`, `ProviderLimits` |
| Token Saver | RTK 压缩、Headroom、Caveman、Ponytail (全部) |
| CLI Tools | `/dashboard/cli-tools`, 16 个 CLI 工具配置 |
| SYSTEM 全部 | Media Providers、Proxy Pools、Skills、Translator、Settings(鉴权部分)、Remote、Tunnel、Tailscale、MITM、MCP、OAuth |
| 数据库持久化 | SQLite (sql.js / better-sqlite3)、usageHistory、usageDaily、requestDetails |
| 格式互转 | OpenAI↔Anthropic↔GLM translator（仅保留 OpenAI 兼容透传）|
| Dashboard 鉴权 | JWT、密码、OIDC、machineId CLI token |
| Cloudflare Tunnel / Tailscale | 远程访问相关全部去除 |

---

## 2. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 语言 | Go 1.23+ | HTTP/SSE 生态成熟，内存 10–25MB，单二进制部署 |
| HTTP 路由 | `net/http` + `chi` | 轻量路由，中间件支持 |
| SSE 流式 | `http.Flusher` + `io.Copy` 逐 chunk flush | OpenAI SSE 透传标准模式 |
| 配置持久化 | `gopkg.in/yaml.v3` → `config.yaml` | 人可读，UI 改完写回 |
| 配置热重载 | `fsnotify` 监听 + 手动 Save 触发 | 双通道保证一致性 |
| UI | 内嵌 HTML + vanilla JS (`embed.FS`) | 无 React/Next，~80KB 静态文件 |
| 统计 | 切片环形缓冲 | 固定内存 O(1) 写入 |
| 日志 | `log/slog` (Go stdlib) + 自定义 handler | 结构化日志，同时输出到 console 和 UI SSE |

### 依赖清单（最小化）

```
github.com/go-chi/chi/v5       # HTTP 路由
gopkg.in/yaml.v3               # YAML 配置
github.com/fsnotify/fsnotify   # 配置热重载（可选）
```

无 ORM、无数据库驱动、无前端框架。

---

## 3. 架构设计

### 3.1 总览

```
┌──────────────────────────────────────────────────────────┐
│  TinyRouter 单二进制 (~15MB)                              │
│                                                          │
│  ┌─────────┐   ┌────────────────────────────────────┐   │
│  │ HTTP    │──▶│ /v1/*         → ProxyHandler        │   │
│  │ Server  │   │ /api/*        → AdminAPI (CRUD)     │   │
│  │ (chi)   │   │ /console-logs → SSE console stream  │   │
│  │         │   │ /             → Embedded UI (HTML)  │   │
│  └─────────┘   └────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ProviderRegistry (内存 + config.yaml 持久化)       │   │
│  │  └─ providers[]: {id, name, prefix, baseUrl,      │   │
│  │     apiType, isActive, keys[]}                    │   │
│  │     └─ keys[]: {id, key, name, priority, isActive,│   │
│  │          status, backoffLevel, modelLocks{},      │   │
│  │          lastUsedAt, consecCount}                 │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ComboRegistry (内存 + config.yaml)                 │   │
│  │  └─ combos[]: {id, name, strategy, models[]}      │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ UsageRingBuffer (内存, 默认500条)                   │   │
│  │  └─ {ts, provider, model, keyId, status,          │   │
│  │      latencyMs, inputTokens, outputTokens}        │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ConsoleLogBuffer (内存, 默认200行)                  │   │
│  │  └─ captures slog output → SSE stream to UI       │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
        │
        ▼
   config.yaml (持久化 providers + combos + settings)
```

### 3.2 请求生命周期

```
CLIENT (Claude Code, Cursor, etc.)
  │
  │  POST http://localhost:{port}/v1/chat/completions
  │  Body: {"model": "deepseek/deepseek-chat", "messages": [...], "stream": true}
  │
  ▼
ProxyHandler
  │
  ├─ 1. 解析 model 字段 → "{prefix}/{model}" 或 combo 名
  │
  ├─ 2a. 若匹配 combo → ComboResolver.resolve(model)
  │     → 按 strategy (fallback/round-robin) 选出 target provider+model
  │
  ├─ 2b. 若匹配 provider prefix → 直接使用
  │
  ├─ 3. KeySelector.Select(provider)
  │     → fill-first: 按 priority 排序取第一个可用 key
  │     → round-robin: 粘性轮询 (stickyLimit=3), 超限后取最久未用
  │     → 排除: 被排除的 key (重试时)、modelLock 过期前、backoff 中的
  │
  ├─ 4. 构造上游请求
  │     → URL: {provider.baseUrl}/v1/chat/completions
  │     → Headers: Authorization: Bearer {key}, Content-Type: application/json
  │     → Body: 原样透传 (仅替换 model 字段为上游实际 model 名)
  │
  ├─ 5. 发送请求 → 获取上游 Response
  │
  ├─ 6a. 流式 (stream=true):
  │     → 设置 SSE headers (Content-Type: text/event-stream, Cache-Control: no-cache)
  │     → 逐 chunk 读取上游 response body → 写入 client response → Flush
  │     → 检测 data: [DONE] 终止
  │
  ├─ 6b. 非流式 (stream=false):
  │     → 读取完整 response body → 原样写入 client
  │
  ├─ 7. Console 日志输出 (与 9router 格式一致):
  │     → [time] REQUEST {PROVIDER} | {model} | {n} msgs
  │     → [time] PROXY {PROVIDER} | {model} | conn={keyName} | url={masked}
  │     → [time] 📊 [{label}] {PROVIDER} | in={n} | out={n} | conn={keyName}
  │     → [time] 🌊 [STREAM] {p} | {model} | {duration}ms | {status}
  │     → [ERROR] {msg} (失败时)
  │
  ├─ 8. Usage 记录:
  │     → 写入 RingBuffer: {ts, provider, model, keyId, status, latencyMs, ...}
  │
  └─ 9. 错误处理:
        → 429 + 日配额: 锁定该 key 该 model 至次日 CST 00:05
        → 429 临时: 同 key 重试最多 5 次 (间隔 5s)
        → 其他错误: markKeyUnavailable (指数退避) → 排除 → 重试下一个 key
        → 全部 key 耗尽: 返回 502 错误
```

---

## 4. 数据模型

### 4.1 config.yaml 结构

```yaml
# TinyRouter 配置文件
port: 20128                    # 监听端口 (UI 可修改)
consoleLogMaxLines: 200        # 控制台日志缓冲行数
usageRingSize: 500             # Usage 环形缓冲条数

rotation:
  strategy: "fill-first"       # fill-first | round-robin
  stickyLimit: 3               # round-robin 粘性连续使用次数
  maxRetries: 5                # 单 key 429 临时错误重试次数
  retryDelaySec: 5             # 重试间隔 (秒)
  backoffMaxSec: 240           # 指数退避上限 (秒)，4min

providers:
  - id: "deepseek"
    name: "DeepSeek"
    prefix: "deepseek"
    baseUrl: "https://api.deepseek.com"
    apiType: "openai-compatible"
    isActive: true
    keys:
      - id: "k1"
        key: "sk-xxxxxxxx"
        name: "Main"
        priority: 1
        isActive: true

  - id: "my-custom"
    name: "My Custom Endpoint"
    prefix: "my-custom"
    baseUrl: "https://api.example.com"
    apiType: "openai-compatible"
    isActive: true
    keys:
      - id: "k1"
        key: "sk-yyyyyyyy"
        name: "Key A"
        priority: 1
        isActive: true
      - id: "k2"
        key: "sk-zzzzzzzz"
        name: "Key B"
        priority: 2
        isActive: true

combos:
  - id: "combo1"
    name: "Fast + Smart"
    strategy: "fallback"       # fallback | round-robin
    models:
      - "deepseek/deepseek-chat"
      - "my-custom/gpt-4o"
```

### 4.2 内存数据结构 (Go)

```go
// Provider — 对应 config.yaml 中的一个 provider
type Provider struct {
    ID       string    `yaml:"id"`
    Name     string    `yaml:"name"`
    Prefix   string    `yaml:"prefix"`
    BaseURL  string    `yaml:"baseUrl"`
    APIType  string    `yaml:"apiType"` // 固定 "openai-compatible"
    IsActive bool      `yaml:"isActive"`
    Keys     []Key     `yaml:"keys"`
}

// Key — provider 下的一个 API Key
type Key struct {
    ID       string `yaml:"id"`
    Key      string `yaml:"key"`
    Name     string `yaml:"name"`
    Priority int    `yaml:"priority"`
    IsActive bool   `yaml:"isActive"`

    // 运行时状态 (不持久化到 YAML)
    Status          string            `yaml:"-"` // "active" | "cooldown" | "locked"
    BackoffLevel    int               `yaml:"-"`
    ModelLocks      map[string]time.Time `yaml:"-"` // model → unlock time
    LastUsedAt      time.Time         `yaml:"-"`
    ConsecCount     int               `yaml:"-"`
    LastError       string            `yaml:"-"`
    LastErrorAt     time.Time         `yaml:"-"`
}

// Combo — 模型组合
type Combo struct {
    ID           string   `yaml:"id"`
    Name         string   `yaml:"name"`
    Strategy     string   `yaml:"strategy"` // fallback | round-robin
    Models       []string `yaml:"models"`   // ["deepseek/deepseek-chat", ...]
}

// UsageEntry — 单次请求用量记录
type UsageEntry struct {
    Timestamp    time.Time `json:"timestamp"`
    Provider     string    `json:"provider"`
    Model        string    `json:"model"`
    KeyID        string    `json:"keyId"`
    KeyName      string    `json:"keyName"`
    Status       string    `json:"status"` // "success" | "error" | "retry"
    LatencyMs    int64     `json:"latencyMs"`
    InputTokens  int       `json:"inputTokens"`
    OutputTokens int       `json:"outputTokens"`
    Error        string    `json:"error,omitempty"`
}

// Settings — 全局设置
type Settings struct {
    Port               int    `yaml:"port"`
    ConsoleLogMaxLines int    `yaml:"consoleLogMaxLines"`
    UsageRingSize      int    `yaml:"usageRingSize"`
    Rotation           RotationConfig `yaml:"rotation"`
}
```

---

## 5. 模块设计

### 5.1 `internal/config` — 配置管理

**职责：** 加载/保存 `config.yaml`，提供线程安全的读写访问。

```go
type Manager struct {
    mu       sync.RWMutex
    config   *Config
    path     string
    onChange func(*Config) // 回调通知
}

func New(path string) (*Manager, error)        // 加载或创建默认配置
func (m *Manager) Get() *Config                // 读取快照 (RLock)
func (m *Manager) Update(fn func(*Config)) error // 修改并保存 (Lock + Write)
func (m *Manager) Save() error                 // 写入 YAML 文件
func (m *Manager) Reload() error               // 重新从文件加载
```

**关键决策：**
- `Update()` 接受一个 mutator 函数，在锁内修改 config，然后原子性写回文件
- 文件写入用临时文件 + rename 保证原子性
- 不使用 fsnotify 热重载（UI 修改直接调 `Update()`，外部编辑 YAML 可手动触发 `/api/reload`）

### 5.2 `internal/registry` — Provider/Key/Combo 注册表

**职责：** 管理运行时 provider/key 状态，提供查询和修改接口。

```go
type Registry struct {
    mu       sync.RWMutex
    config   *config.Manager
}

// Provider 操作
func (r *Registry) ListProviders() []Provider
func (r *Registry) GetProvider(id string) (*Provider, bool)
func (r *Registry) AddProvider(p Provider) error
func (r *Registry) UpdateProvider(id string, updates Provider) error
func (r *Registry) DeleteProvider(id string) error

// Key 操作
func (r *Registry) ListKeys(providerID string) []Key
func (r *Registry) AddKey(providerID string, k Key) error
func (r *Registry) UpdateKey(providerID, keyID string, updates Key) error
func (r *Registry) DeleteKey(providerID, keyID string) error

// Combo 操作
func (r *Registry) ListCombos() []Combo
func (r *Registry) AddCombo(c Combo) error
func (r *Registry) UpdateCombo(id string, updates Combo) error
func (r *Registry) DeleteCombo(id string) error

// 运行时状态操作
func (r *Registry) GetKeyRuntimeState(providerID, keyID string) *KeyRuntimeState
func (r *Registry) SetKeyCooldown(providerID, keyID, model string, until time.Time)
func (r *Registry) ClearKeyCooldown(providerID, keyID, model string)
func (r *Registry) UpdateKeyUsage(providerID, keyID string, lastUsed time.Time, consecCount int)
```

### 5.3 `internal/rotation` — Key 选择与冷却

**职责：** 根据 provider 从可用 keys 中选择一个，处理冷却/退避/锁定。

```go
type Selector struct {
    registry *registry.Registry
    settings *config.Manager
}

// SelectKey 选择一个可用的 key
// excludeKeyIDs: 重试时排除已失败的 key
// model: 用于 per-model lock 检查
func (s *Selector) SelectKey(providerID, model string, excludeKeyIDs []string) (*Key, error)

// MarkUnavailable 标记 key 不可用，计算冷却时间
func (s *Selector) MarkUnavailable(providerID, keyID, model string, err error) time.Time

// ClearError 清除 key 错误状态 (成功时调用)
func (s *Selector) ClearError(providerID, keyID, model string)
```

**选择策略实现：**

```go
// fill-first: 按 priority ASC 排序，取第一个未排除/未冷却的 key
func (s *Selector) selectFillFirst(keys []Key, exclude []string, model string) (*Key, error)

// round-robin: 粘性轮询
//   1. 找到 lastUsedAt 最新的 key (当前粘性 key)
//   2. 若 consecCount < stickyLimit 且该 key 仍可用 → 复用, consecCount++
//   3. 否则 → 取 lastUsedAt 最旧的可用 key, consecCount = 1
//   4. 更新 lastUsedAt = now
func (s *Selector) selectRoundRobin(keys []Key, exclude []string, model string) (*Key, error)
```

**冷却计算 (移植自 9router `auth.js`)：**

```go
func (s *Selector) calculateCooldown(key *Key, model string, err error) time.Time {
    // 1. 429 + 日配额模式 → 锁定至次日 CST 00:05
    if is429DailyQuota(err) {
        return nextCSTMidnight05()
    }

    // 2. 429 + 精确 resets_at (部分 provider 返回)
    if resetsAt := extractResetsAt(err); resetsAt != nil {
        return *resetsAt
    }

    // 3. 指数退避: level 1=1s, 2=2s, 3=4s, ..., max=240s
    key.BackoffLevel++
    backoff := time.Duration(math.Pow(2, float64(key.BackoffLevel-1))) * time.Second
    if backoff > maxBackoff {
        backoff = maxBackoff
    }
    return time.Now().Add(backoff)
}

// 次日 CST 00:05
func nextCSTMidnight05() time.Time {
    loc, _ := time.LoadLocation("Asia/Shanghai")
    now := time.Now().In(loc)
    next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 5, 0, 0, loc)
    return next
}
```

### 5.4 `internal/combo` — Combo 解析

**职责：** 根据 combo 名称和策略选择目标 provider+model。

```go
type Resolver struct {
    registry *registry.Registry
    state    map[string]*comboState // comboID → rotation state
    mu       sync.Mutex
}

type comboState struct {
    index         int  // 当前模型索引
    consecCount   int  // 连续使用计数
}

// Resolve 返回一组要尝试的 {provider, model} 对
// fallback: 返回全部模型按顺序
// round-robin: 返回从当前轮转位置开始的模型
func (r *Resolver) Resolve(comboName string) (*ComboPlan, error)

type ComboPlan struct {
    Strategy    string
    Targets     []ModelTarget
}

type ModelTarget struct {
    ProviderID string
    Model      string
}
```

### 5.5 `internal/proxy` — 代理处理器

**职责：** 接收 `/v1/*` 请求，选择 key，转发上游，流式回传。

```go
type Handler struct {
    registry   *registry.Registry
    selector   *rotation.Selector
    comboRes   *combo.Resolver
    usage      *usage.RingBuffer
    logger     *console.Logger
}

func (h *Handler) ChatCompletions(w http.ResponseWriter, r *http.Request)
func (h *Handler) Completions(w http.ResponseWriter, r *http.Request)
func (h *Handler) ListModels(w http.ResponseWriter, r *http.Request)
```

**SSE 流式透传核心逻辑：**

```go
func (h *Handler) streamResponse(w http.ResponseWriter, upstream *http.Response) error {
    flusher, ok := w.(http.Flusher)
    if !ok {
        return errors.New("streaming unsupported")
    }

    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")
    w.WriteHeader(http.StatusOK)

    scanner := bufio.NewScanner(upstream.Body)
    scanner.Buffer(make([]byte, 0, 256*1024), 256*1024) // 大缓冲
    for scanner.Scan() {
        line := scanner.Bytes()
        w.Write(line)
        w.Write([]byte("\n"))
        flusher.Flush()

        // 检测终止
        if bytes.Equal(line, []byte("data: [DONE]")) {
            break
        }
    }
    return scanner.Err()
}
```

**非流式透传：**

```go
func (h *Handler) passThroughResponse(w http.ResponseWriter, upstream *http.Response) error {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(upstream.StatusCode)
    _, err := io.Copy(w, upstream.Body)
    return err
}
```

### 5.6 `internal/usage` — 用量统计

**职责：** 内存环形缓冲，记录每次请求的用量。

```go
type RingBuffer struct {
    mu    sync.RWMutex
    entries []UsageEntry
    head   int  // 下一个写入位置
    size   int  // 当前条数
    max    int  // 最大容量
}

func New(max int) *RingBuffer
func (rb *RingBuffer) Add(entry UsageEntry)         // 写入一条
func (rb *RingBuffer) All() []UsageEntry             // 读取全部 (按时间倒序)
func (rb *RingBuffer) Summary() UsageSummary         // 汇总统计
func (rb *RingBuffer) Clear()                        // 清空
func (rb *RingBuffer) Resize(newMax int)             // 调整容量

type UsageSummary struct {
    Total       int               `json:"total"`
    Success     int               `json:"success"`
    Error       int               `json:"error"`
    ByProvider  map[string]int    `json:"byProvider"`
    ByModel     map[string]int    `json:"byModel"`
    ByKey       map[string]int    `json:"byKey"`
    AvgLatencyMs int64            `json:"avgLatencyMs"`
}
```

### 5.7 `internal/console` — 控制台日志

**职责：** 捕获应用日志，缓冲到内存，通过 SSE 推送到 UI。

```go
type Logger struct {
    mu       sync.RWMutex
    buffer   []string
    maxLines int
    head     int
    size     int
    subs     map[chan string]bool // SSE 订阅者
}

func New(maxLines int) *Logger
func (l *Logger) Log(level, format string, args ...any)  // 写入 + 推送
func (l *Logger) Info(format string, args ...any)
func (l *Logger) Warn(format string, args ...any)
func (l *Logger) Error(format string, args ...any)
func (l *Logger) Debug(format string, args ...any)
func (l *Logger) AllLines() []string                     // 读取缓冲
func (l *Logger) Subscribe() <-chan string               // SSE 订阅
func (l *Logger) Unsubscribe(ch <-chan string)
func (l *Logger) Clear()
```

**日志格式 (与 9router 保持一致)：**

```
[2026-01-15 10:30:00] REQUEST deepseek | deepseek-chat | 12 msgs
[2026-01-15 10:30:00] PROXY deepseek | deepseek-chat | conn=Main | url=https://api.deepseek.com/v1/chat/completions
[2026-01-15 10:30:02] 📊 [label] deepseek | in=1234 | out=567 | conn=Main
[2026-01-15 10:30:02] 🌊 [STREAM] deepseek | deepseek-chat | 2048ms | 200
[ERROR] upstream returned 429: rate limited
```

### 5.8 `internal/api` — 管理 REST API

**职责：** 提供 CRUD 接口供 UI 调用。纯本地，无鉴权。

```
# Proxy (OpenAI-compatible)
POST   /v1/chat/completions              → 代理转发
POST   /v1/completions                   → 代理转发
GET    /v1/models                        → 列出所有可用模型

# Settings
GET    /api/settings                     → 读取设置
PATCH  /api/settings                     → 更新设置 (port, ringSize, rotation策略等)
POST   /api/reload                       → 从 config.yaml 热重载

# Providers
GET    /api/providers                    → 列出全部 providers
POST   /api/providers                    → 新增 provider
PUT    /api/providers/:id                → 更新 provider
DELETE /api/providers/:id                → 删除 provider
POST   /api/providers/:id/test           → 测试 provider 连通性

# Keys
GET    /api/providers/:id/keys           → 列出 provider 下全部 keys
POST   /api/providers/:id/keys           → 新增 key
PUT    /api/providers/:id/keys/:kid      → 更新 key (toggle active, 改 priority)
DELETE /api/providers/:id/keys/:kid      → 删除 key
GET    /api/providers/:id/keys/:kid/state → 获取 key 运行时状态 (cooldown, locks)

# Combos
GET    /api/combos                       → 列出全部 combos
POST   /api/combos                       → 新增 combo
PUT    /api/combos/:id                   → 更新 combo
DELETE /api/combos/:id                   → 删除 combo

# Usage
GET    /api/usage                        → 获取 usage 记录 (支持 ?limit=N&offset=M)
GET    /api/usage/summary                → 获取汇总统计
DELETE /api/usage                        → 清空 usage

# Console Logs
GET    /api/console-logs                 → 获取缓冲的日志行
GET    /api/console-logs/stream          → SSE 实时日志流
DELETE /api/console-logs                 → 清空日志

# Models
GET    /api/models                       → 列出所有 provider + combo 的可用模型
```

### 5.9 `web/` — 内嵌 UI

**技术：** 纯 HTML + vanilla JS + CSS，通过 `embed.FS` 内嵌到二进制。

**页面结构 (单页应用，hash 路由)：**

```
┌─────────────────────────────────────────────────────┐
│  TinyRouter                          [port: 20128]  │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ Endpoint │  ┌─ 当前页面内容 ──────────────────────┐ │
│ Providers│  │                                    │ │
│ Combos   │  │  根据 hash 路由渲染不同内容          │ │
│ Usage    │  │                                    │ │
│ Console  │  │                                    │ │
│          │  └────────────────────────────────────┘ │
└──────────┴──────────────────────────────────────────┘
```

**5 个页面：**

#### Page 1: Endpoint
- 监听端口设置 (输入框 + 保存按钮，修改后需重启生效或动态重启 listener)
- 本地端点 URL 显示 (`http://localhost:{port}/v1`)
- 说明: 无需 API Key，任意 Key 或无 Key 均可访问

#### Page 2: Providers
- Provider 列表 (卡片式)
- 每张卡片: 名称、Prefix、BaseURL、状态、Key 数量
- 新增 Provider 按钮 → 表单 (name, prefix, baseUrl)
- 点击卡片展开 → Key 管理区域
  - Key 列表: 名称、Key (掩码显示)、优先级、状态 (active/cooldown/locked)、上次使用时间
  - 新增/删除/启用/禁用 Key
  - 运行时状态显示 (当前冷却倒计时、错误信息)

#### Page 3: Combos
- Combo 列表 (卡片式)
- 每张卡片: 名称、策略选择器 (fallback/round-robin)、模型列表
- 新增 Combo → 表单 (name, strategy, models 多选)
- 编辑/删除 Combo

#### Page 4: Usage
- 汇总卡片: 总请求数、成功率、平均延迟、按 provider/model/key 分布
- 请求记录表格 (时间倒序): 时间、Provider、Model、Key、状态、延迟、Tokens
- 清空按钮
- 环形缓冲大小设置 (同步到 settings)

#### Page 5: Console
- 实时日志流 (SSE)
- 日志行着色 (INFO=白色, WARN=黄色, ERROR=红色, DEBUG=灰色)
- 清空按钮
- 自动滚动到底部 (可暂停)

---

## 6. 9router → TinyRouter 功能映射

| 9router 模块 | TinyRouter 处理 | 说明 |
|---|---|---|
| `dashboardGuard.js` | **简化** → 仅检查 localhost | 去除 JWT/OAuth/machineId/API key 鉴权 |
| `src/app/api/v1/` | **保留** → `internal/proxy/` | 核心代理 |
| `open-sse/handlers/chatCore.js` | **大幅简化** → `internal/proxy/handler.go` | 去除 translator、RTK、headroom、caveman、ponytail |
| `open-sse/executors/default.js` | **保留** → `internal/proxy/upstream.go` | OpenAI-compatible 转发 |
| `open-sse/executors/*` (其他) | **去除** | cursor/kiro/codex/antigravity/vertex 等专用 executor |
| `src/sse/services/auth.js` | **保留** → `internal/rotation/selector.go` | fill-first/round-robin + 冷却/退避 |
| `src/sse/services/model.js` | **简化** → `internal/proxy/handler.go` 内前缀匹配 | 仅 OpenAI-compatible，无 alias resolution |
| `open-sse/services/combo.js` | **保留** → `internal/combo/resolver.go` | fallback/round-robin |
| `src/lib/usageDb.js` | **简化** → `internal/usage/ring.go` | 内存环形缓冲，无 SQLite |
| `src/lib/requestDetailsDb.js` | **去除** | 不保存请求/响应体 |
| `src/lib/consoleLogBuffer.js` | **保留** → `internal/console/logger.go` | 相同格式 + SSE 推送 |
| `src/lib/db/` (SQLite) | **去除** | 完全替换为 YAML + 内存 |
| `src/app/api/providers/` | **保留** → `internal/api/providers.go` | Provider CRUD |
| `src/app/api/provider-nodes/` | **合并** → Provider 概念统一 | 不再区分 node/connection |
| `src/app/api/combos/` | **保留** → `internal/api/combos.go` | Combo CRUD |
| `src/app/api/usage/` | **简化** → `internal/api/usage.go` | 内存读取，无 DB 查询 |
| `src/app/api/keys/` | **去除** | 不再需要访问 9router 的 API key |
| `src/app/api/oauth/` | **去除** | OAuth 全部去除 |
| `src/app/api/mcp/` | **去除** | |
| `src/app/api/tunnel/` | **去除** | |
| `src/app/api/cli-tools/` | **去除** | |
| `src/app/api/headroom/` | **去除** | |
| `src/app/api/pricing/` | **去除** | |
| `src/app/api/translator/` | **去除** | (但 console-logs SSE 保留) |
| `src/app/api/media-providers/` | **去除** | |
| `src/app/api/proxy-pools/` | **去除** | |
| `src/app/(dashboard)/dashboard/endpoint/` | **简化** → UI Endpoint 页 | 仅端口设置 |
| `src/app/(dashboard)/dashboard/providers/` | **保留** → UI Providers 页 | 去除 OAuth 分组 |
| `src/app/(dashboard)/dashboard/combos/` | **保留** → UI Combos 页 | |
| `src/app/(dashboard)/dashboard/usage/` | **简化** → UI Usage 页 | 去除 DB 查询，纯内存 |
| `src/app/(dashboard)/dashboard/quota/` | **去除** | |
| `src/app/(dashboard)/dashboard/token-saver/` | **去除** | |
| `src/app/(dashboard)/dashboard/cli-tools/` | **去除** | |
| `src/app/(dashboard)/dashboard/console-log/` | **保留** → UI Console 页 | |
| `src/app/(dashboard)/dashboard/profile/` (Settings) | **大幅简化** | 仅保留端口/环形大小/轮询策略 |
| Next.js / React / zustand | **去除** → embed.FS + vanilla JS | |
| sql.js / better-sqlite3 | **去除** | |
| monaco-editor / recharts / @xyflow/react | **去除** | |

---

## 7. 目录结构

```
tinyrouter/
├── README.md
├── CLAUDE.md
├── IMPLEMENTATION_PLAN.md          # 本文件
├── go.mod
├── go.sum
├── main.go                         # 入口: 加载配置, 启动 HTTP server
├── config.yaml                     # 默认配置 (首次运行自动生成)
│
├── internal/
│   ├── config/
│   │   ├── config.go               # Config/Provider/Key/Combo/Settings 结构定义
│   │   └── manager.go              # 加载/保存/原子写入
│   │
│   ├── registry/
│   │   └── registry.go             # Provider/Key/Combo CRUD + 运行时状态
│   │
│   ├── rotation/
│   │   ├── selector.go             # fill-first / round-robin 选择
│   │   └── cooldown.go             # 指数退避 + 429日配额 + per-model锁
│   │
│   ├── combo/
│   │   └── resolver.go             # fallback / round-robin 解析
│   │
│   ├── proxy/
│   │   ├── handler.go              # /v1/* 入口, model 解析, 重试循环
│   │   ├── stream.go               # SSE 流式透传
│   │   └── upstream.go             # 构造上游请求, 发送, 读取响应
│   │
│   ├── usage/
│   │   └── ring.go                 # 环形缓冲 + 汇总统计
│   │
│   ├── console/
│   │   └── logger.go               # 日志捕获 + SSE 推送
│   │
│   └── api/
│       ├── router.go               # chi 路由注册
│       ├── settings.go             # /api/settings, /api/reload
│       ├── providers.go            # /api/providers/*
│       ├── combos.go               # /api/combos/*
│       ├── usage.go                # /api/usage/*
│       ├── console.go              # /api/console-logs/*
│       └── models.go               # /api/models, /v1/models
│
└── web/
    ├── embed.go                    # //go:embed all:static
    ├── static/
    │   ├── index.html              # 单页应用入口
    │   ├── app.js                  # 路由 + 页面逻辑
    │   └── style.css               # 极简样式
    └── (无构建步骤, 直接 embed)
```

---

## 8. 实施阶段

### Phase 1: 骨架 + 配置 (Day 1)

- [ ] `go.mod` 初始化
- [ ] `internal/config/` — Config 结构 + YAML 加载/保存
- [ ] `main.go` — 加载配置, 启动 HTTP server (空路由)
- [ ] 首次运行自动生成 `config.yaml`
- [ ] 验证: 能启动，能读写配置文件

### Phase 2: 代理核心 (Day 1–2)

- [ ] `internal/proxy/upstream.go` — 构造上游请求
- [ ] `internal/proxy/stream.go` — SSE 流式透传
- [ ] `internal/proxy/handler.go` — /v1/chat/completions 入口, model 解析
- [ ] `internal/registry/` — Provider/Key 内存管理
- [ ] 验证: 手动配置一个 provider + key，能用 curl 发 chat completion 并收到流式响应

### Phase 3: Key 轮询 + 冷却 (Day 2–3)

- [ ] `internal/rotation/selector.go` — fill-first + round-robin
- [ ] `internal/rotation/cooldown.go` — 指数退避 + 429日配额 + per-model锁
- [ ] handler.go 集成重试循环
- [ ] 验证: 多 key 轮询、模拟 429 触发冷却、冷却恢复

### Phase 4: Console 日志 + Usage (Day 3)

- [ ] `internal/console/logger.go` — 日志捕获 + SSE
- [ ] `internal/usage/ring.go` — 环形缓冲
- [ ] handler.go 集成日志输出 + usage 记录
- [ ] 验证: 控制台输出格式与 9router 一致，usage 记录正确

### Phase 5: Combo (Day 4)

- [ ] `internal/combo/resolver.go` — fallback/round-robin
- [ ] handler.go 集成 combo 解析
- [ ] 验证: 三种策略均能正确路由

### Phase 6: 管理 API (Day 4–5)

- [ ] `internal/api/router.go` — chi 路由
- [ ] settings / providers / keys / combos / usage / console-logs 接口
- [ ] 验证: curl 测试全部 API

### Phase 7: UI (Day 5–7)

- [ ] `web/static/index.html` — 布局 + 侧边栏
- [ ] `web/static/app.js` — 5 个页面逻辑
- [ ] `web/static/style.css` — 样式
- [ ] 验证: 全部 UI 功能可用

### Phase 8: 收尾 (Day 7)

- [ ] 端口动态修改 (重启 listener)
- [ ] config.yaml 原子写入
- [ ] 优雅关闭 (signal handling)
- [ ] README 完善
- [ ] 交叉编译测试 (linux/amd64, windows/amd64, darwin/arm64)

---

## 9. 预估指标

| 指标 | 9router (当前) | TinyRouter (目标) |
|---|---|---|
| 内存 RSS | 200–400 MB | 10–25 MB |
| 部署物大小 | ~500 MB (node_modules + .next) | ~15 MB (单二进制) |
| 启动时间 | 1–3 s | < 50 ms |
| 代理延迟开销 | Next.js middleware + Express + undici | 直接 net/http, < 1 ms |
| 代码量 | ~15000 行 JS/JSX | ~2500 行 Go + ~600 行前端 |
| 外部依赖 | 40+ npm packages | 3 Go modules |

---

## 10. 参考来源

- 9router 仓库: `Z:\Playground\9router` (本地参考)
- Key 轮询逻辑: `src/sse/services/auth.js`
- 代理核心: `open-sse/handlers/chatCore.js`, `open-sse/executors/default.js`
- Combo 逻辑: `open-sse/services/combo.js`
- Console 日志: `src/lib/consoleLogBuffer.js`
- Usage 统计: `src/lib/db/repos/usageRepo.js`
- Dashboard 导航: `src/shared/components/Sidebar.js`
- Provider 常量: `src/shared/constants/providers.js`
