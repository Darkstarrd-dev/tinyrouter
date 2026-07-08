# TinyRouter Playground 自动对话（群聊）功能实现文档

> 用途：向顶级深度研究模型请求指导与架构审查。
> 代码版本：commit `3d72ca5` (2026-07-08)

---

## 1. 项目背景

TinyRouter 是一个用 Go 编写的轻量级 LLM API 代理，内置一个 Playground 模块（纯 vanilla JS，无框架），用于交互式测试 LLM 对话。Playground 支持最多 4 个分屏窗口，每个窗口独立配置模型、参数和消息历史。

自动对话（群聊）模式是 Playground 的扩展功能：当开启 ≥2 个窗口时，用户抛出一个问题，所有窗口同时收到并回复，回复完成后各窗口可以"看到"其他窗口的回复内容，并继续发言，形成类似群聊的多 Agent 对话效果。

---

## 2. 技术栈与架构约束

| 维度 | 选型 | 约束 |
|---|---|---|
| 前端框架 | 无（vanilla JS） | CLAUDE.md 明确禁止 React/Vue 等框架 |
| 模块系统 | 无（全局 `function` 声明） | HTML 内联 `onclick="pgXxx()"` 调用 |
| 文件组织 | 10 个 JS 文件 + 1 个 CSS | 通过 `//go:embed all:playground/static-pg` 内嵌到 Go 二进制 |
| 后端 | Go + chi router | OpenAI 兼容透传，不解析/不转换 body |
| 状态持久化 | localStorage（仅 windows[0]） | 重启后仅恢复窗口 0 的配置和消息 |

Playground JS 模块拆分：

```
pg-core.js       — 常量、默认配置、宿主适配
pg-state.js      — pgState、makeWin、pgLoad/pgSave
pg-markdown.js   — Markdown 渲染、KaTeX、代码高亮
pg-request.js    — 请求体构造、SSE 解析
pg-stream.js     — 发送、流式接收、中断
pg-render.js     — 消息渲染、Debug 面板
pg-ui.js         — 分屏、侧栏、输入栏、事件处理
pg-autochat.js   — 自动对话（群聊）核心逻辑  ← 本文档焦点
pg-modal.js      — Modal 系统
pg-lifecycle.js  — renderPlayground / cleanupPlayground
pg-i18n.js       — i18n 字典 (en / cn)
```

---

## 3. 数据结构

### 3.1 全局状态 `pgState.autoChat`

```javascript
// pg-state.js
var pgState = {
  // ... 窗口、模型等字段 ...
  autoChat: {
    enabled: false,        // 自动对话开关（不持久化，刷新后关闭）
    iterations: 10,        // 每窗口最大回复次数（0 = 无限）
    userName: 'User',      // 用户在群聊中的昵称
    delaySeconds: 0,       // 随机延迟基数（秒），0 = 不延迟
    isRunning: false,      // 自动对话循环是否活跃
    abortFlag: false,      // 终止信号（抑制 finish hook）
  },
};
```

**持久化策略**：仅 `userName`、`iterations`、`delaySeconds` 通过 `localStorage` 持久化（key: `tinyrouter.playground.autochat.v1`）。`enabled`/`isRunning`/`abortFlag` 不持久化，刷新后自动关闭。

### 3.2 每窗口状态 `makeWin()` 中的自动对话字段

```javascript
// pg-state.js
function makeWin() {
  return {
    // ... 配置、消息、流式状态等字段 ...
    agentName: '',             // Agent 昵称（每窗口独立，空则 fallback "Agent N"）
    inbox: [],                 // 待处理消息队列 [{sender, content, timestamp}]
    replyCount: 0,             // 该窗口已完成的回复次数
    autoChatDone: false,       // 是否已达到迭代上限
    autoChatPending: false,    // 是否正在等待延迟定时器
    autoChatDelayTimer: null,  // setTimeout id（随机延迟）
  };
}
```

### 3.3 消息格式

自动对话模式下，所有注入窗口 `messages` 数组的消息统一使用 `[发送者]: 内容` 前缀格式，并作为 `role: 'user'` 消息注入（满足 OpenAI API 的 user/assistant 交替要求）。

