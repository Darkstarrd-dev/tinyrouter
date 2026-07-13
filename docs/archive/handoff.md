# Handoff: Provider Detail View, Multi-Language, Prefix Resolution & Bug Fixes

## 本轮完成内容

### 1. Provider 扩展：Models / Rotation 覆盖 / 前缀解析

- **Provider 结构扩展**: 新增 `Models []string`, `RotationStrategy string`, `StickyLimit int` 字段（`internal/config/config.go`）
- **Registry 模型 CRUD**: `ListModels`, `AddModel`, `DeleteModel`, `UpdateProviderStrategy`, `GetProviderByPrefix`（`internal/registry/registry.go`）
- **前缀解析**: `GetProviderByPrefix` 通过 prefix 匹配 provider（`internal/registry/registry.go`），proxy handler 和 combo resolver 均已使用——修复了 "provider not found: ms" 关键 bug
- **Rotation 覆盖**: `effectiveStrategy()` / `effectiveStickyLimit()` 检查 provider 级覆盖，空字符串则回退全局默认

### 2. 管理 API 扩展（7 个新端点）

`internal/api/providers_extra.go`：
- `POST /api/providers/validate` — 连通性测试（GET /v1/models，fallback POST chat/completions）
- `POST /api/providers/{id}/test` — 测试指定 key
- `GET /api/providers/{id}/models` — 从上游拉取模型列表
- `POST /api/providers/{id}/models/test` — 测试模型（最小 chat completion，返回延迟）
- `POST /api/providers/{id}/models` — 添加自定义模型 ID
- `DELETE /api/providers/{id}/models/{modelId}` — 删除自定义模型
- `POST /api/providers/{id}/keys/bulk` — 批量添加 keys

### 3. Proxy 改进

- **URL 规范化**（`internal/proxy/upstream.go` `BuildUpstreamURL`）: 自动去除 `/chat/completions`、`/completions`、`/models` 后缀，再拼接目标路径
- **Token 提取**: `extractTokens` 正确解析上游响应中的 usage 字段（不再总是 0）
- **Usage 记录**: `recordUsage` 存储 `sel.Provider.Name` 而非 provider ID——Usage 页显示 "ModelScope" 而非 "prov_1"
- **ListModels 增强**: 当 provider 配置了具体 Models 时返回 concrete model ID，否则返回 `prefix/*`

### 4. 全量 EN/CN 双语翻译系统

`web/static/app.js` — 新增 `L` 对象含 `en`/`cn` 两套翻译，`t(key, args)` 函数带 `{0}` 参数替换，`toggleLang()` 切换 + localStorage 持久化，设置页 `data-lang` 属性。所有 UI 文本通过 `t()` 渲染。

### 5. Provider Detail View + Combo 编辑增强

- **Detail View**: 点击 provider 卡片进入详情页，展示 Keys/Models/Rotation 覆盖，`data-lang` 行内编辑
- **Combo 编辑**: 预填充表单，`importFromProvider()` 弹窗从 provider 导入模型
- **复制**: 关键字段（key, model ID）添加 `.copyable` + `copyToClipboard()`
- **简洁删除**: `deleteKeyDetail` / `deleteModelDetail` 直接执行，无二次确认弹窗

### 6. UI 布局修复

- **Sidebar 宽度** `220px → 230px`，header padding `16px → 12px`，controls gap `6px → 3px`，footer padding `16px → 12px`——修复语言/主题/字体按钮被 sidebar 截断的问题

### 7. JS 语法修复

- **修复 `app.js:651`**: key 复制 onclick 中 `'data-copy'` 单引号与外部 JS 字符串分隔符冲突导致整个 app 无法渲染——改为 `\'data-copy\'` 转义

### 8. 数据修复

- **`config.yaml`**: SenseNova baseUrl 修复（`.../v1`）、重复 provider ID 修复（`prov_2`）、ModelScope name 恢复
- **`internal/usage/ring.go`**: `Summary` 新增 `TotalInputTokens`/`TotalOutputTokens` 字段

---

## 本轮完成内容（第 3 轮）

### 1. 表格布局调整

- **Key 操作列**从最后一列移到 Name 和 Key 之间（Name → Actions → Key → Priority → Status），操作更直观
- **Model 操作按钮**移到模型名之前（Test | Delete → 模型名 → 状态），删除/测试按钮不再需要滚动查找

