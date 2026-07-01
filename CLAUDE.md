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

## 代码结构

```
main.go                     # 入口
internal/
  config/                   # 配置结构 + YAML 加载/保存
  registry/                 # Provider/Key/Combo CRUD + 运行时状态
  rotation/                 # Key 选择策略 + 冷却/退避
  combo/                    # Combo 解析 (fallback/round-robin/fusion)
  proxy/                    # /v1/* 代理处理器 (SSE 透传)
  usage/                    # 内存环形缓冲统计
  console/                  # 控制台日志捕获 + SSE 推送
  api/                      # 管理 REST API
web/
  static/                   # 内嵌 UI (HTML/JS/CSS)
```

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
- **冷却:** 指数退避 (1s→2s→4s→...→240s max)，429 日配额锁定至次日 CST 00:05，per-model 独立锁

### 6. Combo 策略 (移植自 9router `open-sse/services/combo.js`)
- **fallback:** 按顺序尝试模型，失败则下一个
- **round-robin:** 轮转选择模型
- **fusion:** 并行发送全部模型 + judge 模型裁决

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
