# TinyRouter Playground 自动对话 V2 实施计划

> **文档用途**：供新对话（无历史上下文）独立执行 P0-P2 全部实施工作。
> **代码基准**：commit `3d72ca5`（2026-07-08），已包含独立迭代模型 + 随机延迟 + 群聊 Modal 实时刷新。
> **参考文档**：`autoplay.md`（当前架构文档）、`reply.md`（深度研究模型审查意见）。

---

## 目录

- [1. 现有架构摘要](#1-现有架构摘要)
- [2. P0：正确性修复](#2-p0正确性修复)
- [3. P1：共享时间线重构 + 体验质变](#3-p1共享时间线重构--体验质变)
- [4. P2：真实群聊质感](#4-p2真实群聊质感)
- [5. 实施顺序与验收标准](#5-实施顺序与验收标准)
- [6. 文件修改矩阵](#6-文件修改矩阵)
- [7. 新增 i18n key 清单](#7-新增-i18n-key-清单)
- [8. 新增 CSS 清单](#8-新增-css-清单)

---

## 1. 现有架构摘要

### 1.1 项目背景

TinyRouter 是 Go 编写的 LLM API 代理，内置 Playground 模块（纯 vanilla JS，无框架）。Playground 支持 1-4 个分屏窗口，每窗口独立配置模型/参数/消息。自动对话（群聊）模式让多窗口的 Agent 像群聊一样互相回复。

### 1.2 模块文件

```
web/playground/static-pg/
  pg-core.js       — 常量、默认配置、宿主适配 (PG_HOST/pgApiGet/pgToast/pgT)
  pg-state.js      — pgState、makeWin、pgLoad/pgSave、pgLoadModels
  pg-markdown.js   — Markdown 渲染、KaTeX、代码高亮
  pg-request.js    — 请求体构造 (pgBuildBodyForWin)、SSE 解析
  pg-stream.js     — pgSend、pgStream、pgFlushRender、pgFinish、pgFail、pgStop
  pg-render.js     — pgRenderBubble、pgRenderMessages、pgMsgInnerHTML、Debug 渲染
  pg-autochat.js   — 自动对话核心逻辑（488 行）
  pg-ui.js         — pgRenderSidebar、pgRenderPanes、pgRenderInputBar、pgUserSend
  pg-modal.js      — Modal 系统 (pgShowModal/pgCloseModal)
  pg-lifecycle.js  — renderPlayground / cleanupPlayground
  pg-i18n.js       — i18n 字典 (en / cn)
  playground.css   — 样式
```

HTML 加载入口：`web/static/index.html`，按顺序加载 `pg-i18n → pg-core → pg-state → pg-markdown → pg-request → pg-stream → pg-autochat → pg-render → pg-ui → pg-modal → pg-lifecycle`。

Go 内嵌：`web/embed_playground.go` 通过 `//go:embed all:playground/static-pg` 内嵌所有文件。HTTP 路由在 `internal/api/router.go` 中注册。

### 1.3 核心数据结构

#### pgState.autoChat（全局自动对话状态）

```javascript
// pg-state.js:42-51
autoChat: {
  enabled: false,        // 自动对话开关（不持久化）
  iterations: 10,        // 每窗口最大回复次数（0=无限）
  userName: 'User',      // 用户昵称
  delaySeconds: 0,       // 随机延迟基数（秒），0=不延迟
  isRunning: false,      // 循环是否活跃
  abortFlag: false,      // 终止信号
},
```

#### makeWin() 中的自动对话字段（每窗口状态）

```javascript
// pg-state.js:24-30
agentName: '',             // Agent 昵称
inbox: [],                 // 待处理消息队列 [{sender, content, timestamp}]
replyCount: 0,             // 已完成回复次数
autoChatDone: false,       // 是否达到迭代上限
autoChatPending: false,    // 是否在等待延迟定时器
autoChatDelayTimer: null,  // setTimeout id
```

### 1.4 核心函数清单（pg-autochat.js）

| 函数 | 行号 | 职责 |
|---|---|---|
| `pgAutoChatToggle(enabled)` | 19 | 开关自动对话，splitCount<2 时拒绝 |
| `pgAutoChatSetIterations(v)` | 33 | 设置迭代次数 |
| `pgAutoChatSetUserName(v)` | 39 | 设置用户昵称 |
| `pgAutoChatSetDelay(v)` | 44 | 设置延迟秒数 |
| `pgOnAgentName(v)` | 49 | 设置当前窗口 Agent 昵称 |
| `pgAutoChatGetAgentName(winIdx)` | 60 | 获取窗口昵称（空则 fallback "Agent N"） |
| `pgAutoChatModelWindows()` | 67 | 返回有模型的窗口索引数组 |
| `pgAutoChatCanReply(winIdx)` | 76 | 判断窗口是否可回复 |
| `pgAutoChatStart(text)` | 89 | 首次启动对话 |
| `pgAutoChatProcessWindowInbox(winIdx)` | 127 | 延迟调度 + 触发发送 |
| `pgAutoChatDoSend(winIdx)` | 155 | 合并 inbox 并实际发送 |
| `pgAutoChatOnFinish(winIdx)` | 178 | 回复完成后的核心编排（广播+触发+检查） |
| `pgAutoChatCheckAllDone()` | 225 | 判断是否全部结束 |
| `pgAutoChatClearWindowTimers()` | 249 | 清理所有延迟定时器 |
| `pgAutoChatStop()` | 258 | 手动终止 |
| `pgAutoChatFinish()` | 277 | 自然结束 |
| `pgAutoChatUserSend(text)` | 303 | 运行中用户发言 |
| `pgUpdateAutoChatUI()` | 325 | 更新进度提示 |
| `pgGetGroupChatMessages()` | 357 | 收集所有窗口消息并去重 |
| `pgRenderGroupChatMessagesHtml(msgs)` | 408 | 渲染群聊消息 HTML |
| `pgRefreshGroupChatModal()` | 421 | 刷新群聊 Modal（全量 innerHTML） |
| `pgOpenGroupChatModal()` | 429 | 打开群聊 Modal（启动 500ms 定时刷新） |
| `pgCloseGroupChatModal()` | 465 | 关闭群聊 Modal |
| `pgGroupChatSend()` | 470 | 群聊 Modal 内发送 |
| `pgOnGroupChatInputKey(e)` | 483 | 群聊 Modal 输入框按键处理 |

### 1.5 关键 Hook 注入点

**pgFinish（pg-stream.js:253-295）**：回复正常完成时，末尾调用 `pgAutoChatOnFinish(i)`。

**pgFail（pg-stream.js:297-323）**：回复失败时，末尾也调用 `pgAutoChatOnFinish(i)`（失败也算一次回复）。

**pgStop（pg-stream.js:326-354）**：开头设置 `abortFlag = true` 抑制 finish hook，末尾调用 `pgAutoChatStop()`。

**pgUserSend（pg-ui.js:114-129）**：自动对话模式分支，允许生成中发送（跳过 `pgIsGenerating()` 检查）。

**pgFlushRender（pg-stream.js:150-191）**：流式渲染节流（50ms），更新 `msg.content` 并调用 `pgRenderBubble`。**这是 P1 流式直播的 hook 点。**

### 1.6 现有问题清单（来自 reply.md 审查）

1. **消息上下文膨胀**：messages 数组无限增长，无截断/摘要
2. **消息嵌套**：inbox 消息以 `[sender]: content` 注入，模型模仿导致嵌套
3. **并发安全**：stop→start 后旧回调可能污染新会话（abortFlag 不足）
4. **终止判断**：空回复导致链条断裂时无声结束，用户不知道为什么
5. **延迟策略**：固定基数±50% 已可用，但缺少"正在输入"视觉反馈
6. **Modal 性能**：500ms 全量 innerHTML 导致滚动位置/选区丢失

---

## 2. P0：正确性修复

### 2.1 世代号（Session Epoch）

**问题**：`pgStop()` 设置 `abortFlag=true`，`pgAutoChatStop()` 重置 `abortFlag=false`。如果用户 stop 后立即 start，旧延迟定时器 fire 时 `abortFlag` 已是 false，旧回调污染新会话。

**方案**：引入递增的 session 整数，所有异步回调创建时捕获当前值，fire 时比对。

#### 2.1.1 数据结构变更

```javascript
// pg-state.js — pgState.autoChat 新增字段
autoChat: {
  // ... 现有字段 ...
  session: 0,           // 世代号，每次 start 时 ++
},
```

#### 2.1.2 pgAutoChatStart 中递增 session

```javascript
// pg-autochat.js — pgAutoChatStart() 中，isRunning=true 之前
function pgAutoChatStart(text) {
  // ...
  pgState.autoChat.session++;        // ← 新增
  pgState.autoChat.isRunning = true;
  pgState.autoChat.abortFlag = false;
  // ...
}
```

#### 2.1.3 延迟定时器回调保护

```javascript
// pg-autochat.js — pgAutoChatProcessWindowInbox() 中
function pgAutoChatProcessWindowInbox(winIdx) {
  // ...
  var capturedSession = pgState.autoChat.session;  // ← 新增：捕获世代号

  w.autoChatDelayTimer = setTimeout(function() {
    w.autoChatDelayTimer = null;
    w.autoChatPending = false;
    // ← 新增：世代号比对
    if (capturedSession !== pgState.autoChat.session) return;
    if (pgState.autoChat.abortFlag || !pgState.autoChat.isRunning) return;
    pgAutoChatDoSend(winIdx);
  }, delay);
}
```

#### 2.1.4 pgAutoChatOnFinish 保护

```javascript
// pg-autochat.js — pgAutoChatOnFinish() 开头
function pgAutoChatOnFinish(winIdx) {
  if (!pgState.autoChat || !pgState.autoChat.isRunning) return;
  if (pgState.autoChat.abortFlag) return;
  // ← 新增：abortFlag 被 pgStop 设置后，即使被重置，旧 session 的回调也不应执行
  // 但 pgAutoChatOnFinish 是同步调用的（从 pgFinish），不需要 session 保护。
  // session 保护主要针对 setTimeout 回调。
  // 此处保持现有逻辑即可。
  var w = pgWinAt(winIdx);
  if (!w) return;
  // ...
}
```

**注意**：`pgAutoChatOnFinish` 是从 `pgFinish`/`pgFail` 同步调用的，不经过 setTimeout，因此不需要 session 保护。session 保护仅针对 `pgAutoChatProcessWindowInbox` 中的 `setTimeout` 回调。

#### 2.1.5 pgStop 中重置 session

```javascript
// pg-stream.js — pgStop() 中，设置 abortFlag 之后
function pgStop() {
  if (pgState.autoChat && pgState.autoChat.isRunning) {
    pgState.autoChat.abortFlag = true;
    // ← 新增：递增 session 使所有在途定时器失效
    pgState.autoChat.session++;
  }
  // ... 现有逻辑 ...
}
```

#### 2.1.6 pgAutoChatStop 中也递增

```javascript
// pg-autochat.js — pgAutoChatStop() 中
function pgAutoChatStop() {
  pgState.autoChat.abortFlag = true;
  pgState.autoChat.session++;        // ← 新增
  pgState.autoChat.isRunning = false;
  // ... 现有逻辑 ...
}
```

### 2.2 输出端剥离 `[name]:` 前缀

**问题**：模型经常模仿输入格式，在回复开头加上 `[自己的名字]:` 或 `[其他人的名字]:`，导致嵌套。

**方案**：在 `pgAutoChatOnFinish` 中，广播前对 content 执行正则清洗。

#### 2.2.1 新增清洗函数

```javascript
// pg-autochat.js — 新增辅助函数（放在 Helpers 区域）
// 剥离回复开头的 [name]: 前缀（模型模仿输入格式的常见行为）
function pgAutoChatStripPrefix(content) {
  if (!content) return content;
  // 匹配开头的 [任意文字]: 后跟可选空白
  return content.replace(/^\s*\[[^\]]+\]\s*:\s*/, '');
}
```

#### 2.2.2 在 pgAutoChatOnFinish 中使用

```javascript
// pg-autochat.js — pgAutoChatOnFinish() 中，广播前
var rawContent = pgTextContent(w.messages[w.messages.length - 1].content);
var content = pgAutoChatStripPrefix(rawContent);  // ← 新增：清洗前缀
if (content && content.trim()) {
  var sender = pgAutoChatGetAgentName(winIdx);
  // ... 广播 content（而非 rawContent）...
}
```

#### 2.2.3 边界情况

- 前缀不在开头时**不剥离**（模型主动引用是正常行为）
- 空回复不广播（已有 `content.trim()` 检查）
- 清洗只影响广播内容，不影响窗口自身 messages 数组中的原始内容

---

## 3. P1：共享时间线重构 + 体验质变

### 3.1 共享时间线（Shared Timeline）重构

**核心思想**：群聊时间线是唯一事实来源（single source of truth），各窗口的 messages 是从时间线派生出的视图。消灭 inbox、去重、消息分叉三类复杂度。

**策略**：保留现有 messages 数组作为渲染缓存（每次发送时从 timeline 重建），降低风险。

#### 3.1.1 数据结构

```javascript
// pg-state.js — pgState.autoChat 新增
autoChat: {
  // ... 现有字段 ...
  timeline: [],          // 共享时间线（唯一事实来源）
  timelineId: 0,         // 自增 id 计数器
},
```

```javascript
// pg-state.js — makeWin() 中新增
lastReadTimelineId: 0,   // 该窗口已读到的 timeline 消息 id
```

#### 3.1.2 Timeline 消息结构

```javascript
{
  id: 1,                 // 自增唯一 id
  sender: '陆小凤',       // 发送者昵称
  senderType: 'user',    // 'user' | 'agent' | 'system'
  winIdx: -1,            // 发送者窗口索引（user=-1, system=-1, agent=0-3）
  content: '朋友们...',   // 消息内容（无前缀）
  ts: 1720000000000,    // 时间戳
  status: 'complete',    // 'streaming' | 'complete' | 'error' | 'pass'
  replyCount: 0,         // 此条消息被多少窗口回复过（用于 pass 机制）
}
```

#### 3.1.3 新增函数：pgAutoChatAppendTimeline

```javascript
// pg-autochat.js — 新增
function pgAutoChatAppendTimeline(sender, senderType, winIdx, content, status) {
  pgState.autoChat.timelineId++;
  var entry = {
    id: pgState.autoChat.timelineId,
    sender: sender,
    senderType: senderType,
    winIdx: winIdx,
    content: content,
    ts: Date.now(),
    status: status || 'complete',
  };
  pgState.autoChat.timeline.push(entry);
  return entry;
}
```

#### 3.1.4 新增函数：pgAutoChatRenderPerspective（视角渲染）

将 timeline 从指定窗口的 `lastReadTimelineId` 之后的消息渲染为 OpenAI 格式的 messages 数组。

```javascript
// pg-autochat.js — 新增
// 从 timeline 构建指定窗口的 messages 视角
// 规则：自己的消息 → role:assistant（无前缀）
//       他人的消息 → role:user，带 [sender]: 前缀
//       system 消息 → role:system
function pgAutoChatRenderPerspective(winIdx) {
  var w = pgWinAt(winIdx);
  var myName = pgAutoChatGetAgentName(winIdx);
  var msgs = [];

  // 保留窗口原有的 system prompt（如果用户设置了）
  if (w.config.systemPrompt && w.config.systemPrompt.trim()) {
    msgs.push({ role: 'system', content: w.config.systemPrompt });
  }

  // 遍历 timeline
  for (var i = 0; i < pgState.autoChat.timeline.length; i++) {
    var entry = pgState.autoChat.timeline[i];
    if (entry.id <= w.lastReadTimelineId) continue;  // 跳过已读

    if (entry.senderType === 'system') {
      msgs.push({ role: 'system', content: entry.content });
    } else if (entry.senderType === 'agent' && entry.winIdx === winIdx) {
      // 自己之前的回复
      msgs.push({ role: 'assistant', content: entry.content });
    } else {
      // 他人消息（user 或其他 agent）
      msgs.push({ role: 'user', content: '[' + entry.sender + ']: ' + entry.content });
    }
  }

  return msgs;
}
```

#### 3.1.5 修改 pgAutoChatStart

```javascript
// pg-autochat.js — pgAutoChatStart() 重写
function pgAutoChatStart(text) {
  var modelWins = pgAutoChatModelWindows();
  if (!modelWins.length) { pgToast(pgT('pgSelectModel'), 'warning'); return; }

  pgState.autoChat.session++;
  pgState.autoChat.isRunning = true;
  pgState.autoChat.abortFlag = false;
  pgState.autoChat.timeline = [];        // ← 新增：重置时间线
  pgState.autoChat.timelineId = 0;       // ← 新增

  // 用户消息追加到 timeline
  var entry = pgAutoChatAppendTimeline(
    pgState.autoChat.userName || 'User',
    'user', -1, text, 'complete'
  );

  // 重置所有窗口
  modelWins.forEach(function(i) {
    var w = pgWinAt(i);
    w.replyCount = 0;
    w.autoChatDone = false;
    w.autoChatPending = false;
    w.lastReadTimelineId = 0;            // ← 新增：重置读取位置
    if (w.autoChatDelayTimer) { clearTimeout(w.autoChatDelayTimer); w.autoChatDelayTimer = null; }
    w.inbox = [];                        // 保留字段但不再使用
    w.messages = [];                     // 清空，将从 timeline 重建
  });

  pgSave();
  pgRenderSidebar();
  pgRenderInputBar();

  // 启动所有窗口
  modelWins.forEach(function(i) { pgAutoChatProcessWindowInbox(i); });
  pgUpdateAutoChatUI();
}
```

#### 3.1.6 修改 pgAutoChatDoSend（从 inbox 合并改为视角渲染）

```javascript
// pg-autochat.js — pgAutoChatDoSend() 重写
function pgAutoChatDoSend(winIdx) {
  if (!pgAutoChatCanReply(winIdx)) return;
  var w = pgWinAt(winIdx);

  // 检查是否有未读消息
  var hasUnread = pgState.autoChat.timeline.some(function(e) {
    return e.id > w.lastReadTimelineId;
  });
  if (!hasUnread) { pgAutoChatCheckAllDone(); return; }

  // 从 timeline 渲染视角
  var perspectiveMsgs = pgAutoChatRenderPerspective(winIdx);

  // 更新 lastReadTimelineId 到最新
  var lastEntry = pgState.autoChat.timeline[pgState.autoChat.timeline.length - 1];
  w.lastReadTimelineId = lastEntry ? lastEntry.id : w.lastReadTimelineId;

  // 重建窗口的 messages 数组（渲染缓存）
  w.messages = perspectiveMsgs.map(function(m) {
    return { role: m.role, content: m.content, status: 'complete' };
  });

  // 添加 assistant placeholder
  var now = Date.now();
  w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: now });
  var lastIdx = w.messages.length - 1;
  pgRenderMessages(winIdx);

  // 构造请求体（使用视角渲染的 messages）
  // 需要修改 pgBuildBodyForWin 或在此处直接构造 body
  pgAutoChatSendWithPerspective(winIdx, perspectiveMsgs, lastIdx);
}
```

#### 3.1.7 新增函数：pgAutoChatSendWithPerspective

由于现有 `pgBuildBodyForWin` 从 `w.messages` 构造请求体，而我们在 `pgAutoChatDoSend` 中已经重建了 messages，可以直接复用 `pgSend`。但需要确保 `pgSend` → `pgBuildBodyForWin` 读到的是正确的 messages。

```javascript
// pg-autochat.js — 新增
// 直接调用 pgSend，因为 w.messages 已经在 pgAutoChatDoSend 中重建
function pgAutoChatSendWithPerspective(winIdx, perspectiveMsgs, lastIdx) {
  pgSend(winIdx, lastIdx);
}
```

**注意**：实际上这个函数可以直接内联到 `pgAutoChatDoSend` 中。保留为独立函数仅为了清晰。`pgSend` → `pgBuildBodyForWin` 会从 `w.messages` 读取，而我们已经把视角渲染的结果写入了 `w.messages`，所以链路是通的。

#### 3.1.8 修改 pgAutoChatOnFinish（广播改为 append timeline）

```javascript
// pg-autochat.js — pgAutoChatOnFinish() 重写
function pgAutoChatOnFinish(winIdx) {
  if (!pgState.autoChat || !pgState.autoChat.isRunning) return;
  if (pgState.autoChat.abortFlag) return;
  var w = pgWinAt(winIdx);
  if (!w) return;

  // 1. 计数
  w.replyCount++;

  // 2. 检查迭代上限
  var iters = pgState.autoChat.iterations;
  if (iters > 0 && w.replyCount >= iters) { w.autoChatDone = true; }

  // 3. 将回复追加到 timeline（替代广播到 N 个 inbox）
  var rawContent = pgTextContent(w.messages[w.messages.length - 1].content);
  var content = pgAutoChatStripPrefix(rawContent);  // P0: 清洗前缀

  if (content && content.trim()) {
    var sender = pgAutoChatGetAgentName(winIdx);
    pgAutoChatAppendTimeline(sender, 'agent', winIdx, content, 'complete');
  }

  pgUpdateAutoChatUI();
  pgRefreshGroupChatModal();

  // 4. 处理自己的 inbox（检查 timeline 是否有新消息）
  pgAutoChatProcessWindowInbox(winIdx);

  // 5. 触发其他 idle 窗口处理
  for (var k = 0; k < pgState.splitCount; k++) {
    if (k === winIdx) continue;
    pgAutoChatProcessWindowInbox(k);
  }

  // 6. 检查是否全部结束
  pgAutoChatCheckAllDone();
}
```

**关键变化**：原来的"遍历其他窗口 push inbox"变成了"append timeline 一次"。所有窗口通过 `lastReadTimelineId` 自然获取新消息。

#### 3.1.9 修改 pgAutoChatUserSend

```javascript
// pg-autochat.js — pgAutoChatUserSend() 重写
function pgAutoChatUserSend(text) {
  if (pgState.autoChat.isRunning) {
    // 用户消息追加到 timeline
    pgAutoChatAppendTimeline(
      pgState.autoChat.userName || 'User',
      'user', -1, text, 'complete'
    );
    // 触发所有未完成窗口处理
    var modelWins = pgAutoChatModelWindows();
    modelWins.forEach(function(i) { pgAutoChatProcessWindowInbox(i); });
    pgUpdateAutoChatUI();
    pgRefreshGroupChatModal();
  } else {
    pgAutoChatStart(text);
  }
}
```

#### 3.1.10 修改 pgAutoChatCanReply

```javascript
// pg-autochat.js — pgAutoChatCanReply() 无需修改
// 仍检查 streaming/pending/done/replyCount，逻辑不变
```

#### 3.1.11 修改 pgAutoChatCheckAllDone

```javascript
// pg-autochat.js — pgAutoChatCheckAllDone() 修改
function pgAutoChatCheckAllDone() {
  var modelWins = pgAutoChatModelWindows();
  var allDone = modelWins.every(function(i) {
    var w = pgWinAt(i);
    if (w.streaming) return false;
    if (w.autoChatPending) return false;
    if (w.autoChatDone) return true;
    // ← 修改：检查 timeline 是否有未读消息（替代 inbox.length）
    var hasUnread = pgState.autoChat.timeline.some(function(e) {
      return e.id > w.lastReadTimelineId;
    });
    if (hasUnread) return false;
    return true;
  });
  if (allDone) pgAutoChatFinish();
}
```

#### 3.1.12 修改群聊 Modal 消息收集

```javascript
// pg-autochat.js — pgGetGroupChatMessages() 重写
// 直接从 timeline 渲染，无需去重
function pgGetGroupChatMessages() {
  return pgState.autoChat.timeline.map(function(entry) {
    return {
      sender: entry.sender,
      content: entry.content,
      reasoning: '',
      timestamp: entry.ts,
      winIdx: entry.winIdx,
      isUser: entry.senderType === 'user',
      isSystem: entry.senderType === 'system',
      id: entry.id,
      status: entry.status,
    };
  });
}
```

**关键变化**：去重逻辑完全删除（timeline 只有一份）。消息来源解析（正则匹配 `[sender]:` 前缀）也删除（timeline 直接有 sender 字段）。

#### 3.1.13 修改 pgAutoChatStop / pgAutoChatFinish

```javascript
// pg-autochat.js — pgAutoChatStop() 和 pgAutoChatFinish() 中
// 清理时重置 timeline
function pgAutoChatStop() {
  pgState.autoChat.abortFlag = true;
  pgState.autoChat.session++;
  pgState.autoChat.isRunning = false;
  pgAutoChatClearWindowTimers();
  if (typeof pgStop === 'function') pgStop();
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    if (!w) continue;
    w.inbox = [];
    w.autoChatDone = false;
    w.replyCount = 0;
    w.lastReadTimelineId = 0;            // ← 新增
  }
  pgState.autoChat.timeline = [];        // ← 新增
  pgState.autoChat.timelineId = 0;       // ← 新增
  // ... 其余不变 ...
}

// pgAutoChatFinish() 同理添加 timeline 清理
```

#### 3.1.14 废弃字段

以下字段在重构后不再使用，但**保留在 makeWin 中不删除**（避免破坏现有代码的深拷贝/序列化）：
- `inbox` — 被 `lastReadTimelineId` + timeline 替代
- `pgGetGroupChatMessages` 中的 `seen` 去重逻辑 — 删除

### 3.2 "正在输入…" 指示

#### 3.2.1 窗口标题栏指示

```javascript
// pg-ui.js — pgRenderPanes() 中，pane 标题栏
// 在 agentName 后面追加 typing 指示
var paneLabel = (w && w.config.agentName) ? w.config.agentName : pgT('pgPaneName', [i + 1]);
var typingIndicator = '';
if (pgState.autoChat.isRunning && w.autoChatPending) {
  typingIndicator = ' <span class="pg-typing">' + pgEscapeHtml(pgT('pgTyping')) + '</span>';
} else if (pgState.autoChat.isRunning && w.streaming) {
  typingIndicator = ' <span class="pg-typing">' + pgEscapeHtml(pgT('pgStreaming')) + '</span>';
}
// 在 HTML 中：'<span class="pg-pane-idx">' + pgEscapeHtml(paneLabel) + typingIndicator + '</span>'
```

**注意**：`pgRenderPanes` 需要在 `pgUpdateAutoChatUI` 中被调用以实时更新指示。但全量重渲染 panes 会丢失消息滚动位置。替代方案：只更新标题栏的 typing span。

#### 3.2.2 轻量更新方案（推荐）

不全量重渲染 panes，而是在 `pgUpdateAutoChatUI` 中直接操作 DOM：

```javascript
// pg-autochat.js — pgUpdateAutoChatUI() 中追加
function pgUpdateAutoChatUI() {
  // ... 现有进度提示逻辑 ...

  // 更新各窗口标题栏的 typing 指示
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    var span = document.querySelector('.pg-pane[data-win="' + i + '"] .pg-pane-typing');
    if (!span) continue;
    if (pgState.autoChat.isRunning && w.autoChatPending) {
      span.textContent = pgT('pgTyping');
      span.style.display = 'inline';
    } else if (pgState.autoChat.isRunning && w.streaming) {
      span.textContent = pgT('pgStreaming');
      span.style.display = 'inline';
    } else {
      span.style.display = 'none';
    }
  }
}
```

```javascript
// pg-ui.js — pgRenderPanes() 中，pane 标题栏添加空的 typing span
'<span class="pg-pane-idx">' + pgEscapeHtml(paneLabel) +
  '<span class="pg-pane-typing" style="display:none"></span>' +
'</span>' +
```

#### 3.2.3 群聊 Modal 中的 typing 指示

```javascript
// pg-autochat.js — pgRenderGroupChatMessagesHtml() 中追加
// 在消息列表末尾追加 typing 行
function pgRenderGroupChatMessagesHtml(msgs) {
  var html = msgs.map(function(m) {
    // ... 现有消息渲染 ...
  }).join('');

  // 追加正在输入的 agent
  if (pgState.autoChat.isRunning) {
    var typingAgents = [];
    for (var i = 0; i < pgState.splitCount; i++) {
      var w = pgWinAt(i);
      if (!w.config.model || w.autoChatDone) continue;
      if (w.autoChatPending || w.streaming) {
        typingAgents.push(pgAutoChatGetAgentName(i));
      }
    }
    if (typingAgents.length) {
      html += '<div class="pg-gc-typing">' +
        pgEscapeHtml(typingAgents.join(', ') + pgT('pgTypingPlural')) +
        '<span class="pg-gc-typing-dots"></span></div>';
    }
  }

  return html;
}
```

### 3.3 Modal 增量渲染 + 流式直播

**目标**：废弃 500ms 全量 innerHTML，改为基于消息 ID 的 appendChild + streaming 节点实时更新。

#### 3.3.1 增量追加新消息

```javascript
// pg-autochat.js — 新增变量
var pgGcRenderedIds = {};  // 已渲染的 timeline id 集合
var pgGcStreamingNode = null;  // 当前 streaming 消息的 DOM 节点
var pgGcStreamingId = 0;  // 当前 streaming 的 timeline id
var pgGcAutoScroll = true;  // 是否自动滚动到底部

// pg-autochat.js — pgOpenGroupChatModal() 修改
function pgOpenGroupChatModal() {
  if (pgGcRefreshTimer) { clearInterval(pgGcRefreshTimer); pgGcRefreshTimer = null; }

  pgGcRenderedIds = {};
  pgGcStreamingNode = null;
  pgGcStreamingId = 0;
  pgGcAutoScroll = true;

  // ... 构建 modal HTML（与现有相同，但 messages div 初始为空）...
  pgShowModal(html);

  // 首次全量渲染
  pgGcRefreshModalIncremental();

  // 滚动监听：用户上翻时停止自动跟随
  var msgBox = document.getElementById('pg-gc-messages');
  if (msgBox) {
    msgBox.addEventListener('scroll', function() {
      var atBottom = msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight < 50;
      pgGcAutoScroll = atBottom;
      // 显示/隐藏 "↓ N 条新消息" 按钮
      var newMsgBtn = document.getElementById('pg-gc-new-msgs');
      if (newMsgBtn) newMsgBtn.style.display = atBottom ? 'none' : 'block';
    });
  }

  // 保留定时刷新作为兜底（频率降低到 2s）
  pgGcRefreshTimer = setInterval(function() {
    var overlay = document.getElementById('pg-modal-overlay');
    if (!overlay || !overlay.classList.contains('show')) {
      clearInterval(pgGcRefreshTimer);
      pgGcRefreshTimer = null;
      return;
    }
    pgGcRefreshModalIncremental();
  }, 2000);
}
```

#### 3.3.2 增量渲染函数

```javascript
// pg-autochat.js — 新增
function pgGcRefreshModalIncremental() {
  var msgBox = document.getElementById('pg-gc-messages');
  if (!msgBox) return;

  var msgs = pgGetGroupChatMessages();
  var newHtml = '';

  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    if (pgGcRenderedIds[m.id]) {
      // 已渲染，如果是 streaming 状态则更新节点
      if (m.status === 'streaming' && pgGcStreamingId === m.id && pgGcStreamingNode) {
        var contentNode = pgGcStreamingNode.querySelector('.pg-gc-content');
        if (contentNode) contentNode.innerHTML = pgRenderMarkdown(m.content);
        continue;
      }
      // 已渲染且非 streaming，跳过
      if (m.status !== 'streaming') continue;
      continue;
    }

    // 新消息，追加
    pgGcRenderedIds[m.id] = true;
    var timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
    var cls = m.isSystem ? 'pg-gc-msg system' : (m.isUser ? 'pg-gc-msg user' : 'pg-gc-msg agent');

    if (m.status === 'streaming') {
      pgGcStreamingId = m.id;
      newHtml += '<div class="' + cls + '" data-gc-id="' + m.id + '">' +
        '<div class="pg-gc-sender">' + pgEscapeHtml(m.sender) +
        '<span class="pg-gc-time">' + timeStr + '</span></div>' +
        '<div class="pg-gc-content">' + pgRenderMarkdown(m.content) + '</div>' +
      '</div>';
    } else {
      newHtml += '<div class="' + cls + '" data-gc-id="' + m.id + '">' +
        '<div class="pg-gc-sender">' + pgEscapeHtml(m.sender) +
        '<span class="pg-gc-time">' + timeStr + '</span></div>' +
        '<div class="pg-gc-content">' + pgRenderMarkdown(m.content) + '</div>' +
      '</div>';
    }
  }

  if (newHtml) {
    // 如果有 streaming 节点，先移除（会在新 HTML 中重新创建）
    if (pgGcStreamingNode) {
      pgGcStreamingNode.remove();
      pgGcStreamingNode = null;
    }

    // appendChild 新消息
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHtml;
    while (tempDiv.firstChild) {
      if (tempDiv.firstChild.dataset && tempDiv.firstChild.dataset.gcId == pgGcStreamingId) {
        pgGcStreamingNode = tempDiv.firstChild;
      }
      msgBox.appendChild(tempDiv.firstChild);
    }

    // 更新 typing 指示
    pgGcUpdateTypingIndicator(msgBox);

    if (pgGcAutoScroll) {
      msgBox.scrollTop = msgBox.scrollHeight;
    }
  } else {
    // 没有新消息，只更新 typing 指示
    pgGcUpdateTypingIndicator(msgBox);
  }
}

function pgGcUpdateTypingIndicator(msgBox) {
  // 移除旧 typing
  var oldTyping = msgBox.querySelector('.pg-gc-typing');
  if (oldTyping) oldTyping.remove();

  // 添加新 typing
  if (pgState.autoChat.isRunning) {
    var typingAgents = [];
    for (var i = 0; i < pgState.splitCount; i++) {
      var w = pgWinAt(i);
      if (!w.config.model || w.autoChatDone) continue;
      if (w.autoChatPending || w.streaming) {
        typingAgents.push(pgAutoChatGetAgentName(i));
      }
    }
    if (typingAgents.length) {
      var typingDiv = document.createElement('div');
      typingDiv.className = 'pg-gc-typing';
      typingDiv.innerHTML = pgEscapeHtml(typingAgents.join(', ') + pgT('pgTypingPlural')) +
        '<span class="pg-gc-typing-dots"></span>';
      msgBox.appendChild(typingDiv);
      if (pgGcAutoScroll) msgBox.scrollTop = msgBox.scrollHeight;
    }
  }
}
```

#### 3.3.3 流式直播 Hook

在 `pgFlushRender`（pg-stream.js:150-191）中添加群聊 Modal 更新 hook：

```javascript
// pg-stream.js — pgFlushRender() 中，pgRenderBubble 之后
pgRenderBubble(i, assistantIdx);
pgRenderDebug();
pgScrollBottom(i);
// ← 新增：群聊 Modal 流式直播
if (typeof pgGcOnStreamChunk === 'function') {
  pgGcOnStreamChunk(i, assistantIdx);
}
```

```javascript
// pg-autochat.js — 新增
function pgGcOnStreamChunk(winIdx, assistantIdx) {
  var overlay = document.getElementById('pg-modal-overlay');
  if (!overlay || !overlay.classList.contains('show')) return;

  var w = pgWinAt(winIdx);
  if (!w.streaming) return;

  // 找到或创建 timeline 中的 streaming 条目
  // 在 pgAutoChatDoSend 中，我们还没有 timeline 条目（回复未完成）
  // 所以这里需要临时更新 Modal 中的 streaming 节点
  var content = pgTextContent(w.pendingContent);
  if (!content) return;

  // 查找该窗口的 streaming 节点
  var msgBox = document.getElementById('pg-gc-messages');
  if (!msgBox) return;

  var agentName = pgAutoChatGetAgentName(winIdx);
  var streamingNode = msgBox.querySelector('.pg-gc-msg.streaming-agent-' + winIdx);

  if (!streamingNode) {
    // 创建 streaming 节点
    streamingNode = document.createElement('div');
    streamingNode.className = 'pg-gc-msg agent streaming-agent-' + winIdx;
    streamingNode.innerHTML =
      '<div class="pg-gc-sender">' + pgEscapeHtml(agentName) +
      '<span class="pg-gc-time">' + new Date().toLocaleTimeString() + '</span></div>' +
      '<div class="pg-gc-content">' + pgRenderMarkdown(content) + '</div>';
    msgBox.appendChild(streamingNode);
    pgGcStreamingNode = streamingNode;
  } else {
    var contentNode = streamingNode.querySelector('.pg-gc-content');
    if (contentNode) contentNode.innerHTML = pgRenderMarkdown(content);
  }

  if (pgGcAutoScroll) {
    msgBox.scrollTop = msgBox.scrollHeight;
  }
}
```

**注意**：这个 streaming 节点在 `pgAutoChatOnFinish` 追加正式 timeline 条目后，需要被替换或移除。在 `pgGcRefreshModalIncremental` 中，新的 complete 消息会被 appendChild，而旧的 streaming 节点需要移除：

```javascript
// pg-autochat.js — pgGcRefreshModalIncremental() 中
// 在追加新消息之前，移除所有 streaming-agent 临时节点
var tempStreamings = msgBox.querySelectorAll('[class*="streaming-agent-"]');
tempStreamings.forEach(function(n) { n.remove(); });
```

#### 3.3.4 废弃 pgRefreshGroupChatModal

原来的 `pgRefreshGroupChatModal`（全量 innerHTML）被 `pgGcRefreshModalIncremental` 替代。但 `pgRefreshGroupChatModal` 的调用点（`pgAutoChatOnFinish`、`pgAutoChatUserSend`）改为调用 `pgGcRefreshModalIncremental`。

### 3.4 结束原因系统消息 + 失败重试

#### 3.4.1 结束原因系统消息

```javascript
// pg-autochat.js — pgAutoChatFinish() 修改
function pgAutoChatFinish() {
  pgState.autoChat.isRunning = false;
  pgState.autoChat.abortFlag = false;
  pgAutoChatClearWindowTimers();

  // ← 新增：追加系统消息到 timeline
  var totalReplies = 0;
  for (var i = 0; i < pgState.splitCount; i++) {
    totalReplies += pgWinAt(i).replyCount;
  }
  var reason;
  if (pgState.autoChat.iterations > 0) {
    reason = pgT('pgAutoChatFinishedReason', [totalReplies]);
  } else {
    reason = pgT('pgAutoChatNoNewContent');
  }
  pgAutoChatAppendTimeline('', 'system', -1, reason, 'complete');

  // ... 清理逻辑 ...
  pgGcRefreshModalIncremental();  // 刷新 Modal 显示系统消息
  pgToast(reason, 'success');
}
```

```javascript
// pg-autochat.js — pgAutoChatStop() 修改
function pgAutoChatStop() {
  // ... 现有清理逻辑 ...
  // ← 新增：追加系统消息
  if (pgState.autoChat.timeline.length > 0) {
    pgAutoChatAppendTimeline('', 'system', -1, pgT('pgAutoChatStopped'), 'complete');
  }
  pgGcRefreshModalIncremental();
  pgToast(pgT('pgAutoChatStopped'), 'info');
}
```

#### 3.4.2 失败重试

在 `pgFail` 中，如果是自动对话模式且该窗口未重试过，延迟 3 秒后重试：

```javascript
// pg-stream.js — pgFail() 中，auto chat hook 之前
// ← 新增：自动对话失败重试
if (typeof pgAutoChatShouldRetry === 'function' &&
    pgState.autoChat && pgState.autoChat.isRunning) {
  if (pgAutoChatShouldRetry(i, assistantIdx)) {
    return;  // 不触发 pgAutoChatOnFinish，等待重试
  }
}
// 现有 hook
if (typeof pgAutoChatOnFinish === 'function' && ...) { ... }
```

```javascript
// pg-autochat.js — 新增
var pgAutoChatRetryCount = {};  // {winIdx: count}

function pgAutoChatShouldRetry(winIdx, assistantIdx) {
  var retries = pgAutoChatRetryCount[winIdx] || 0;
  if (retries >= 1) return false;  // 最多重试 1 次

  pgAutoChatRetryCount[winIdx] = retries + 1;

  // 延迟 3 秒后重试
  var capturedSession = pgState.autoChat.session;
  var w = pgWinAt(winIdx);
  setTimeout(function() {
    if (capturedSession !== pgState.autoChat.session) return;
    if (!pgState.autoChat.isRunning) return;
    if (w.autoChatDone) return;

    // 重新发送（使用现有的 messages，最后一条是 error 的 assistant）
    w.messages[w.messages.length - 1].status = 'loading';
    w.messages[w.messages.length - 1].content = '';
    w.messages[w.messages.length - 1].error = null;
    pgRenderMessages(winIdx);
    pgSend(winIdx, w.messages.length - 1);
  }, 3000);

  return true;  // 已调度重试，不触发 onFinish
}

// pgAutoChatStart 中重置重试计数
function pgAutoChatStart(text) {
  // ...
  pgAutoChatRetryCount = {};  // ← 新增
  // ...
}

// pgAutoChatOnFinish 中清除重试计数（成功回复后）
function pgAutoChatOnFinish(winIdx) {
  // ...
  pgAutoChatRetryCount[winIdx] = 0;  // ← 新增
  // ...
}
```

---

## 4. P2：真实群聊质感

### 4.1 发言意愿（Pass 机制）

**目标**：Agent 可以选择不发言（输出 `<pass/>`），使对话自然收敛。

#### 4.1.1 默认 System Prompt 注入

当自动对话开启且窗口的 systemPrompt 为空时，自动注入默认群聊规则：

```javascript
// pg-autochat.js — 新增
var PG_AUTOCHAT_DEFAULT_SYSTEM_PROMPT =
  'You are a participant in a group chat. ' +
  'Multiple AI agents and a human user are discussing together. ' +
  'Messages from others are prefixed with [name]:. ' +
  'Do NOT add any [name]: prefix to your own replies — just speak directly. ' +
  'If you have nothing meaningful to add at this moment, ' +
  'reply with exactly <pass/> and nothing else. ' +
  'Use <pass/> when others are still discussing a topic you have no strong opinion on.';

// pg-autochat.js — pgAutoChatRenderPerspective() 中
function pgAutoChatRenderPerspective(winIdx) {
  var w = pgWinAt(winIdx);
  var msgs = [];

  // System prompt：用户自定义优先，否则用默认
  var sysPrompt = (w.config.systemPrompt && w.config.systemPrompt.trim())
    ? w.config.systemPrompt
    : PG_AUTOCHAT_DEFAULT_SYSTEM_PROMPT;
  msgs.push({ role: 'system', content: sysPrompt });

  // ... 遍历 timeline ...
  return msgs;
}
```

#### 4.1.2 Pass 检测

```javascript
// pg-autochat.js — pgAutoChatOnFinish() 中
function pgAutoChatOnFinish(winIdx) {
  // ...
  var rawContent = pgTextContent(w.messages[w.messages.length - 1].content);
  var content = pgAutoChatStripPrefix(rawContent);

  // ← 新增：检测 pass
  var isPass = /^\s*<pass\s*\/>\s*$/i.test(content);

  if (isPass) {
    // Pass：不追加到 timeline（或追加为 pass 类型），不广播，不计数
    pgAutoChatAppendTimeline(
      pgAutoChatGetAgentName(winIdx), 'agent', winIdx,
      '', 'pass'
    );
    // replyCount 不递增（pass 不算一次回复）
    // autoChatDone 不设置
    pgUpdateAutoChatUI();
    pgGcRefreshModalIncremental();
    pgAutoChatProcessWindowInbox(winIdx);
    for (var k = 0; k < pgState.splitCount; k++) {
      if (k === winIdx) continue;
      pgAutoChatProcessWindowInbox(k);
    }
    pgAutoChatCheckAllDone();
    return;
  }

  // 正常回复：追加到 timeline
  if (content && content.trim()) {
    pgAutoChatAppendTimeline(
      pgAutoChatGetAgentName(winIdx), 'agent', winIdx, content, 'complete'
    );
  }
  // ... 其余逻辑不变 ...
}
```

#### 4.1.3 Pass 在群聊 Modal 中的显示

```javascript
// pg-autochat.js — pgRenderGroupChatMessagesHtml() 中
// 或在增量渲染中处理 pass 消息
var msgs = pgGetGroupChatMessages();
// pass 消息特殊渲染
if (m.status === 'pass') {
  html += '<div class="pg-gc-msg pass">' +
    '<span class="pg-gc-pass-icon">👀</span> ' +
    pgEscapeHtml(m.sender) + ' ' + pgEscapeHtml(pgT('pgPassHint')) +
  '</div>';
  continue;
}
```

#### 4.1.4 Pass 对 CheckAllDone 的影响

Pass 后窗口的 `replyCount` 不递增，因此不会因 pass 而达到迭代上限。但如果所有窗口都 pass（无人有新内容可说），`CheckAllDone` 会因为 timeline 无新消息而自然触发结束。

### 4.2 @提及与定向发言

#### 4.2.1 用户输入解析

```javascript
// pg-autochat.js — pgAutoChatUserSend() 修改
function pgAutoChatUserSend(text) {
  if (pgState.autoChat.isRunning) {
    // ← 新增：解析 @提及
    var mentions = pgAutoChatParseMentions(text);
    // mentions = [winIdx, ...] 或 null（无提及）

    pgAutoChatAppendTimeline(
      pgState.autoChat.userName || 'User',
      'user', -1, text, 'complete'
    );

    if (mentions && mentions.length) {
      // 定向投递：只触发被提及的窗口
      mentions.forEach(function(i) { pgAutoChatProcessWindowInbox(i); });
    } else {
      // 全员投递
      var modelWins = pgAutoChatModelWindows();
      modelWins.forEach(function(i) { pgAutoChatProcessWindowInbox(i); });
    }

    pgUpdateAutoChatUI();
    pgGcRefreshModalIncremental();
  } else {
    pgAutoChatStart(text);
  }
}
```

#### 4.2.2 @提及解析函数

```javascript
// pg-autochat.js — 新增
function pgAutoChatParseMentions(text) {
  var matches = text.match(/@(\S+)/g);
  if (!matches) return null;

  var mentionedWindows = [];
  matches.forEach(function(m) {
    var name = m.slice(1);  // 去掉 @
    for (var i = 0; i < pgState.splitCount; i++) {
      var agentName = pgAutoChatGetAgentName(i);
      if (agentName === name || pgWinAt(i).config.agentName === name) {
        if (mentionedWindows.indexOf(i) < 0) mentionedWindows.push(i);
        break;
      }
    }
  });

  return mentionedWindows.length ? mentionedWindows : null;
}
```

#### 4.2.3 Agent 回复中的 @提及

Agent 回复中如果包含 `@某人`，被提及者的下次延迟缩短。这在 `pgAutoChatProcessWindowInbox` 中实现：

```javascript
// pg-autochat.js — pgAutoChatProcessWindowInbox() 修改
function pgAutoChatProcessWindowInbox(winIdx) {
  // ...
  var baseDelay = pgState.autoChat.delaySeconds || 0;

  // ← 新增：检查最近 timeline 消息是否 @了此窗口
  var myName = pgAutoChatGetAgentName(winIdx);
  var mentioned = false;
  for (var i = pgState.autoChat.timeline.length - 1; i >= 0; i--) {
    var entry = pgState.autoChat.timeline[i];
    if (entry.id <= pgWinAt(winIdx).lastReadTimelineId) break;
    if (entry.content && entry.content.indexOf('@' + myName) >= 0) {
      mentioned = true;
      break;
    }
  }
  if (mentioned && baseDelay > 0) {
    baseDelay = baseDelay * 0.3;  // 被提及者延迟缩短到 30%
  }

  if (baseDelay <= 0) { pgAutoChatDoSend(winIdx); return; }
  // ... 剩余延迟逻辑不变，使用调整后的 baseDelay ...
}
```

### 4.3 滚动摘要 + Token 水位可视化

#### 4.3.1 Token 估算

```javascript
// pg-autochat.js — 新增
// 粗略估算 token 数（中文 ~1.5 字/token，英文 ~4 字符/token）
function pgAutoChatEstimateTokens(text) {
  if (!text) return 0;
  var cnChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  var otherChars = text.length - cnChars;
  return Math.ceil(cnChars * 1.5 + otherChars / 4);
}

// 估算某窗口当前上下文的 token 数
function pgAutoChatEstimateWindowTokens(winIdx) {
  var msgs = pgAutoChatRenderPerspective(winIdx);
  var total = 0;
  msgs.forEach(function(m) {
    total += pgAutoChatEstimateTokens(m.content);
  });
  return total;
}
```

#### 4.3.2 滚动摘要触发

```javascript
// pg-autochat.js — 新增
var pgAutoChatSummaryThreshold = 30;  // timeline 超过 30 条触发摘要
var pgAutoChatSummaryKeep = 10;       // 摘要后保留最近 10 条
var pgAutoChatIsSummarizing = false;

function pgAutoChatMaybeSummarize() {
  if (pgAutoChatIsSummarizing) return;
  if (pgState.autoChat.timeline.length < pgAutoChatSummaryThreshold) return;

  pgAutoChatIsSummarizing = true;

  // 取最旧的 N 条（保留最近 pgAutoChatSummaryKeep 条）
  var toSummarize = pgState.autoChat.timeline.slice(0,
    pgState.autoChat.timeline.length - pgAutoChatSummaryKeep);

  // 构造摘要请求内容
  var summaryText = toSummarize.map(function(e) {
    return '[' + e.sender + ']: ' + e.content;
  }).join('\n');

  // 用最便宜的模型做摘要（这里简化为用窗口 0 的模型）
  // 实际实现中应该让用户配置摘要模型，或使用固定的小模型
  var summaryBody = {
    model: pgWinAt(0).config.model,  // 或专用摘要模型
    messages: [
      { role: 'system', content: 'Summarize the following group chat conversation as a brief narrative (2-3 sentences). Do not use [name]: prefixes. Write in third person.' },
      { role: 'user', content: summaryText },
    ],
    stream: false,
  };

  fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summaryBody),
  }).then(function(resp) {
    return resp.json();
  }).then(function(j) {
    var summary = j.choices && j.choices[0] && j.choices[0].message
      ? j.choices[0].message.content : '';

    if (summary) {
      // 原子替换：用摘要条目替换旧消息
      var summaryEntry = {
        id: ++pgState.autoChat.timelineId,
        sender: '',
        senderType: 'system',
        winIdx: -1,
        content: pgT('pgAutoChatSummaryPrefix') + summary,
        ts: toSummarize[toSummarize.length - 1].ts,
        status: 'summary',
      };

      // 替换 timeline
      var kept = pgState.autoChat.timeline.slice(toSummarize.length);
      pgState.autoChat.timeline = [summaryEntry].concat(kept);

      // 重置所有窗口的 lastReadTimelineId（因为 timeline 变了）
      for (var i = 0; i < pgState.splitCount; i++) {
        pgWinAt(i).lastReadTimelineId = 0;
      }

      pgGcRefreshModalIncremental();
    }
  }).catch(function(e) {
    // 摘要失败不影响对话
  }).finally(function() {
    pgAutoChatIsSummarizing = false;
  });
}
```

**调用时机**：在 `pgAutoChatOnFinish` 末尾、`pgAutoChatCheckAllDone` 之前调用 `pgAutoChatMaybeSummarize()`。

#### 4.3.3 Token 水位可视化

在群聊 Modal 顶部显示各窗口的 token 使用量：

```javascript
// pg-autochat.js — pgOpenGroupChatModal() 中
// 在 modal HTML 中追加 token 水位条
var tokenBarHtml = '<div class="pg-gc-token-bar" id="pg-gc-token-bar"></div>';
// 插入到 pg-gc-messages 之前

// pg-autochat.js — 新增
function pgGcUpdateTokenBar() {
  var bar = document.getElementById('pg-gc-token-bar');
  if (!bar) return;

  var html = '';
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    if (!w.config.model) continue;
    var tokens = pgAutoChatEstimateWindowTokens(i);
    var name = pgAutoChatGetAgentName(i);
    // 假设 8K context window（简化，实际应从模型配置获取）
    var pct = Math.min(100, (tokens / 8000) * 100);
    var color = pct > 80 ? '#ff6b6b' : (pct > 50 ? '#ffd93d' : '#6bcf7f');
    html += '<div class="pg-gc-token-item">' +
      '<span class="pg-gc-token-name">' + pgEscapeHtml(name) + '</span>' +
      '<div class="pg-gc-token-bar-bg">' +
        '<div class="pg-gc-token-bar-fill" style="width:' + pct + '%;background:' + color + '"></div>' +
      '</div>' +
      '<span class="pg-gc-token-num">' + tokens + '</span>' +
    '</div>';
  }
  bar.innerHTML = html;
}
```

在 `pgGcRefreshModalIncremental` 末尾调用 `pgGcUpdateTokenBar()`。

---

## 5. 实施顺序与验收标准

### 第一批：P0（正确性修复）

**涉及文件**：`pg-state.js`、`pg-autochat.js`、`pg-stream.js`

**实施步骤**：
1. `pg-state.js`：pgState.autoChat 新增 `session: 0`
2. `pg-autochat.js`：新增 `pgAutoChatStripPrefix()` 函数
3. `pg-autochat.js`：`pgAutoChatStart()` 中 `session++`
4. `pg-autochat.js`：`pgAutoChatProcessWindowInbox()` 中捕获 session 并在回调中比对
5. `pg-autochat.js`：`pgAutoChatOnFinish()` 中广播前调用 `pgAutoChatStripPrefix()`
6. `pg-autochat.js`：`pgAutoChatStop()` 中 `session++`
7. `pg-stream.js`：`pgStop()` 中 `session++`

**验收**：
- `go build -tags playground -o tinyrouter-pg.exe .` 构建成功
- 开启自动对话，stop 后立即 start，无异常行为
- 模型回复中不再出现 `[自己名字]:` 开头的前缀

### 第二批：P1（时间线重构 + 体验质变）

**涉及文件**：`pg-state.js`、`pg-autochat.js`、`pg-stream.js`、`pg-ui.js`、`pg-i18n.js`、`playground.css`

**实施步骤**：
1. `pg-state.js`：pgState.autoChat 新增 `timeline: []`、`timelineId: 0`；makeWin 新增 `lastReadTimelineId: 0`
2. `pg-autochat.js`：新增 `pgAutoChatAppendTimeline()`、`pgAutoChatRenderPerspective()`
3. `pg-autochat.js`：重写 `pgAutoChatStart()`、`pgAutoChatDoSend()`、`pgAutoChatOnFinish()`、`pgAutoChatUserSend()`、`pgAutoChatCheckAllDone()`
4. `pg-autochat.js`：重写 `pgGetGroupChatMessages()`（直接从 timeline 渲染）
5. `pg-autochat.js`：新增增量渲染 `pgGcRefreshModalIncremental()`、`pgGcOnStreamChunk()`
6. `pg-autochat.js`：`pgOpenGroupChatModal()` 改为增量渲染 + 滚动跟随
7. `pg-autochat.js`：新增 `pgGcUpdateTypingIndicator()`
8. `pg-autochat.js`：`pgAutoChatFinish()`/`pgAutoChatStop()` 追加系统消息
9. `pg-autochat.js`：新增 `pgAutoChatShouldRetry()`、`pgAutoChatRetryCount`
10. `pg-stream.js`：`pgFlushRender()` 末尾添加 `pgGcOnStreamChunk` hook；`pgFail()` 中添加重试逻辑
11. `pg-ui.js`：`pgRenderPanes()` 中添加 typing span
12. `pg-autochat.js`：`pgUpdateAutoChatUI()` 中更新 typing span
13. `pg-i18n.js`：新增所有 P1 key（见第 7 节）
14. `playground.css`：新增 P1 样式（见第 8 节）

**验收**：
- `go build -tags playground` 构建成功
- 群聊 Modal 中消息逐条追加（不闪烁），流式回复逐字显示
- 用户上翻时 Modal 不自动滚动，显示"↓N条新消息"
- 窗口标题栏显示"正在输入…"/"生成中..."指示
- 对话结束时 Modal 显示系统消息说明原因
- 失败回复自动重试一次

### 第三批：P2（真实群聊质感）

**涉及文件**：`pg-autochat.js`、`pg-stream.js`、`pg-i18n.js`、`playground.css`

**实施步骤**：
1. `pg-autochat.js`：新增 `PG_AUTOCHAT_DEFAULT_SYSTEM_PROMPT` 常量
2. `pg-autochat.js`：`pgAutoChatRenderPerspective()` 中注入默认 system prompt
3. `pg-autochat.js`：`pgAutoChatOnFinish()` 中检测 `<pass/>` 并特殊处理
4. `pg-autochat.js`：增量渲染中处理 pass 消息（👀 显示）
5. `pg-autochat.js`：新增 `pgAutoChatParseMentions()`
6. `pg-autochat.js`：`pgAutoChatUserSend()` 中解析 @提及并定向投递
7. `pg-autochat.js`：`pgAutoChatProcessWindowInbox()` 中检查 @提及并缩短延迟
8. `pg-autochat.js`：新增 `pgAutoChatEstimateTokens()`、`pgAutoChatEstimateWindowTokens()`
9. `pg-autochat.js`：新增 `pgAutoChatMaybeSummarize()` 摘要触发
10. `pg-autochat.js`：`pgAutoChatOnFinish()` 末尾调用 `pgAutoChatMaybeSummarize()`
11. `pg-autochat.js`：新增 `pgGcUpdateTokenBar()` 水位条
12. `pg-i18n.js`：新增所有 P2 key
13. `playground.css`：新增 P2 样式

**验收**：
- `go build -tags playground` 构建成功
- Agent 输出 `<pass/>` 时不在 timeline 广播，Modal 显示"👀 Agent 看了一眼消息"
- 用户输入 `@王怜花 你怎么看` 时只有王怜花窗口回复
- 对话超过 30 条时自动触发摘要，timeline 旧消息被替换为摘要
- 群聊 Modal 顶部显示各窗口 token 水位条

---

## 6. 文件修改矩阵

| 文件 | P0 | P1 | P2 |
|---|---|---|---|
| `pg-state.js` | autoChat.session | autoChat.timeline/timelineId; makeWin.lastReadTimelineId | — |
| `pg-autochat.js` | pgAutoChatStripPrefix; session 保护; Stop/Start session++ | 重写 Start/DoSend/OnFinish/UserSend/CheckAllDone/GetGroupChatMessages; 新增 AppendTimeline/RenderPerspective/GcRefreshModalIncremental/GcOnStreamChunk/GcUpdateTypingIndicator/ShouldRetry; 修改 Stop/Finish | PG_AUTOCHAT_DEFAULT_SYSTEM_PROMPT; pass 检测; ParseMentions; EstimateTokens; MaybeSummarize; GcUpdateTokenBar |
| `pg-stream.js` | pgStop session++ | pgFlushRender 添加 GcOnStreamChunk hook; pgFail 添加重试 | — |
| `pg-ui.js` | — | pgRenderPanes 添加 typing span | — |
| `pg-i18n.js` | — | pgTyping, pgTypingPlural, pgAutoChatFinishedReason, pgGcNewMsgs 等 | pgPassHint, pgAutoChatSummaryPrefix 等 |
| `playground.css` | — | .pg-typing, .pg-pane-typing, .pg-gc-typing, .pg-gc-typing-dots, .pg-gc-new-msgs | .pg-gc-msg.pass, .pg-gc-token-bar, .pg-gc-msg.system |

---

## 7. 新增 i18n key 清单

### P1 新增

```javascript
// en
pgTyping: 'typing…',
pgTypingPlural: ' are typing',
pgAutoChatFinishedReason: 'Conversation ended — {0} total replies',
pgGcNewMsgs: '↓ {0} new messages',
pgAutoChatRetryMsg: 'W{0}: retrying…',

// cn
pgTyping: '正在输入…',
pgTypingPlural: ' 正在输入',
pgAutoChatFinishedReason: '对话结束 — 共 {0} 次回复',
pgGcNewMsgs: '↓ {0} 条新消息',
pgAutoChatRetryMsg: 'W{0}: 重试中…',
```

### P2 新增

```javascript
// en
pgPassHint: 'glanced at the messages',
pgAutoChatSummaryPrefix: '[Summary] ',
pgGcTokenBar: 'Context Usage',

// cn
pgPassHint: '看了一眼消息',
pgAutoChatSummaryPrefix: '[摘要] ',
pgGcTokenBar: '上下文用量',
```

---

## 8. 新增 CSS 清单

### P1 新增

```css
/* Typing indicator in pane header */
.pg-pane-typing{font-size:11px;color:var(--accent);margin-left:6px;animation:pg-pulse 1.5s infinite}

/* Typing indicator in group chat modal */
.pg-gc-typing{font-size:12px;color:var(--accent);padding:4px 12px;opacity:.7;font-style:italic}
.pg-gc-typing-dots::after{content:'';animation:pg-dots 1.5s infinite}
@keyframes pg-dots{0%{content:''}33%{content:'.'}66%{content:'..'}100%{content:'...'}}

/* New messages button */
.pg-gc-new-msgs{position:absolute;bottom:80px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;cursor:pointer;display:none;z-index:10}

/* System message in group chat */
.pg-gc-msg.system{align-self:center;max-width:90%}
.pg-gc-msg.system .pg-gc-content{background:rgba(255,255,255,0.08);font-size:12px;font-style:italic;text-align:center}
```

### P2 新增

```css
/* Pass message */
.pg-gc-msg.pass{align-self:center;max-width:90%}
.pg-gc-msg.pass .pg-gc-pass-icon{margin-right:4px}
.pg-gc-msg.pass{font-size:12px;color:var(--muted);font-style:italic;opacity:.6;padding:4px 0}

/* Token bar */
.pg-gc-token-bar{padding:8px 12px;border-bottom:1px solid var(--glass-border);display:flex;flex-direction:column;gap:4px}
.pg-gc-token-item{display:flex;align-items:center;gap:6px;font-size:11px}
.pg-gc-token-name{min-width:60px;color:var(--muted)}
.pg-gc-token-bar-bg{flex:1;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden}
.pg-gc-token-bar-fill{height:100%;border-radius:3px;transition:width .3s}
.pg-gc-token-num{min-width:40px;text-align:right;color:var(--muted)}

/* Summary message */
.pg-gc-msg.summary .pg-gc-content{background:rgba(255,200,0,0.1);border-left:3px solid #ffc800;font-size:12px}
```

---

## 附录 A：现有代码关键行号索引

| 函数 | 文件 | 行号 |
|---|---|---|
| `pgState` | pg-state.js | 37-51 |
| `makeWin()` | pg-state.js | 2-31 |
| `pgSaveAutoChat()` | pg-state.js | 160-167 |
| `pgAutoChatStart()` | pg-autochat.js | 89-121 |
| `pgAutoChatProcessWindowInbox()` | pg-autochat.js | 127-152 |
| `pgAutoChatDoSend()` | pg-autochat.js | 155-174 |
| `pgAutoChatOnFinish()` | pg-autochat.js | 178-222 |
| `pgAutoChatCheckAllDone()` | pg-autochat.js | 225-245 |
| `pgAutoChatStop()` | pg-autochat.js | 258-275 |
| `pgAutoChatFinish()` | pg-autochat.js | 277-299 |
| `pgAutoChatUserSend()` | pg-autochat.js | 303-321 |
| `pgUpdateAutoChatUI()` | pg-autochat.js | 325-351 |
| `pgGetGroupChatMessages()` | pg-autochat.js | 357-406 |
| `pgRenderGroupChatMessagesHtml()` | pg-autochat.js | 408-418 |
| `pgOpenGroupChatModal()` | pg-autochat.js | 429-463 |
| `pgCloseGroupChatModal()` | pg-autochat.js | 465-468 |
| `pgFinish()` | pg-stream.js | 253-295 |
| `pgFail()` | pg-stream.js | 297-323 |
| `pgStop()` | pg-stream.js | 326-354 |
| `pgFlushRender()` | pg-stream.js | 150-191 |
| `pgUserSend()` | pg-ui.js | 114-129 |
| `pgRenderPanes()` | pg-ui.js | 205-236 |
| `pgRenderInputBar()` | pg-ui.js | 501-522 |
| `pgRenderSidebar()` autochat panel | pg-ui.js | 379-408 |
| `router.go` pg JS routes | internal/api/router.go | 179-187 |

---

## 附录 B：reply.md 核心建议摘要

### 核心架构建议：共享时间线
- 群聊时间线是唯一事实来源，各窗口 messages 是派生视图
- 消灭去重/inbox/分叉三类复杂度
- 保留 messages 作为渲染缓存（本方案采用）

### 六个问题的解法
1. **上下文膨胀**：三层结构（System + 摘要 + 最近K条）+ 异步摘要 + token 水位条
2. **消息嵌套**：输出端正则剥离 `[name]:` 前缀 + system prompt 约定
3. **并发安全**：世代号（session epoch）替代 flag 检查
4. **终止判断**：结束原因系统消息 + 失败重试 + 看门狗兜底
5. **延迟策略**：打字模拟延迟 + 对话热度自适应 + "正在输入…"视觉反馈
6. **Modal 性能**：基于消息 ID 的增量 appendChild + 流式直播 + 滚动跟随策略

### 扩展方向（P3，本文档不实施）
- 场景预设（辩论/圆桌/剧本杀）
- 导演模式（隐形导演调度发言）
- 剧本导出与回放

---

## 附录 C：实施注意事项

1. **构建命令**：`go build -tags playground -o tinyrouter-pg.exe .`（在 `Z:\Playground\tinyrouter` 下）
2. **dist 产出**：`./build.ps1 -Variant webview -Playground -Strip -OutputDir dist`
3. **纯 vanilla JS**：无框架、无模块系统，所有函数全局 `function pgXxx()` 声明
4. **Hook 保护**：所有从 stream 侧调用 autochat 的地方用 `typeof fn === 'function'` 保护
5. **不修改 `Z:\Playground\9router`**：那是参考项目，只读
6. **每批完成后**：提交 + 推送 + 重编译 dist 供用户测试
7. **CSS 文件**：`playground.css` 是压缩格式（单行），新增样式追加到文件末尾即可
8. **i18n**：en 和 cn 两个字典都要加，key 命名 `pgXxx` 规范