### 2. 删除后保留滚动位置

`deleteKeyDetail` / `deleteModelDetail` 在调用 `renderProviders` 前保存 `scrollTop`，`requestAnimationFrame` 恢复滚动位置，支持连续操作

### 3. Combo 模型选择 UI 重设计

- 复选框 → 点击高亮选中（`.selected` 类名，浅蓝背景 + 强调色边框，CSS 动画过渡）
- 增加"全选" / "取消全选"按钮

### 4. 中文化完善

- 补充 `close`/`pause`/`selectAll`/`deselectAll` 翻译
- Sidebar 导航项（Endpoint/Providers/Combos/Usage/Console）及 Shutdown 按钮改为动态 `updateSidebarNav()`，切换语言时即时更新

### 5. 修复模型删除无效（`/` 导致的 URL 路由问题）

- **根因**: 模型 ID 含 `/`（如 `stepfun-ai/Step-3.7-Flash`），`encodeURIComponent` 编码为 `%2F` 后，Go HTTP 服务器解码回 `/` 导致 chi 路由错位，API 返回 404 但前端未检查响应
- **修复**: 后端路由 `DELETE /providers/{id}/models/{modelId}` → `DELETE /providers/{id}/models?model=xxx`；前端使用 query param 并检查 `resp.error`

### 6. 完善 `deleteModelDetail` 错误处理

- 前端 `deleteModelDetail` 添加 `resp.error` 检查，API 失败时显示错误 toast 而非虚假的成功提示

## 变更文件

| 文件 | 变更 |
|---|---|
| `web/static/app.js` | 表格列顺序、滚动保留、combo 模型选择 UI、翻译补全、deleteModelDetail 错误处理 |
| `web/static/style.css` | 新增 `.import-model-item.selected` 样式 |
| `internal/api/router.go` | 模型删除路由改为 query param |
| `internal/api/providers_extra.go` | 模型删除 handler 改为 `r.URL.Query().Get("model")` |

## 架构决策记录

### 前缀解析策略
前缀解析由 `GetProviderByPrefix` 在 registry 层完成，proxy handler 和 combo resolver 均通过此函数解析 `ms/modelId` → 查找 prefix="ms" 的 provider。这样 model 字段格式与 9router 保持一致（`prefix/model-id`）。

### 翻译系统设计
全量翻译对象 + `t()` 函数模式：无依赖、零运行时、纯 JS 对象，`{0}` 参数替换适配动态文本。语言偏好通过 `data-lang` 属性 + localStorage 持久化。

### Provider 级 Rotation 覆盖
`RotationStrategy` 和 `StickyLimit` 在 provider 配置中可选。`effectiveStrategy()`/`effectiveStickyLimit()` 先检查 provider 级设置，空字符串/0 则回退全局默认。不改变全局配置。

## 未完成事项

1. **Provider 详情页骨架屏**：可直接显示内容而非骨架，可后续优化
2. **Console 页加载态**：目前直接显示日志容器，可加初始加载动画

## 已知问题和注意事项

1. **浏览器自动关闭限制**：Shutdown 按钮 `window.close()` 在非 `window.open()` 打开的窗口会静默失败
2. **Light 主题玻璃效果**：浅色背景下的玻璃拟态不如深色明显
3. **config.yaml 安全性**：现有测试 key 为真实凭据，避免泄露
4. **URL 规范化**：`BuildUpstreamURL` 处理三种 base URL 格式（根路径、`/v1`、完整路径），均能正确规范化

---

## 本轮完成内容（第 4 轮：发布前审核修复 + 429 双模式 + Usage 增强）

### 1. P0: 4xx 错误处理修复

- **根因**: `forwardWithRetry` 中仅处理 429 和 >=500，其余 4xx（401/403/404）落入"成功"路径，调用 `ClearError`，导致无效 key 不被排除
- **修复** (`internal/proxy/handler.go`): 在 5xx 判断之后新增 `>= 400` 分支，所有 4xx（除 429）均调用 `MarkUnavailable` + 排除 + 切换

### 2. P1: Registry.Config() 数据竞争修复