```javascript
// 用户消息
{ role: 'user', content: '[陆小凤]: 朋友们，我要去东瀛闯荡了', createdAt: 1720000000000 }

// inbox 合并后的多源消息（多条 inbox 消息合并为一条 user 消息）
{ role: 'user', content: '[王怜花]: ...\n\n[令狐冲]: ...', createdAt: 1720000000500 }

// assistant 回复（不带头前缀，渲染时由群聊 modal 解析来源）
{ role: 'assistant', content: '（四条眉毛一挑...）', status: 'complete', ... }
```

---

## 4. 核心设计：独立迭代模型

### 4.1 设计演进

最初实现为**轮次屏障同步模型**（所有窗口等齐才进下一轮），但不符合群聊的自然节奏。后改为**独立迭代模型**：

| | 轮次屏障同步（已废弃） | 独立迭代（当前） |
|---|---|---|
| 迭代计数 | 全局共用 `currentRound` | 每窗口独立 `replyCount` |
| 回复触发 | 等所有窗口完成 → 批量触发 | 窗口完成 → 立即检查自己的 inbox → 有消息就继续 |
| 窗口间关系 | 同步屏障，快等慢 | 完全异步，快可远超慢 |
| 迭代次数含义 | N 轮 = 所有窗口各回复 N 次 | 每窗口各自最多回复 N 次 |

**效果**：一个快速模型可以在慢模型回复 3 次时已经回复 10 次，更接近真实群聊节奏。

### 4.2 窗口生命周期状态机

每个窗口在自动对话中的状态转移：

```
                    ┌──────────────────────────────────────┐
                    │                                      │
                    ▼                                      │
  ┌──────┐  process inbox  ┌─────────┐  delay (if set) ┌────────┐
  │ idle │ ──────────────→ │ pending │ ──────────────→ │ sending│
  └──────┘                 └─────────┘                  └────────┘
      ▲                         │                          │
      │                         │ abort                    │ pgSend()
      │                         ▼                          ▼
      │                    ┌──────┐                 ┌──────────┐
      │                    │ idle │                 │ streaming│
      │                    └──────┘                 └──────────┘
      │                                                  │
      │                                    pgFinish/pgFail│
      │                                                  ▼
      │                                           ┌─────────┐
      │              replyCount++                  │finished │
      │←──────────────────────────────────────────│  hook   │
      │                                           └─────────┘
      │                                                  │
      │    replyCount >= iterations?                     │
      │    ├── yes → autoChatDone = true → [TERMINAL]    │
      │    └── no  → check own inbox                     │
      │              ├── has messages → process inbox (loop)
      │              └── empty → idle (wait for broadcasts)
      │
      └── broadcast received (other window's reply pushed to inbox)
```

### 4.3 全局流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户发送消息                               │
│                   pgUserSend() → pgAutoChatStart()              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ 用户消息注入所有窗口     │
              │ inbox.push(userMsg)     │
              └───────────┬────────────┘
                          │
              ┌───────────▼────────────┐
              │ 遍历所有窗口            │
              │ pgAutoChatProcessWindowInbox(i) │
              └───────────┬────────────┘
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ Window 0  │  │ Window 1  │  │ Window 2  │
     │ (model A) │  │ (model B) │  │ (model C) │
     └─────┬────┘  └─────┬────┘  └─────┬────┘
           │              │              │
     delay? random      delay? random  delay? random
           │              │              │
           ▼              ▼              ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ pgSend() │  │ pgSend() │  │ pgSend() │  ← 各自独立请求上游 LLM
     │ SSE 流式  │  │ SSE 流式  │  │ SSE 流式  │
     └─────┬────┘  └─────┬────┘  └─────┬────┘
           │              │              │
     (先完成)        (后完成)       (最后完成)
           │              │              │
           ▼              │              │
    ┌─────────────┐       │              │
    │ pgFinish(0) │       │              │
    │ → hook      │       │              │
    └──────┬──────┘       │              │
           │              │              │
    ┌──────▼──────────────────────────────┐
    │ pgAutoChatOnFinish(0):              │
    │  1. replyCount++ → 1                │
    │  2. 检查迭代上限                      │
    │  3. 广播回复到 W1, W2 的 inbox       │
    │  4. 处理自己的 inbox (可能为空)      │
    │  5. 触发其他 idle 窗口处理 inbox     │
    │  6. pgAutoChatCheckAllDone()        │
    └──────┬──────────────────────────────┘
           │
           ▼
    ┌─────────────────────────────────────────┐
    │ W1 收到 W0 的回复 → inbox 有消息          │
    │ W1 仍在 streaming → 不处理，等 pgFinish  │
    └─────────────────────────────────────────┘
           │
           ▼ (W1 完成)
    ┌─────────────────────────────────────────┐
    │ pgAutoChatOnFinish(1):                  │
    │  1. replyCount++ → 1                    │
    │  2. 广播 W1 回复到 W0(已 done?), W2     │
    │  3. W1 检查自己的 inbox (有 W0 的回复)  │
    │     → 有消息 → process inbox → pgSend   │
    │  4. 触发 W2 处理 inbox (有 W0+W1 的回复)│
    │     → W2 仍 streaming → 跳过            │
    │  5. CheckAllDone → W1 streaming, false  │
    └─────────────────────────────────────────┘
           │
           ▼ (循环继续...)
           │
    ┌──────▼──────────────────────────────────┐
    │ CheckAllDone 条件:                       │
    │  所有窗口满足以下之一:                    │
    │  - autoChatDone = true (达到迭代上限)    │
    │  - !streaming && !pending && inbox空     │
    │    (空闲且无消息，无人再说话)              │
    │                                          │
    │  满足 → pgAutoChatFinish()               │
    │  不满足 → 继续（有窗口在 streaming/pending）
    └──────────────────────────────────────────┘
