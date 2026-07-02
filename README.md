# TinyRouter

轻量级 LLM API 代理，从 [9router](https://github.com/sst9/9router) 抽取核心功能用 Go 重写。

单二进制，内存占用 ~6 MB，内置 Web UI。

## 功能

- **多 Key 轮询** — fill-first / round-robin 两种策略，粘性轮询，指数退避冷却，429 日配额锁定，per-model 锁
- **Provider 管理** — 通过 Web UI 增删改 Provider，连接测试、模型导入、单模型测试、密钥批量添加
- **模型列表** — 自定义模型 ID，每个 Provider 独立配置
- **Rotation 覆盖** — 每个 Provider 可独立设置轮询策略，覆盖全局默认
- **前缀解析** — `ms/deepseek-chat` 格式自动解析为对应 Provider
- **Combo** — fallback / round-robin / fusion 三种组合策略，支持从 Provider 导入模型
- **EN / CN 双语 UI** — 侧边栏一键切换
- **深色 / 浅色主题** — 玻璃拟态设计
- **内存 Usage** — 环形缓冲 (默认 500 条)，实时统计请求数/成功率/平均延迟/Token 用量
- **控制台日志** — 与 9router 格式一致的实时日志，SSE 流式推送
- **纯本地** — 无鉴权，无远程访问，任意 Key 或无 Key 均可访问

## 快速开始

```bash
# 构建
go build -o tinyrouter .

# 运行 (首次自动生成 config.yaml)
./tinyrouter

# 浏览器自动打开
# 或手动访问 http://localhost:20128
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
  - id: "prov_1"
    name: "My Provider"
    prefix: "my"
    baseUrl: "https://api.example.com/v1"
    apiType: "openai-compatible"
    isActive: true
    rotationStrategy: ""          # 空=继承全局
    stickyLimit: 0                # 0=继承全局
    keys:
      - id: "k1"
        key: "sk-xxx"
        name: "Main"
        priority: 1
        isActive: true
    models:
      - "gpt-4o"

combos:
  - id: "combo1"
    name: "Fast + Smart"
    strategy: "fallback"
    models:
      - "my/gpt-4o"
```

## 客户端配置

将客户端 (Claude Code, Cursor, OpenCode 等) 的 API Base URL 指向：

```
http://localhost:20128/v1
```

模型名格式：`{provider前缀}/{模型ID}`，例如 `ms/deepseek-chat`。

无需 API Key，任意值或留空均可。

## 使用示例

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ms/deepseek-chat",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

## License

MIT
