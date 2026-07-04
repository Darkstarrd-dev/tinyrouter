# CLAUDE.md

> Claude Code 项目指令文件。Claude Code 在此项目中工作时会自动读取此文件。

## 项目概述

TinyRouter 是从 9router (Node.js/Next.js) 中抽取核心代理功能，用 Go 重写的轻量级 LLM API 代理。

**参考来源：** `Z:\Playground\9router` — 原始项目，实施过程中作为业务逻辑参考。不要修改该目录。

## 技术栈

- **语言:** Go 1.23+
- **HTTP 路由:** `github.com/go-chi/chi/v5`
- **配置:** `gopkg.in/yaml.v3` → `config.yaml`
- **前端:** 原生 HTML + vanilla JS + CSS (通过 `embed.FS` 内嵌)
- **无数据库、无 ORM、无前端框架**

## 构建与运行

```bash
# 构建
go build -o tinyrouter .

# 运行 (首次自动生成 config.yaml)
./tinyrouter

# 运行测试
go test ./...

# 交叉编译
GOOS=linux GOARCH=amd64 go build -o tinyrouter-linux-amd64 .
GOOS=windows GOARCH=amd64 go build -o tinyrouter-windows-amd64.exe .
GOOS=darwin GOARCH=arm64 go build -o tinyrouter-darwin-arm64 .
```

## 构建变体 (Build Variants)

TinyRouter 通过 build tag + 链接器 flag 组合，提供多个构建变体。Windows 下用 `build.ps1` 一键产出。

### build.ps1 参数

```powershell
./build.ps1 [-Variant default|tray|webview|debug] [-Playground] [-Strip] [-OutputDir dist]
```

### Variant 含义

| Variant | 行为 | tags | ldflags | CGO |
|---|---|---|---|---|
| `default` | console 窗口 + 自动打开浏览器(当前行为) | — | — | 无 |
| `tray` | 系统托盘常驻,无 console 窗口,右键菜单"打开控制台/退出" | `tray` | `-H windowsgui` | 无 |
| `webview` | tray + WebView2 原生窗口(需 WebView2 Runtime) | `tray,webview` | `-H windowsgui` | 是 |
| `debug` | 全 DWARF/console 窗口,供 `dlv` 调试;Playground/Strip 被忽略 | — | — | 无 |

### 关键开关

- **-Playground**: 启用 `playground` build tag,内嵌 `web/playground/static-pg` 资产(无此 tag 用 `web/embed_playground_stub.go` 空 FS)
- **-Strip**: 加 `-ldflags "-s -w"` 剥离符号表 + DWARF,减约 3.6 MB;失去 `dlv` 调试能力,运行不感知

### 默认构建 vs 标签构建

- **无 tag** = 当前行为(console 窗口 + 浏览器),`go build -o tinyrouter .` 与 `./build.ps1` 等价
- **`-tags tray`** = 切换到 `host_tray_windows.go`,引入 `fyne.io/systray`;无此 tag 用 `host_console.go`
- **`-tags playground`** = 切换到 `web/embed_playground.go`,内嵌 Playground 资产;无此 tag 用 `web/embed_playground_stub.go`

### 8 产物矩阵 (实际体积)

| Variant | Playground | Strip | 输出文件 | 体积 |
|---|---|---|---|---|
| default | 否 | 否 | `tinyrouter.exe` | 14.75 MB |
| default | 否 | 是 | `tinyrouter-stripped.exe` | 11.12 MB |
| default | 是 | 否 | `tinyrouter-pg.exe` | 18.77 MB |
| default | 是 | 是 | `tinyrouter-pg-stripped.exe` | 15.13 MB |
| tray | 否 | 否 | `tinyrouter-tray.exe` | 15.22 MB |
| tray | 否 | 是 | `tinyrouter-tray-stripped.exe` | 11.37 MB |
| tray | 是 | 否 | `tinyrouter-tray-pg.exe` | 19.24 MB |
| tray | 是 | 是 | `tinyrouter-tray-pg-stripped.exe` | 15.39 MB |

Playground 模块增量约 +4.2 MB;Strip 减约 3.6 MB;Tray 仅增约 +0.3 MB(纯 Go,无 CGO,单 exe 无外置 DLL)。

## 代码结构

```
main.go                     # 入口(host_loop 调用点,业务逻辑)
host_console.go            !tray && !webview   # 默认: OS 信号 + UI 关停
host_tray_windows.go      tray && windows      # 托盘实现 (fyne.io/systray)
host_tray_other.go        tray && !windows     # Linux/macOS 回退到 console 行为
build.ps1                                       # 构建脚本(8+ 变体)
internal/
  config/                   # 配置结构 + YAML 加载/保存
  registry/                 # Provider/Key/Combo CRUD + 运行时状态
  rotation/                 # Key 选择策略 + 冷却/退避
  combo/                    # Combo 解析 (fallback/round-robin)
  proxy/                    # /v1/* 代理处理器 (SSE 透传)
  usage/                    # 内存环形缓冲统计
  console/                  # 控制台日志捕获 + SSE 推送
  api/                      # 管理 REST API
web/
  static/                   # 内嵌 UI (HTML/JS/CSS)
  embed_playground.go       # playground tag: 内嵌 static + playground/static-pg
  embed_playground_stub.go  # !playground tag: 空 PlaygroundStatic FS
```

