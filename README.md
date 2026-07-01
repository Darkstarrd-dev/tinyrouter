# TinyRouter

轻量级 LLM API 代理，从 [9router](https://github.com/sst9/9router) 抽取核心功能用 Go 重写。

单二进制，内存占用 ~15MB，内置 Web UI。

## 功能

- **多 Key 轮询** — fill-first / round-robin 两种策略，粘性轮询，指数退避冷却，429 日配额锁定，per-model 锁
- **自定义端点** — OpenAI 兼容端点，UI 增删改
- **Combo** — fallback / round-robin / fusion 三种组合策略
- **内存 Usage** — 环形缓冲 (默认 500 条)，重启清零，无数据库
- **控制台日志** — 与 9router 格式一致的实时日志，UI 中 SSE 流式查看
- **纯本地** — 无鉴权，无远程访问，任意 Key 或无 Key 均可访问

## 快速开始

```bash
# 构建
go build -o tinyrouter .

# 运行 (首次自动生成 config.yaml)
./tinyrouter

# 浏览器打开
open http://localhost:20128
```

## 配置

编辑 `config.yaml` 或通过 Web UI 管理：

```yaml
port: 20128
consoleLogMaxLines: 200
usageRingSize: 500

rotation:
  strategy: "fill-first"
  stickyLimit: 3
  maxRetries: 5
  retryDelaySec: 5
  backoffMaxSec: 240

providers:
  - id: "deepseek"
    name: "DeepSeek"
    prefix: "deepseek"
    baseUrl: "https://api.deepseek.com"
    apiType: "openai-compatible"
    isActive: true
    keys:
      - id: "k1"
        key: "sk-xxx"
        name: "Main"
        priority: 1
        isActive: true

combos:
  - id: "combo1"
    name: "Fast + Smart"
    strategy: "fallback"
    models:
      - "deepseek/deepseek-chat"
```

## 客户端配置

将客户端 (Claude Code, Cursor 等) 的 API Base URL 指向：

```
http://localhost:20128/v1
```

无需 API Key，任意值或留空均可。

## 使用示例

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek/deepseek-chat",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

## 与 9router 的差异

| 特性 | 9router | TinyRouter |
|---|---|---|
| 运行时 | Node.js / Next.js | Go 单二进制 |
| 内存 | 200–400 MB | 10–25 MB |
| 数据库 | SQLite | 无 (YAML + 内存) |
| 鉴权 | JWT / OAuth / 密码 | 无 (纯本地) |
| 格式互转 | OpenAI ↔ Claude ↔ GLM | 仅 OpenAI 兼容透传 |
| Token Saver | RTK / Headroom / Caveman / Ponytail | 无 |
| Quota Tracker | 有 | 无 |
| CLI Tools | 16 个工具 | 无 |
| OAuth Providers | 有 | 无 |
| Tunnel / Tailscale | 有 | 无 |
| 部署物 | ~500 MB | ~15 MB |

详细实施方案见 [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)。

## License

MIT
