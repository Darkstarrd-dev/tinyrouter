# 深度研究申请书：TinyRouter Playground 自动对话功能流程梳理与"AI 辅助设定生成"特性设计

---

## 致深度研究模型的任务提示词

你是一位高级 AI 系统研究/架构顾问。本申请书提交给你，包含两部分材料，请基于它们完成研究工作：

- **第一部分**是对 TinyRouter Playground 现有"自动对话（群聊）"功能的**完整流程梳理**——包括模块拓扑、启动方式、参数注入路径、核心循环机制、视角重建、终止条件、错误处理、停止机制、状态管理、UI/模态框、完整流程图与端到端调用链。所有结论附 `file:line` 引用，已抽查验证。
- **第二部分**是要新增的"AI 辅助设定生成"特性的**工作要求**——包括设定生成的三种模式、旁白/剧情推进子系统、参数自动推导、导入导出等。

### 你需要研究的内容

1. **深入理解第一部分**所描述的现有自动对话机制（共享 timeline + 多窗口独立迭代 + 事件驱动循环 + `pgAutoChatRenderPerspective` 视角重建 + 4 个守卫式钩子），作为后续设计的基础。
2. **基于第二部分的工作要求**，研究如何**在符合用户意图的前提下，合适地融合或修改现有流程**，实现该特性。重点研究：
   - 三种生成模式（全阶段/两步/一步）如何复用所附小说项目提示词的质量结构，并产出统一 schema；
   - 设定产物如何落入现有数据通路（`w.config.systemPrompt` / `agentName` / 参数位 / `pgAutoChatRenderPerspective`）；
   - 旁白 `narrator` 新类型如何接入共享 timeline 与视角重建（映射为 `role:'system'`）；
   - 监督模型周期评估机制如何在现有事件驱动循环中新增一类周期性触发源；
   - "性格→temperature/topP/maxTokens"的可解释映射规则；
   - narrator 条目对滚动总结、未读游标、终止判断的影响；
   - 各开放问题的可行方案。
3. **产出**一份**详细的设计方案**（数据结构变更、提示词设计、流程改动点、与现有钩子/函数的对接、风险与权衡），而非仅重复本申请书的内容。
4. 本申请书**仅描述需求与现状**，不规定实现。你有充分的设计自由度，但任何方案须能解释为对下列意图的合理实现。

### 阅读约定

- 所有 `file:line` 引用基于静态代码分析，已抽查验证可信。
- 第一部分末尾"附：研究模型可关注的改进点"为参考性观察，非既定结论，是否成立需结合运行时行为与产品意图研判。
- 第二部分标注的"开放问题"是留给你重点研究的，不是已决项。

---

# 第一部分：自动对话功能完整流程梳理

## 0. 一句话概括

自动对话是 playground 的"群聊"引擎：**N 个 AI 窗口共享一条时间线（timeline）作为唯一事实来源，每个窗口独立迭代——窗口完成一次流式回复后，把回复广播进 timeline，然后通知所有窗口（含自己）检查各自的未读游标；有未读且满足发送条件的窗口随即重建"自己的视角"并发起下一轮请求**，直到所有窗口都 idle 且无未读、或达到迭代上限、或用户停止。循环是**事件驱动**的（`setTimeout` 延迟 + 流完成回调），不是 `while` 轮询。

## 1. 模块拓扑

### 1.1 文件与加载顺序

`index.html:92-111` 规定加载顺序（关键）：

```
vendor: katex → marked → marked-katex-extension → purify → highlight → mermaid
modules: pg-i18n → pg-core → pg-state → pg-markdown → pg-request → pg-stream
         → pg-autochat → pg-render → pg-ui → pg-modal → pg-lifecycle
```

注意 `pg-autochat.js`（1040 行）在 `pg-render.js`/`pg-ui.js` 之前加载，但它被 `pg-stream.js`/`pg-ui.js` 以**守卫式全局函数**方式调用（`typeof pgAutoChatOnFinish === 'function'`），因此加载顺序不产生引用错误。

### 1.2 模块依赖关系图

```
pg-i18n ──(pgT)──→ 所有模块
pg-core ──(常量/PG_HOST适配器)──→ 所有模块
pg-state ──(pgState/pgWin*/pgSave*)──→ 所有模块
pg-markdown ──→ pg-render, pg-autochat
pg-request ──(pgBuildBody*/pgTextContent/pgParseSSE*)──→ pg-stream, pg-render, pg-state
pg-stream ──(pgSend/pgStop/pgFinish/pgFail)──→ pg-ui, pg-autochat, pg-lifecycle
           ←──(守卫回调)── pg-autochat [pgAutoChatOnFinish/pgAutoChatShouldRetry/pgAutoChatStop/pgGcOnStreamChunk]
pg-autochat ──(pgSend/pgStop/pgRenderMessages/pgRenderSidebar/pgShowModal...)──→ pg-stream, pg-render, pg-ui, pg-modal, pg-state, pg-request, pg-markdown
pg-render ──→ pg-stream(被调), pg-ui, pg-autochat
pg-ui ──→ pg-autochat(调用启动入口), pg-stream, pg-render
pg-modal ──→ pg-ui, pg-autochat
pg-lifecycle(renderPlayground/cleanupPlayground)──→ 全部
```

核心特征：`pg-stream.js` 与 `pg-autochat.js` 是**双向耦合**——autochat 调 stream 的 `pgSend`/`pgStop`，stream 在流完成/失败/chunk/停止时**守卫式回调** autochat 的 4 个钩子。这是整个循环的"接合部"。

## 2. 如何启动

### 2.1 三种触发路径（殊途同归到 `pgAutoChatStart`）

**路径 A｜侧边栏启用 + 主输入框发送（最常用）**
1. 勾选 `#pg-autochat-enable`（`pg-ui.js:400`）→ `pgAutoChatToggle(true)`（`pg-autochat.js:19`）→ 校验 `splitCount>=2` → `pgState.autoChat.enabled=true`
2. 在 `#pg-input` 按 Enter → `pgOnInputKey`（`pg-ui.js:635`）→ `pgUserSend()`（`pg-ui.js:114`）
3. `pgUserSend` 检测 `autoChat.enabled`（:121）且 `!isRunning`（:123）→ **`pgAutoChatStart(text)`**（`pg-ui.js:126`）

