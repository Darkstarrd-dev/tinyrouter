# 9router 参考映射

> 最后核对：2026-07-14

> 本地参考副本位于 `Z:\Playground\9router`。不要修改该目录。

## 文件映射

实施时需要参考 9router 的以下文件：

| 功能 | 9router 文件 |
|---|---|
| Key 选择逻辑 | `src/sse/services/auth.js` → `getProviderCredentials()` |
| 冷却/退避 | `src/sse/services/auth.js` → `markAccountUnavailable()`, `clearAccountError()` |
| 代理核心 | `open-sse/handlers/chatCore.js` → `handleChatCore()` |
| 上游转发 | `open-sse/executors/default.js` |
| Combo 逻辑 | `open-sse/services/combo.js` |
| Console 日志 | `src/lib/consoleLogBuffer.js` |
| Usage 统计 | `src/lib/db/repos/usageRepo.js` |
| Model 解析 | `src/sse/services/model.js` → `getModelInfo()` |
| 错误规则配置 | `open-sse/config/errorConfig.js` |
| Dashboard 导航 | `src/shared/components/Sidebar.js` |
| Provider 常量 | `src/shared/constants/providers.js` |

## 日志格式 (与 9router 保持一致)

```
[2026-01-15 10:30:00] REQUEST deepseek | deepseek-chat | 12 msgs | Key Main
[2026-01-15 10:30:00] PROXY deepseek | deepseek-chat | conn=Main | url=https://api.deepseek.com/v1/chat/completions
[2026-01-15 10:30:02] 📊 [stream] deepseek | in=1234 | out=567 | conn=Main
[2026-01-15 10:30:02] 📊 [response] deepseek | in=1234 | out=567 | conn=Main
[2026-01-15 10:30:02] 🌊 [STREAM] deepseek | deepseek-chat | 2048ms | 200
[2026-01-15 10:30:02] 🌊 [RESPONSE] deepseek | deepseek-chat | 2048ms | 200
[2026-01-15 10:30:02] [ERROR] upstream returned 429: rate limited
```
