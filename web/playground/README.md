# TinyRouter Playground Module (Vanilla JS)

## 简述
client-side 交互式聊天 UI, 通过 OpenAI 兼容 /v1/chat/completions 端点与上游对话。无框架依赖, 1670 行 JavaScript + 280 行 CSS + 56KB i18n字典; 适配器契约模式, 可嵌入其他 Go/Node/Python web 后端。

## 宿主集成方式

### HTML 引入(按顺序)
1. KaTeX, marked, marked-katex-extension, DOMPurify, highlight.js, mermaid 第三方依赖
2. `<script>window.PG_HOST = {...}</script>` 注入契约(推荐)
3. playground.css + pg-i18n.js + playground.js 依次加载

### 宿主适配契约 window.PG_HOST
| 字段 | 类型 | 必填 | 用途 |
|---|---|---|---|
| apiGet | (path: string) => Promise<any> | 是 | GET /models 等 |
| toast | (message: string, type?: 'info'|'success'|'warning'|'error') => void | 是 | UI 提示 |
| escapeHtml | (s: string) => string | 是 | HTML 转义 |
| copyToClipboard | (text: string, label?: string) => void | 是 | 复制到剪贴板 |
| t | (key: string, args?: any[]) => string | 是 | i18n 翻译; 应能解析 PG_I18N.pg* key 或合并自身字典 |

未注入时 fallback 到同名全局函数, 保证 TinyRouter 宿主可用。

### 后端端点
- `POST /v1/chat/completions` - OpenAI 兼容, 支持 stream/非 stream
- `GET /models` - 返回 `{ models: [{id, type, provider}] }`
- 可选响应头 `X-TinyRouter-Provider`, `X-TinyRouter-Key` - 用于 debug 面板显示; 缺失显示 N/A

### HTML 容器需求
- `<div id="page-content">` - renderPlayground 渲染目标
- `<div id="toast-container">` - toast 容器
- `<div id="modal-overlay">` - modal 容器(删除确认等)

### 生命周期
- `renderPlayground(containerEl)` - 进入页面
- `cleanupPlayground()` - 离开页面, 中止进行中的 fetch

## 编译可选性(阶段 3 通过 build tag 控制)
本模块仅以 `-tags playground` 编译进 TinyRouter 二进制; 默认构建剥离 playground 与 4MB vendor 资源。其它项目接入时,只需复制 web/static/playground/ (含 playground.js / playground.css / pg-i18n.js) + vendor/ 目录即可。

## 文件位置
```
web/static/playground/
  README.md              # 本文件
  ../playground.js      # 主模块
  ../playground.css      # 样式
  ../pg-i18n.js          # 翻译字典
  ../vendor/             # 第三方依赖(marked, katex, hljs, purify, mermaid)
```