**路径 B｜群聊模态框发送**
- 点击"Open Group Chat"→ `pgOpenGroupChatModal()`（`pg-autochat.js:913`）
- 在 `#pg-gc-input` 按 Enter → `pgOnGroupChatInputKey`（:995）→ `pgGroupChatSend()`（:982）→ 把文本拷回 `#pg-input` 再调 `pgUserSend()` → 同上

**路径 C｜运行中追加用户消息**（不启动，仅广播）
- `pgUserSend` 检测 `isRunning===true`（:123）→ `pgAutoChatUserSend(text)`（`pg-autochat.js:477`）→ 把用户消息追加进 timeline 并通知所有窗口检查 inbox

**停止入口**：`#pg-autochat-stop-btn`（`pg-ui.js:420`）→ `pgAutoChatStop()`（`pg-autochat.js:415`）

### 2.2 启动函数 `pgAutoChatStart(text)`（`pg-autochat.js:165-205`）逐行

```
165  校验至少一个窗口有 model（否则 toast 返回）
171  session++              ← 使所有旧 setTimeout 回调失效（防竞态）
172  isRunning = true
173  abortFlag = false
174  timeline = []           ← 重置共享时间线
175  timelineId = 0
176  pgAutoChatRetryCount = {}
179  把用户种子消息追加进 timeline（senderType='user', winIdx=-1）
185  对每个有 model 的窗口重置：replyCount=0 / autoChatDone=false / autoChatPending=false / lastReadTimelineId=0 / 清定时器 / inbox=[] / messages=[]
201  对每个有 model 的窗口调用 pgAutoChatProcessWindowInbox(i)  ← 并发起爆所有窗口
204  pgUpdateAutoChatUI()
```

## 3. 参数如何注入（从 UI 到引擎的完整路径）

### 3.1 autochat 专用参数（持久化到 localStorage `tinyrouter.playground.autochat.v1`）

| 参数 | UI 控件 / 事件 (`pg-ui.js`) | setter (`pg-autochat.js`) | 落点 | 默认 |
|---|---|---|---|---|
| 启停 `enabled` | `#pg-autochat-enable` onchange:400 | `pgAutoChatToggle`:19 | `pgState.autoChat.enabled` | false |
| 迭代数 `iterations`(0=∞) | number input onchange:406 | `pgAutoChatSetIterations`:33 | `pgState.autoChat.iterations` | 10 |
| 用户名 `userName` | text input oninput:411 | `pgAutoChatSetUserName`:39 | `pgState.autoChat.userName` | 'User' |
| 延迟 `delaySeconds` | number input onchange:415 | `pgAutoChatSetDelay`:44 | `pgState.autoChat.delaySeconds` | 0 |

每个 setter 模式一致：写 `pgState` → `pgSaveAutoChat()`（`pg-state.js:169`）→ `pgUpdateAutoChatUI()`。

### 3.2 窗口级参数（per-window，持久化到 localStorage `tinyrouter.playground.v1`）

每窗口有独立 `w.config`，用户通过侧边栏 winbar（`pgSetActiveWin(i)`，`pg-ui.js:290`）切换"当前编辑哪个窗口"：

| 参数 | 控件/事件 | setter | 落点 |
|---|---|---|---|
| model | `#pg-model` onchange:315 | `pgOnModelChange`（pg-ui.js:581） | `pgWin().config.model` |
| agentName | `.pg-agent-name` oninput:425 | `pgOnAgentName`（pg-autochat.js:49） | `pgWin().config.agentName` |
| systemPrompt | `#pg-sysprompt` oninput:347 | `pgOnSystemPrompt`（pg-ui.js:590） | `pgWin().config.systemPrompt` |
| contextLimit | number onchange:426 | `pgOnContextLimit`（pg-ui.js:591） | `pgWin().config.contextLimit` |
| temperature/topP/.../stream/seed | range/checkbox onchange:333-343 | `pgOnParam`（pg-ui.js） | `pgWin().config.*` |
| useCustomBody/customBody | （调试面板） | — | `pgWin().config.*` |

### 3.3 种子消息参数

`pgAutoChatStart(text)` 唯一入参 `text` 来自 `pgUserSend()` 读取的 `#pg-input` 文本（`pg-ui.js:114`）。群聊模态框路径会把 `#pg-gc-input` 文本拷回 `#pg-input` 再走同一路径。

### 3.4 默认值来源

- 窗口配置默认 `PG_DEFAULT_CFG`（`pg-core.js:19-38`）：model:'', temperature:0.8, topP:1, maxTokens:0, stream:true, systemPrompt:'', agentName:'', contextLimit:8000
- autochat 默认 `pgState.autoChat`（`pg-state.js:45-55`）：如上表
- 群聊默认 system prompt `PG_AUTOCHAT_DEFAULT_SYSTEM_PROMPT`（`pg-autochat.js:62-69`）：告知 AI 身处群聊、可用 `<pass/>` 选择不发言

### 3.5 关键：参数如何进入请求 body

请求 body 由 `pgBuildBodyForWin(i)`（`pg-request.js:46-80`）+ `pgFinalizeBodyForSend()`（:86-108）构造。autochat 模式下，`w.messages` 在每次发送前由 `pgAutoChatDoSend` 从 timeline **整体重建**（`pg-autochat.js:283-285`），所以 body 的 `model` 取 `w.config.model`、`messages` 取重建后的视角、可选参数按 `parameterEnabled` 开关注入。**autochat 不做格式转换**，body 原样 POST 到 `/v1/chat/completions`（由 TinyRouter 后端代理转发，仅替换 model 字段）。

## 4. 核心循环机制（事件驱动 + 共享 timeline）

### 4.1 数据结构

**共享 timeline**（`pgState.autoChat.timeline`，唯一事实来源）每条 entry：
```
{ id, sender, senderType:'user'|'agent'|'system', winIdx, content, status:'complete'|'pass'|'error' }
```
**per-window 读游标** `w.lastReadTimelineId`：该窗口已消费到 timeline 的最大 id。未读 = 存在 `entry.id > w.lastReadTimelineId`。

