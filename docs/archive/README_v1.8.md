# TinyRouter (v1.8 Archive)

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
- **Video Download** — 基于 yt-dlp 的视频/音频下载，支持单链接 / 播放列表、画质选择、并发分片、代理、缩略图预览与任务队列；失败/取消任务原地重试（不再生成新任务项）；打开目录按钮正确打开下载位置（修复 explorer.exe 单实例 DDE 转发丢失路径问题）
- **Download UI (v1.8.0)** — 解析卡片表头粘性置顶，多个解析卡片与任务列表共享同一滚动条，消除 card 与 task-item 之间的间隙；移除了 console 页面的重复 yt-dlp [debug] 信息（已在 download 页面 View Log 显示）
- **Gallery (v1.7.8)** — 本地与 Zip 压缩包漫画/图片/视频浏览器，支持独立 Sub-Panel 左图右视频双屏 (`D`) / 单屏 (`S`) / 媒体 (`M`) 模式切换、Focus 焦点继承退回、全屏黄金比例自适应排布 (`autoBalanceFullscreenSplitRatio`)、视频状态感知连贯播放 (State-Aware Continuity)、多层子目录 Zip 压缩包秒解与直属计数 (`directCount`) 目录树、全量 SVG 图标与亮色主题完全兼容
- **纯本地** — 无鉴权，无远程访问，任意 Key 或无 Key 均可访问
- **多模型同时请求测试** — 一键对多个模型并行发起请求，对比延迟/速度/配额
- **多模型聊天群聊** — 多个模型同场对话，并排对比回答
- **Playground Search** — 联网搜索模式：AI 自动分类查询意图 → 调用 AnySearch 检索 → 流式合成回答，支持子域名过滤与页面内容提取

## 页面

| 页面 | 功能 |
|---|---|
| **Usage** | 实时请求统计：趋势图、Token 用量、最近请求、Quota 监控 |
| **Settings** | 监听端口、上游代理、轮询策略、超时、密码保护、Provider / Combo / QuickSlot 管理 |
| **Console** | 实时日志、Monitor 白名单命令、Terminal（Debug Mode） |
| **Download** | yt-dlp 视频/音频下载，播放列表批量、画质、代理、任务队列 |
| **Gallery** | 本地图片/Zip 漫画浏览器，支持拖拽粘贴、目录树、自动播放与全屏浏览 |
| **Playground** | 多模型同时测试、群聊对比、联网搜索（仅 `-tags playground` 构建包含） |

Playground 的前后端事实基线见 [`docs/playground-architecture.md`](docs/playground-architecture.md)。

## Quick Slot 快速模型切换

Quick Slot 是预设的「模型切换槽」，适合把常用的几个模型绑到一个数字键上，一键循环切换，无需打开下拉菜单。

- **添加**：Settings 页面 → Quick Slots → 新建。填写名称、`order` (1~9)、并从 Provider 导入模型。
- **绑定数字键**：`order` 决定对应哪个数字键（1→order 1，2→order 2，……，9→order 9，最多 9 个槽）。
- **循环切换**：按下对应数字键，在当前槽「已启用」的模型之间循环切换；被停用的模型会自动跳过。
- **当前选中**：顶部 header 会显示该槽的名称、当前模型的 `provider/末段模型名`，并带序号徽章；hover 显示完整 `provider/modelid`。
- **快捷增删**：Header 右键打开「从 Provider 导入模型」弹窗；右键下拉菜单中的模型可确认删除。`Alt+数字` 快捷导入，`Ctrl+数字` 快捷删除当前模型。
- **编辑**：在槽的编辑弹窗中可增删模型、拖拽排序。

> 说明：若某槽被停用 (disabled)，其数字键不再生效。当所有模型都被停用或槽为空时，按键无效。

## Video Download（需手动安装外部工具）

Download 功能基于 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 驱动，并通过 [ffmpeg](https://ffmpeg.org/) 完成音视频合并/转码。**这两个工具需要自行下载安装**，并将可执行文件路径填入 Settings → Download Settings（默认从 `PATH` 查找 `yt-dlp` 和 `ffmpeg`）。

- **yt-dlp**：<https://github.com/yt-dlp/yt-dlp/releases>（下载 `yt-dlp.exe` / `yt-dlp`，放到 PATH 或在设置中指定绝对路径）
- **ffmpeg**：<https://ffmpeg.org/download.html>（下载构建产物，把 `ffmpeg` / `ffprobe` 可执行文件放到 PATH 或在设置中指定）

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `F1` | 切换到 Usage 统计页面 |
| `F2` | 切换到 Settings 页面 |
| `F3` | 切换到 Console 日志页面 |
| `F4` | 切换到 Playground 页面 |
| `F5` | 切换到 Download 页面 |
| `F6` | 切换到 Gallery 页面 |
