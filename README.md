# TinyRouter

轻量级 LLM API 代理，从 [9router](https://github.com/sst9/9router) 抽取核心功能用 Go 重写。

单二进制，内存占用 ~6 MB，内置 Web UI。

## 功能

- **多 Key 轮询** — fill-first / round-robin 两种策略，粘性轮询，指数退避冷却，429 日配额锁定，per-model 锁
- **Provider 管理** — 通过 Web UI 增删改 Provider，连接测试、模型导入、单模型测试、密钥批量添加
- **模型列表** — 自定义模型 ID，每个 Provider 独立配置
- **Rotation 覆盖** — 每个 Provider 可独立设置轮询策略，覆盖全局默认
- **前缀解析** — `ms/deepseek-chat` 格式自动解析为对应 Provider
- **Combo** — fallback / round-robin 两种组合策略，支持从 Provider 导入模型
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

## 构建变体 TinyRouter

TinyRouter 提供多套构建变体，通过 build tag 与链接器 flag 组合控制是否带托盘常驻、是否内嵌 Playg 模块、是否裁剪二进制。Windows 下推荐用 `build.ps1` 一键产出。

### 构建命令

```powershell
# 默认：console 窗口 + 自动打开浏览器 (当前行为)
./build.ps1

# 默认 + 裁剪符号表 (-s -w)
./build.ps1 -Strip

# 带 Playground 模块 (内嵌 Playground static-pg 资产)
./build.ps1 -Playground

# 托盘常驻：右下角图标右键菜单 "打开控制台/退出",无 console 窗口
./build.ps1 -Variant tray

# 托盘 + Playground + 裁剪 (最小托盘带 Playg 版)
./build.ps1 -Variant tray -Playground -Strip

# 托盘 + 原生 WebView2 独立窗口：右键菜单多一项 "打开独立窗口",弹出原生窗口加载 UI,不开浏览器
./build.ps1 -Variant webview

# Webview + Playground + 裁剪
./build.ps1 -Variant webview -Playground -Strip

# 调试版：全 DWARF/无裁剪/console 窗口，供 dlv 使用
./build.ps1 -Variant debug
```

### 构建矩阵产出文件名 (位于 `dist/`)

| Variant | Playground | Strip | 输出文件 | 体积 |
|---|---|---|---|---|
| default | 否 | 否 | `tinyrouter.exe` | ~15.15 MB |
| default | 否 | 是 | `tinyrouter-stripped.exe` | ~11.51 MB |
| default | 是 | 否 | `tinyrouter-pg.exe` | ~19.17 MB |
| default | 是 | 是 | `tinyrouter-pg-stripped.exe` | ~15.53 MB |
| tray | 否 | 否 | `tinyrouter-tray.exe` | ~15.62 MB |
| tray | 否 | 是 | `tinyrouter-tray-stripped.exe` | ~11.77 MB |
| tray | 是 | 否 | `tinyrouter-tray-pg.exe` | ~19.64 MB |
| tray | 是 | 是 | `tinyrouter-tray-pg-stripped.exe` | ~15.79 MB |
| webview | 否 | 否 | `tinyrouter-webview.exe` | ~16.02 MB |
| webview | 否 | 是 | `tinyrouter-webview-stripped.exe` | ~12.09 MB |
| webview | 是 | 否 | `tinyrouter-webview-pg.exe` | ~20.04 MB |
| webview | 是 | 是 | `tinyrouter-webview-pg-stripped.exe` | ~16.11 MB |
| debug | — | — | `tinyrouter-debug.exe` | ~15.15 MB |

### Variant 含义

- **default**: 当前行为，启动 console 子系统窗口，自动打开浏览器
- **tray**: 隐藏 console (-H windowsgui),依靠系统托盘图标驻留,右键菜单项 "打开控制台/退出"。Ctrl+C 与 UI 触发的 `POST /api/shutdown` 都会优雅退出
- **webview**: 在 tray 基础上用 WebView2 弹出原生窗口承载 UI。托盘菜单多一项 "打开独立窗口",点击后弹出 1280×800 原生窗口加载 admin 界面,关闭窗口不退出进程仍可再次打开。纯 Go + Win10/11 自带 WebView2 Runtime,无需 CGO、无需随包分发 DLL
- **debug**: 无 windowsgui,不裁剪,保留完整 DWARF 供 `dlv` 调试;Playground/Strip 开关被忽略

### Build tag 详解

- `-tags tray`: 启用 `host_tray_windows.go`,编译 `fyne.io/systray`;无此 tag 则用 `host_console.go`(原行为)
- `-tags webview`: 启用 `host_webview_windows.go`,编译 `jchv/go-webview2`(纯 Go,无 CGO);需 `-tags tray` 同时生效
- `-tags playground`: 启用 `web/embed_playground.go`,内嵌 `web/playground/static-pg` 资产;否则用 `web/embed_playground_stub.go`(空 FS)
- `-ldflags "-H windowsgui"`: Windows 链接器去掉控制台子系统,只对 tray/webview 变体生效
- `-ldflags "-s -w"`: 剥离符号表与 DWARF,约减 3.6 MB,失去 `dlv` 调试能力,运行不感知

### 图标资源

`web/static/favicon.ico` 通过 `gen-icon.ps1` 从 `web/static/logo.png` (1024×1024) 生成,内嵌 7 个尺寸 (16/24/32/48/64/128/256),覆盖托盘、资源管理器、任务栏、Alt+Tab、jumplist 全部 DPI 场景。`rsrc.syso` 自动同步,无需手动维护;改 logo 后跑 `./gen-icon.ps1` 再 `go generate ./...`。

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