### 4.2 循环触发方式

**没有 `while`/递归堆栈**。循环由两类异步事件推进：
1. **`setTimeout` 延迟**（可选，`delaySeconds>0` 时）——`pgAutoChatProcessWindowInbox` 安排
2. **流完成回调**——`pg-stream.js` 的 `pgFinish`/`pgFail` 守卫式调用 `pgAutoChatOnFinish`

`session` 纪元计数器（每次 start/stop 递增）+ 闭包捕获 `capturedSession` 比对，确保旧定时器在 start/stop/start 序列后自动失效（防竞态）。

### 4.3 单窗口单轮完整流程

```
pgAutoChatProcessWindowInbox(winIdx)          [pg-autochat.js:211]
 ├─ pgAutoChatCanReply(winIdx)?  [152]  ← model/非streaming/非pending/非done/未超迭代
 │    └ false → return
 ├─ 扫描 timeline 有无 entry.id > w.lastReadTimelineId?  [215-218]
 │    └ 无未读 → pgAutoChatCheckAllDone() → return   ← 可能自然结束
 ├─ 解析 @mentions → 若被提及则延迟缩减为 30%  [234-236]
 ├─ delaySeconds<=0 → 直接 pgAutoChatDoSend(winIdx)  [239]
 └─ delaySeconds>0  → 随机延迟 = base*[0.5,1.5]  [244-246]
        w.autoChatPending=true; setTimeout(capturedSession守卫 → pgAutoChatDoSend)  [248-258]

pgAutoChatDoSend(winIdx)                       [pg-autochat.js:262]
 ├─ pgAutoChatCanReply 复检  [263]
 ├─ 复检未读（延迟期间可能变化）  [267-273]  无未读 → CheckAllDone → return
 ├─ perspectiveMsgs = pgAutoChatRenderPerspective(winIdx)  [276]   ← 见 §5
 ├─ w.lastReadTimelineId = 最新 entry.id  [279-280]
 ├─ w.messages = perspectiveMsgs 深拷贝(置 status='complete')  [283-285]
 ├─ w.messages.push({role:'assistant', status:'loading'})  [289]
 ├─ pgRenderMessages(winIdx)  [291]
 └─ pgAutoChatSendWithPerspective → pgSend(winIdx, lastIdx)  [138-139,293]
                       │
                       ▼
              pg-stream.js 异步流式请求（见 §6）
                       │
                       ▼ 流完成/失败回调
pgAutoChatOnFinish(winIdx)                     [pg-autochat.js:298]  ← 见 §7
```

### 4.4 循环终止条件（`pgAutoChatCheckAllDone`，:379-402）

对每个窗口检查，**全部满足才算 allDone**：
- `w.streaming===true` → 不结束（还在回复）
- `w.autoChatPending===true` → 不结束（定时器待触发）
- 有未读 timeline → 不结束（即将触发新回复）
- 其余（`autoChatDone` 或 idle 无未读）→ 算完成

`allDone===true` → `pgAutoChatFinish()`（:444，自然结束，追加系统消息、toast success）。

## 5. 视角构建（"上一角色的输出如何变成下一角色的输入"）

`pgAutoChatRenderPerspective(winIdx)`（`pg-autochat.js:110-135`）是群聊的核心巧思：

```
1. system prompt：w.config.systemPrompt 非空则用之，否则用 PG_AUTOCHAT_DEFAULT_SYSTEM_PROMPT  [117-120]
2. 遍历 timeline 每条 entry：
   - senderType==='system'                          → {role:'system', content}
   - senderType==='agent' && entry.winIdx===winIdx  → {role:'assistant', content}   ← 自己的历史发言
   - 其他（别的 agent 或 user）                      → {role:'user', content:'[sender]: '+content}  ← 加身份前缀
```

效果：每个窗口看到的对话里，**自己的发言是 assistant，所有人（含其他 AI）都是 user 且带 `[名字]:` 前缀**。这避免多模型混淆身份、并让模型能识别该回复谁。`<pass/>` 让 agent 主动跳过本轮（不计迭代、不阻塞他人）。

## 6. 请求与 SSE 流（`pg-stream.js`）

### 6.1 发送 `pgSend(i, assistantIdx)`（:2-31）
1. `pgBuildBodyForWin(i)`（`pg-request.js:46`）→ body（model/messages/stream/可选参数）
2. `pgFinalizeBodyForSend`（:86）→ 注入 system prompt（若尚无）+ 图片
3. stream? `pgStream`（:33）: `pgSendNonStream`（:197）

### 6.2 流式 `pgStream`（:33-106）
- `w.streaming=true`、`w.abortCtrl=new AbortController()`（:35-36）
- `fetch('/v1/chat/completions', {signal})`（:39-43）
- `ReadableStream.reader.read()` pump 循环（:56-91）：按 `\n` 切 SSE 行 → `pgParseSSELine` → `pgApplyChunk`（:108，提取 `delta.content`/`reasoning_content`/`sources` 到 `w.pendingContent/pendingReasoning/pendingSources`）→ `pgFlushRender`（:150，50ms 去抖增量渲染）
- 收到 `[DONE]`/流尾 → `pgFinish`（:257）

### 6.3 四个守卫式钩子（`pg-stream.js` → `pg-autochat.js` 的接合部）

| 钩子 | 调用点 (`pg-stream.js`) | 触发时机 | 作用 |
|---|---|---|---|
| `pgGcOnStreamChunk(i,assistantIdx)` | :191-193 | 每个 50ms 渲染帧 | 群聊弹窗实时更新流式内容 |
| `pgAutoChatOnFinish(i)` | :296-298 | 流成功完成 | 推进下一轮/检查终止 |
| `pgAutoChatShouldRetry(i,assistantIdx)` | :325-329 | 流失败 | 最多重试1次/3s后重发 |
| `pgAutoChatStop()` | :367-369 | `pgStop()` 时 | 终止循环 |

全部以 `typeof === 'function' && pgState.autoChat.isRunning` 双重守卫，autochat 未加载/未运行时零副作用。

## 7. 完成钩子 `pgAutoChatOnFinish(winIdx)`（:298-376）——循环的"节拍器"