```

---

## 5. 关键函数与代码片段

### 5.1 入口：`pgUserSend()` — 用户发送消息

```javascript
// pg-ui.js:114
function pgUserSend() {
  var ta = document.getElementById('pg-input');
  if (!ta) return;
  var text = ta.value.trim();
  if (!text) return;

  // 自动对话模式：允许在生成中发送（消息进入 inbox）
  if (pgState.autoChat.enabled) {
    ta.value = '';
    if (pgState.autoChat.isRunning) {
      pgAutoChatUserSend(text);    // 对话进行中 → 注入 inbox
    } else {
      pgAutoChatStart(text);       // 首次发送 → 启动对话
    }
    return;
  }

  // 普通模式：生成中不允许发送
  if (pgIsGenerating()) return;
  // ... 原有广播逻辑 ...
}
```

**关键设计**：自动对话模式下，`pgIsGenerating()` 检查被跳过，用户可以在窗口正在回复时发言。消息进入所有未完成窗口的 inbox，由窗口在完成当前回复后处理。

### 5.2 启动：`pgAutoChatStart(text)` — 首次启动对话

```javascript
// pg-autochat.js:89
function pgAutoChatStart(text) {
  var modelWins = pgAutoChatModelWindows();
  if (!modelWins.length) { pgToast(pgT('pgSelectModel'), 'warning'); return; }

  pgState.autoChat.isRunning = true;
  pgState.autoChat.abortFlag = false;

  var now = Date.now();
  // 用户消息注入所有窗口 inbox
  modelWins.forEach(function(i) {
    var w = pgWinAt(i);
    w.replyCount = 0;
    w.autoChatDone = false;
    w.autoChatPending = false;
    if (w.autoChatDelayTimer) { clearTimeout(w.autoChatDelayTimer); w.autoChatDelayTimer = null; }
    w.inbox = [];
    w.inbox.push({ sender: pgState.autoChat.userName || 'User', content: text, timestamp: now });
  });

  pgSave();
  pgRenderSidebar();
  pgRenderInputBar();

  // 启动所有窗口
  modelWins.forEach(function(i) { pgAutoChatProcessWindowInbox(i); });
  pgUpdateAutoChatUI();
}
```

### 5.3 延迟调度：`pgAutoChatProcessWindowInbox(winIdx)` — 随机延迟 + 发送

```javascript
// pg-autochat.js:127
function pgAutoChatProcessWindowInbox(winIdx) {
  if (!pgAutoChatCanReply(winIdx)) return;
  var w = pgWinAt(winIdx);
  if (!w.inbox.length) return;

  var baseDelay = pgState.autoChat.delaySeconds || 0;
  if (baseDelay <= 0) { pgAutoChatDoSend(winIdx); return; }  // 无延迟直接发送

  // 随机延迟：base × [0.5, 1.5]
  var minMs = baseDelay * 500;
  var maxMs = baseDelay * 1500;
  var delay = minMs + Math.random() * (maxMs - minMs);

  w.autoChatPending = true;
  pgUpdateAutoChatUI();

  w.autoChatDelayTimer = setTimeout(function() {
    w.autoChatDelayTimer = null;
    w.autoChatPending = false;
    if (pgState.autoChat.abortFlag || !pgState.autoChat.isRunning) return;
    pgAutoChatDoSend(winIdx);
  }, delay);
}
```

**设计要点**：
- 延迟期间 inbox 继续累积消息（其他窗口可能广播新回复），fire 时一并合并
- `autoChatPending` 标记防止重复调度
- `abortFlag` 检查确保终止时不会误触发

### 5.4 实际发送：`pgAutoChatDoSend(winIdx)` — 合并 inbox 并请求

```javascript
// pg-autochat.js:155
function pgAutoChatDoSend(winIdx) {
  if (!pgAutoChatCanReply(winIdx)) return;
  var w = pgWinAt(winIdx);
  if (!w.inbox.length) { pgAutoChatCheckAllDone(); return; }

  // 使用 inbox 中最大的 timestamp 作为 createdAt（保证跨窗口去重一致性）
  var now = w.inbox.reduce(function(max, m) { return Math.max(max, m.timestamp); }, 0) || Date.now();
  
  // 合并 inbox 消息为一条 user 消息
  var merged = w.inbox.map(function(m) {
    return '[' + m.sender + ']: ' + m.content;
  }).join('\n\n');
  w.inbox = [];

  w.messages.push({ role: 'user', content: merged, createdAt: now });
  w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: now });
  var lastIdx = w.messages.length - 1;
  pgRenderMessages(winIdx);
  pgSend(winIdx, lastIdx);  // → pgStream / pgSendNonStream
}
```

### 5.5 完成 Hook：`pgAutoChatOnFinish(winIdx)` — 回复完成后的核心编排

```javascript
// pg-autochat.js:178
function pgAutoChatOnFinish(winIdx) {
  if (!pgState.autoChat || !pgState.autoChat.isRunning) return;
  if (pgState.autoChat.abortFlag) return;  // 关闭过程中抑制 hook
  var w = pgWinAt(winIdx);
  if (!w) return;

  // 1. 计数（完成时计数，失败也算）
  w.replyCount++;

  // 2. 检查迭代上限
  var iters = pgState.autoChat.iterations;
  if (iters > 0 && w.replyCount >= iters) { w.autoChatDone = true; }

  // 3. 广播回复到其他未完成窗口的 inbox
  var content = pgTextContent(w.messages[w.messages.length - 1].content);
  if (content && content.trim()) {
    var sender = pgAutoChatGetAgentName(winIdx);
    var ts = Date.now();
    for (var j = 0; j < pgState.splitCount; j++) {
      if (j === winIdx) continue;
      var other = pgWinAt(j);
      if (!other.config.model || other.autoChatDone) continue;
      other.inbox.push({ sender: sender, content: content, timestamp: ts });
    }
  }

  pgUpdateAutoChatUI();
  pgRefreshGroupChatModal();

  // 4. 处理自己的 inbox（回复期间可能收到其他窗口的广播）
  pgAutoChatProcessWindowInbox(winIdx);

  // 5. 触发其他 idle 窗口处理 inbox（刚广播了新消息给他们）
  for (var k = 0; k < pgState.splitCount; k++) {
    if (k === winIdx) continue;
    pgAutoChatProcessWindowInbox(k);
  }

  // 6. 检查是否全部结束
  pgAutoChatCheckAllDone();
}
```

**Hook 注入点**（pg-stream.js）：

```javascript
// pg-stream.js — pgFinish() 末尾
if (typeof pgAutoChatOnFinish === 'function' && pgState.autoChat && pgState.autoChat.isRunning) {
  pgAutoChatOnFinish(i);
}

