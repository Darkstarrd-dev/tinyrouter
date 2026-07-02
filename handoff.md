# Handoff: WebUI Redesign & UX Enhancements

## 本轮完成内容

### 1. WebUI 全面重设计 — 深色玻璃拟态

`web/static/style.css` — 完全重写设计系统：

- **设计语言**: 深色玻璃拟态（Glassmorphism），`backdrop-filter: blur()` + `rgba` 半透明层叠
- **背景**: 径向渐变 `#12121a → #0a0a0f`
- **色彩体系**: 渐变强调色 `#4fc3f7 → #7c4dff`，柔和的状态色（绿/橙/红）
- **组件样式**: 全新卡片、按钮（primary/danger/ghost）、徽章（带圆点指示器）、表格、表单
- **动效**: 页面入场 `fadeIn + translateY`、骨架屏 `shimmer` 脉动、徽章 `pulse`、按钮悬停上浮

### 2. 布局修复

`web/static/style.css` — `.app` 容器缺失 `display: flex`，导致 sidebar 和 main 垂直堆叠：

```css
.app { display: flex; width: 100%; height: 100vh; overflow: hidden; }
.sidebar { flex-shrink: 0; height: 100%; display: flex; flex-direction: column; }
.main { flex: 1; min-width: 0; height: 100%; overflow-y: auto; }
```

### 3. 交互改进 — Toast + Modal + Skeleton

`web/static/app.js` — 替换原生弹窗：

- **`alert(msg)` → `toast(msg, type)`**: 右上角玻璃滑入通知，带进度条，4 种类型（success/error/info/warning）
- **`confirm(msg)` → `await confirmModal(msg)`**: 居中玻璃弹窗，遮罩层 `blur(8px)`，支持 backdrop 点击关闭
- **骨架屏**: 所有页面加载时显示脉动骨架占位，数据到达后替换

### 4. 深色 / 浅色主题切换

- `style.css` 使用 CSS 变量，`:root` 为深色，`[data-theme="light"]` 覆盖全套配色
- `index.html` 在 `<head>` 内联脚本先读取 `localStorage`，避免 Flash of Unstyled Content
- 侧边栏标题旁 **Light/Dark** 按钮，偏好持久化
- 浅色主题使用低不透明度黑色层代替白色层，保持玻璃质感

### 5. 字体大小切换 S/M/L

- `style.css` 新增 `--font-*` 变量组（base/h2/h3/card/stat/log/code/badge...）
- `[data-font-size="m"]` 和 `[data-font-size="l"]` 三套字号档位
- 侧边栏标题旁 **S/M/L** 按钮，循环切换，`localStorage` 持久化
- 内联脚本预读取防闪烁

### 6. 启动自动打开浏览器

`main.go` — 服务启动 300ms 后自动打开默认浏览器：

| 系统 | 命令 |
|---|---|
| Windows | `rundll32 url.dll,FileProtocolHandler` |
| macOS | `open` |
| Linux | `xdg-open` |

### 7. 网页内 Shutdown 按钮

- `main.go` — 新增 `context.WithCancel` 作为关闭信号，`select` 同时监听 OS 信号和 UI 触发
- `internal/api/router.go` — Router 新增 `shutdown context.CancelFunc` 字段
- `internal/api/misc.go` — 新增 `POST /api/shutdown` 端点，延迟 100ms 后触发优雅关闭
- `web/static/app.js` — `shutdownServer()` 调用 `/api/shutdown` → 显示停止提示页 → `window.close()`

**注意**: 浏览器安全策略限制，JS 只能关闭 `window.open()` 打开的窗口。系统自动打开的标签页会显示 "You may close this window" 提示页。

### 8. 静态资源缓存控制

`internal/api/misc.go` — `serveUI()` 为静态文件添加 `Cache-Control: no-cache, must-revalidate` 头，确保开发时 CSS/JS 更新立即可见。

## 架构决策记录

### CSS 变量驱动主题
选择使用纯 CSS 变量 + `data-theme` / `data-font-size` 属性切换，而非 CSS-in-JS 或预处理器。优点是零运行时开销，变量在浏览器 DevTools 中可直接调试。

### 关闭信号传递
使用 `context.WithCancel` 传递关闭信号，而非 `chan struct{}`。优点是闭包安全、可多次调用 cancel()（幂等）。

### 字体大小联动缩放
不使用全局 `transform: scale()`，而是为每个字体相关属性定义 CSS 变量。这样确保精确控制每一处字号，不影响布局盒模型和 spacing。

## 未完成事项

1. **provider 详情页的骨架屏**：当前 detail view 直接显示内容而非骨架，可后续优化
2. **Console 页添加骨架/加载态**：目前直接显示日志容器，可加初始加载动画

## 已知问题和注意事项

1. **浏览器自动关闭限制**：Shutdown 按钮调用 `window.close()` 在多数现代浏览器中会静默失败（非 `window.open()` 打开的窗口）。用户需要手动关闭标签页。
2. **Light 主题玻璃效果**：浅色背景下的玻璃拟态效果不如深色明显，因为 `backdrop-filter` 在浅色背景上的视觉对比度较低。
3. **字体 S/M/L 只影响字号**：行高、内边距、间距等不会随字体大小变化，L 档位下可能需要后续微调。
4. **config.yaml 变更**：`Register` 结构体新增 model 验证相关字段（本次未修改 Provider 配置结构，无迁移成本）。