```
299  if (!isRunning || abortFlag) return        ← 抑制过期回调
307  pgAutoChatRetryCount[winIdx]=0
310-311  content = pgAutoChatStripPrefix(rawContent)   ← 去掉模型可能输出的 [name]: 前缀
314  isPass = /^\s*<pass\s*\/>\s*$/i.test(content)
     ├─ pass 分支 [316-338]:
     │    appendTimeline(name,'agent',winIdx,'','pass')  ← 计入 timeline 但不计数
     │    w.lastReadTimelineId = id
     │    pgUpdateAutoChatUI / pgGcRefreshModalIncremental
     │    pgAutoChatProcessWindowInbox(winIdx)            ← 自己可能继续
     │    for k!=winIdx: pgAutoChatProcessWindowInbox(k)  ← 通知他人
     │    pgAutoChatCheckAllDone()
     └─ 正常分支 [342-375]:
          w.replyCount++
          if (iterations>0 && replyCount>=iterations) w.autoChatDone=true  [344-348]
          appendTimeline(name,'agent',winIdx,content,'complete')  ← 广播
          w.lastReadTimelineId = id
          pgUpdateAutoChatUI / pgGcRefreshModalIncremental
          pgAutoChatProcessWindowInbox(winIdx)           ← 自己：有未读(自己刚加的)→立即下一轮
          for k!=winIdx: pgAutoChatProcessWindowInbox(k) ← 他人：有未读→各自起爆
          pgAutoChatMaybeSummarize()                     ← 滚动总结(可选)
          pgAutoChatCheckAllDone()
```

**循环的物理来源**：`pgAutoChatOnFinish` 末尾对"自己+所有他人"调用 `pgAutoChatProcessWindowInbox`，只要某窗口有未读且 `pgAutoChatCanReply`，就会再次进入 `pgAutoChatDoSend → pgSend → ... → pgAutoChatOnFinish`，形成自维持的事件循环。

## 8. 错误处理与重试

- 流失败/HTTP错误/网络中断 → `pgFail`（`pg-stream.js:301`）：设 `msg.status='error'`、记录 `error/errorCode`
- `pgAutoChatShouldRetry`（`pg-autochat.js:1009`）：**每窗口最多重试1次**，3s 后恢复 assistant 占位为 loading 并 `pgSend` 重发；重试期间 `autoChatPending=true` 防其他触发
- 重试耗尽 → `pgFail` 调 `pgAutoChatOnFinish`（:332）——**失败也算完成本轮**（计入迭代、广播空内容/错误、推进循环）
- 滚动总结 `pgAutoChatMaybeSummarize`（:760）的 fetch 失败 `.catch` 静默忽略（:846）——不影响主对话

## 9. 停止机制

**用户停止 `pgAutoChatStop()`（:415-442）**
```
abortFlag=true; session++; isRunning=false          [416-418]
pgAutoChatClearWindowTimers()                        [419]
pgStop()  → pg-stream.js:338                         [420]
   ├─ 设 abortFlag/session（防重复）
   ├─ 对每个 streaming 窗口 w.abortCtrl.abort()      [346-348]
   ├─ 对 streaming/loading 的 assistant 调 pgFinish   [350-359]
   └─ 守卫式调 pgAutoChatStop()（二次，安全）         [367-369]
重置每窗口状态、pgAutoChatRetryCount={}               [421-429]
timeline 非空则追加系统消息"[stopped]"                [433-435]
pgSave/pgRenderSidebar/pgRenderInputBar/pgUpdateAutoChatUI/pgGcRefreshModalIncremental/toast
```
**自然结束 `pgAutoChatFinish()`（:444-473）**：同上但不设 abortFlag，结束消息基于迭代/idle，toast 为 success。

`abortFlag` 在 `pgAutoChatOnFinish`（:300）和延迟定时器（:256）中作为短路守卫，确保停止后所有在途回调立即作废。

**页面卸载** `cleanupPlayground()`（`pg-lifecycle.js:25`）：若 `isRunning` 先 `pgAutoChatStop()`，再逐窗口 abort fetch。

## 10. 状态管理总览

| 状态 | 位置 | 管理者 | 持久化 |
|---|---|---|---|
| enabled/iterations/userName/delaySeconds | `pgState.autoChat.*` | setter+`pgSaveAutoChat` | ✅ localStorage |
| isRunning/abortFlag/session/timeline/timelineId | `pgState.autoChat.*` | start/stop/finish/appendTimeline | ❌ 仅内存 |
| replyCount/autoChatDone/autoChatPending/lastReadTimelineId/autoChatDelayTimer | `w.*`（per-window） | OnFinish/ProcessInbox/DoSend | ❌ 仅内存 |
| streaming/abortCtrl | `w.*` | pg-stream | ❌ |
| pgAutoChatRetryCount/pgGcRenderedIds/pgAutoChatIsSummarizing | 模块级变量 | autochat 内部 | ❌ |

全局状态通过**全局 `pgState` 直接引用**共享，无事件总线；UI 同步靠显式调用 `pgUpdateAutoChatUI()`/`pgRenderMessages` 等（函数调用驱动，非响应式）。

## 11. UI 与群聊模态框

- **侧边栏**（`pgRenderSidebar`，`pg-ui.js:268`）：autochat 面板（开关/迭代/用户名/延迟）、停止按钮、各窗口 agentName/contextLimit
- **分屏 pane**（`pgRenderPanes`）：每窗口消息列表，`.pg-msg.user/assistant/system` CSS 类区分角色；pane 头显示 agentName + typing/streaming 指示（`pgUpdateAutoChatUI` :530）
- **群聊模态框**（`pgOpenGroupChatModal` :913）：**实时监控界面**（非配置弹窗）。`pgGcRefreshModalIncremental`（:644）增量追加新 timeline 条目（`pgGcRenderedIds` 去重）、管理 streaming-agent-N 实时节点、typing 指示器、token 水位条（`pgGcUpdateTokenBar` :855）、2s 后备轮询定时器
- **进度提示**：`#pg-autochat-iterations-hint` 显示 `W1:3 W2:5 / 10`

## 12. 完整流程图（Mermaid）