// pg-stream.js — pgFail() 末尾（失败也计数）
if (typeof pgAutoChatOnFinish === 'function' && pgState.autoChat && pgState.autoChat.isRunning) {
  pgAutoChatOnFinish(i);
}
```

### 5.6 终止判断：`pgAutoChatCheckAllDone()`

```javascript
// pg-autochat.js:225
function pgAutoChatCheckAllDone() {
  var modelWins = pgAutoChatModelWindows();
  var allDone = modelWins.every(function(i) {
    var w = pgWinAt(i);
    if (w.streaming) return false;           // 仍在回复
    if (w.autoChatPending) return false;     // 正在等待延迟
    if (w.autoChatDone) return true;         // 达到迭代上限
    if (w.inbox.length > 0) return false;    // 有待处理消息
    return true;  // 空闲 + 无消息 = 等待他人发言；全部如此则无人说话 → 结束
  });
  if (allDone) pgAutoChatFinish();
}
```

### 5.7 用户运行中发言：`pgAutoChatUserSend(text)`

```javascript
// pg-autochat.js:303
function pgAutoChatUserSend(text) {
  if (pgState.autoChat.isRunning) {
    var now = Date.now();
    var modelWins = pgAutoChatModelWindows();
    // 注入所有未完成窗口的 inbox
    modelWins.forEach(function(i) {
      var w = pgWinAt(i);
      if (w.autoChatDone) return;
      w.inbox.push({ sender: pgState.autoChat.userName || 'User', content: text, timestamp: now });
    });
    // 触发 idle 窗口立即处理
    modelWins.forEach(function(i) { pgAutoChatProcessWindowInbox(i); });
    pgUpdateAutoChatUI();
    pgRefreshGroupChatModal();
  } else {
    pgAutoChatStart(text);
  }
}
```

### 5.8 终止安全：`pgStop()` 中的 abortFlag 抑制

```javascript
// pg-stream.js:326
function pgStop() {
  // 设置 abortFlag 抑制 finish hook（关闭过程中 pgFinish 会为每个 streaming 窗口调用）
  if (pgState.autoChat && pgState.autoChat.isRunning) {
    pgState.autoChat.abortFlag = true;
  }
  // ... abort 所有窗口的 AbortController ...
  // ... 对每个 streaming 窗口调用 pgFinish() ...
  // 终止自动对话循环
  if (typeof pgAutoChatStop === 'function' && pgState.autoChat && pgState.autoChat.isRunning) {
    pgAutoChatStop();
  }
  pgUpdateInputBar();
}
```

**问题背景**：`pgStop()` 遍历所有 streaming 窗口逐一调用 `pgFinish()`，每个 `pgFinish()` 末尾会触发 `pgAutoChatOnFinish()`。如果不抑制，关闭过程中会错误地触发广播和新一轮 inbox 处理。`abortFlag` 在 hook 入口被检查，直接 return。

### 5.9 群聊聚合视图 Modal（实时刷新）

```javascript
// pg-autochat.js:429
function pgOpenGroupChatModal() {
  if (pgGcRefreshTimer) { clearInterval(pgGcRefreshTimer); pgGcRefreshTimer = null; }

  var msgs = pgGetGroupChatMessages();
  var msgsHtml = pgRenderGroupChatMessagesHtml(msgs);
  // ... 构建 modal HTML（含输入框）...
  pgShowModal(html);

  // 500ms 定时刷新
  pgGcRefreshTimer = setInterval(function() {
    var overlay = document.getElementById('pg-modal-overlay');
    if (!overlay || !overlay.classList.contains('show')) {
      clearInterval(pgGcRefreshTimer);  // modal 已关闭 → 自动清理
      pgGcRefreshTimer = null;
      return;
    }
    pgRefreshGroupChatModal();
  }, 500);
}
```

**消息去重**：同一消息会出现在多个窗口的 `messages` 数组中（用户消息广播到所有窗口、agent 回复广播到其他窗口 inbox）。群聊 modal 通过 `sender + content + timestamp` 三元组去重。

**消息来源解析**：user 消息中的 `[发送者]: 内容` 前缀被正则解析为 `sender` 和 `displayContent`，assistant 消息直接使用窗口的 `agentName`。

---

## 6. UI 布局

### 6.1 右侧设置面板（自动对话相关）

```
┌─────────────────────────────────┐
│ Auto Chat                       │  ← pgAutoChat 面板标题
│ ☑ Enable Auto Chat              │  ← 开关（splitCount < 2 时拒绝）
│                                 │
│ Iterations    [10]              │  ← 每窗口最大回复次数
│ ⚠ 0 = infinite, use caution... │  ← 0 时显示费用警告
│                                 │
│ Your Name     [陆小凤]           │  ← 用户昵称
│                                 │
│ Delay (s)     [3.0]             │  ← 随机延迟基数（秒）
│ Random wait before each reply.. │  ← 延迟说明
│                                 │
│ [Stop Auto Chat] [Open Group]   │  ← 终止按钮 + 群聊按钮
├─────────────────────────────────┤
│ Agent Identity                  │  ← Agent 昵称面板（每窗口独立）
│ [王怜花_________________]       │
├─────────────────────────────────┤
│ Select Model                    │  ← 模型选择（已有）
│ ...                             │
```

### 6.2 分屏窗口标题

```
┌─────────────────────────────────────────┐
│ 王怜花  deepseek-chat  [🗑] [🐛]        │  ← agentName 优先，空则 "Window N"
│ ┌─────────────────────────────────────┐ │
│ │ 消息列表                            │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 6.3 群聊聚合视图 Modal