- **根因**: `Config()` 返回内部 `*config.Config` 指针，调用方在锁释放后无锁修改共享对象
- **修复** (`internal/registry/registry.go`): `Config()` 返回 `config.Config` 值拷贝
- **适配** (`internal/api/handlers.go` + `internal/api/providers_extra.go`): 所有 `config.Save(rt.configPath, rt.reg.Config())` 改为先 `cfg := rt.reg.Config()` 取值拷贝再 `config.Save(rt.configPath, &cfg)`；`updateSettings` 修改后调用 `rt.reg.Reload(&cfg)` 写回 registry

### 3. 429 双模式判定（与 9router 对齐）

- **根因**: 原实现 `isDailyQuota` 硬编码宽泛字符串匹配（`"quota exceeded"`/`"rate_limit_exceeded"`），将大量临时 429 误判为日配额耗尽，导致 key 被错误锁定 24 小时
- **9router 参照**: `checkDailyQuotaMatch(errorText, model)` 检查错误体是否包含模型名称——含模型名→日配额，不含→临时
- **修复** (`internal/rotation/cooldown.go`):
  - `IsDailyQuota429(body, model)` — 检查错误体是否包含模型名（与 9router `checkDailyQuotaMatch` 一致）
  - `MarkDailyQuotaLocked` — 锁定 key+model 到次日 CST 00:05
  - `nextCSTMidnight05` — 修复 00:00-00:05 窗口 bug（原总是 `Day()+1`，现在 00:05 前用当天）
- **两种 429 示例**:
  - `#1 临时`: `{"error":{"code":"insufficient_quota","message":"You exceeded your current quota..."}}` — 不含模型名 → 重试 5 次 → 切换（不锁定）
  - `#2 日配额`: `{"error":{"message":"You have exceeded today's quota for model ZhipuAI/GLM-5.2..."}}` — 含模型名 → 锁定到次日 CST 00:05

### 4. forwardWithRetry 循环重构

- **根因**: `maxAttempts=10` + `attempt` 共用计数器，导致 429 重试 5 次后剩余 key 不再重试，且 Key-6~8 根本没机会被尝试
- **9router 参照**: `while(true)` 无限循环 + per-key `temp429RetryCount`，切换 key 时重置
- **修复** (`internal/proxy/handler.go` `forwardWithRetry`):
  - `for{}` 无限循环替代 `for attempt := 0; attempt < maxAttempts`
  - 新增 `temp429Retries` per-key 计数器，切换 key 时重置为 0
  - 429 双模式：日配额→`MarkDailyQuotaLocked`+排除；临时→重试 5 次→只排除不锁定（与 9router `chat.js:323-324` 一致）
  - 5xx/4xx/网络错误→`MarkUnavailable`（指数退避）+排除+重置 `temp429Retries`
  - 循环终止：所有 key 被排除→`SelectKey` 返回 error→返回 false

### 5. Usage inputTokens=0 修复

- **根因**: `extractTokens` 仅兼容 `prompt_tokens`/`completion_tokens`，不兼容部分 provider 使用的 `input_tokens`/`output_tokens` 命名；流式响应完全不解析 SSE 内容
- **修复** (`internal/proxy/handler.go`):
  - `extractTokens` 增强：兼容 `prompt_tokens`/`input_tokens`、`completion_tokens`/`output_tokens`，fallback 到 `total_tokens`
  - 新增 `tokenVal` 辅助函数
- **修复** (`internal/proxy/stream.go`):
  - SSE 流式读取中收集最后一个 `data:` 行（`lastDataLine`），事后用 `extractTokens` 解析 token
  - 新增 `strings` 导入

### 6. Usage 面板增强

- **总输入/总输出以 M tokens 显示** (`web/static/app.js`): 新增 `formatMillionTokens(n)` 函数，`n/1000000` 后 `toFixed(3)` + `"M"` 后缀
- **每 3s 自动刷新** (`web/static/app.js`): 新增 `usageRefreshTimer` + `startUsageRefresh()`/`stopUsageRefresh()`/`updateUsageSummary()`/`updateUsageTable()`；`navigateTo` 切换页面时调用 `stopUsageRefresh()` 清理定时器

### 7. gofmt 格式化

- 修复 9 个未格式化文件：`handler.go`、`stream.go`、`upstream.go`、`registry.go`、`cooldown.go`、`cooldown_test.go`、`selector.go`、`selector_test.go`、`ring.go`

## 变更文件

