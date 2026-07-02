# Handoff: Providers 功能增强

## 本轮完成内容

### 1. URL 路径自动判断

`internal/proxy/upstream.go` — 新增 `normalizeBaseURL()` 和 `BuildUpstreamURL()`

自动处理三种 BaseURL 格式：
- `https://api.deepseek.com`（根路径） → 追加 `/v1/chat/completions`
- `https://api.deepseek.com/v1`（含版本） → 追加 `/chat/completions`
- `https://token.sensenova.cn/v1/chat/completions`（完整路径） → 标准化后使用

### 2. Config 结构变更

`internal/config/config.go` — Provider 新增字段：

```go
type Provider struct {
    // ... 原有字段 ...
    Models           []string `yaml:"models,omitempty" json:"models,omitempty"`
    RotationStrategy string   `yaml:"rotationStrategy,omitempty" json:"rotationStrategy,omitempty"`
    StickyLimit      int      `yaml:"stickyLimit,omitempty" json:"stickyLimit,omitempty"`
}
```

- `Models`: 存储该 provider 的自定义 model ID 列表（上游实际 model name）
- `RotationStrategy`: 覆盖全局设置，可选值 `""`(继承) / `"fill-first"` / `"round-robin"`
- `StickyLimit`: 覆盖全局粘性限制，`0` = 继承全局

### 3. Registry 新增方法

`internal/registry/registry.go`:
- `ListModels(providerID) []string`
- `AddModel(providerID, model) bool` — 去重添加
- `DeleteModel(providerID, model) bool`
- `UpdateProviderStrategy(providerID, strategy, stickyLimit) bool`
- `UpdateProvider` 现在也同步 Models/RotationStrategy/StickyLimit

### 4. Rotation 支持 provider 级别覆盖

`internal/rotation/selector.go`:
- `effectiveStrategy(provider)` — 优先使用 provider.RotationStrategy，否则用全局
- `effectiveStickyLimit(provider)` — 优先使用 provider.StickyLimit，否则用全局

### 5. 7 个新 API 端点

`internal/api/providers_extra.go`:

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/providers/validate` | 创建前测试连通性。请求体: `{baseUrl, apiKey, modelId?}`。先 GET /v1/models，失败且有 modelId 时回退 POST /v1/chat/completions。401/403=无效，其他=有效 |
| POST | `/api/providers/{id}/test` | 测试指定 key。请求体: `{keyId?}`。默认使用第一个活跃 key |
| GET | `/api/providers/{id}/models` | 从上游 /v1/models 获取模型列表。使用第一个活跃 key |
| POST | `/api/providers/{id}/models/test` | 测试模型连通性。请求体: `{model}`。发送最小 chat completion，返回 `{ok, latencyMs, error, status}` |
| POST | `/api/providers/{id}/models` | 添加自定义模型 ID。请求体: `{model}` |
| DELETE | `/api/providers/{id}/models/{modelId}` | 删除自定义模型 ID |
| POST | `/api/providers/{id}/keys/bulk` | 批量添加 keys。请求体: `{keys: [{name, key, priority?}]}`。返回 `{added, errors}` |

### 6. ListModels 显示具体模型

- `/v1/models`（OpenAI 格式）和 `/api/models`（管理 API）现在优先显示具体的 `prefix/modelId`
- 如果 provider.Models 为空，显示 `prefix/*`

### 7. config.yaml 修复

SenseNova URL 从 `https://token.sensenova.cn/v1/chat/completions` 更正为 `https://token.sensenova.cn/v1`

### 8. 前端 UI 增强

`web/static/app.js` — Providers 页面完全重写：

**添加 Provider 表单（增强版）：**
- 新增 API Key 输入（仅用于测试，不保存到 provider）
- 新增 Model ID 输入（可选，当 /v1/models 不可用时作为回退测试）
- "Check" 按钮调用 `POST /api/providers/validate`，显示 Valid/Invalid 徽章

**Provider 详情视图（新）：**
- 点击 provider 卡片进入详情页（替代原有的内联 key 表格）
- 返回按钮、启用/禁用切换、删除
- **Keys Section:**
  - Key 表格：Name、Key（掩码）、Priority、Status
  - 单 Key 添加：Name + API Key + Priority + "Create"
  - 批量添加：textarea 每行一个 key，格式 `name|key` 或只 `key`
  - 每个 key 有 Test / Pause-Resume / Delete 按钮
- **Rotation Section:**
  - 策略选择：Inherit Global / fill-first / round-robin
  - Sticky Limit 输入（0 = 继承全局）
  - Save 按钮（保存到 provider 字段）
- **Models Section:**
  - 模型列表：每行显示 `prefix/modelId` + 测试状态 + Test 按钮 + Delete 按钮
  - Add Model 行：输入框 + "Test" 按钮 + "Add" 按钮
  - "Import from /models" 按钮：从上游导入，自动添加新模型

## 架构决策记录

### URL 规范化策略
为了让配置更灵活，BaseURL 支持三种形式（根路径、带 /v1、带完整路径），通过 `normalizeBaseURL()` 统一处理。代价是每次请求都要做字符串处理，但性能损耗可以忽略。

### Provider 级别覆盖 vs 全局设置
选择覆盖模式：provider 设置优先级高于全局，未设置时自动继承全局。这样既保留了对各 provider 的精细控制，又不增加迁移成本。

### 模型存储位置
模型 ID 直接存储在 `provider.Models` 字段中（YAML 序列化），不创建独立的数据结构。简单够用，代价是即使没有自定义模型，空数组也会写入 YAML（用 `omitempty` 规避）。

## 未完成事项

暂无。所有计划功能均已实现。

## 已知问题和注意事项

1. **URL 规范化限制**：`normalizeBaseURL` 只处理 `/chat/completions`、`/completions`、`/models` 这三种后缀。如果上游使用其他路径，需要手动调整 BaseURL 配置。

2. **Config 文件变更**：添加了新的 Provider 字段后，旧 config.yaml 可以正常加载（新字段使用 Go 零值），但需要手动添加 `rotationStrategy`/`stickyLimit`/`models` 才能生效。

3. **SenseNova 配置**：已修复 BaseURL，但原始配置中的 API Key 可能已过时。需要用户自行更新。

4. **批量导入模型**：Import from /models 按钮逐个调用 `POST /api/providers/{id}/models`，大模型列表时会有 N+1 问题。后续可以添加批量添加模型的端点优化。