```
┌───────────────────────────────────────────────┐
│ 💬 Group Chat                            [✕]  │
├───────────────────────────────────────────────┤
│                                               │
│  [陆小凤] 02:05:54                            │  ← 用户消息（右对齐）
│  朋友们，我要去东瀛闯荡了                      │
│                                               │
│  [王怜花] 02:05:56                            │  ← Agent 回复（左对齐）
│  花满楼轻摇折扇...                            │
│                                               │
│  [令狐冲] 02:06:02                            │
│  轻摇折扇，眉眼带笑...                         │
│                                               │
├───────────────────────────────────────────────┤
│ [输入消息...                          ] [Send] │  ← 内置输入框
└───────────────────────────────────────────────┘
```

进度提示（运行中）：`W1:3… W2:5~ W3:1 / 10`
- `3` = 已完成回复数
- `…` = 正在 streaming
- `~` = 正在等待延迟
- `/ 10` = 迭代上限（`/ ∞` = 无限）

---

## 7. 交互流程总结

### 7.1 正常对话流程

1. 用户设置分屏数 ≥ 2，为每个窗口选择模型和 Agent 昵称
2. 开启自动对话开关，设置迭代次数、用户昵称、延迟
3. 用户输入消息发送 → `pgAutoChatStart()` → 消息注入所有窗口 inbox → 各窗口按延迟顺序开始回复
4. 每个窗口回复完成 → `pgAutoChatOnFinish()` → 广播到其他窗口 inbox → 处理自身 inbox → 继续回复
5. 所有窗口达到迭代上限或无人有新消息 → `pgAutoChatFinish()`

