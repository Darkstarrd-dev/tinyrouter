# TinyRouter

轻量级 LLM API 代理，从 [9router](https://github.com/sst9/9router) 抽取代理功能，增加针对一些主流慈善供应商的专用机制，抽取 newAPI 的 playground 模块，魔改增加多模型同时请求测试功能、多模型聊天群聊天功能。

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
- **Monitor** — 实时流式运行白名单命令（如 `nvidia-smi -l 1`），结果内嵌于 Console 页面
- **Terminal** — Debug Mode 下开启完整交互式终端（xterm.js + WebSocket + ConPTY/PTY），支持 vim、Ctrl+C、Tab 补全；会话持久保持
- **Video Download** — 基于 yt-dlp 的视频/音频下载，支持单链接 / 播放列表、画质选择、并发分片、代理、缩略图预览与任务队列
- **Gallery** — 本地与 Zip 压缩包漫画/图片浏览器，支持递归文件夹与多层 Zip 解析、自然路径排序、目录树侧边栏、跨文件夹跳转、目录级缩略图过滤与全屏浏览
- **纯本地** — 无鉴权，无远程访问，任意 Key 或无 Key 均可访问
- **多模型同时请求测试** — 一键对多个模型并行发起请求，对比延迟/速度/配额
- **多模型聊天群聊** — 多个模型同场对话，并排对比回答

## 页面

| 页面 | 功能 |
|---|---|
| **Usage** | 实时请求统计：趋势图、Token 用量、最近请求、Quota 监控 |
| **Settings** | 监听端口、上游代理、轮询策略、超时、密码保护、Provider / Combo / QuickSlot 管理 |
| **Console** | 实时日志、Monitor 白名单命令、Terminal（Debug Mode） |
| **Download** | yt-dlp 视频/音频下载，播放列表批量、画质、代理、任务队列 |
| **Gallery** | 本地图片/Zip 漫画浏览器，支持拖拽粘贴、目录树、自动播放与全屏浏览 |
| **Playground** | 多模型同时测试、群聊对比（仅 `-tags playground` 构建包含） |

Playground 的前后端事实基线见 [`docs/playground-architecture.md`](docs/playground-architecture.md)。

## Gallery 图片浏览器

内置极速漫画与图片浏览器，支持拖拽、粘贴或选择本地图片与压缩包。

### 支持的能力

- **文件与压缩包解析**：支持单个/批量图片文件（`webp` / `png` / `jpg` / `gif` / `bmp` / `avif`）直接拖入或粘贴；支持拖入/选择包含子目录的完整文件夹及多级嵌套 Zip 压缩包（自动进行反斜杠清洗与编码修复）；
- **自然分段排序**：采用 Natural Segment Path Order，文件名与目录名自然数字排序（如 `1` -> `2` -> `10`），与 Windows 资源管理器逻辑保持一致；
- **目录树面板 (`T`)**：侧边栏展示当前压缩包或文件夹的树状层级结构，带有直属图片计数 badge，点击节点直接跳至该目录直属首图；
- **跨文件夹跳转 (`<|` / `|>`)**：一键在不同子目录或包之间来回切换；
- **目录级直属缩略图**：底部缩略图栏与页码计数（如 `5 / 206`）按当前所处的子目录进行范围过滤；
- **多档位自动播放 (`A`)**：悬停或按数字键可在 `1s` ~ `120s` 多档位间隔间快速切换自动播放；
- **物理全屏 (`F`)**：支持网页全屏与 WebView2 独立窗口系统的原生无边框全屏（覆盖任务栏与标题栏），支持全屏下鼠标右键退出；
- **进程内会话留存**：在应用内切换至其他页面（如 Usage / Playground）再切回时，自动保存加载状态与阅读位置。

## Quick Slot 快速模型切换

Quick Slot 是预设的「模型切换槽」，适合把常用的几个模型绑到一个数字键上，一键循环切换，无需打开下拉菜单。

- **添加**：Settings 页面 → Quick Slots → 新建。填写名称、`order` (1~9)、并从 Provider 导入模型。
- **绑定数字键**：`order` 决定对应哪个数字键（1→order 1，2→order 2，……，9→order 9，最多 9 个槽）。
- **循环切换**：按下对应数字键，在当前槽「已启用」的模型之间循环切换；被停用的模型会自动跳过。
- **当前选中**：顶部 header 会显示该槽的名称、当前模型的 `provider/末段模型名`，并带序号徽章；hover 显示完整 `provider/modelid`。
- **编辑**：在槽的编辑弹窗中可增删模型、拖拽排序。

> 说明：若某槽被停用 (disabled)，其数字键不再生效。当所有模型都被停用或槽为空时，按键无效。

## Video Download（需手动安装外部工具）

Download 功能基于 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 驱动，并通过 [ffmpeg](https://ffmpeg.org/) 完成音视频合并/转码。**这两个工具需要自行下载安装**，并将可执行文件路径填入 Settings → Download Settings（默认从 `PATH` 查找 `yt-dlp` 和 `ffmpeg`）。

- **yt-dlp**：<https://github.com/yt-dlp/yt-dlp/releases>（下载 `yt-dlp.exe` / `yt-dlp`，放到 PATH 或在设置中指定绝对路径）
- **ffmpeg**：<https://ffmpeg.org/download.html>（下载构建产物，把 `ffmpeg` / `ffprobe` 可执行文件放到 PATH 或在设置中指定）

### 支持的能力

- 单链接 / 播放列表批量（可勾选条目）
- 视频（最高画质 best → 最差 worst）/ 仅音频
- 容器格式：mp4 / mkv / webm / mov
- 并发分片下载、断点续传、任务队列
- 缩略图预览、状态（pending / downloading / processing / completed / error / cancelled）
- 代理（与全局上游代理解耦，单独设置）
- 默认下载目录、yt-dlp / ffmpeg 自定义路径

> **未安装 yt-dlp / ffmpeg 时**：Download 页面会提示工具未找到，任务无法启动。

## 快捷键

### 全局 / 页面导航

| 快捷键 | 功能 |
|---|---|
| `F1` | 切换到 Usage 统计页面 |
| `F2` | 切换到 Settings 页面 |
| `F3` | 切换到 Console 日志页面 |
| `F4` | 切换到 Playground 页面 |
| `F5` | 切换到 Download 页面 |
| `F6` | 切换到 Gallery 页面 |
| `1` ~ `9` | 循环切换对应 `order` 的 Quick Slot 模型（仅在非 Gallery 页面时生效） |
| `Esc` | 关闭弹窗；若没有弹窗则关闭服务器 |

### Gallery 页面专用快捷键

| 快捷键 | 功能 |
|---|---|
| `T` / `t` | 展开 / 收起侧边目录树面板（双屏下作用于 Focus 聚焦区侧边） |
| `D` / `d` | 切换【双屏模式 ▍▍ (`S`)】/【单屏模式 (`D`)】 |
| `P` / `V` / `M` / `m` | 切换【图片模式 (`V`)】/【视频模式 (`P`)】（单屏下生效） |
| `Tab` | 【双屏模式下专用】无缝切换 Focus 焦点（图片 ↔ 视频，带脉冲高亮蒙层） |
| `Up` (↑) / `Down` (↓) | 图片模式：切换文件夹；视频模式：上一个 / 下一个视频 |
| `Left` (←) / `Right` (→) | 图片模式：翻到上一张 / 下一张图片；视频模式：视频快退 / 快进 10s |
| `Space` (空格) | 图片模式：翻页；视频模式：切换播放 / 暂停 |
| `A` / `a` | 开启 / 停止图片自动播放 |
| `1` ~ `9` | 图片模式：设置自动播放间隔；视频 Focus 模式：调节音量 (11% ~ 99%) |
| `F` / `f` | 切换全屏 / 退出全屏（全屏双屏模式下开启 Aspect-Ratio 自适应比例分配） |
| `Esc` / `Enter` / `鼠标右键` | 退出全屏模式 |

> 数字键 `1`~`9` 仅在未聚焦输入框 / 无弹窗时生效，避免与正文输入冲突。

## 弹窗交互（统一行为）

所有点击弹出的弹窗（增删改 Provider / Combo / Quick Slot、导入模型、模型信息、确认框等）遵循统一规则：

- **点击弹窗外部不关闭**；
- **`Esc` / 鼠标右键 / 「取消」按钮** → 关闭弹窗；
- **`Enter`** → 触发弹窗内的主操作（主按钮）并关闭。

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

# 一次性产出全部 13 个变体到 dist/（忽略其他参数）
./build.ps1 -All

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

- `-tags tray`: 启用 `host_tray_windows.go`,编译 `fyne.io/systray`;无此 tag 则用 `host_console.go`(原行为)。在非 Windows 平台自动降级为 console 行为
- `-tags webview`: 启用 `host_webview_windows.go`,编译 `jchv/go-webview2`(纯 Go,无 CGO);需 `-tags tray` 同时生效。非 Windows 平台降级为 stub
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

# Video Download（可选）：yt-dlp / ffmpeg 路径、默认下载目录、代理
download:
  enabled: true
  ytDlpPath: ""                  # 留空走 PATH
  ffmpegPath: ""                 # 留空走 PATH
  defaultDir: ""                 # 留空走系统下载目录
  maxConcurrent: 3
  concurrentFragments: 4
  proxy: ""                      # 可选，仅作用于下载请求
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
