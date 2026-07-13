# TinyRouter v1.4.0 发布前修复计划

> 生成时间: 2026-07-08
> 基于: commit 8d45d2a, v1.4.0
> 评审评分: 6.9/10 — 有 6 项 P1 必须在发布前处理

---

## 目录

- [项目概况](#项目概况)
- [修复波次总览](#修复波次总览)
- [第一波 P1 必须修复](#第一波-p1-必须修复)
  - [1.1 移除 CORS `*`](#11-移除-cors-)
  - [1.2 Provider BaseURL 私网拦截](#12-provider-baseurl-私网拦截)
  - [1.3 配置/状态文件权限 → 0600](#13-配置状态文件权限--0600)
  - [1.4 SSE 非 normalize 路径尾行重复写出 bug](#14-sse-非-normalize-路径尾行重复写出-bug)
  - [1.5 上游请求传播 r.Context()](#15-上游请求传播-rcontext)
  - [1.6 golang.org/x/sys 升级](#16-golangorgxsys-升级)
- [第二波 P2 强烈建议修复](#第二波-p2-强烈建议修复)
  - [2.1 Registry.Reload 改 merge 语义](#21-registryreload-改-merge-语义)
  - [2.2 全局 rotation 配置热生效](#22-全局-rotation-配置热生效)
  - [2.3 请求/响应体大小限制](#23-请求响应体大小限制)
  - [2.4 重试循环中 keyState 指向僵尸对象](#24-重试循环中-keystate-指向僵尸对象)
  - [2.5 YAML 解析启用 KnownFields](#25-yaml-解析启用-knownfields)
  - [2.6 config.Save 双失败返回 error](#26-configsave-双失败返回-error)
  - [2.7 config.Load .tmp 恢复改用 mtime 比较](#27-configload-tmp-恢复改用-mtime-比较)
  - [2.8 finalizeConfig 补 StatePersist/StatePath 默认值](#28-finalizeconfig-补-statepersiststatepath-默认值)
- [第三波 P3 建议后续版本推进](#第三波-p3-建议后续版本推进)
  - [3.1 前端 t() 占位符统一转义](#31-前端-t-占位符统一转义)
  - [3.2 Playground source href 协议白名单](#32-playground-source-href-协议白名单)
  - [3.3 a11y 图标按钮补 aria-label](#33-a11y-图标按钮补-aria-label)
  - [3.4 build tag webview ⇒ tray 互斥约束](#34-build-tag-webview--tray-互斥约束)
  - [3.5 dist/ 加入 .gitignore](#35-dist-加入-gitignore)
  - [3.6 go.mod 将 x/sys 标为直接依赖](#36-gomod-将-xsys-标为直接依赖)
  - [3.7 UpdateProvider 支持更多字段更新](#37-updateprovider-支持更多字段更新)
  - [3.8 补 SSE 端到端测试 + registry CRUD 单测](#38-补-sse-端到端测试--registry-crud-单测)
  - [3.9 补 quota.go / ratelimit.go / ClassifyError 单测](#39-补-quotago--ratelimitgo--classifyerror-单测)
  - [3.10 修复假测试：TestInjectStreamOptions / TestRecordUsage / TestComboResponse](#310-修复假测试testinjectstreamoptions--testrecordusage--testcomboresponse)
  - [3.11 server_manager 补 MaxHeaderBytes](#311-server_manager-补-maxheaderbytes)
  - [3.12 SSE 流读取监听 r.Context().Done()](#312-sse-流读取监听-rcontextdone)
  - [3.13 http.Client.Timeout 300s 截断长 SSE 流](#313-httpclienttimeout-300s-截断长-sse-流)
  - [3.14 5xx 错误补短退避](#314-5xx-错误补短退避)
- [每波结束后的验证清单](#每波结束后的验证清单)

---

## 项目概况

| 维度 | 数据 |
|---|---|
| 路径 | `Z:\Playground\tinyrouter` |
| 版本 | 1.4.0 (`version.go`) |
| 源码规模 | 116 Go 文件, ~20,900 LOC + 14 前端 JS + 2 CSS |
| 构建系统 | `build.ps1` (13 变体), `gen-icon.ps1` (ICO 生成) |
| 依赖 | chi v5.2.1, yaml.v3, brotli v1.2.2, fyne/systray v1.12.2, go-webview2, golang.org/x/sys |
| 当前状态 | `go build` ✅ / `go vet` ✅ / `go test` ✅ / `go test -race` ✅ / 覆盖率 46.1% |

### 关键架构概览

```
main.go                      // 入口；创建 registry/selector/comboRes/proxyHandler/stateManager
server_manager.go            // HTTP 优雅重启
host_*.go                    // build tag 互斥的宿主实现（console/tray/webview）
version.go                   // "1.4.0"
internal/
  config/config.go           // 配置结构 + YAML 加载/保存（原子写）
  state/state.go             // Snapshot 结构 + Load/Save
  state/manager.go           // 去抖+定时落盘管理器
  registry/registry.go       // ★ Reload() 整体重建 states map（P2 要改）
  registry/state.go          // KeyRuntimeState + per-key mutex
  registry/providers.go     // Provider 增删改查 + GetProvider 返回拷贝指针
  registry/keys.go           // Key 增删改
  rotation/selector.go       // ★ SelectKey + OnKeyFailure + UpdateSettings（从未被调用）
  rotation/strategy.go       // fill-first / round-robin / failover 策略
  rotation/cooldown.go       // 指数退避 + 每日配额锁
  rotation/error_rules.go    // 错误分类表
  rotation/nim.go            // NIM 特殊轮转
  proxy/handler.go           // ★ handleProxy → forwardWithRetry → streamResponse/passThrough
  proxy/upstream.go          // ★ forwardUpstream（未传播 context）+ BuildUpstreamURL
  proxy/stream.go            // ★ streamResponse（非 normalize 尾行重复 bug）
  proxy/retry.go             // 429/5xx 重试逻辑（onKeyFailure 在此调用）
  combo/resolver.go          // fallback/round-robin/greedy-squirrel
  usage/ring.go              // 环形缓冲
  usage/quota.go             // 配额追踪（0% 测试覆盖）
  console/logger.go          // 环形缓冲日志 + SSE 推送
  api/router.go              // ★ CORS `*` 全局中间件
  api/handlers.go            // REST API handlers（createProvider 无 BaseURL 校验）
  api/providers_validate.go  // probeUpstream（error 回传可能泄露凭据）
web/
  static/                    // 主管理 UI（HTML+JS+CSS，vanilla JS，全局变量）
  static/i18n.js             // ★ t() 占位符不转义
  playground/static-pg/      // Playground UI
  playground/static-pg/pg-render.js // ★ source href 未做协议白名单
  embed.go / embed_playground.go    // build tag 互斥的 embed.FS
```

### 三层锁结构（并发模型）

```
Registry
├── cfgMu    (sync.RWMutex)    — 保护 config *Config
├── stateMu  (sync.RWMutex)    — 保护 states map[string]*KeyRuntimeState
└── KeyRuntimeState
    └── mu   (sync.Mutex)      — per-key 状态锁
```

锁获取顺序：`cfgMu → stateMu → ks.mu`（全局一致，无死锁）。
`Registry.Reload()` 在 `cfgMu.Lock()` 下调用 `reloadStatesLocked()`，后者获取 `stateMu.Lock()` 并用 `make()` 重建整个 states map —— **这是 P2.1 的根因**。

---

## 修复波次总览

| 波次 | 条目数 | 严重度 | 发布前必须 | 预计工时 |
|---|---|---|---|---|
| 第一波 | 6 | P1 | ✅ 是 | ~4 小时 |
| 第二波 | 8 | P2 | 强烈建议 | ~6 小时 |
| 第三波 | 14 | P3 | 后续版本 | ~8 小时 |

---

## 第一波 P1 必须修复

### 1.1 移除 CORS `*`

**文件**: `internal/api/router.go`

**问题**: 第 100 行全局中间件对所有路由设置 `Access-Control-Allow-Origin: *`，包括 `/api/*` 和 `/v1/*`。这将"仅本机可信"降级为"任意网页可跨域读写管理 API、窃取明文 API Key、关停服务"。

**当前代码** (`internal/api/router.go:98-105`):
```go
r.Use(func(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.Header().Set("Access-Control-Expose-Headers", "X-TinyRouter-Provider, X-TinyRouter-Key")
        next.ServeHTTP(w, r)
    })
})
```

**修复方案**: 移除全局 CORS `*` 中间件。管理 UI 同源（`http://127.0.0.1:<port>`）无需 CORS。仅保留 CORS OPTIONS 预检处理给 `/v1/*` 代理路由（如有外部客户端需要跨域调用 LLM API）。同时移除 `stream.go` 和 `passThroughResponse` 中硬编码的 `Access-Control-Allow-Origin: *`。

**具体操作**:

1. 移除 `internal/api/router.go:98-105` 的 CORS 中间件块
2. 保留 `Access-Control-Expose-Headers` 逻辑，移到 securityHeaders 中间件中（或直接在 proxy handler 中设置，不过 management 路由不需要它）
3. 添加 OPTIONS 方法处理仅作用于 `/v1/*` 路由:
   ```go
   // 在 r.Get("/v1/models", ...) 之前添加：
   r.Options("/v1/*", func(w http.ResponseWriter, r *http.Request) {
       w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
       w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
       w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
       w.Header().Set("Access-Control-Expose-Headers", "X-TinyRouter-Provider, X-TinyRouter-Key")
       w.WriteHeader(http.StatusNoContent)
   })
   ```
   ⚠ 注意：仅对 `/v1/*` 路由保留 CORS（代理客户端可能跨域调用），management `/api/*` 完全无 CORS。

4. 移除 `internal/proxy/stream.go:110` 的 `w.Header().Set("Access-Control-Allow-Origin", "*")`
5. 移除 `internal/proxy/stream.go:226` 的 `w.Header().Set("Access-Control-Allow-Origin", "*")`
6. 移除 `internal/api/providers_models_probe.go` 中（如果有的话）CORS 相关 header

**验证**: 启动服务后从另一端口 fetch `/api/providers` 应被浏览器 CORS 阻止；从同源页面正常工作。`/v1/chat/completions` 预检 OPTIONS 仍可通。

---

### 1.2 Provider BaseURL 私网拦截

**文件**: `internal/api/handlers.go`, 新增 `internal/api/url_validation.go`（或内联到 `handlers.go`）

**问题**: `createProvider` (handler.go:123) 和 `updateProvider` (handler.go:153) 接受任意 `BaseURL` 字符串无校验。配合 CORS `*`（1.1）形成 SSRF：可指向 `http://169.254.169.254/latest/meta-data/` 等内网地址。

**当前代码** (`internal/api/handlers.go:123-151`):
```go
func (rt *Router) createProvider(w http.ResponseWriter, r *http.Request) {
    var p config.Provider
    if err := json.NewDecoder(r.Body).Decode(&p); err != nil { ... }
    if p.ID == "" { p.ID = generateID("prov") }
    for rt.reg.HasProvider(p.ID) { p.ID = generateID("prov") }
    if p.APIType == "" { p.APIType = "openai-compatible" }
    p.IsActive = true
    // ← 没有对 p.BaseURL 做任何校验
    rt.reg.AddProvider(p)
    ...
}
```

**修复方案**: 创建 `validateBaseURL` 函数，对 `BaseURL` 进行 scheme 白名单 + 私网地址拦截。在 `createProvider` 和 `updateProvider` 中调用。

**具体操作**:

1. 新建 `internal/api/url_validation.go`:
   ```go
   package api

   import (
       "fmt"
       "net"
       "net/url"
       "strings"
   )

   // validateBaseURL 校验 provider BaseURL：
   // - 必须是 http/https scheme
   // - host 不能解析到私网/回环/链路本地地址
   // 返回 nil 表示通过，否则 error 描述被拒原因。
   func validateBaseURL(baseURL string) error {
       if baseURL == "" {
           return fmt.Errorf("baseUrl is required")
       }
       u, err := url.Parse(baseURL)
       if err != nil {
           return fmt.Errorf("invalid URL: %w", err)
       }
       scheme := strings.ToLower(u.Scheme)
       if scheme != "http" && scheme != "https" {
           return fmt.Errorf("only http/https schemes are allowed, got: %s", scheme)
       }
       host := u.Hostname()
       if host == "" {
           return fmt.Errorf("URL must have a hostname")
       }
       // 解析主机地址
       ips, err := net.LookupIP(host)
       if err != nil {
           return fmt.Errorf("failed to resolve host %s: %w", host, err)
       }
       for _, ip := range ips {
           if isPrivateIP(ip) {
               return fmt.Errorf("host %s resolves to private/loopback address %s, which is not allowed", host, ip)
           }
       }
       return nil
   }

   func isPrivateIP(ip net.IP) bool {
       if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
           return true
       }
       return false
   }
   ```

2. 在 `handlers.go` 的 `createProvider` 中，`if p.APIType == ""` 后面、`p.IsActive = true` 前面加入:
   ```go
   if err := validateBaseURL(p.BaseURL); err != nil {
       writeAPIError(w, http.StatusBadRequest, fmt.Sprintf("invalid baseURL: %v", err))
       return
   }
   ```

3. 在 `updateProvider` 中也加入同样校验（在 `rt.reg.UpdateProvider(id, updates)` 之前）:
   ```go
   if updates.BaseURL != "" {
       if err := validateBaseURL(updates.BaseURL); err != nil {
           writeAPIError(w, http.StatusBadRequest, fmt.Sprintf("invalid baseURL: %v", err))
           return
       }
   }
   ```

4. 同样 `validateProvider` handler（`providers_validate.go:28`）中调用 `validateBaseURL(req.BaseURL)`。

**注意**: DNS 解析在调用时进行。如果 provider 配置后 DNS 变更到私网地址（DNS rebinding），此校验不能防。但纯本地工具场景下可接受。

**验证**: POST `/api/providers` 携带 `{"baseUrl": "http://169.254.169.254/latest/"}` 应回 400。携带 `{"baseUrl": "https://api.deepseek.com"}` 应通过。

---

### 1.3 配置/状态文件权限 → 0600

**文件**: `internal/config/config.go`, `internal/state/state.go`

**问题**: `config.yaml` 和 `state.yaml` 含明文 API Key，但文件以 `0644` 权限写入（所有用户可读）。在 Linux/macOS 上同机其他用户可读取全部密钥。

**当前代码**:

`internal/config/config.go:248,253`:
```go
if err := os.WriteFile(tmp, data, 0644); err != nil { ... }
if writeErr := os.WriteFile(path, data, 0644); writeErr != nil { ... }
```

`internal/state/state.go:84,88`:
```go
if err := os.WriteFile(tmp, data, 0644); err != nil { ... }
if writeErr := os.WriteFile(path, data, 0644); writeErr != nil { ... }
```

**修复方案**: 将所有 `0644` 改为 `0600`。

**具体操作**:

1. `internal/config/config.go` 中所有 `os.WriteFile` 调用的权限从 `0644` 改为 `0600`:
   - 第 176 行: `os.WriteFile(path, tmpData, 0600)` (Load 中 .tmp 回退路径)
   - 第 248 行: `os.WriteFile(tmp, data, 0600)` (Save 中写 .tmp)
   - 第 253 行: `os.WriteFile(path, data, 0600)` (Save 中直写回退路径)

2. `internal/state/state.go` 中所有 `os.WriteFile` 调用的权限从 `0644` 改为 `0600`:
   - 第 84 行: `os.WriteFile(tmp, data, 0600)` (Save 中写 .tmp)
   - 第 89 行: `os.WriteFile(path, data, 0600)` (Save 中直写回退路径)

3. `main.go:53` 单实例 lock 文件权限也可从 `0644` 改为 `0600`:
   ```go
   lockFile, lockErr := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
   ```

**验证**: 保存 config 后在 Linux/WSL 上 `ls -la config.yaml` 应显示 `-rw-------`。在 Windows 上权限由 ACL 管理，但 `0600` 不影响功能。

---

### 1.4 SSE 非 normalize 路径尾行重复写出 bug

**文件**: `internal/proxy/stream.go`

**问题**: 在 `normalize=false` 路径（默认），每次读取先把整块 `buf[:n]` 原样 `w.Write`（第 147 行），随后用 `sb.Feed` 提取 token。到流结束（`err != nil`）时 `sb.Remaining()` 返回尚未以 `\n` 结尾的尾部片段，在第 191 行再次 `w.Write(remaining + "\n")`。由于该尾部片段已在之前的 `w.Write(buf[:n])` 中原样发出，客户端收到重复内容，SSE 数据损坏。

**当前代码** (`internal/proxy/stream.go:146-165` 非 normalize 分支):
```go
} else {
    if _, err := w.Write(buf[:n]); err != nil { ... return }  // ← 原样写出整块
    // Token extraction still needs to scan the raw lines.
    for _, line := range sb.Feed(buf[:n]) {                    // ← 提取 token
        line = strings.TrimSpace(line)
        if strings.HasPrefix(line, "data:") { ... }
    }
}
```

以及 EOF 处 (`stream.go:180-207`):
```go
if err != nil {
    remaining := sb.Remaining()
    if remaining != "" {
        if normalize {
            out := normalizeSSEChunk(remaining)
            if _, werr := w.Write([]byte(out + "\n")); werr != nil { ... }
        } else {
            if _, werr := w.Write([]byte(remaining + "\n")); werr != nil { ... }  // ← 重复写出！
        }
    }
    break
}
```

**修复方案**: 在非 normalize 路径中，EOF 处 `remaining` 已经通过 `w.Write(buf[:n])` 原样发出了，不应再重发。修复方式：非 normalize 路径的 `remaining` 处理只需提取 token，不应再 `w.Write`。

**具体操作**:

将 `stream.go` 第 179-207 行（`if err != nil {` 块）改为：

```go
if err != nil {
    remaining := sb.Remaining()
    if remaining != "" {
        if normalize {
            // normalize 路径未在循环中原样写出过整块，需要在这里写出规范化后的 remaining
            out := normalizeSSEChunk(remaining)
            if _, werr := w.Write([]byte(out + "\n")); werr != nil {
                h.logger.Debug("client disconnected during SSE stream: %v", werr)
                return
            }
            totalOutput += len(out) + 1
            remaining = out
        } else {
            // 非 normalize 路径：remaining 已经在循环中通过 w.Write(buf[:n]) 原样发出，
            // 不应重复写出。仅提取 token 即可。
            totalOutput += len(remaining) // remaining 的长度已包含在之前的 totalOutput 中
        }
        // 统一提取 token（两个路径都需要）
        trimmedLine := strings.TrimSpace(remaining)
        if strings.HasPrefix(trimmedLine, "data:") {
            payload := strings.TrimSpace(trimmedLine[5:])
            if payload != "[DONE]" {
                if in, out := util.ExtractTokens([]byte(payload)); in > 0 || out > 0 {
                    inputTokens = in
                    outputTokens = out
                }
            }
        }
    }
    break
}
```

**验证**:
1. 写测试：模拟上游返回 `"data: {\"choices\":[]}\n"` 然后 `"data: [DONE]"`（无结尾 `\n`），用 `httptest.ResponseRecorder` 验证非 normalize 模式下客户端只收到一次 `data: [DONE]` 而非两次。
2. 手动测试：对非 normalize provider 发流式请求，检查响应体无重复内容。

---

### 1.5 上游请求传播 r.Context()

**文件**: `internal/proxy/upstream.go`

**问题**: `forwardUpstream` 用 `http.NewRequest("POST", url, ...)` 创建请求时未调用 `req.WithContext(r.Context())`。客户端中途断开后，上游请求不会被取消，goroutine 持续占用并消耗 token/配额。

**当前代码** (`internal/proxy/upstream.go:36-54`):
```go
func (h *Handler) forwardUpstream(sel *rotation.SelectedKey, body []byte, headers http.Header, isStream bool, path string) (*http.Response, error) {
    url := BuildUpstreamURL(sel.Provider.BaseURL, path)
    req, err := http.NewRequest("POST", url, strings.NewReader(string(body)))
    if err != nil {
        return nil, err
    }
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+sel.Key.Key)
    // ...
    return h.client.Do(req)
}
```

**修复方案**: 传入 `ctx context.Context` 参数并用 `req.WithContext(ctx)`。

**具体操作**:

1. 修改 `forwardUpstream` 签名，增加 `ctx context.Context` 参数:
   ```go
   func (h *Handler) forwardUpstream(ctx context.Context, sel *rotation.SelectedKey, body []byte, headers http.Header, isStream bool, path string) (*http.Response, error) {
       url := BuildUpstreamURL(sel.Provider.BaseURL, path)
       req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(body)))
       if err != nil {
           return nil, err
       }
       // ... 其余不变
       return h.client.Do(req)
   }
   ```

2. 修改调用方 `internal/proxy/handler.go:201`，传入 `r.Context()`:
   ```go
   resp, err := h.forwardUpstream(r.Context(), sel, upstreamBody, r.Header, isStream, path)
   ```
   找到 `h.forwardUpstream(` 的调用处，添加 `r.Context()` 参数。

3. 如果项目中还有其他调用 `http.NewRequest` 而未带 context 的地方（`internal/api/providers_validate.go:47,70` 的 `probeUpstream` 也用了 `http.NewRequest` 但那是 API 探测路径，也应传入 `r.Context()`）:
   - `providers_validate.go:47`: `http.NewRequest("GET", modelsURL, nil)` → 需要传入 `r.Context()`
   - `providers_validate.go:70`: `http.NewRequest("POST", chatURL, ...)` → 同上
   - `internal/api/providers_models_probe.go` 中的 `http.NewRequest` 调用 → 同上
   
   建议为 `probeUpstream` 也增加 `ctx context.Context` 参数：
   ```go
   func (rt *Router) probeUpstream(ctx context.Context, baseURL, apiKey, modelID string) (bool, string, string) {
       // ...
       req, err := http.NewRequestWithContext(ctx, "GET", modelsURL, nil)
       // ...
   }
   ```
   并在 `validateProvider` handler 中调用时传入 `r.Context()`。

**验证**: `go build ./...` 通过。手动测试：发起流式请求然后客户端断开，观察上游连接被取消（日志中不应有后续 PROXY 成功日志）。

---

### 1.6 golang.org/x/sys 升级

**文件**: `go.mod`, `go.sum`

**问题**: `golang.org/x/sys v0.15.0`（2023-12）含 CVE-2026-39824 / GO-2026-5024（integer overflow in `NewNTUnicodeString`），修复于 v0.45.0+。webview 变体直接 `import "golang.org/x/sys/windows"`，受漏洞影响。

**当前 go.mod**:
```
require (
    golang.org/x/sys v0.15.0 // indirect
)
```

**修复方案**: 升级到最新版（截至编写时为 v0.46.x，建议 ≥ v0.45.0）。

**具体操作**:

1. 运行升级命令:
   ```powershell
   go get golang.org/x/sys@latest
   go mod tidy
   ```

2. 确认 `go.mod` 中 `golang.org/x/sys` 版本已更新为 `v0.46.x`（或最新）且不再标注 `// indirect`（因为 webview 变体直接导入）。

3. 确认 `go.sum` 已更新。

4. 用全 build tag 验证编译:
   ```powershell
   go build ./...
   go build -tags tray ./...
   go build -tags "tray,webview" ./...
   go build -tags "tray,webview,playground" ./...
   go vet ./...
   go test ./...
   ```

**验证**: `go.mod` 中 `golang.org/x/sys` 版本 ≥ v0.45.0，所有 build tag 组合编译通过。

---

## 第二波 P2 强烈建议修复

### 2.1 Registry.Reload 改 merge 语义

**文件**: `internal/registry/registry.go`

**问题**: `Registry.Reload()` 调用 `reloadStatesLocked()` 用 `make(...)` 重建整个 `r.states` map，丢弃所有 `KeyRuntimeState` 的 `ModelLocks`/`BackoffLevel`/`NIM*`/`InFlight`。每个 API 写操作（createProvider/updateProvider/createKey/deleteKey/updateCombo 等）都会 `rt.reg.Reload(&cfg)`，导致：
1. 任何配置变更立即清空所有 key 冷却/锁定状态
2. 去抖落盘会把重置态写回 state.yaml，静默覆盖磁盘上正确的冷却状态

**当前代码** (`internal/registry/registry.go:28-42`):
```go
func (r *Registry) reloadStatesLocked() {
    newStates := make(map[string]*KeyRuntimeState)
    for _, p := range r.config.Providers {
        for _, k := range p.Keys {
            newStates[p.ID+"/"+k.ID] = &KeyRuntimeState{
                ModelLocks:  make(map[string]time.Time),
                ModelStatus: make(map[string]string),
                ModelErrors: make(map[string]string),
            }
        }
    }
    r.stateMu.Lock()
    r.states = newStates
    r.stateMu.Unlock()
}
```

**修复方案**: 改为 merge 语义：保留仍存在的 `providerID/keyID` 的旧 `KeyRuntimeState`，仅增减新增/删除的项。

**具体操作**:

将 `reloadStatesLocked()` 改为:

```go
func (r *Registry) reloadStatesLocked() {
    // 锁顺序：调用方已持有 cfgMu，此处只需 stateMu
    r.stateMu.Lock()
    defer r.stateMu.Unlock()

    // 保留仍存在的 key 的旧运行时状态，仅增减
    seen := make(map[string]bool)
    newKeys := make(map[string]*KeyRuntimeState)
    for _, p := range r.config.Providers {
        for _, k := range p.Keys {
            key := p.ID + "/" + k.ID
            seen[key] = true
            if existing, ok := r.states[key]; ok {
                // 保留既有运行时状态
                newKeys[key] = existing
            } else {
                // 新 key，初始化空状态
                newKeys[key] = &KeyRuntimeState{
                    ModelLocks:  make(map[string]time.Time),
                    ModelStatus: make(map[string]string),
                    ModelErrors: make(map[string]string),
                }
            }
        }
    }
    r.states = newKeys
}
```

**注意**: 调用方 `Reload()` 已持有 `cfgMu.Lock()`，`reloadStatesLocked()` 内部获取 `stateMu.Lock()`。锁顺序 `cfgMu → stateMu` 保持一致，无死锁风险。

**验证**:
1. 启动 → 等某 key 被 429 冷却 → 通过 UI 新增另一个 provider → 检查原 key 仍处于冷却状态（未重置）。
2. `go test ./internal/registry/...` 通过。
3. 新增测试用例验证 merge 语义（保留旧状态 + 新增 key 获得空状态 + 删除 key 的状态被移除）。

---

### 2.2 全局 rotation 配置热生效

**文件**: `internal/rotation/selector.go`, `internal/api/handlers.go`, `main.go`

**问题**: `main.go:72` 创建 `selector := rotation.New(reg, &cfg.Rotation)`，`selector.settings` 指向原始 `cfg.Rotation`。API `updateSettings`（handlers.go:69）和 `reload` 都通过 `rt.reg.Config()` 取得**拷贝**并 `reg.Reload(&cfg)`，从不调用 `selector.UpdateSettings()`（该方法定义了但全代码库无调用点）。通过 UI 修改全局 `RotationStrategy`/`StickyLimit`/`MaxRetries`/`BackoffMaxSec` 对 selector 无效，需重启进程。

**根因**: `selector.settings` 是指针，初始指向 `cfg.Rotation`。但 `Registry.Reload` 会用新创建的 `cfg` 副本的地址调用 `r.config = cfg`（指针赋值），而 selector 的 `settings` 仍指向第一次启动时的那个 `&cfg.Rotation`。后续 `updateSettings` 用 `cfg := rt.reg.Config()` 返回的是值拷贝，修改后 `rt.reg.Reload(&cfg)` 使得 `reg.config` 指向新拷贝，但 selector.settings 还指向旧拷贝。

**修复方案**: 在 `updateSettings` 和 `reload` handler 中，调用 `rt.reg.Reload(&cfg)` 后，显式调用 `rt.selector.UpdateSettings(cfg.Rotation)`。

**具体操作**:

1. `internal/api/handlers.go` 的 `updateSettings` 中，在 `rt.reg.Reload(&cfg)` 之后（第 83 行）增加:
   ```go
   rt.reg.Reload(&cfg)
   rt.selector.UpdateSettings(cfg.Rotation)  // ← 新增
   ```

2. `internal/api/handlers.go` 的 `reload` 中，在 `rt.reg.Reload(cfg)` 之后（第 110 行）增加:
   ```go
   rt.reg.Reload(cfg)
   rt.selector.UpdateSettings(cfg.Rotation)  // ← 新增
   ```

3. 检查 `internal/api/router.go` 的 `Router` 结构定义，确认 `selector` 字段类型是 `*rotation.Selector`（当前已是这样），且 `UpdateSettings` 是 `Selector` 的方法（selector.go:154 已定义）。

**验证**:
1. 通过 UI 修改全局 rotation strategy 从 `fill-first` 到 `round-robin` → 立即生效（下次请求使用新策略）。
2. `go test ./internal/api/...` 通过。

---

### 2.3 请求/响应体大小限制

**文件**: `internal/proxy/handler.go`, `internal/api/handlers.go`

**问题**: `handler.go:59` 的 `io.ReadAll(r.Body)` 无上限读取代理请求体；`handlers.go` 中 `json.NewDecoder(r.Body).Decode(...)` 也无限制。攻击者可发送超大 body 耗尽内存。

**修复方案**: 对代理请求体加 `http.MaxBytesReader`；API handler 也加限制。

**具体操作**:

1. `internal/proxy/handler.go:59` 改为:
   ```go
   // 32 MB 代理请求体上限（LLM prompt 可能很大，32MB 足够）
   r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
   bodyBytes, err := io.ReadAll(r.Body)
   ```
   ⚠ 注意：`http.MaxBytesReader` 的第一个参数实际上是 `http.ResponseWriter`，用于设置 413 状态码。但此处需要把 `w` 传进去。`handleProxy` 的签名已经包含 `w http.ResponseWriter`。

2. `internal/proxy/handler.go:233` 的 `passThroughResponse` 中 `io.ReadAll(resp.Body)` 对上游非流式响应也加限制:
   ```go
   limitedBody := io.LimitReader(resp.Body, 64<<20) // 64 MB 上限
   bodyBytes, err := io.ReadAll(limitedBody)
   ```

3. `internal/api/handlers.go` 中的所有 `json.NewDecoder(r.Body).Decode(...)` 调用前加 `http.MaxBytesReader`。可以在 router 级用中间件统一设置:
   在 `internal/api/router.go` 的 `/api` 路由组中加:
   ```go
   r.Route("/api", func(r chi.Router) {
       r.Use(func(next http.Handler) http.Handler {
           return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
               r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB API 请求上限
               next.ServeHTTP(w, r)
           })
       })
       // ... 现有路由
   })
   ```

**验证**: 发送 33MB body 到 `/v1/chat/completions` 应回 413 或 400。发送 2MB body 到 `/api/providers` 应回类似错误。

---

### 2.4 重试循环中 keyState 指向僵尸对象

**文件**: `internal/proxy/handler.go`

**问题**: `handler.go:169` `keyState := h.reg.GetKeyState(providerID, sel.Key.ID)` 在 `for` 循环外取一次指针（⤡ 修正：实际在循环内每次取的）。但从代码看，第 169 行确实在 `for` 循环内部每次迭代调用 `h.reg.GetKeyState`。不过如果有 reload 发生在重试迭代之间，第一次取的 `keyState` 对象已经不是当前 map 中的对象了。仔细看代码：

实际上重新检查 `handler.go:161-262`:
```go
for {
    sel, err := h.selector.SelectKey(...)        // 162
    // ...
    keyState := h.reg.GetKeyState(providerID, sel.Key.ID)  // 169 ← 每次迭代都取！
    if keyState != nil { keyState.IncInFlight() }           // 170-172
    // ...
}
```

**修正**: 实际上 `keyState` 在循环内每次迭代都重新获取，不是"循环外取一次"。但是问题是重试循环的每次迭代可能选中**不同的 key**，而 `GetKeyState` 返回的是新 key 的 state，不是上一个 key 的。如果在迭代期间 reload 重建 states map，`GetKeyState` 返回的是新 map 中的新对象（或 nil），旧的 `keyState` 引用已失效但不会造成计数失真。因此这个问题的严重度应降为 P3——仅在 **reload 后 nil-check 通过旧指针**。

但仍有改进空间：确保 `DecInFlight` 调在同一个 keyState 对象上（与 Inc 对称）。当前代码在每次迭代末尾对同一次取的 `keyState` 做 DecInFlight，这是对的。

**修复方案**: 确保在重试迭代之间，如果 `selector.SelectKey` 选了新 key，`keyState` 也对应更新（已如此）。真正的改进是确保 nil 安全和 reload 场景下不丢失 in-flight 计数。

**具体操作**:

实际上当前代码在每次 `for` 循环内都重新 `GetKeyState`，逻辑是正确的。但可以添加一个注释说明这一点，并确保 reload 时不丢失 in-flight（已在 2.1 中通过 merge 语义解决）。

因此本项从 P2 降级为已在 2.1 中解决。无需额外代码改动。

---

### 2.5 YAML 解析启用 KnownFields

**文件**: `internal/config/config.go`, `internal/state/state.go`

**问题**: `yaml.Unmarshal` 未启用严格模式。字段拼写错误被静默忽略，降为 zero value。`baseUrl` 写成 `baseurl` 不会报错，导致 BaseURL 变空字符串。

**修复方案**: 用 `yaml.NewDecoder` 替代 `yaml.Unmarshal` 并设置 `KnownFields(true)`。

**具体操作**:

1. `internal/config/config.go:200` 替换:
   ```go
   // 旧
   var cfg Config
   if err := yaml.Unmarshal(data, &cfg); err != nil {
       return nil, fmt.Errorf("parse config: %w", err)
   }
   ```
   ```go
   // 新
   var cfg Config
   dec := yaml.NewDecoder(bytes.NewReader(data))
   dec.KnownFields(true)
   if err := dec.Decode(&cfg); err != nil {
       return nil, fmt.Errorf("parse config: %w", err)
   }
   ```
   ⚠ 注意：需要 `import "bytes"`（config.go 已导入 bytes）。

2. 同样处理 `config.go:180` 的 `.tmp` 解析:
   ```go
   var cfg Config
   dec := yaml.NewDecoder(bytes.NewReader(tmpData))
   dec.KnownFields(true)
   if err := dec.Decode(&cfg); err != nil {
       return nil, fmt.Errorf("parse pending config (.tmp): %w", err)
   }
   ```

3. `internal/state/state.go:60` 替换:
   ```go
   var s Snapshot
   dec := yaml.NewDecoder(bytes.NewReader(data))
   dec.KnownFields(true)
   if err := dec.Decode(&s); err != nil {
       return nil, err
   }
   ```
   ⚠ 需要加 `import "bytes"`（state.go 当前未导入 bytes）。

4. 注意 `ModelDef` 有自定义 `UnmarshalYAML` 方法（config.go:41），KnownFields true 不影响自定义解码器。

5. **向后兼容**: 现有 config.yaml 如果有未知字段（比如旧版本移除的字段），启用 KnownFields 后会报错。检查当前 config.yaml 确认无遗留字段（从审查看当前无）。但旧版的 `state.yaml` 有 `status:` 字段（schema 漂移 P3），启用 KnownFields 后会报错。因此 **state.go 的 Load 应保留宽松模式或做 version 迁移**，仅 config.go 启用 KnownFields。

**修正**: 仅对 `config.go` 启用 `KnownFields(true)`，`state.go` 暂时保留宽松模式（因 state.yaml 有旧 schema 字段漂移）。

**验证**:
1. 修改 config.yaml 故意拼错字段名（`baseurl` 代替 `baseUrl`）→ 启动应报错。
2. `go test ./internal/config/...` 通过（可能需要修改测试用例中的 config.yaml 样本以匹配严格模式）。

---

### 2.6 config.Save 双失败返回 error

**文件**: `internal/config/config.go`

**问题**: `Save` 在 rename 和 direct-write 双失败时返回 `nil`（第 257 行），调用方误以为已保存。实际上 `.tmp` 保留了数据，但 API handler 没有感知。

**当前代码** (`internal/config/config.go:254-257`):
```go
if writeErr := os.WriteFile(path, data, 0644); writeErr != nil {
    return nil  // ← 双失败但仍返回 nil
}
```

**修复方案**: 双失败时返回 error，让 API handler 正确告知用户保存失败。

**具体操作**:

将 config.go:254-257 改为:

```go
if writeErr := os.WriteFile(path, data, 0600); writeErr != nil {
    // Both rename and direct write failed — target is actively locked.
    // .tmp retains the data; it will be applied on next restart via Load.
    // Return an error so the caller knows the state is not persisted to path.
    return fmt.Errorf("config file is locked (both rename and direct write failed); pending changes saved to %s and will be applied on next restart", tmp)
}
```

同理修改 `internal/state/state.go:88-90`:
```go
if writeErr := os.WriteFile(path, data, 0600); writeErr != nil {
    return fmt.Errorf("state file is locked; pending changes saved to %s", tmp)
}
```

**验证**: 当路径不可写时 `config.Save` 返回 error。API handler 已有 `if err := config.Save(...)` 检查。

---

### 2.7 config.Load .tmp 恢复改用 mtime 比较

**文件**: `internal/config/config.go`

**问题**: `Load` 只要 `path+".tmp"` 存在就优先 rename 覆盖 path（第 172-187 行），无条件。边界情况下可能用遗留的 `.tmp` 覆盖更新的 `path`。

**当前代码** (`internal/config/config.go:171-186`):
```go
tmp := path + ".tmp"
if _, err := os.Stat(tmp); err == nil {
    if renameErr := os.Rename(tmp, path); renameErr != nil {
        // ...
    }
}
```

**修复方案**: 比较 `.tmp` 和 `path` 的 mtime，只当 `.tmp` 比 `path` 新时才恢复。

**具体操作**:

将 `config.go:171-187` 改为:

```go
tmp := path + ".tmp"
if tmpInfo, err := os.Stat(tmp); err == nil {
    pathInfo, pathErr := os.Stat(path)
    applyTmp := true
    if pathErr == nil && pathInfo != nil && tmpInfo != nil {
        // 只当 .tmp 比 path 更新时才恢复
        applyTmp = tmpInfo.ModTime().After(pathInfo.ModTime())
    }
    if applyTmp {
        if renameErr := os.Rename(tmp, path); renameErr != nil {
            tmpData, readErr := os.ReadFile(tmp)
            if readErr == nil {
                if writeErr := os.WriteFile(path, tmpData, 0600); writeErr == nil {
                    _ = os.Remove(tmp)
                } else {
                    var cfg Config
                    dec := yaml.NewDecoder(bytes.NewReader(tmpData))
                    dec.KnownFields(true)
                    if err := dec.Decode(&cfg); err != nil {
                        return nil, fmt.Errorf("parse pending config (.tmp): %w", err)
                    }
                    return finalizeConfig(&cfg, tmpData), nil
                }
            }
        }
    } else {
        // .tmp 比 path 旧，可能是过时残留，删除它
        _ = os.Remove(tmp)
    }
}
```

**验证**: 创建一个旧的 `.tmp` 和新的 `path`，启动后 `path` 不被覆盖。

---

### 2.8 finalizeConfig 补 StatePersist/StatePath 默认值

**文件**: `internal/config/config.go`

**问题**: `finalizeConfig` 未对 `Rotation.StatePersist`/`StatePath` 兜底。旧版 config.yaml 缺这两字段时 `StatePersist` 为 `false`，静默禁用状态持久化。

**当前代码** (`internal/config/config.go:209-233`): 未对 StatePersist/StatePath 做兜底。

**修复方案**: 在 `finalizeConfig` 中补默认值。

**具体操作**:

在 `finalizeConfig` 的末尾、`return` 之前添加:

```go
// StatePersist 默认 true（向后兼容旧 config 无此字段时启用持久化）
if !cfg.Rotation.StatePersist && !bytes.Contains(raw, []byte("state_persist")) {
    cfg.Rotation.StatePersist = true
}
if cfg.Rotation.StatePath == "" {
    cfg.Rotation.StatePath = "state.yaml"
}
```

**验证**: 删除 config.yaml 中的 `state_persist` 和 `state_path` 字段 → 启动后持久化仍启用，state.yaml 正常写入。

---

## 第三波 P3 建议后续版本推进

### 3.1 前端 t() 占位符统一转义

**文件**: `web/static/i18n.js`

**问题**: `t(key, args)` 的 `{0}` 占位符仅做字符串替换不转义。调用方将其拼入 `innerHTML`（如 providers.js:121 `t('invalidProvider', [result.error])`），构成 XSS。

**当前代码** (`web/static/i18n.js:253-263`):
```js
function t(key, args) {
  var lang = document.documentElement.getAttribute('data-lang') || 'en';
  var dict = L[lang] || L['en'];
  var msg = dict[key] || (L['en'][key] || key);
  if (args) {
    for (var i = 0; i < args.length; i++) {
      msg = msg.replace('{' + i + '}', args[i]);
    }
  }
  return msg;
}
```

**修复方案**: 在 `t()` 内对 `args` 统一 `escapeHtml`。

**具体操作**:

修改 `t` 函数:

```js
function t(key, args) {
  var lang = document.documentElement.getAttribute('data-lang') || 'en';
  var dict = L[lang] || L['en'];
  var msg = dict[key] || (L['en'][key] || key);
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var safeArg = (typeof args[i] === 'string') ? escapeHtml(args[i]) : args[i];
      msg = msg.replace('{' + i + '}', safeArg);
    }
  }
  return msg;
}
```

⚠ 注意：`escapeHtml` 定义在 `app.js:69`，`i18n.js:253` 的 `t` 函数可以引用它（全局作用域）。但需确保 `app.js` 在 `i18n.js` 之前加载，或将 `escapeHtml` 与 `t` 合并到同一文件的临近位置。

检查 `index.html` 中的 script 加载顺序确认 `app.js` 在 `i18n.js` 之前。（实际操作时需确认。）

**验证**: 在 `validateProvider` 响应中返回含 `<script>` 的 error → `t('invalidProvider', [...]` 渲染时 HTML 被转义，不执行。

---

### 3.2 Playground source href 协议白名单

**文件**: `web/playground/static-pg/pg-render.js`

**问题**: 第 141 行 `s.href` 仅经 `pgEscapeHtml` 转义但不剥离 `javascript:` 协议。`<a href="javascript:...">` 点击时执行脚本。

**当前代码** (`web/playground/static-pg/pg-render.js:140-144`):
```js
return '<a class="pg-source-item" href="' + pgEscapeHtml(s.href) + '" target="_blank" rel="noreferrer">' +
  '<span class="pg-source-idx">[' + (si + 1) + ']</span>' +
  '<span>' + pgEscapeHtml(s.title || s.href) + '</span></a>';
```

**修复方案**: 校验协议白名单，仅允许 `http:`、`https:`。

**具体操作**:

在 `pg-render.js` 顶部（或 `pg-core.js`）添加协议校验函数:

```js
function pgSafeHref(href) {
  try {
    var u = new URL(href, window.location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.href;
    }
  } catch (e) {}
  return '#'; // 不安全 href 降级为无效链接
}
```

修改第 141 行:
```js
return '<a class="pg-source-item" href="' + pgEscapeHtml(pgSafeHref(s.href)) + '" target="_blank" rel="noreferrer noopener">' +
```

**验证**: 构造 LLM 返回包含 `javascript:alert(1)` 的 source → 点击不执行脚本。

---

### 3.3 a11y 图标按钮补 aria-label

**文件**: `web/static/index.html`, `web/static/index-nopg.html`, 前端 JS 动态创建图标按钮处

**问题**: 顶栏 `lang-btn`/`theme-btn`/`font-btn` 等图标按钮仅用 `title` 无 `aria-label`，SVG 未标 `role="img"`/`aria-hidden`，屏幕阅读器体验差。

**修复方案**: 为所有图标按钮补 `aria-label`；SVG 标 `aria-hidden="true"`。

**具体操作**:

1. `index.html` 中找到所有 icon-only button（lang-btn/theme-btn/font-btn 等）添加 `aria-label`。
2. 在 JS 动态创建按钮处（如 providers.js 中的 `<button>` + `<svg>`），添加 `aria-label` 和 `aria-hidden`。
3. 标记节为可选/改进项，不阻塞发布。

---

### 3.4 build tag webview ⇒ tray 互斥约束

**文件**: `host_webview_other.go`

**问题**: `go build -tags webview`（不带 tray）缺 `runHostLoop`，编译失败。现状 build.ps1 不触发，但缺互斥约束是脚枪。

**当前 `host_webview_other.go`**:
```go
//go:build webview && !windows
```

**修复方案**: 给 `host_webview_other.go` 加 tray 约束，或在 `host_webview_stub.go` 中补全。

**具体操作**:

在 `host_webview_other.go` 顶部 build constraint 改为:
```go
//go:build tray && webview && !windows
```

同时在代码中添加注释说明 `webview` 必须与 `tray` 同时使用。

可选：新建 `host_*.go` 文件处理 `webview && !tray` 组合，或者直接在 代码中 panic 强制约束。

**验证**: `go build -tags webview ./...` 编译报错（清晰的约束错误），`go build -tags "tray,webview" ./...` 正常。

---

### 3.5 dist/ 加入 .gitignore

**文件**: `.gitignore`

**问题**: `dist/` 存放构建产物，`.gitignore` 未显式忽略，`dist/checksums-sha256.txt` 等可能被误提交。

**具体操作**:

在 `.gitignore` 末尾添加:
```
# Build output
dist/
```

**验证**: `git status` 不显示 dist/ 下文件。

---

### 3.6 go.mod 将 x/sys 标为直接依赖

**文件**: `go.mod`

**问题**: `golang.org/x/sys` 当前标为 `// indirect`，但 webview 变体直接导入。

**具体操作**:

在 1.6 升级 x/sys 后，运行:
```powershell
go mod tidy
```

确认 go.mod 中 `golang.org/x/sys` 移到了 `require` 块（直接依赖），不再有 `// indirect`。

---

### 3.7 UpdateProvider 支持更多字段更新

**文件**: `internal/registry/providers.go`

**问题**: `UpdateProvider` (providers.go:72-87) 仅更新 `Name/Prefix/BaseURL/IsActive/RotationStrategy/StickyLimit`，不更新 `APIType`/`Keys`/`Models`/`InjectStreamOpts`/`NormalizeStreamChunks`/`NIMConfig`。

**具体操作**:

在 `UpdateProvider` 中添加更多字段更新:
```go
func (r *Registry) UpdateProvider(id string, updates config.Provider) bool {
    r.cfgMu.Lock()
    defer r.cfgMu.Unlock()
    for i := range r.config.Providers {
        if r.config.Providers[i].ID == id {
            r.config.Providers[i].Name = updates.Name
            r.config.Providers[i].Prefix = updates.Prefix
            r.config.Providers[i].BaseURL = updates.BaseURL
            r.config.Providers[i].APIType = updates.APIType
            r.config.Providers[i].IsActive = updates.IsActive
            r.config.Providers[i].RotationStrategy = updates.RotationStrategy
            r.config.Providers[i].StickyLimit = updates.StickyLimit
            r.config.Providers[i].InjectStreamOpts = updates.InjectStreamOpts
            r.config.Providers[i].NormalizeStreamChunks = updates.NormalizeStreamChunks
            r.config.Providers[i].NIMConfig = updates.NIMConfig
            // 注意：Keys 和 Models 不在此更新，需通过专门的 key/model CRUD API
            return true
        }
    }
    return false
}
```

⚠ 注意：不在此更新 `Keys`（通过 `createKey`/`updateKey`/`deleteKey` API 操作）和 `Models`（通过 `addProviderModel` 等 API 操作），以避免误覆盖。

**验证**: `go test ./internal/registry/...` 通过。

---

### 3.8 补 SSE 端到端测试 + registry CRUD 单测

**文件**: 新增 `internal/proxy/stream_e2e_test.go`, `internal/registry/crud_test.go`

**问题**: `streamResponse` 0% 覆盖——这是项目核心的 SSE 流式透传函数。`registry` CRUD 4.3% — CRUD 全无直接测试。

**具体操作**:

1. 新建 `internal/proxy/stream_e2e_test.go`:
   - 用 `httptest.NewServer` 模拟上游 SSE 响应
   - 用 `httptest.NewRecorder` 验证流式输出
   - 测正常流式（分块到达）、流尾无 `\n`、`[DONE]` 无 `\n`、normalize vs 非 normalize（验证 1.4 修复后无重复）
   - 测 token 提取、usage 记录被调用
   - 测客户端断开（通过 cancel context）goroutine 退出

2. 新建 `internal/registry/crud_test.go`:
   - `AddProvider` + `GetProvider` + `HasProvider`
   - `AddKey` + `HasKey` + `DeleteKey` + `DeleteProvider`（状态是否被清理）
   - `UpdateProvider` 返回 false 对不存在的 ID
   - `DeleteProvider` 返回 false 对不存在的 ID
   - 并发：多个 goroutine 同时 Add/Delete，验证无 panic

3. 修改假测试:
   - `TestInjectStreamOptions` (`handler_test.go:519`): 改为构造带 `InjectStreamOpts:true` 的 provider + mock upstream 返回 200，走 `ChatCompletions`，断言请求体含 `stream_options.include_usage`。
   - `TestRecordUsage` (`handler_test.go:443`): 添加对 `usageBuf.All()` 结果的断言。
   - `TestComboResponse` (`handler_test.go:643`): 与 `TestWriteError` 重复，删除或重命为真正的 combo 测试。

**验证**: `go test -cover ./internal/proxy/...` 覆盖率 > 75%，`go test -cover ./internal/registry/...` 覆盖率 > 70%。

---

### 3.9 补 quota.go / ratelimit.go / ClassifyError 单测

**文件**: 新增 `internal/usage/quota_test.go`, `internal/rotation/ratelimit_test.go`, `internal/rotation/error_rules_test.go`

**问题**: `quota.go` 全 0%，`ratelimit.go` 全 0%，`error_rules.go:ClassifyError` 0%。

**具体操作**:

1. `quota_test.go`: 测 `Update`/`RemoveKey`/`All`/`RenameProvider`/`Clear`。
2. `ratelimit_test.go`: 测 `GetAdapter`/`ModelScopeAdapter.ParseHeaders`/`HasQuota`/`ModelExhausted`/`atoiSafe`。
3. `error_rules_test.go`: 测规则表优先级、text vs status 回退、transient 兜底。

**验证**: `go test -cover ./internal/usage/...` > 80%，`go test -cover ./internal/rotation/...` > 85%。

---

### 3.10 修复假测试

已在 3.8 中描述。

---

### 3.11 server_manager 补 MaxHeaderBytes

**文件**: `server_manager.go`

**当前代码** (`server_manager.go:40-46`):
```go
m.srv = &http.Server{
    Addr:         m.addr,
    Handler:      m.handler,
    ReadTimeout:  300 * time.Second,
    WriteTimeout: 300 * time.Second,
    IdleTimeout:  120 * time.Second,
}
```

**修复方案**: 添加 `MaxHeaderBytes`。

**具体操作**:

```go
m.srv = &http.Server{
    Addr:            m.addr,
    Handler:         m.handler,
    ReadTimeout:     300 * time.Second,
    WriteTimeout:    300 * time.Second,
    IdleTimeout:     120 * time.Second,
    MaxHeaderBytes:  1 << 20, // 1 MB
}
```

---

### 3.12 SSE 流读取监听 r.Context().Done()

**文件**: `internal/proxy/stream.go`

**问题**: 流读取循环 (`stream.go:123-210`) 仅靠 `w.Write` 的 error 检测客户端断开。在两次上游 chunk 之间的长空闲期 Read 会阻塞，直到客户端断开且下次数据到达才能发现。

**修复方案**: 在读取循环中使用 `select` 或用 `resp.Body` 配合 context。

**注意**: Go 的 `http.Response.Body` 的 `Read` 不直接支持 context 取消，但 `client.Do(req)` 当 request context 被取消时，`resp.Body` 的 `Read` 会立即返回 error。因此 1.5 修复（传播 context 到上游请求）已部分解决此问题——客户端断开后 `r.Context()` 被取消，上游 `client.Do` 的 context 也被取消，`resp.Body.Read` 会返回 error。

**结论**: 1.5 修复已覆盖此场景，无需额外代码。标记为已由 1.5 解决。

---

### 3.13 http.Client.Timeout 300s 截断长 SSE 流

**文件**: `internal/proxy/handler.go`

**问题**: `http.Client.Timeout=300s` 包含响应体读取全过程，对 SSE 长 流式响应可能 300s 后强制中断。

**当前代码** (`internal/proxy/handler.go:43-45`):
```go
client: &http.Client{
    Timeout: 300 * time.Second,
},
```

**修复方案**: 流式请求的 client 不设 `Timeout`（或设为 0=无限），改由 `r.Context()` 控制连接生命周期（1.5 已传播 context）。

**具体操作**:

1. 在 `Handler` 中添加两个 client:
   ```go
   type Handler struct {
       // ... 现有字段
       client     *http.Client // 非流式：有超时
       streamClient *http.Client // 流式：无超时，由 context 控制
   }
   ```

2. `New` 中初始化:
   ```go
   client: &http.Client{ Timeout: 300 * time.Second },
   streamClient: &http.Client{}, // 无超时
   ```

3. `forwardUpstream` 中根据 `isStream` 选择 client:
   ```go
   func (h *Handler) forwardUpstream(ctx context.Context, sel *rotation.SelectedKey, body []byte, headers http.Header, isStream bool, path string) (*http.Response, error) {
       // ... 构建 req
       if isStream {
           return h.streamClient.Do(req)
       }
       return h.client.Do(req)
   }
   ```

4. 非流式保持 300s 超时上限。

**验证**: 流式请求超过 300s 不被中断。非流式请求 300s 超时正常。

---

### 3.14 5xx 错误补短退避

**文件**: `internal/proxy/retry.go`

**问题**: 5xx 错误无退避直接轮转，上游持续 5xx 时快速遍历所有 key 后返回 "all keys exhausted"，对上游形成瞬时重试风暴。

**修复方案**: 对 5xx 加短退避（如 500ms-2s）。

**具体操作**:

在 `retry.go` 的 `handleUpstreamError` 处，5xx 分支加短等待:
```go
// 5xx short backoff to avoid hammering upstream
backoff := 500 * time.Millisecond
if state.consecutive5xx > 1 {
    backoff = time.Duration(state.consecutive5xx) * time.Second
    if backoff > 5*time.Second {
        backoff = 5 * time.Second
    }
}
select {
case <-r.Context().Done():
    return false
case <-time.After(backoff):
}
```

⚠ 注意：需在 `retryState` 中跟踪 `consecutive5xx` 计数。非强制项，可作为改动建议。

---

## 每波结束后的验证清单

### 第一波完成后

```powershell
# 编译验证
go build -o NUL .
go build -tags tray -o NUL .
go build -tags "tray,webview" -o NUL .
go build -tags "tray,webview,playground" -o NUL .

# 静态检查
go vet ./...

# 测试
go test ./...
go test -race ./...

# 手动验证
# 1. 浏览器从 http://localhost:<other-port> 的页面 fetch http://127.0.0.1:<port>/api/providers → 应被 CORS 阻止
# 2. POST /api/providers {"baseUrl":"http://169.254.169.254/"} → 应返回 400
# 3. 这个检测需要 GitHub CVE-2026-39824 详情确认后再复核
# 4. ls -la config.yaml → 权限 0600 (Linux/WSL)
# 5. 非流式请求 → 响应 200，无需验证 SSE
# 6. 流式请求（非 normalize、流尾无 \n）→ 客户端无双块
# 7. 流式请求 → 在服务端一直阻塞状态下，客户端断开 → 服务端上游连接被取消
# 8. go mod graph | grep "x/sys" → 版本 >= v0.45.0
```

>

### 第二波完成后

```powershell
# 编译验证（同第一波）
go build -o NUL .
go build -tags "tray,webview,playground" -o NUL .

# 静态检查
go vet ./...

# 测试（需先更新旧测试中可能受 KnownFields 影响的用例）
go test ./...
go test -race ./...

# 手动验证
# 1. 先等待 key 被 429 冷却 → 通过 UI 新增 provider → 原 key 仍处于冷却（2.1 merge 生效）
# 2. 通过 UI 改全局 rotation strategy → 下次请求使用新策略（2.2 生效）
# 3. 发送 >32MB body 到 /v1/chat/completions → 返回 400/413（2.3 生效）
# 4. 故意在 config.yaml 拼错字段名 baseUrl → 启动报错（2.5 KnownFields 生效）
# 5. 启动时检查 .tmp 比较逻辑（2.7 生效）：手动创建旧 .tmp 和新 path，启动后 path 不变
# 6. 迁移 config.yaml 删除 state_persist 字段 → 启动后 StatePersist 默认 true（2.8 生效）
```

>

### 第三波完成后

```powershell
# 编译验证
go build -o NUL .
go build -tags "tray,webview,playground" -o NUL .

# 全量测试 + race
go test ./...
go test -race ./...
go test -cover ./...

# 覆盖率目标
# internal/proxy > 75%
# internal/registry > 70%
# internal/usage > 80%
# internal/rotation > 85%

# 前端验证
# 1. 开 DevTools Console → 检查无 XSS 告警
# 2. 在浏览器中测试 playground（主要交互：新建对话、自动对话、群聊）
# 3. 用 aXe 插件检查无障碍
```

>

### 最终发布前

```powershell
# 全变体构建
./build.ps1 -All

# 检查产物大小（与 CLAUDE.md 中记录对比）
Get-ChildItem dist/ | Select-Object Name, Length

# 清理
git status  # 确认无意外提交
```

>

## 附：评审中确认的设计亮点（不需要改动）

以下设计在评审中表现优秀，不需要改动：

1. **三层锁分层**（`cfgMu`/`stateMu`/per-key `mu`）顺序全局一致，无死锁，`-race` 全绿
2. **日志脱敏**：只打 `Key.Name`，`maskURL` 截断，探测响应主动删 `Authorization` 头
3. **429 处理分层精细**：NIM 阶梯冷却 / ModelScope 日配额 / SenseNova rpm/tpm / 通用退避，均带 ctx 取消感知
4. **Broadcaster 扇出设计**：非阻塞 channel + `sync.Once` 幂等退订
5. **SSE normalize 路径**正确处理 `choices:null` 畸形块
6. **每日配额锁到 CST 00:05**，时区带兜底
7. **配置/状态原子写** tmp+rename，Windows 锁定有 direct-write 兜底
8. **去抖落盘** 500ms + `time.AfterFunc` 复用 timer
9. **13 构建变体矩阵**清晰正交，纯 Go 无 CGO
10. **前端转义纪律**总体好（escapeHtml 覆盖核心路径），Playground DOMPurify 管线到位
11. **严格 localhost 绑定**，端口变化也不泄露到 `0.0.0.0`
12. **yatterYAML 安全**（yaml.v3 不执行代码）
13. **SSE 订阅**正确监听 `r.Context().Done()` + defer 退订
14. **前端 eventsource 连接**带可见性重连
15. **零 FOUC** 主题/语言引导脚本
16. **Playground 功能完整度高**：分屏/自动对话群聊/Mermaid/KaTeX/HTML 预览/多模态

---

## 文件变更索引（按出现顺序）

| 文件 | 波次 | 变更类型 |
|---|---|---|
| `internal/api/router.go` | 1.1 | 移除全局 CORS `*`，改仅对 /v1/* 设置 CORS |
| `internal/proxy/stream.go` | 1.1, 1.4 | 移除硬编码 CORS `*`；修复非 normalize 尾行重复写出 |
| `internal/api/providers_models_probe.go` | 1.1 | 移除硬编码 CORS `*` |
| `internal/api/handlers.go` | 1.2, 1.4(内联), 2.3, 2.7 | 加入 BaseURL 校验；加入 MaxBytesReader；updateSettings 中添加 selector.UpdateSettings |
| `internal/api/url_validation.go` | 1.2 | 新增文件 |
| `internal/config/config.go` | 1.3, 2.5, 2.6, 2.7, 2.8 | 权限 0600；KnownFields(true)；双失败返回 error；.tmp mtime 比较；补 StatePersist 默认值 |
| `internal/state/state.go` | 1.3 | 权限 0600 |
| `main.go` | 1.3 | lock 文件权限 0600 |
| `internal/proxy/upstream.go` | 1.5 | 传播 r.Context()，改用 http.NewRequestWithContext |
| `internal/api/providers_validate.go` | 1.5(间接) | probeUpstream 也传入 ctx |
| `go.mod` / `go.sum` | 1.6, 3.6 | 升级 golang.org/x/sys；标为直接依赖 |
| `internal/registry/registry.go` | 2.1 | reloadStatesLocked 改 merge 语义 |
| `internal/rotation/selector.go` | 2.2 | （无代码变更，UpdateSettings 已存在） |
| `internal/proxy/handler.go` | 2.3, 3.13 | MaxBytesReader；streamClient 分离 |
| `host_webview_other.go` | 3.4 | build constraint 补 tray |
| `.gitignore` | 3.5 | 加 dist/ |
| `internal/registry/providers.go` | 3.7 | UpdateProvider 补字段 |
| `internal/proxy/stream_e2e_test.go` | 3.8 | 新增测试文件 |
| `internal/registry/crud_test.go` | 3.8 | 新增测试文件 |
| `internal/proxy/handler_test.go` | 3.10 | 修复假测试 |
| `internal/usage/quota_test.go` | 3.9 | 新增测试文件 |
| `internal/rotation/ratelimit_test.go` | 3.9 | 新增测试文件 |
| `internal/rotation/error_rules_test.go` | 3.9 | 新增测试文件 |
| `server_manager.go` | 3.11 | 补 MaxHeaderBytes |
| `internal/proxy/retry.go` | 3.14 | 5xx 短退避（可选） |
| `web/static/i18n.js` | 3.1 | t() 占位符 escapeHtml |
| `web/playground/static-pg/pg-render.js` | 3.2 | source href 协议白名单 |
| `web/playground/static-pg/pg-core.js` | 3.2 | pgSafeHref 函数 |
| `web/static/index.html` | 3.3 | aria-label |
| `web/static/index-nopg.html` | 3.3 | aria-label |

---

## 实施顺序（建议在新对话中的操作步骤）

1. 阅读本文件 (`auditfix.md`) 了解完整计划
2. 阅读 `CLAUDE.md` 了解项目约定（无数据库/无鉴权/无前端框架）
3. 执行第一波（6 项 P1）→ 验证 → 自由测试
4. 执行第二波（8 项 P2）→ 验证 → 测试
5. 执行第三波（14 项 P3）→ 验证 → 覆盖率提升
6. 全变体构建验证
7. 版本号 bump 到 v1.4.1（`version.go`）
8. Git commit + tag（待用户确认）

---

> 本文件由代码评审生成，包含所有修复所需的文件路径、行号、当前代码、修复方案和验证方法。新对话中可直接按列展开实施。