```mermaid
flowchart TD
    U([用户: 勾选 Enable Auto Chat<br/>输入种子消息 按 Enter]) --> UI[pgUserSend<br/>pg-ui.js:114]
    UI -->|enabled & !isRunning| S[pgAutoChatStart text<br/>pg-autochat.js:165]
    UI -->|enabled & isRunning| US[pgAutoChatUserSend<br/>:477 广播用户消息]
    S --> S1[session++ isRunning=true<br/>timeline=[] 重置每窗口状态]
    S1 --> S2[用户消息追加 timeline]
    S2 --> S3[对所有有model窗口<br/>pgAutoChatProcessWindowInbox i]
    S3 --> P{pgAutoChatProcessWindowInbox<br/>:211}
    P --> C{pgAutoChatCanReply? :152}
    C -->|否| END1[pgAutoChatCheckAllDone]
    C -->|是| UR{timeline 有未读?<br/>id>lastReadTimelineId}
    UR -->|否| END1
    UR -->|是| DL{delaySeconds>0?}
    DL -->|否| D[pgAutoChatDoSend :262]
    DL -->|是| T[setTimeout 随机延迟<br/>autoChatPending=true :248]
    T -->|capturedSession守卫通过| D
    D --> RP[pgAutoChatRenderPerspective<br/>重建视角 :276]
    RP --> DM[w.messages=视角深拷贝<br/>push assistant占位 :283-289]
    DM --> RM[pgRenderMessages :291]
    RM --> SND[pgSend winIdx lastIdx<br/>:138-139]
    SND --> ST[pgStream pg-stream.js:33<br/>fetch /v1/chat/completions SSE]
    ST --> CHUNK[每50ms pgFlushRender<br/>增量渲染+pgGcOnStreamChunk :191]
    CHUNK --> DONE{[DONE]/流尾}
    DONE -->|成功| FIN[pgFinish :257]
    ST -->|失败| FAIL[pgFail :301]
    FAIL --> RT{pgAutoChatShouldRetry? :325}
    RT -->|是 重试1次/3s| SND
    RT -->|否| ONF
    FIN --> ONF[pgAutoChatOnFinish winIdx :298]
    ONF --> CHK1{isRunning & !abortFlag?}
    CHK1 -->|否| STOP[返回 已停止]
    CHK1 -->|是| PS{content=<pass/>? :314}
    PS -->|是 pass| TL1[appendTimeline pass 不计数 :319]
    PS -->|否 正常| TL2[replyCount++<br/>appendTimeline complete :342-353]
    TL1 --> BROAD
    TL2 --> BROAD
    BROAD[pgUpdateAutoChatUI<br/>pgGcRefreshModalIncremental<br/>SUM pgAutoChatMaybeSummarize :372]
    BROAD --> NXT[对本窗口+所有他人<br/>pgAutoChatProcessWindowInbox :363-369]
    NXT --> P
    BROAD --> ALL[pgAutoChatCheckAllDone :375]
    ALL --> AD{所有窗口 idle 且无未读<br/>或全部 done?}
    AD -->|否| P
    AD -->|是| FNS[pgAutoChatFinish :444<br/>追加系统消息 toast success]
    END1 --> AD
    USTOP([用户: 点 Stop]) --> STP[pgAutoChatStop :415]
    STP --> STP1[abortFlag=true session++<br/>isRunning=false]
    STP1 --> STP2[清定时器 pgStop abort所有fetch :420]
    STP2 --> STP3[重置状态 追加stopped消息 toast]
```

## 13. 端到端调用链（时序，以 2 窗口/iterations=2/delay=0 为例）

```
[1]  pgOnInputKey                    pg-ui.js:635
[2]  pgUserSend                      pg-ui.js:114
[3]  pgAutoChatStart("Hello")        pg-autochat.js:165  ← 启动
       ├ session++; isRunning=true; timeline=[]
       ├ appendTimeline(user,-1,"Hello")
       ├ reset w0,w1 per-window state
       └ pgAutoChatProcessWindowInbox(0)   :201
          └ pgAutoChatProcessWindowInbox(1)
[4]  pgAutoChatProcessWindowInbox(0) :211  ← 窗口0第1轮
       └ pgAutoChatCanReply(0)→true :152
       └ 有未读→delay=0→pgAutoChatDoSend(0) :239
[5]  pgAutoChatDoSend(0)             :262
       ├ pgAutoChatRenderPerspective(0) :276  → [system, user:[User]:Hello]
       ├ w0.messages=深拷贝; push assistant占位 :283-289
       ├ pgRenderMessages(0) :291
       └ pgAutoChatSendWithPerspective→pgSend(0,lastIdx) :138-139
[6]  pgSend(0)                       pg-stream.js:2
       ├ pgBuildBodyForWin(0)        pg-request.js:46
       ├ pgFinalizeBodyForSend       pg-request.js:86
       └ pgStream(0,body,assistantIdx) :27
[7]  pgStream fetch SSE              pg-stream.js:33-106
       └ pump→pgApplyChunk(累积pendingContent) :108
       └ pgFlushRender(50ms)→pgRenderBubble + pgGcOnStreamChunk :150,191
[8]  [DONE]→pgFinish(0)              pg-stream.js:257
       └ pgAutoChatOnFinish(0)       :297 → pg-autochat.js:298  ← 节拍器
[9]  pgAutoChatOnFinish(0)           :298
       ├ replyCount=1 (<2)
       ├ appendTimeline(Agent1,agent,0,回复) :353
       ├ pgUpdateAutoChatUI / pgGcRefreshModalIncremental
       ├ pgAutoChatProcessWindowInbox(0) :363 → 有未读(自己刚加)→ 窗口0第2轮
       ├ pgAutoChatProcessWindowInbox(1) :366 → 有未读→ 窗口1第1轮
       ├ pgAutoChatMaybeSummarize :372 (不足30条,跳过)
       └ pgAutoChatCheckAllDone :375 (仍在运行,否)
[10] 窗口0第2轮: [5]-[8] 重放 → replyCount=2 → autoChatDone=true
[11] 窗口1第1轮: [4]-[8] 重放(角色变1) → replyCount=1
[12] 窗口1第2轮: → replyCount=2 → autoChatDone=true
[13] 最后一次 pgAutoChatOnFinish 末尾 pgAutoChatCheckAllDone :375
       └ w0:done w1:done → allDone=true :399
[14] pgAutoChatFinish               :444
       ├ isRunning=false; 清定时器; 重置状态
       ├ appendTimeline(system,"finished — 4 total replies") :465
       └ pgSave/pgRenderSidebar/pgRenderInputBar/pgUpdateAutoChatUI/pgGcRefreshModalIncremental/toast(success)
```