### 7.2 用户中途发言

- 对话进行中，用户输入发送 → `pgAutoChatUserSend()` → 消息注入所有未完成窗口 inbox
- idle 窗口立即被触发处理 inbox（可能经过延迟）
- streaming 窗口在完成当前回复后处理 inbox
- 用户发言不消耗迭代次数

### 7.3 手动终止

- 点击"Stop Auto Chat"或"Stop"按钮 → `pgAutoChatStop()` → 设置 abortFlag → 清理延迟定时器 → `pgStop()` 中止所有请求 → 清空 inbox → 重置计数

### 7.4 群聊 Modal 交互

- 点击"Open Group Chat"打开 modal → 500ms 定时刷新消息
- modal 内输入发送 → `pgGroupChatSend()` → 转发到主输入栏 → `pgUserSend()` → 即时刷新
- 关闭 modal → 定时器自动清理

---

## 8. 已知限制与潜在问题

### 8.1 消息上下文膨胀

每次窗口处理 inbox 时，将所有 inbox 消息合并为一条 user 消息追加到 `messages` 数组。随着对话进行，`messages` 数组不断增长，发送给上游 LLM 的 token 数也随之膨胀。当前无截断/滑动窗口机制（仅 windows[0] 有 100 条上限的 localStorage 持久化限制，但运行时内存无限制）。

**影响**：长对话可能导致 token 超限（取决于模型 max context length）或费用过高。

### 8.2 消息重复与嵌套

inbox 消息以 `[发送者]: 原始内容` 格式注入。如果 Agent A 的回复中引用了 Agent B 的话（模型倾向这么做），那么 Agent C 收到的 inbox 消息会包含 `[B]: ... [A]: [B]: ...` 的嵌套结构。随着轮次增加，嵌套深度可能增长。