| 文件 | 变更 |
|---|---|
| `internal/proxy/handler.go` | P0: 4xx 错误处理；429 双模式 + `forwardWithRetry` 重构；`extractTokens` 增强 + `tokenVal` |
| `internal/proxy/stream.go` | SSE token 提取（`lastDataLine` + `strings` 导入） |
| `internal/registry/registry.go` | P1: `Config()` 返回值拷贝 |
| `internal/api/handlers.go` | P1: 所有 `Config()` 调用适配值拷贝 + `updateSettings` 增加 `Reload` |
| `internal/api/providers_extra.go` | P1: 3 处 `config.Save` 适配值拷贝 |
| `internal/rotation/cooldown.go` | `IsDailyQuota429`/`MarkDailyQuotaLocked`/`nextCSTMidnight05`（修复 CST 窗口 bug） |
| `internal/rotation/cooldown_test.go` | 新增 `TestIsDailyQuota429`/`TestMarkDailyQuotaLocked`/`TestNextCSTMidnight05` |
| `web/static/app.js` | `formatMillionTokens`；Usage 3s 自动刷新；`usageRefreshTimer` 生命周期管理 |

## 架构决策记录

### 429 双模式判定策略
与 9router `checkDailyQuotaMatch` 一致：检查 429 错误体是否包含模型名称。含模型名→日配额耗尽（锁定到次日 CST 00:05）；不含→临时速率限制（重试 5 次后切换，不锁定）。此判定始终生效，无需 per-provider 开关。

### forwardWithRetry 循环结构
`for{}` 无限循环 + `excludeKeyIDs` 排除列表 + `temp429Retries` per-key 计数器。循环仅在所有 key 被排除（`SelectKey` 返回 error）时终止。与 9router `while(true)` + `excludeConnectionIds` 结构对齐。

### 临时 429 重试耗尽处理
临时 429 重试耗尽后只排除 key（`excludeKeyIDs`），不调用 `MarkUnavailable`。下次新请求时 `excludeKeyIDs` 为空，key 立即可用。与 9router `chat.js:323-324` 一致。

## 未完成事项

1. **Provider 详情页骨架屏**：可直接显示内容而非骨架，可后续优化
2. **Console 页加载态**：目前直接显示日志容器，可加初始加载动画

## 已知问题和注意事项

1. **stream_options 兼容性**：`injectStreamOptions` 默认为 false。仅对确认支持的 provider（如 ModelScope）手动开启。SenseNova、部分自定义 endpoint 可能拒绝该参数
2. **浏览器自动关闭限制**：Shutdown 按钮 `window.close()` 在非 `window.open()` 打开的窗口会静默失败
3. **Light 主题玻璃效果**：浅色背景下的玻璃拟态不如深色明显
4. **config.yaml 安全性**：现有测试 key 为真实凭据，避免泄露
5. **URL 规范化**：`BuildUpstreamURL` 处理三种 base URL 格式（根路径、`/v1`、完整路径），均能正确规范化

---

## 本轮完成内容（第 5 轮：Playground 审核、提取、可选编译 + UI 对齐）

### 1. 代码审核全量修复（高/中/低危共 13 处）

| 编号 | 严重性 | 文件 | 问题 | 修复 |
|---|---|---|---|---|
| H1 | 高 | `index.html` | Mermaid `securityLevel:'loose'` 允许 LLM 注入 click 回调 XSS | 改为 `'strict'` |
| M1 | 中 | `stream.go` | `sel` 在 nil 守卫外解引用，未来可能 panic | 日志/recordUsage 前加 `if sel == nil { return }` |
| M2 | 中 | `playground.js` | `msg.role !== 'loading'` typo（应为 `status`） | 修复 condition |
| M3 | 中 | `playground.js` | `pgMergeChunk` 上游 prefix 变化时错误拼接 | 加 `next.length < current.length` 回退 |
| M4 | 中 | `playground.js` | localStorage 超 1MB 直接全量丢弃 | 改为逐条 shift 直到符合限制 |
| L1 | 低 | `compress.go` | Brotli `BestCompression`(11) 对本地代理不必要地慢 | 降为 `DefaultCompression`(6) |
| L3 | 低 | `playground.js` | iframe `sandbox="allow-same-origin"` 无意义 | 改为 `sandbox=""` |
| L4 | 低 | `playground.js` | `window.open` 缺 `noopener` | 加第三参 |
| L5 | 低 | `playground.js` | 纯图像 loading 消息不修复 | `hasContent` 增加 `pgImageParts` 检查 |
| L6 | 低 | `playground.js` | SSE `split('\n')` 不兼容 `\r` | 改为 `replace(/\r\n/g,'\n').split('\n')` |
| L7 | 低 | `playground.js` | DOMPurify ADD_ATTR 含 href 依赖默认策略 | 加注释说明 |

