# TinyRouter

> **About**  
> **Lightweight Utilities bundled local based API router, AI Chat, Image Generation, Stream Video Download Manager, Image Viewer, Video Player ....... with extremely tiny size.**

TinyRouter 是一个极轻量级的本地端 AI 工具箱与 API 代理引擎。它以单二进制交付（解压即用、零外部依赖、极低内存占用），在提供 OpenAI 兼容代理与 Key 轮询退避能力的同时，深度集成了多模型 AI Playground、AI 联网检索、图像生成、流式音视频下载器、多媒体画廊（图片/漫画浏览器与视频播放器）以及交互终端与实时监控等核心功能。

---

## 核心功能概览

### 1. 🔀 API Router & Provider Rotation (API 代理与轮询引擎)
- **多 Key 轮询与智能退避**：支持 `fill-first`（按优先级填充）与 `round-robin`（粘性轮询）策略，提供指数退避冷却、429 日配额自动锁定与 per-model 独立锁机制。
- **Provider & Combo 管理**：支持动态增加与管理 Provider、模型批量导入、连通性测试；支持 `fallback` / `round-robin` / `greedy-squirrel` 三种 Combo 组合策略。
- **协议兼容与改写**：OpenAI / Anthropic / NVIDIA NIM 原生兼容，支持模型前缀自动路由解析（如 `ms/deepseek-chat`）。

### 2. 🧪 Playground (AI 多模型混合引擎)
- **Normal 模式**：支持 1~4 窗口自由分割，对多个模型并行发起对话，对比回复延迟、生成速度与 Token 用量。
- **Search 模式**：AI 联网检索合成模式。自动意图提取 → 调用 AnySearch 检索 → 左屏展示策略与 Raw 抓取结果、右屏流式合成 Synthesized 回复，并支持 Markdown 结构自动修复与删除单条 Search 历史。
- **Image 模式**：AI 图像生成与创作控制台，支持画质比例预设管理与多尺寸切换。
- **Auto (AutoChat) 模式**：多模型自动群聊与碰撞测试。设定角色与主题后，多个 AI 自动在多窗口间轮流对话与辩论。

### 3. ⬇️ Stream Video Download Manager (音视频下载管理器)
- 基于 `yt-dlp` 与 `ffmpeg` 驱动，支持单链接解析与播放列表批量下载。
- 支持最高画质选择、仅提取音频、并发分片下载、代理设置、缩略图预览与任务队列生命周期管理。

### 4. 🖼️ Gallery (Image Viewer & Video Player 多媒体画廊)
- **图片与漫画浏览器**：支持单图/多图拖拽与粘贴、本地文件夹及多层 Zip 压缩包秒解解析，采用自然段排序（Natural Segment Path Order）。
- **视频播放器**：支持状态感知连贯播放（State-Aware Continuity）与视频预览。
- **分屏与多模式**：支持独立 Sub-Panel 左图右视频双屏 (`D`)、全屏黄金比例自适应排布 (`F`)、媒体模式切换 (`M`) 与直属计数目录树 (`T`)。

### 5. 💻 Terminal & Monitor (交互终端与系统监控)
- **Monitor**：实时流式运行白名单监控命令（如 `nvidia-smi -l 1`），结果内嵌于控制台。
- **Terminal**：Debug 模式下提供完整 PTY 交互式终端（xterm.js + WebSocket + ConPTY/PTY），支持 vim、Ctrl+C 与 Tab 自动补全。

---

## 详细功能指南与快捷键

### 页面全局导航

| 快捷键 | 功能说明 |
|---|---|
| `F1` | 快速切换到 **Usage** (实时统计与用量监控) 页面 |
| `F2` | 快速切换到 **Settings** (配置、Provider 与 Combo 管理) 页面 |
| `F3` | 快速切换到 **Console** (日志、Monitor 与 Terminal) 页面 |
| `F4` | 快速切换到 **Playground** (多模型对话与 AI 测试) 页面 |
| `F5` | 快速切换到 **Download** (视频/音频下载管理器) 页面 |
| `F6` | 快速切换到 **Gallery** (图片/漫画/视频画廊) 页面 |

---

### Playground 专属快捷键与操作手势

Playground 支持每个模式独立的“状态沙盒”与消息隔离，随时自由双向切换：

| 快捷键 | 功能说明 |
|---|---|
| `Alt + ~` | **聚焦输入框**：快速将光标聚焦到底部的 Prompt Input 文本框 |
| `Alt + 1` | 切换到 **Normal** (多模型对话与请求测试) 模式 |
| `Alt + 2` | 切换到 **Search** (AI 联网检索与双屏比对) 模式 |
| `Alt + 3` | 切换到 **Image** (AI 图像生成) 模式 |
| `Alt + 4` | 切换到 **Auto** (多模型自动群聊碰撞) 模式 |
| `Alt + C` | **清空聊天**：清空当前模式下的会话历史记录 (`Clear Chat`) |
| `Ctrl + 1` ~ `4` | **切换窗口数量**：一键切换 Playground 当前显示 1 ~ 4 个窗口屏数 (Auto 模式限定最少 2 窗口) |
| `Shift + 1` ~ `4` | **切换活动焦点窗口**：快速将活动编辑窗口切换到第 1 ~ 4 窗口（输入框打字时自动放行放误触） |

#### Search 模式操作手势：
- **历史记录一键删除**：侧边栏 Search History 中的每一个历史记录项右侧均带有红色圆形 `✕` 删除按钮，支持独立移除单条历史。
- **Markdown 结构修复**：左侧 Raw 抓取结果与右侧 Synthesized 回复卡片底部提供修复与 Markdown 保存按钮 (`↺` / `💾`)。

---

### Gallery (画廊 & 视频播放器) 快捷键

| 快捷键 | 功能说明 |
|---|---|
| `Space` | **播放 / 暂停**：播放或暂停当前视频 |
| `F` | **全屏模式**：切换网页全屏 / 原生无边框全屏 (支持鼠标右键一键退出) |
| `D` | **切换视图**：切换单屏 (Single View) / 左图右视频双屏 (Dual View) |
| `M` | **切换媒体模式**：切换图片模式 (Picture Mode) / 视频模式 (Video Mode) |
| `A` | **自动播放**：开启/关闭图片自动播放（悬停可调节 1s ~ 120s 间隔） |
| `T` | **目录树面板**：展开/收起压缩包或文件夹的直属计数层级目录树 |
| `←` / `→` | 切换上张 / 下张图片（或视频快退 / 快进 5 秒） |
| `↑` / `↓` / `PageUp` / `PageDown` | 切换上一个 / 下一个文件夹或子目录 |

---

### Quick Slot (快速模型槽) 指南

Quick Slot 支持将常用的模型绑定到数字键上进行循环快速切换：

- **快捷按键**：按数字键 `1` ~ `9` 在当前对应槽中的已启用模型间循环切换。
- **快捷导入与删除**：Header 处 `Alt + 数字键` 快捷导入当前模型至指定槽；`Ctrl + 数字键` 快捷删除当前选中的模型。
- **状态显示**：顶部 Header 实时显示当前槽的名称、序号徽章与 `provider/modelid`。

---

### Stream Video Download 外部依赖说明

Download 功能依赖 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 抓取与 [ffmpeg](https://ffmpeg.org/) 音视频转码工具：
1. **yt-dlp**：下载 `yt-dlp.exe` 或 `yt-dlp` 二进制放至系统 `PATH` 或在 `Settings → Download Settings` 中指定路径。
2. **ffmpeg**：下载 `ffmpeg` 可执行文件放至系统 `PATH` 或在设置中指定路径。