### 8.3 去重依赖时间戳精度

群聊 modal 的去重使用 `sender + content + timestamp` 三元组。`pgAutoChatDoSend` 中使用 inbox 中最大的 timestamp 作为 `createdAt`，但如果两条不同消息恰好在同一毫秒产生（概率极低），可能误去重。

### 8.4 无流式中途插入

用户在窗口 streaming 时发言，消息进入 inbox，但窗口必须完成当前回复后才能处理。无法中断当前回复直接响应用户（这符合群聊逻辑，但可能导致用户等待）。

### 8.5 单进程内存调度

所有窗口的请求/响应在浏览器端并发。Go 后端是纯透传，不感知自动对话状态。如果有 4 个窗口同时 streaming，浏览器的 fetch 并发连接数可能成为瓶颈（HTTP/1.1 通常 6 连接/域名）。

### 8.6 延迟期间的状态一致性

延迟定时器 fire 时检查 `abortFlag` 和 `isRunning`，但如果在 `pgAutoChatDoSend` 执行过程中（同步代码）被终止，不会有问题（JS 单线程）。但如果 fire 时窗口恰好从 idle 变为 streaming（理论上不可能，因为 `pgAutoChatCanReply` 检查了 `streaming`），则 `pgSend` 不会被调用。

---

## 9. 文件修改清单

| 文件 | 修改内容 |
|---|---|
| `pg-state.js` | `makeWin()` 新增 `agentName/inbox/replyCount/autoChatDone/autoChatPending/autoChatDelayTimer`；`pgState.autoChat` 新增 `delaySeconds`；持久化 `delaySeconds` |
| `pg-autochat.js` | **全新文件**，488 行，包含所有自动对话核心逻辑 |
| `pg-stream.js` | `pgFinish()`/`pgFail()` 末尾添加 `pgAutoChatOnFinish` hook；`pgStop()` 开头设置 `abortFlag` |
| `pg-ui.js` | `pgUserSend()` 添加自动模式分支；`pgRenderSidebar()` 添加自动对话面板和 Agent 昵称面板；`pgRenderPanes()` 显示 agentName；`pgRenderInputBar()` 运行中显示 Stop Auto Chat 按钮 |
| `pg-modal.js` | 无修改（群聊 modal 在 pg-autochat.js 中自行实现） |
| `pg-lifecycle.js` | `cleanupPlayground()` 添加 `pgAutoChatStop()` |
| `pg-i18n.js` | en/cn 各新增 17 个 key（pgAutoChat*、pgGroupChatTitle 等） |
| `playground.css` | 新增自动对话面板和群聊 modal 样式 |
| `index.html` | 添加 `pg-autochat.js` 的 `<script>` 加载（在 pg-stream.js 之后） |
| `internal/api/router.go` | 注册所有 `pg-*.js` 文件的 HTTP 路由（修复 404） |

---

## 10. 请求指导的方向

向深度研究模型请求以下方面的审查和建议：

1. **消息上下文管理**：当前无截断机制，长对话 token 膨胀。是否有更好的滑动窗口/摘要策略，在保持群聊连贯性的同时控制 token 用量？

2. **消息嵌套问题**：inbox 消息以 `[sender]: content` 格式注入，模型可能引用导致嵌套。是否有更好的消息格式或 system prompt 策略来减少嵌套？

3. **并发安全**：纯 JS 单线程，但 setTimeout 回调和 fetch Promise 的交错执行是否有竞态条件风险？当前用 `autoChatPending`/`streaming` 标志位防护是否充分？

4. **终止判断的充分性**：`pgAutoChatCheckAllDone()` 的判断条件是"所有窗口 streaming=false && pending=false && (done=true || inbox=空)"。是否存在死锁场景（所有窗口都在等对方先说话，但没有人有 inbox 消息）？这是预期行为还是需要超时兜底？

5. **延迟策略优化**：当前是固定基数 ±50% 随机。是否有更自然的延迟模型（如基于回复长度、对话热度自适应）？

6. **群聊 Modal 性能**：500ms 全量重渲染（`innerHTML` 替换）在消息量大时可能有性能问题。是否有增量更新方案？