## 附：研究模型可关注的改进点（参考性观察，非既定结论）

1. **`pgAutoChatSendWithPerspective`（:138-139）形参 `perspectiveMsgs` 未被使用**——视角已写入 `w.messages`，`pgSend` 直接读 `w.messages`，参数冗余。
2. **`w.inbox` 字段已弃用**（:192 注释），仅保留序列化兼容，可清理。
3. **重试仅 1 次/3s 固定**（:1009），无指数退避，对 429 类错误可能不够稳健。
4. **`pgGcStreamingNode`/`pgGcStreamingId`（:611-614）标注已弃用**，保留兼容。
5. **`session` 纪元防竞态**是手工实现，可考虑用 AbortSignal 统一管理定时器与 fetch。
6. **无未读但未达迭代的 idle 窗口会被 `CheckAllDone` 判为完成**——若期望"等待他人产生新消息"则可能提前结束（需结合 `<pass/>` 与广播语义复核）。
7. **视角重建是 O(timeline) 全量重建**（:122 每次遍历整个 timeline），长对话 + 滚动总结机制（:760）是其补偿策略，可研究增量视角。

---

# 第二部分：新增"AI 辅助设定生成"特性工作要求

## 0. 特性总览

新增特性分为两个**相位**：

| 相位 | 时机 | 职责 | 对应需求 |
|---|---|---|---|
| A·设定生成 | 对话启动前 | 由 AI 生成场景背景 + 各人物设定，合成 system prompt 并自动填入各窗口 | 点 1、2、4 |
| B·旁白推进 | 对话进行中 | 监督模型周期评估对话，决定是否由旁白进程注入"剧情推进"内容 | 点 3 |

## 1. 相位 A：设定生成（setup）

### 1.1 入口与用户输入
- 提供一个"设定生成"入口（按钮/弹窗）。
- 用户**最少可不提供任何输入**（完全自动），也可提供：一句话主题/方向种子、各 agent 名称、agent 数量。
- agent 数量取现有窗口数（`pgState.splitCount`，1–4），不另设独立计数。
- 生成后用户仍可手动覆盖任何字段。

### 1.2 三种生成模式（用户可选，全都要）
特性需同时支持以下三种模式，由用户在生成时自行选择。三种模式**共享统一输出 schema**（§1.4），以保证下游自动填入逻辑一致：

| 模式 | 阶段数 | 复用的小说项目提示词 | 适用场景 |
|---|---|---|---|
| **M1 全阶段管线** | 5 | 方向创造→小说架构→人物卡片生成→人物侧写→人物设定 | 质量与可控性最高，每阶段可审阅/微调/重生成 |
| **M2 两步精简** | 2 | ①(方向创造+小说架构合一)生成场景背景+人物批量侧写；②(人物侧写)扩写为人物卡片并合成 system prompt | 步骤少、仍借用提示词质量结构 |
| **M3 一步到位** | 1 | 单次生成"场景背景 + N 个 system prompt" | 最快，可控性最低 |

> 研究模型需为 M2/M3 设计合并后的提示词，但应尽量沿用小说项目提示词的**质量结构**（核心矛盾、驱动力三角、styleNote/styleExamples 等），而非另起炉灶。

### 1.3 复用提示词与产出映射

| 阶段(小说项目) | 输入 | 输出 | 在本特性中的用途 |
|---|---|---|---|
| 方向创造 | 可能为空 | `{topic,genre,guidance}` | 场景创意方向种子 |
| 小说架构 | topic/genre/guidance | 核心种子+角色动力学+世界观+三幕情节 | **共享场景背景**（世界观/核心种子）；角色动力学→人物关系网 |
| 人物卡片生成 | type/count/要求 | `{profiles:[{name,brief}]}` | 按数量生成 N 个差异化人物侧写 |
| 人物侧写 | 一组侧写 | JSON 数组（name/aliases/description/fields/styleNote/styleExamples） | 扩写为完整人物卡片 |
| 人物设定 | 单实体 | 单个卡片 JSON | 单个 agent 的重新生成/丰富 |

**关键映射**：人物卡片的 `styleNote`（语言风格）+ `styleExamples`（台词例句）是合成 system prompt 的核心素材——直接定义"该 agent 如何说话"。

### 1.4 统一输出 schema（三种模式最终都产出此结构）
研究模型需定义一个统一档案结构，至少包含：
- `scenario`：共享场景背景（世界观、核心种子、基调）
- `characters[]`：各人物卡片（name/aliases/description/fields/styleNote/styleExamples + 与他人关系）
- `agents[]`：每个 agent 的最终合成结果
  - `agentName`（取自人物名）
  - `systemPrompt` = `[共享场景背景] + [该人物的个人定义：description/fields/styleNote/styleExamples/关系] + [群聊行为规则（含对旁白 narrator 类条目的识别说明，见 §2.4）]`
  - `params`：自动推导的参数快照（见 §1.6）

### 1.5 自动填入窗口的映射（要求层面）
生成完成后，`agents[i]` 的字段自动写入第 i 个窗口的对应配置位（即现有流程中由侧边栏控件分别写入的 `w.config.systemPrompt` / `w.config.agentName` / `w.config.*` 参数位）。填入后，现有 `pgAutoChatRenderPerspective`（pg-autochat.js:117-119）读取 `w.config.systemPrompt` 的逻辑即可直接复用——**生成产物天然落入既有数据通路**。

### 1.6 参数自动推导规则（model 始终由用户选）
根据人物设定自动推导并填入以下参数：
- `agentName` ← 人物名
- `temperature` / `topP` ← 由性格推导创造性（严谨/克制角色偏低；跳脱/奔放角色偏高）
- `maxTokens` ← 由人物设定推导（控制某些角色不输出过长/过复杂内容）
- `seed` ← 随机生成