### 2. UI 布局对齐 new-api（实用对齐）

保留右侧 320px 侧栏（承载 TinyRouter 独有的 Debug/SSE viewer/Custom body），仅视觉风格对齐：

- **用户气泡**：accent-gradient → muted 灰底（`var(--glass-hover)` + border + shadow）
- **助手脚气泡**：glass-bg → 透明无边（`background:transparent; border:none; padding:0`）
- **消息区居中**：`max-width:56rem; margin:0 auto`
- **输入栏**：加 `pg-input-card` 外层容器，含 `box-shadow` + `focus-within` 边框高亮
- **空状态**：4 张 quick-prompt 卡片（分析数据/总结文本/编码助手/获取建议）
- **操作按钮**：文本 → SVG 图标（Lucide 风格，含 title 提示）
- **侧栏面板**：标题加 `border-bottom` section header

### 3. JS 模块独立化（PG_HOST 适配器契约）

- **适配器契约**：`window.PG_HOST = {apiGet, toast, escapeHtml, copyToClipboard, t}` 可选注入
- **211 处调用**全部替换为 `pgApiGet`/`pgToast`/`pgEscapeHtml`/`pgCopyToClipboard`/`pgT` 包装函数
- 未注入时 fallback 到现有全局函数，保持 TinyRouter 宿主原行为不变
- **pg-i18n.js** 抽出：56 英文 + 56 中文翻译 key
- **playground.css** 抽出：271 行 `.pg-*` 样式，从 `style.css` 分离
- **playground/README.md**：模块文档，含宿主集成方式、PG_HOST 契约表格、后端端点要求、生命周期

### 4. 可选编译：Build tags + 运行时 flag 双层隔离

#### 4.1 构建标签（Build tags）

```
# 核心版（不含 playground，~14.7 MB）
go build -o tinyrouter .

# 含 playground 版（~18.7 MB，vendor 资源 ~4 MB）
go build -tags playground -o tinyrouter .
```

**实现**：
- `web/embed.go`（`//go:build !playground`）：仅嵌入核心 `web/static/`（app.js、api.js、i18n.js、endpoint.js、providers.js、combos.js、usage.js、console.js、style.css、favicon、logo）
- `web/embed_playground.go`（`//go:build playground`）：嵌入核心 + `web/playground/static-pg/`（vendor/、playground.js、playground.css、pg-i18n.js）
- `web/embed_playground_stub.go`（`//go:build !playground`）：空 `PlaygroundStatic` 零值 + `PlaygroundCompiled()=false`
- `web.PlaygroundCompiled()` 函数在 router.go 中用于条件注册 `/vendor/*`、`/playground.js` 等路由

**目录结构**：
```
web/
  embed.go                          # !playground 构建
  embed_playground.go               # playground 构建
  embed_playground_stub.go          # !playground 桩
  static/                           # 核心 SPA 资源
    index.html                      # 含 playground 引用
    index-nopg.html                 # 不含 playground 引用
    app.js, api.js, i18n.js, ...
    style.css                       # 仅核心样式（.pg-* 已移出）
  playground/
    README.md                       # 模块文档
    static-pg/                      # playground 专属资源
      playground.js                 # 主模块（含 PG_HOST 契约）
      playground.css                # 271 行 .pg-* 样式
      pg-i18n.js                    # 56 en + 56 cn 翻译
      vendor/                       # 第三方依赖（~4MB）
        katex.min.js, marked.min.js, highlight.min.js,
        purify.min.js, mermaid.min.js, KaTeX fonts/
```

#### 4.2 运行时开关（Runtime flag）

- **config.yaml** 新增 `enablePlayground: true/false`（默认 `true`）
- **Settings API**（`GET/PATCH /api/settings`）支持读写 `enablePlayground` 字段
- **serveUI** 根据 `PlaygroundCompiled() && EnablePlayground` 选择：
  - `true` → 服务 `index.html`（含 playground nav + vendor 引用）
  - `false` → 服务 `index-nopg.html`（纯核心版，无 playground 入口）