## 工作流约定

本项目使用昂贵的高级模型作为计划、分配与审核中枢。

- **角色定位：** 高级模型负责将用户需求拆分为合理的任务提示词，进行任务分配，并对子 agent 的产出物进行审核。高级模型本身尽量不直接执行检索或编码，但此为优先策略而非绝对约束——当判断有必要时（如快速验证、小范围修正、紧急修复等），可自行操作。
- **代码库检索：** 通过 `task` 工具调用 `explore` agent 执行，高级模型负责构造精确的检索提示词并审核返回结果。
- **实际实施：** 通过 `task` 工具调用 `general` agent 执行，高级模型负责构造实施提示词（含上下文、约束、验收标准）并审核产出物。

## 关键设计决策

### 1. 纯本地，无鉴权
不实现任何认证机制。HTTP server 仅监听 localhost。任意 API Key 或无 Key 均可访问 `/v1/*`。

### 2. 配置持久化用 YAML，不用数据库
- `config.yaml` 存储 providers + combos + settings
- Usage 和 console logs 仅存内存，重启清零
- 文件写入用临时文件 + rename 保证原子性

### 3. OpenAI 兼容透传
不做任何格式转换。客户端发什么 body，直接转发给上游（仅替换 model 字段）。上游响应原样回传。

### 4. SSE 流式透传
使用 `http.Flusher` 逐 chunk 转发上游 SSE 响应。不解析、不修改 SSE 内容。

### 5. Key 轮询策略 (移植自 9router `src/sse/services/auth.js`)
- **fill-first:** 按 priority ASC 排序，取第一个可用 key
- **round-robin:** 粘性轮询，连续使用同一 key N 次 (stickyLimit) 后切换到最久未用的 key
- **failover:** 使用当前 key 直到失败（重试耗尽），失败后该 key 排到队尾，切下一个 key；成功则继续用当前 key
- **冷却:** 指数退避 (1s→2s→4s→...→240s max)，429 日配额锁定至次日 CST 00:05，per-model 独立锁

### 6. Combo 策略 (移植自 9router `open-sse/services/combo.js`)
- **fallback:** 按顺序尝试模型，失败则下一个
- **round-robin:** 轮转选择模型

## 9router 参考映射

实施时需要参考 9router 的以下文件：

| 功能 | 9router 文件 |
|---|---|
| Key 选择逻辑 | `src/sse/services/auth.js` → `getProviderCredentials()` |
| 冷却/退避 | `src/sse/services/auth.js` → `markAccountUnavailable()`, `clearAccountError()` |
| 代理核心 | `open-sse/handlers/chatCore.js` → `handleChatCore()` |
| 上游转发 | `open-sse/executors/default.js` |
| Combo 逻辑 | `open-sse/services/combo.js` |
| Console 日志 | `src/lib/consoleLogBuffer.js` |
| Usage 统计 | `src/lib/db/repos/usageRepo.js` |
| Model 解析 | `src/sse/services/model.js` → `getModelInfo()` |
| 错误规则配置 | `open-sse/config/errorConfig.js` |
| Dashboard 导航 | `src/shared/components/Sidebar.js` |
| Provider 常量 | `src/shared/constants/providers.js` |

## 日志格式 (与 9router 保持一致)

```
[2026-01-15 10:30:00] REQUEST deepseek | deepseek-chat | 12 msgs
[2026-01-15 10:30:00] PROXY deepseek | deepseek-chat | conn=Main | url=https://api.deepseek.com/v1/chat/completions
[2026-01-15 10:30:02] 📊 [label] deepseek | in=1234 | out=567 | conn=Main
[2026-01-15 10:30:02] 🌊 [STREAM] deepseek | deepseek-chat | 2048ms | 200
[ERROR] upstream returned 429: rate limited
```

## 编码规范

- Go 标准格式 (`gofmt` / `goimports`)
- 错误处理: 错误必须显式处理，不使用 panic
- 并发: 共享状态用 `sync.RWMutex` 保护
- 日志: 使用 `internal/console.Logger`，不直接用 `log` 标准库
- 注释: 导出函数需有文档注释
- 测试: 核心逻辑 (rotation, combo, usage) 需有单元测试

## 不要做的事

- 不要引入数据库 (SQLite, BoltDB, 等)
- 不要引入前端框架 (React, Vue, 等)
- 不要实现鉴权 (JWT, OAuth, 密码)
- 不要实现格式转换 (OpenAI ↔ Anthropic)
- 不要实现 Token Saver (RTK, Headroom, Caveman, Ponytail)
- 不要修改 `Z:\Playground\9router` 目录中的任何文件