> 研究模型需给出"性格→temperature/topP/maxTokens"的可解释映射规则（建议方向，非硬编码）。

### 1.7 导入/导出
- 支持**导出**已生成设定为可复用档案（JSON），范围 = §1.4 的完整统一档案（scenario + characters + agents）。
- 支持**导入**该档案，恢复至各窗口配置位，供下次复用。
- 格式以 JSON 为准。

## 2. 相位 B：旁白/剧情推进子系统（runtime）

### 2.1 监督模型（director/judge）
- 新增一个**控制场景、剧情推进的监督模型**，配有专属提示词（**该提示词需由研究模型新设计**，小说项目材料中无对应物）。
- **隔一段时间**（可配置间隔）提交一次**当前对话内容**给监督模型。
- 监督模型**判断**：是否进行剧情推进，还是继续让自动对话进行下去。
- 即：触发时机不由固定周期/停滞检测硬编码，而由一个**带提示词的元模型**依据剧情上下文自主决策。

### 2.2 旁白进程与 narrator 类型
- 旁白/世界推进者**不作为群聊参与者**：不占发言轮次、不计 `replyCount`/迭代。
- 当监督模型决定推进时，由**旁白后台进程**生成"推进场景/故事前进"的内容，并以**新的 timeline 条目类型 `senderType:'narrator'`** 注入共享时间线。
- 旁白使用哪个模型：由用户配置（可复用已配置模型或指定专用模型）。
- 监督模型与旁白进程的**关系**（是否同一模型实例、合一或分离）作为开放设计点，由研究阶段决定；但职责上二者明确区分：监督模型决定"何时推进"，旁白进程负责"生成推进内容并注入"。

### 2.3 各 agent 视角重建中的映射
- narrator 类型条目在各 agent 的视角重建中须映射为 **`role:'system'`**（场景变更/环境描写），而非 `role:'user'`（提问）。
- 此映射与现有 `pgAutoChatRenderPerspective`（pg-autochat.js:125-126）对 `senderType==='system'` 的处理同构——研究模型可沿此通路扩展 narrator 分支。

### 2.4 system prompt 对 agent 的告知
- 每个 agent 的 system prompt 中须包含明确规则：群聊中会出现 `narrator` 类型的条目，它们是**场景的改变/环境描写**，**不是需要回答的提问**，agent 应据此调整后续发言而非回复旁白本身。
- 此规则在 §1.4 的 `systemPrompt` 合成时注入。

## 3. 与现有自动对话流程的对接点（要求层面，非实现）

下列为概念性对接点，供研究模型理解"应融合到哪里"，具体实现留给下一阶段：

| 新特性产物 | 现有流程对接点（已梳理） |
|---|---|
| 生成的 `systemPrompt` | `w.config.systemPrompt` → 被 `pgAutoChatRenderPerspective`（pg-autochat.js:117-119）读取 |
| 生成的 `agentName` / 参数 | `w.config.agentName` / `w.config.*`（现由侧边栏 setter 写入） |
| narrator timeline 条目 | 共享 `pgState.autoChat.timeline`；视角重建时映射为 `role:'system'`（同 :125-126 system 分支） |
| 旁白"不计迭代" | 与现有 `<pass/>` 不计 `replyCount` 语义（pg-autochat.js:317-338）同构 |
| 监督模型周期评估 | 需在事件驱动循环中新增一类周期性触发源（现有循环由流完成回调+setTimeout 延迟驱动） |
| 终止判断 | `pgAutoChatCheckAllDone`（:379-402）需把 narrator/监督活动纳入"是否仍 idle"考量 |

## 4. 约束与开放问题（留给研究模型）

1. **三种模式共享统一输出 schema**，使下游填入逻辑与模式无关。
2. 监督模型的**专属提示词**需新设计（小说项目无对应）；其输入=当前对话内容，输出=推进决策（推进/继续，以及推进方向）。
3. 监督模型与旁白进程的**关系**（合一/分离、是否同模型）为开放设计点。
4. "性格→temperature/topP/maxTokens"的**映射规则**需可解释、可被用户在生成后覆盖。
5. narrator 条目进入 timeline 后，其对**滚动总结**（`pgAutoChatMaybeSummarize` :760）、**未读游标**（`lastReadTimelineId`）、**终止判断**的影响需在研究阶段明确。
6. 导入/导出档案的**版本号**与向后兼容策略需定义。
7. 设定生成阶段调用的 LLM 请求走现有 `/v1/chat/completions`（非流式即可），不引入新端点。

---

# 附录：参考提示词（小说辅助描写项目原文）

以下为用户提供、供设定生成复用的提示词原文。

## 附录-1 方向创造

```
创作方向你是创意写作教练。用户想写小说但可能缺乏灵感或只有一个模糊的方向。你的任务是与用户共创，脑暴出一个引人入胜的小说创作方向。

## 工作方法

1. 如果用户给了任何线索（类型、章节数、梗概），紧扣其展开；如果几乎为空，请自由发挥创意，给出一个有趣、有张力的创作方向。
2. 设计一个**高冲突、有反转余地的核心矛盾**作为故事锚点。
3. 主题（topic）必须是一句式钩子承诺——让读者产生"想知道接下来会发生什么"的冲动。
4. 类型（genre）必须精准（如：仙侠/悬疑/都市/科幻/武侠/历史），可跨类混合但不超过 3 类。
5. 梗概（guidance）用 2-3 句话勾勒核心设定、主要冲突与预期结局方向。

## 输出格式（严格遵守，便于程序解析）

你必须且只能输出以下 JSON 对象（不要 ```json``` 标记，不要任何解释文字）：

{"topic":"一句式钩子承诺","genre":"精准的类型标签","guidance":"2-3句核心梗概"}

topic 是必填的，genre 和 guidance 也必须给出。即使完全没有用户输入，也要生成一个完整、有趣的创作方向。
```

## 附录-2 小说架构