#### 4.3 取值矩阵

| `-tags playground` | `enablePlayground` | 行为 |
|---|---|---|
| 无 | 任意 | 无 playground 路由，始终服务 `index-nopg.html` |
| 有 | `true` | 完整 playground：vendor 资源 + nav 入口 + 路由注册 |
| 有 | `false` | vendor 路由已注册但入口隐藏，服务 `index-nopg.html` |

#### 4.4 Release 发布说明

发布时需产出两个版本：

| 版本 | 二进制名 | 构建命令 | 大小 |
|---|---|---|---|
| **Lite**（核心代理） | `tinyrouter-lite-{os}-{arch}` | `go build` | ~14.7 MB |
| **Full**（含 Playground） | `tinyrouter-{os}-{arch}` | `go build -tags playground` | ~18.7 MB |

Lite 版仅含代理核心（providers/combos/usage/console 管理 + `/v1/*` 透传），不含 Playground 交互式聊天 UI。Full 版在 Lite 基础上增加 Playground 模块，默认启用（`enablePlayground: true`），可通过 `enablePlayground: false` 关闭。

## 变更文件

| 文件 | 变更 |
|---|---|
| `internal/api/compress.go` | Brotli 降级 DefaultCompression |
| `internal/api/handlers.go` | `getSettings`/`updateSettings` 增加 `enablePlayground` |
| `internal/api/misc.go` | `serveUI` 双 index 选择逻辑 |
| `internal/api/router.go` | 条件注册 playground 静态路由 + `web` import |
| `internal/config/config.go` | `Config` 新增 `EnablePlayground` 字段 |
| `internal/proxy/stream.go` | nil sel 防御 early-return |
| `web/embed.go` | `//go:build !playground` + `PlaygroundCompiled()` |
| `web/embed_playground.go` | **新建**：`//go:build playground` 嵌入 playground 资源 |
| `web/embed_playground_stub.go` | **新建**：`//go:build !playground` 空桩 |
| `web/static/i18n.js` | 删除所有 pg* 翻译 key（移至 pg-i18n.js） |
| `web/static/index.html` | `securityLevel:strict` + `playground.css` link |
| `web/static/index-nopg.html` | **新建**：不含 playground 引用的核心版 index |
| `web/static/style.css` | 删除全部 `.pg-*` 样式段（移至 playground.css） |
| `web/playground/static-pg/playground.js` | 审核修复 + PG_HOST 契约 + UI 对齐 + 图标化 |
| `web/playground/static-pg/playground.css` | **新建**：271 行 playground 样式 |
| `web/playground/static-pg/pg-i18n.js` | **新建**：56 en + 56 cn 翻译 |
| `web/playground/static-pg/vendor/` | 从 `web/static/vendor/` 迁移 |
| `web/playground/README.md` | **新建**：模块文档 |

## 架构决策记录

### Playground 模块化策略
Playground 作为独立可选模块，通过 `//go:build playground` 构建标签控制是否编译进二进制。vendor 资源（KaTeX/marked/hljs/purify/mermaid ~4MB）与核心代理资源物理分离（`web/static/` vs `web/playground/static-pg/`），Go embed 无法 exclude 子目录，因此必须物理隔离目录。

### PG_HOST 适配器契约
`window.PG_HOST` 可选注入 5 个宿主函数（apiGet/toast/escapeHtml/copyToClipboard/t），未注入时 fallback 到全局函数。这使 playground.js 可被其他项目（非 TinyRouter）复用，只需提供向后兼容的契约实现。

### 运行时 flag 与构建标签的协作
`PlaygroundCompiled()` 在编译时固定（`//go:build` 控制），`enablePlayground` 在运行时可通过 YAML 或 API 切换。serveUI 同时检查两者：构建无 playground → 强制核心版；构建有 playground → 按 flag 选择。这避免了"核心版编译 + enablePlayground=true"的配置矛盾。

## 未完成事项

1. **Provider 详情页骨架屏**：可直接显示内容而非骨架
2. **Console 页加载态**：目前直接显示日志容器，可加初始加载动画
3. **4MB 二进制体积优化**：当前版本 vendor 资源在 playground 构建中完整嵌入。未来可考虑按需加载（CDN）或 wasm 压缩进一步缩减