```
你是一位精通"雪花写作法"的资深小说架构师。你的目标是帮助用户从零构建一个逻辑严密、充满张力的长篇小说架构。

## 工作方法（雪花法，依次思考）

**第 1 步 核心种子**：用单句公式概括故事本质——"当[主角]遭遇[核心事件]，必须[关键行动]，否则[灾难后果]……"。必须包含显性冲突与潜在危机。

**第 2 步 角色动力学**：设计 3–6 个核心角色。为每个角色定义驱动力三角（表面追求 / 深层渴望 / 灵魂需求），并构建关系网（冲突、合作、背叛）。

**第 3 步 世界构建**：分三维度——物理维度（空间/时间/法则）、社会维度（权力结构/文化禁忌）、隐喻维度（视觉符号/主题映射）。

**第 4 步 三幕式情节**：
- 第一幕（触发）：日常打破 → 关键事件 → 错误抉择。
- 第二幕（对抗）：压力升级 → 虚假胜利 → 灵魂黑夜。
- 第三幕（解决）：代价显现 → 终极抉择 → 开放结局。

## 输出格式（严格遵守，便于程序解析）

你必须且只能输出以下四个二级标题分区，标题行原样照写，每区内容自由发挥：

## 核心种子
（单句公式 + 一两句扩展）

## 角色动力学
（各角色的驱动力三角与关系网）

## 世界观
（物理 / 社会 / 隐喻三维度）

## 三幕式情节
（第一幕 / 第二幕 / 第三幕）

不要输出这四个分区之外的任何内容（不要前言、不要结语、不要解释）。如果用户给了主题/类型/梗概，紧扣其推导。
```

## 附录-3 人物设定

```
你是专业的小说设定设计师。你的任务是根据用户的描述，凭空创作一张结构完整、内容丰富的小说设定卡片（不依赖任何原文）。

## 实体类型

卡片属于以下五类之一（由用户指定 type）：character（人物）/ location（地点）/ item（物品）/ skill（技能·能力）/ faction（势力·组织）。

## 两种模式

- **create（新建）**：根据用户描述从零创作一张全新卡片。
- **enrich（丰富）**：用户会提供一张「已有卡片」内容，你要在**保留原有信息**的前提下扩写、补全、深化——补充缺失的字段、丰富描述、增加细节，但不得推翻或矛盾于已有设定。

## 创作原则

- **贴合描述**：紧扣用户的指令意图（性格、定位、外貌、能力等）。
- **结构化**：根据实体类型把关键属性整理进 fields 键值对（中文键名）。
- **人物专属**：当 type=character 时，额外输出 styleNote（语言风格描述）与 styleExamples（2-4 句台词例句）；其他类型这两个字段省略或留空。
- **自洽完整**：description 用一段连贯文字概括该实体（80-200 字）。

## fields 字段示例（按类型）

- character：appearance(外貌) / personality(性格) / ability(能力) / identity(身份) / motivation(动机)
- location：type(类型) / environment(环境) / significance(意义)
- item：type(类型) / effect(效果) / owner(持有者)
- skill：type(类型) / effect(效果) / user(使用者)
- faction：type(类型) / leader(领袖) / influence(势力范围)

## 输出格式（严格遵守）

只能输出**单个 JSON 对象**（不要 ```json``` 标记，直接输出 JSON），结构如下：

{
  "name": "实体名称",
  "aliases": ["别名1", "别名2"],
  "description": "一段连贯的概括描述",
  "fields": { "外貌": "...", "性格": "..." },
  "styleNote": "（仅 character）语言风格描述",
  "styleExamples": ["（仅 character）台词例句1", "台词例句2"]
}

## 注意事项

- 输出必须是合法 JSON，不附加任何解释文字、不加 markdown 围栏。
- aliases 没有就给空数组 []；非人物类的 styleNote/styleExamples 可省略。
- enrich 模式下：name 一般沿用已有卡片的 name（除非用户明确要求改名），其余字段在已有内容基础上扩充。
```

## 附录-4 人物卡片生成

```
你是小说设定策划。根据用户给定的实体类型、数量与（可选）整体要求，构思一组**彼此区分、互不雷同**的简短侧写，供后续逐一扩写为完整设定卡片。

## 输出格式（严格遵守）

只输出**一个 JSON 对象**（不要 ```json``` 标记，直接输出 JSON）：

{
  "profiles": [
    { "name": "名称", "brief": "一句话侧写（30-60字，点出定位/性格/核心特征）" }
  ]
}

## 要求

- profiles 数组长度必须等于用户指定的数量 count。
- 每条侧写聚焦一个鲜明的核心设定，彼此**差异化**：避免重名、避免设定/定位重复。
- 若用户提供了整体要求/主题，所有侧写都要贴合它；若未提供，自由发挥、追求新颖多样。
- name 简洁；brief 用一句话概括，不展开。
- 输出必须是合法 JSON，不附加任何解释文字、不加 markdown 围栏。
```

## 附录-5 人物侧写

```
你是专业的小说设定设计师。你会收到同一实体类型下的**一组侧写**，请把每条侧写各自扩写为一张结构完整、内容丰富的设定卡片（不依赖任何原文）。

## 实体类型与字段

卡片属于以下五类之一：character（人物）/ location（地点）/ item（物品）/ skill（技能·能力）/ faction（势力·组织）。
- 用 fields 键值对（中文键名）整理关键属性。
- 仅当 type=character 时额外输出 styleNote（语言风格）与 styleExamples（2-4 句台词例句），其它类型省略。
- description 用一段连贯文字概括该实体（80-200 字）。

## 输出格式（严格遵守）

只输出**一个 JSON 数组**（不要 ```json``` 标记，直接输出 JSON），每个元素对应输入的一条侧写、**顺序一一对应**：

[
  {
    "name": "实体名称",
    "aliases": ["别名1"],
    "description": "一段连贯的概括描述",
    "fields": { "外貌": "...", "性格": "..." },
    "styleNote": "（仅 character）语言风格描述",
    "styleExamples": ["（仅 character）台词例句1", "台词例句2"]
  }
]

## 要求

- 数组长度必须等于输入侧写条数，顺序与输入一致。
- 每张卡片自洽完整、彼此差异化；紧扣对应侧写的核心设定与用户的整体要求。
- aliases 没有就给空数组 []；非人物类的 styleNote/styleExamples 省略。
- 输出必须是合法 JSON，不附加任何解释文字、不加 markdown 围栏。
```
