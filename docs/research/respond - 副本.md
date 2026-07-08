# TinyRouter Playground「AI 辅助设定生成」特性设计方案

> 本方案基于申请书第一部分的流程梳理（已作为事实基础采信），针对第二部分工作要求给出完整设计：数据结构、提示词全文、流程改动点（精确到现有 `file:line` 对接位）、开放问题裁决、风险与权衡。所有对现有代码的引用沿用申请书的行号。

---

## 0. 总体架构决策摘要（先给结论）

| # | 决策 | 理由摘要 |
|---|---|---|
| D1 | 新增两个模块 `pg-setup.js`（相位 A）与 `pg-director.js`（相位 B），加载顺序插在 `pg-autochat` 之后、`pg-render` 之前；对 autochat 的回调全部沿用**守卫式全局函数**惯例 | 与现有 4 钩子模式同构，零加载顺序风险，autochat 不感知新模块是否存在 |
| D2 | 三种生成模式共享统一档案 `ScenarioProfile v1`（§2），下游"填入窗口"逻辑与模式完全解耦 | 满足开放问题 1 |
| D3 | 监督（director）与旁白（narrator）**职责分离、调用分离，模型可同可异**：director 每次评估是一次廉价的 JSON 判决调用；仅当判决为"推进"时才发起第二次 narrator 生成调用 | 判决高频、生成低频，分离可让判决用小模型省成本，且两套提示词各自可调（开放问题 3 的裁决，详见 §5.1） |
| D4 | director 触发采用**事件计数驱动**（每累积 N 条新的 agent complete 条目评估一次），挂载在 `pgAutoChatOnFinish` 尾部，而非墙钟 `setInterval` | 与现有"流完成回调驱动"的事件循环同构；对话停止即自然停止，无需额外清理墙钟定时器（仍保留 session 守卫，见 §5.3） |
| D5 | narrator 条目**推进未读游标**（唤醒 idle 窗口）、**不计任何 replyCount**、**计入滚动总结输入**、在 `CheckAllDone` 中以 `director.pending / narrator.streaming` 两个标志阻止提前结束 | 开放问题 5 的裁决，详见 §5.5 |
| D6 | 性格→参数映射采用"**LLM 输出量化性格轴 + 客户端确定性映射**"两段式：LLM 只打分（0–10 三轴），映射公式在客户端硬规则实现并附 rationale 文本 | 可解释、可覆盖、可单测；避免让 LLM 直接输出 temperature 数值导致不可控（开放问题 4） |
| D7 | 导出档案带 `{schema, version}` 头，导入按版本迁移；最近一次档案额外持久化到 `localStorage: tinyrouter.playground.scenario.v1` | 开放问题 6 |
| D8 | 所有生成/判决/旁白调用均为 `stream:false` 的 `/v1/chat/completions` POST，不引入新端点，不走 `pgSend`（避免污染窗口状态机） | 满足约束 7；`pgAutoChatMaybeSummarize`（:760）已示范此裸 fetch 通路，直接沿用其模式 |

---

## 1. 模块拓扑变更

```
index.html 加载顺序（新增两行）：
  ... → pg-autochat → pg-setup → pg-director → pg-render → pg-ui → pg-modal → pg-lifecycle
```

新增守卫式钩子（由 autochat 侧调用，`typeof === 'function'` 守卫，与 `pgAutoChatOnFinish` 等 4 钩子同一惯例）：

| 钩子 | 调用点（现有代码位置） | 方向 | 作用 |
|---|---|---|---|
| `pgDirectorOnAgentReply(winIdx)` | `pgAutoChatOnFinish` 尾部，紧邻 `pgAutoChatMaybeSummarize`（:372）之后 | autochat → director | 累积计数，达阈值触发评估 |
| `pgDirectorOnBeforeFinish()` | `pgAutoChatCheckAllDone`（:379-402）判定 allDone 前 | autochat → director | 终局评估机会（§5.6），返回 true 表示"我要介入，暂缓 finish" |
| `pgDirectorReset()` | `pgAutoChatStart`（:165）、`pgAutoChatStop`（:415）、`pgAutoChatFinish`（:444） | autochat → director | 重置/中止 director 状态与在途 fetch |
| `pgSetupApplyProfile(profile)` | pg-setup 内部 → 写 `w.config.*` | setup → state | 档案落盘（§4） |

反向依赖：`pg-director.js` 直接调用 autochat 既有公开函数 `pgAutoChatProcessWindowInbox`、timeline 追加函数（需小幅导出，见 §5.4）、`pgUpdateAutoChatUI`、`pgGcRefreshModalIncremental`。这与 pg-stream↔pg-autochat 的双向耦合模式一致。

---

## 2. 统一档案 Schema：`ScenarioProfile v1`

三种模式（M1/M2/M3）无论中间过程如何，最终都归一到此结构；导入/导出/自动填入只认此结构。

```jsonc
{
  "schema": "tr.playground.scenario",
  "version": 1,
  "createdAt": "2025-01-01T00:00:00Z",
  "seedInput": { "topic": "", "genre": "", "guidance": "", "userNames": [] },  // 用户原始输入，便于重生成
  "scenario": {
    "coreSeed": "单句公式：当…遭遇…必须…否则…",       // 来自小说架构·核心种子
    "world": "世界观（物理/社会/隐喻三维度的浓缩）",     // 来自小说架构·世界观
    "tone": "基调与类型标签",                          // 来自方向创造 genre
    "openingSituation": "开场情境（用于建议种子消息）",
    "relationships": "角色关系网概述"                   // 来自角色动力学
  },
  "characters": [                                       // 长度 == pgState.splitCount 有 model 的窗口数
    {
      "name": "", "aliases": [],
      "description": "80-200字概括",
      "fields": { "外貌": "", "性格": "", "能力": "", "身份": "", "动机": "" },
      "styleNote": "语言风格",
      "styleExamples": ["台词1", "台词2"],
      "relations": "与其他角色的关系（从关系网切片）",
      "personaAxes": { "conventionality": 7, "expressiveness": 3, "verbosity": 5 }  // 0-10，供参数推导
    }
  ],
  "agents": [                                           // 与 characters 一一对应的最终合成结果
    {
      "agentName": "",
      "systemPrompt": "…（§4.1 模板合成）",
      "params": { "temperature": 0.72, "topP": 0.95, "maxTokens": 384, "seed": 1234567 },
      "paramsRationale": "conventionality=7（严谨）→ temp 0.72；verbosity=5 → maxTokens 384",
      "paramsOverridden": false                          // 用户手动改过则置 true，重生成时不覆盖
    }
  ],
  "director": {                                          // 相位 B 的档案级默认配置（可选）
    "plotOutline": "三幕式情节浓缩（M1 才有，供 director 参考剧情走向）",
    "suggestedEveryNReplies": 6
  }
}
```

设计要点：

- **`characters` 与 `agents` 分离**：characters 是"创作素材"（可反复编辑、单卡重生成），agents 是"落地产物"（合成结果+参数）。重新合成只重写 agents，不动 characters——这使 M1 的"每阶段可审阅微调"成为纯数据操作。
- **`personaAxes` 是参数映射的唯一输入**（§4.2），三种模式的提示词都要求输出这三个整数，保证 M3 一步到位也能推导参数。
- **`director.plotOutline`**：只有 M1 产出三幕情节；M2/M3 留空。director 提示词对其做"有则遵循、无则自由裁量"处理（§5.2）。
- **版本策略**（开放问题 6）：导入时 `version > 当前支持` → 拒绝并 toast；`version < 当前` → 逐版迁移函数链 `migrateV1toV2(...)`。字段新增一律给默认值，删除字段保留读兼容一个大版本。

---

## 3. 相位 A：三种生成模式设计

### 3.1 管线总览

```
M1（5 阶段，逐阶段可审阅/重生成）：
  ①方向创造(附录-1) → ②小说架构(附录-2) → ③人物卡片生成(附录-4, count=N)
  → ④人物侧写(附录-5, 批量扩写) → ⑤客户端合成 agents（无 LLM，纯模板）
  单卡重生成/丰富：人物设定(附录-3, enrich 模式)

M2（2 步）：
  ①「场景+侧写」合并提示词（新设计，融合附录-1+2+4 的质量结构）
  → ②人物侧写(附录-5 原文直接复用) → 客户端合成 agents

M3（1 步）：
  ①「一步全量」提示词（新设计） → 客户端合成 agents（或直接采纳其 systemPrompt 草稿）
```

关键观察：**附录-5（人物侧写批量扩写）是三条管线的公共收敛点素材格式**——M1④ 与 M2② 直接复用其原文；M3 的输出 schema 也要求人物部分与之字段对齐。这样 characters[] 的解析器只写一份。

**阶段间数据传递**均为客户端拼接：上一阶段的 JSON/分区文本作为下一阶段 user message 的一部分注入，全部 `stream:false` 单次调用，JSON 解析采用容错提取（剥 ```json 围栏、取首个平衡花括号/方括号，解析失败给"重试本阶段"按钮而非静默失败）。

### 3.2 M1 各阶段的输入拼接（复用附录原文为 system prompt）

| 阶段 | system | user message 拼接 |
|---|---|---|
| ① | 附录-1 原文 | 用户种子（可空："（无输入，请自由发挥）"） |
| ② | 附录-2 原文 | `topic/genre/guidance` JSON + "核心角色数请贴近 N 个" |
| ③ | 附录-4 原文 | `type=character, count=N` + 整体要求 =「②的核心种子+世界观摘录」+ 用户预填的 agent 名（若有，要求 name 采用之） |
| ④ | 附录-5 原文 | ③的 profiles 数组 + 整体要求（同上）+ **附加一行**："每张卡片额外输出 personaAxes 对象：{conventionality, expressiveness, verbosity}，各为 0-10 整数，分别表示性格的严谨克制程度、表达的跳脱奔放程度、话语的冗长程度。" |
| ⑤ | — | 纯客户端：切片②的角色动力学→ `relations`；模板合成 systemPrompt（§4.1）；映射参数（§4.2） |

> 对附录-5 的 schema 扩展（personaAxes）是唯一改动，属"追加字段"而非改结构，对提示词质量结构零侵入。M1 每阶段结果展示在向导式模态框中，用户可编辑文本后再进入下一阶段，也可点"重新生成本阶段"。

### 3.3 M2 第一步合并提示词（新设计全文）

```
你是资深小说架构师兼设定策划。请一步完成：为一个 N 人群聊角色扮演场景，
设计共享场景背景与 N 个彼此差异化的人物侧写。

## 工作方法
1. 若用户给了主题/类型/梗概/人物名，紧扣展开；若为空，自由发挥一个高冲突、
   有反转余地的方向。
2. 用单句公式提炼核心种子——"当[主角们]遭遇[核心事件]，必须[关键行动]，
   否则[灾难后果]"。
3. 世界观从物理/社会/隐喻三维度构思后浓缩为一段。
4. 为 N 个人物各设计驱动力三角（表面追求/深层渴望/灵魂需求），并构建
   彼此的关系网（冲突、合作、背叛至少各一处，若人数允许）。
5. 每个人物给出一句话侧写（30-60字），彼此定位/性格不得雷同。

## 输出格式（严格遵守，只输出以下 JSON 对象，不要围栏、不要解释）
{
  "scenario": {
    "coreSeed": "单句公式",
    "world": "世界观浓缩（150字内）",
    "tone": "类型与基调标签",
    "openingSituation": "开场情境（50字内，可作为群聊第一条消息的素材）",
    "relationships": "关系网概述（每对关键关系一句话）"
  },
  "profiles": [
    { "name": "名称", "brief": "一句话侧写（含定位/性格/核心特征与驱动力暗示）" }
  ]
}
profiles 长度必须等于 N。
```

第二步直接复用附录-5 原文（含 §3.2 的 personaAxes 追加行），整体要求栏注入第一步的 `scenario` 全文——这就是"沿用质量结构而非另起炉灶"：核心种子/驱动力三角/关系网/styleNote 全部保留，只是压缩了阶段数。

### 3.4 M3 一步到位提示词（新设计全文）

```
你是资深小说架构师兼设定策划。请一次性完成：共享场景背景 + N 张完整人物
卡片，用于 N 个 AI 在群聊中分别扮演一个角色。

## 工作方法
- 核心种子用单句公式（当…遭遇…必须…否则…）；世界观三维度浓缩；
  每个人物有驱动力三角与关系网位置；人物间高差异化。
- 每张人物卡片必须包含 styleNote（该角色如何说话）与 styleExamples
  （2-4 句能立刻听出"是这个人"的台词）——这是最重要的字段。
- 每张卡片输出 personaAxes：{conventionality, expressiveness, verbosity}
  三个 0-10 整数（严谨克制度/跳脱奔放度/话痨度）。

## 输出格式（严格遵守，只输出以下 JSON，不要围栏、不要解释）
{
  "scenario": { "coreSeed": "...", "world": "...", "tone": "...",
                "openingSituation": "...", "relationships```
{
  "scenario": { "coreSeed": "...", "world": "...", "tone": "...",
                "openingSituation": "...", "relationships": "..." },
  "characters": [
    {
      "name": "", "aliases": [],
      "description": "80-200字概括",
      "fields": { "外貌": "", "性格": "", "能力": "", "身份": "", "动机": "" },
      "styleNote": "语言风格描述",
      "styleExamples": ["台词1", "台词2"],
      "relations": "与其他角色的关系一句话",
      "personaAxes": { "conventionality": 5, "expressiveness": 5, "verbosity": 5 }
    }
  ]
}
characters 长度必须等于 N。
```

> M3 不让 LLM 直接产出 systemPrompt——即使一步模式，**合成仍在客户端模板中完成**（§4.1）。理由：(a) 群聊行为规则与 narrator 告知条款（§4.1 第③段）必须逐字稳定注入，不能依赖 LLM 转述；(b) 保证三种模式的 agents 产物字节级结构一致，便于导入导出与 diff。

### 3.5 单卡重生成 / 丰富

任一模式生成后，每张人物卡片旁提供「重新生成」「AI 丰富」按钮，直接复用**附录-3 原文**（create / enrich 模式），user message 注入：当前卡片 JSON + scenario 全文（保证与场景自洽）+ personaAxes 追加要求。结果只替换 `characters[i]`，然后重跑客户端合成刷新 `agents[i]`（若 `paramsOverridden===true` 则保留用户参数）。

---

## 4. 客户端合成与自动填入

### 4.1 systemPrompt 合成模板（纯字符串模板，无 LLM）

```
【场景】
{scenario.coreSeed}
{scenario.world}
基调：{scenario.tone}
人物关系：{scenario.relationships}

【你的角色：{name}】
{description}
{fields 逐行： - 外貌：… / - 性格：… / - 动机：…}
与他人的关系：{relations}
语言风格：{styleNote}
你的说话方式示例（模仿其口吻，不要照抄）：
{styleExamples 逐行}

【群聊规则】
1. 你正在一个多人群聊中扮演 {name}，始终以第一人称、保持角色口吻发言。
2. 其他消息以 [名字]: 前缀出现；你的回复不要带任何名字前缀。
3. 若当前没有值得你发言的内容，只回复 <pass/>。
4. 对话中会出现「旁白」消息（以系统消息形式出现的场景描写/剧情推进）。
   它是环境与剧情的变化，不是提问——不要回答它、不要复述它，
   而是让你的下一次发言自然地体现这一变化。
5. 每次发言保持在角色的自然长度内，推动对话而非独白。
```

第【群聊规则】段是 `PG_AUTOCHAT_DEFAULT_SYSTEM_PROMPT`（pg-autochat.js:62-69）语义的超集（含 `<pass/>` 条款），因此合成 prompt 写入 `w.config.systemPrompt` 后，`pgAutoChatRenderPerspective`（:117-120）会因"非空则用之"而直接采用，默认 prompt 被自然旁路——**零改动复用既有分支**。第 4 条即 §2.4 要求的 narrator 告知条款，在合成时无条件注入。

### 4.2 personaAxes → 参数映射（确定性、可解释、可覆盖）

| 参数 | 公式 | 说明 |
|---|---|---|
| `temperature` | `clamp(0.3 + expressiveness*0.09 - conventionality*0.03, 0.2, 1.3)`，四舍五入到 0.05 | 奔放度主导升温，严谨度压温。例：严谨军师 (c=8,e=2) → 0.24→0.25；跳脱疯批 (c=2,e=9) → 1.05 |
| `topP` | `conventionality >= 7 ? 0.9 : 1.0`（仅两档） | 只对高度克制角色收紧核采样；避免 temp 与 topP 同时压导致复读 |
| `maxTokens` | `verbosity` 分三档：0–3 → 256；4–6 → 512；7–10 → 1024 | 粗粒度台阶而非连续函数——用户一眼能懂、能改 |
| `seed` | `Math.floor(Math.random()*2**31)` | 每次合成随机 |

配套输出人类可读的 `paramsRationale`（见 §2 示例），显示在填入确认界面每个窗口卡片下方。**覆盖策略**：填入后用户经现有侧边栏 `pgOnParam`（pg-ui.js:333-343）改动任何参数 → pg-setup 监听不到也无需监听——只在"重新合成/重新导入"时比对 `agents[i].params` 与 `w.config.*`，不一致即视为已覆盖并弹确认。同时开启对应 `parameterEnabled` 开关，确保推导参数真正进入 `pgBuildBodyForWin`（pg-request.js:46-80）的可选参数注入。

### 4.3 自动填入（`pgSetupApplyProfile`）

对第 i 个有 model 的窗口（按 `pgState.splitCount` 顺序）：

```
w.config.agentName    = agents[i].agentName      // 即 pgOnAgentName(:49) 的落点
w.config.systemPrompt = agents[i].systemPrompt   // 即 pgOnSystemPrompt 的落点
w.config.temperature / topP / maxTokens / seed = agents[i].params.*
w.config.parameterEnabled.{temperature,topP,maxTokens,seed} = true
（model 不写——始终由用户选，符合 §1.6）
```

随后调 `pgSave()` + `pgRenderSidebar()` + `pgUpdateAutoChatUI()`（函数调用驱动的 UI 同步惯例，§10 状态管理表）。若窗口已有非空 systemPrompt，填入前逐窗口勾选确认覆盖。填入完成后：自动勾选 `#pg-autochat-enable`（经 `pgAutoChatToggle(true)`，:19，其 splitCount>=2 校验顺带生效），并把 `scenario.openingSituation` 预填到 `#pg-input` 作为**建议种子消息**（用户可改可删）——启动仍走原路径 A，不新增启动入口。

### 4.4 导入 / 导出

- 导出：完整 `ScenarioProfile` JSON 下载（`Blob` + `a[download]`），文件名 `scenario-{name片段}-{date}.json`。
- 导入：文件选择 → JSON.parse → 校验 `schema==='tr.playground.scenario'` → 版本迁移链 → 渲染到设定预览界面（可再编辑）→ `pgSetupApplyProfile`。
- 最近档案自动存 `localStorage: tinyrouter.playground.scenario.v1`（与 `tinyrouter.playground.autochat.v1` 并列的新 key，走 `pg-state.js` 新增 `pgSaveScenario/pgLoadScenario`），刷新页面后可一键恢复。
- **向后兼容承诺**：v1 内字段只增不改义；破坏性变更升 v2 并提供 `migrateV1toV2`；导入高于当前版本 → 明确报错（不静默降级）。

---

## 5. 相位 B：Director / Narrator 子系统

### 5.1 开放问题 3 裁决：分离的两次调用，模型可同可异

- **Director（判决）**：输入 = 对话近况，输出 = 一个小 JSON 判决。调用廉价、频繁（每 N 条回复一次），适合用户配置小模型。
- **Narrator（生成）**：仅当判决为 `advance` 时发起，输入 = 判决给出的推进方向 + 对话近况，输出 = 一段旁白正文。低频、需要文笔，适合较强模型。
- 用户配置（新增侧边栏 Director 面板，持久化进 `autochat.v1` 存储的 `pgState.autoChat.director` 子对象）：`enabled`、`directorModel`、`narratorModel`（默认 = directorModel）、`everyNReplies`（默认 6，来自档案 `director.suggestedEveryNReplies`）、`maxNarrations`（0=∞）。
- 不合一的额外理由：判决 JSON 与旁白正文的输出约束互斥（前者要求"只输出 JSON"，后者要求纯文学文本），合一提示词会互相污染格式服从性。权衡：多一次调用延迟——可接受，因为 narrator 注入本身不在任何窗口的关键路径上（异步旁路，见 §5.4）。

### 5.2 Director 专属提示词（新设计全文）

```
你是群聊角色扮演的「剧情导演」。你会周期性收到一段多角色对话的近况，
你的唯一职责是判断：此刻是否需要一次旁白介入来推进剧情。

## 判断标准（按优先级）
1. 停滞：角色们在原地寒暄、互相重复、礼貌性空转，超过约 3 轮没有新信息。
2. 收敛过快：冲突刚起就要和解、谜题刚抛出就被解决——需要投放阻碍或反转。
3. 偏轨：对话严重偏离场景核心矛盾（若提供了剧情大纲，以大纲为准）。
4. 节奏良好：角色间张力上升、信息持续更新——此时【不要】介入，让对话继续。

## 介入方式的克制原则
- 宁少勿多。连续两次评估都判 advance 是异常信号，第二次应倾向 continue。
- 推进方向只给「发生了什么」的一句话指令，不写正文（正文由旁白执笔者完成）。
- 方向必须是环境/事件层面的（有人闯入、传来消息、场景突变、时限逼近），
  不得替任何角色决定其想法或台词。

## 输入
你将收到：场景背景、剧情大纲（可能为空）、最近的对话记录、
已进行的旁白次数与上次旁白内容（可能为空）。

## 输出格式（严格遵守，只输出以下 JSON，不要围栏、不要解释）
{"decision":"advance"或"continue","reason":"一句话理由","direction":"仅当 advance 时给出的一句话推进指令，否则空字符串"}
```

输入拼接（user message）：`scenario.coreSeed + world`（来自档案；无档案则取各窗口 systemPrompt 首 200 字并集）＋ `director.plotOutline`（M1 才有，"有则遵循、无则自由裁量"由提示词第 3 条承接）＋ **timeline 尾部最近 20 条**（复用 `pgAutoChatMaybeSummarize` :760 已有的 timeline→文本序列化逻辑，pass/error 条目跳过）＋ 旁白计数与上次旁白。

### 5.3 触发机制（D4 决策展开）：事件计数驱动

在 `pgAutoChatOnFinish` 正常分支尾部（紧邻 :372 `pgAutoChatMaybeSummarize` 之后）加一行守卫式调用：

```js
if (typeof pgDirectorOnAgentReply === 'function' && pgState.autoChat.isRunning) pgDirectorOnAgentReply(winIdx);
```

`pgDirectorOnAgentReply` 内部：

```
repliesSinceLastEval++
if (!enabled || repliesSinceLastEval < everyNReplies || evalInFlight) return
evalInFlight = true; capturedSession = pgState.autoChat.session
fetch 判决（stream:false, AbortController 挂 pgDirectorAbort）
  .then(decision):
    if (session 已变 || !isRunning || abortFlag) return   ← 与 :299 同款过期抑制
    repliesSinceLastEval = 0; evalInFlight = false
    decision==='advance' && narrationCount < maxNarrations
      → pgDirectorRunNarrator(direction)   // 第二次调用
      → 否则纯记录（reason 显示在群聊模态框的 director 状态行）
  .catch → 静默 + evalInFlight=false        ← 与 :846 总结失败同款容错
```

选事件计数而非墙钟 `setInterval` 的完整理由：(a) 与现有循环的驱动源同质（流完成回调），无新的定时器生命周期要管理；(b) "隔一段时间"在群聊语境下的自然度量是**对话量**而非墙钟——各模型延迟差异大，墙钟间隔会在快模型下评估过疏、慢模型下评估过密；(c) 停止/结束时无孤儿定时器（仍以 `session + abortFlag` 双守卫兜底，`pgDirectorReset` 中 abort 在途 fetch）。

**并发安全**：判决期间对话继续推进是**特性而非缺陷**——判决基于略旧快照，但 narrator 注入前会重取 timeline 尾部给 narrator 提示词，时效性由生成端补偿；`evalInFlight` 互斥保证同时最多一个判决在途。

### 5.4 Narrator 生成与注入

Narrator 提示词（新设计全文）：

```
你是群聊角色扮演的「旁白执笔者」。导演已决定推进剧情，指令是：{direction}

## 写作要求
- 以第三人称全知视角写一段 50-150 字的旁白：环境变化、突发事件或场景转换。
- 只描写「世界发生了什么」，绝不替任何角色说话、行动或下决定。
- 与场景基调一致：{scenario.tone}。承接最近的对话情境，不突兀、不重复已有信息。
- 结尾应留下让角色们不得不回应的钩子（一个新事实、一声异响、一个抉择时刻）。

## 输出
直接输出旁白正文，不要任何前缀、引号、解释或格式标记。
```

注入流程（`pgDirectorRunNarrator`）：

```
narratorPending = true; pgUpdateAutoChatUI()          ← 群聊弹窗显示"旁白撰写中…"
fetch 生成（stream:false；narratorModel）
  → session/abortFlag 守卫
  → entry = appendTimeline('旁白', 'narrator', -1, text, 'complete')
       // winIdx=-1：与用户消息（:179）同款"非窗口来源"约定
  → narrationCount++; narratorPending = false
  → pgUpdateAutoChatUI(); pgGcRefreshModalIncremental()
  → for 每个有 model 的窗口 k: pgAutoChatProcessWindowInbox(k)   ← 广播唤醒
```

需要 autochat 侧的两个小改动：

1. **timeline 追加函数导出**：现有 append 逻辑（:179/:319/:353 处使用）若为模块内私有，提为全局 `pgAutoChatAppendTimeline(sender, senderType, winIdx, content, status)`，director 复用（不复制实现，保证 `timelineId` 单调性由唯一入口维护）。
2. **`pgAutoChatRenderPerspective` 新增 narrator 分支**（:125-126 system 分支旁）：

```js
if (entry.senderType === 'narrator') {
  out.push({ role: 'system', content: '【旁白】' + entry.content });
  continue;
}
```

映射为 `role:'system'` 满足 §2.3；`【旁白】` 前缀 + systemPrompt 群聊规则第 4 条（§4.1）双保险，防止模型把行中 system 消息误当新指令。群聊模态框渲染（`pgGcRefreshModalIncremental` :644）为 narrator 条目加独立样式类 `.pg-gc-narrator`（居中斜体，区别于 agent 气泡）——增量渲染按 `pgGcRenderedIds` 去重的机制无需改动，narrator 条目走同一 id 通道。

### 5.5 开放问题 5 裁决：narrator 对游标 / 总结 / 迭代 / 终止的影响

| 机制 | 裁决 | 依据 |
|---|---|---|
| **未读游标** `lastReadTimelineId` | narrator 条目**正常获得 id、正常构成未读** | 这正是旁白的功能语义：唤醒 idle 窗口对新剧情做出反应。注入后的广播（§5.4 末）与 `pgAutoChatUserSend`（:477）运行中追加用户消息的模式完全同构 |
| **replyCount / 迭代** | narrator 不经过 `pgAutoChatOnFinish`，天然不触碰任何窗口的 `replyCount`——**无需任何代码防御** | 旁白不走 `pgSend` 窗口状态机，是 timeline 的旁路写入者；与 `<pass/>` 不计数（:317-338）语义同构但实现更干净 |
| **滚动总结** `pgAutoChatMaybeSummarize`（:760） | narrator 条目**计入总结输入**，序列化时以 `旁白: …` 行呈现 | 剧情推进是后续对话的因果前提，总结若丢弃 narrator，被压缩区间之后的对话将失去动机解释。需在其 timeline→文本序列化处加一个 senderType 分支（一行改动） |
| **终止判断** `pgAutoChatCheckAllDone`（:379-402） | 循环体前加两个短路：`if (pgDirectorEvalInFlight() || pgDirectorNarratorPending()) return;`（守卫式，函数不存在则跳过） | 防止竞态：所有窗口恰好 idle、但判决/旁白在途——若此刻 finish，旁白会注入到已结束的会话。director 活动期间视为"系统仍忙" |
| **旁白连锁计迭代** | 窗口被 narrator 唤醒后的回复**照常计 replyCount** | 迭代上限是用户对"每窗口最多说几次"的预算约束，旁白引发的发言也消耗预算——否则 iterations 失去上界意义。用户可用 iterations=0（∞）+ 手动 Stop 的既有组合获得开放式剧情 |

### 5.6 与"改进点 6"（idle 提前结束）的交互——`pgDirectorOnBeforeFinish`

申请书附录改进点 6 指出：无未读且未达迭代的 idle 窗口会被判完成，可能提前自然结束。director 恰好提供一个体面的对冲：在 `pgAutoChatCheckAllDone` 判定 `allDone===true`、调用 `pgAutoChatFinish` **之前**插入：

```js
if (typeof pgDirectorOnBeforeFinish === 'function' && pgDirectorOnBeforeFinish()) return;
```

`pgDirectorOnBeforeFinish` 语义：若 `enabled && narrationCount < maxNarrations && 存在未达迭代上限的窗口 && 未用过终局机会`，发起一次**终局判决**（同 §5.2 提示词，输入附加一行"对话即将自然结束——若剧情尚未到达合理收束点，请给出推进指令"），返回 `true` 表示暂缓 finish；判决 `continue` 或失败时再调 `pgAutoChatCheckAllDone()` 让其自然结束（以 `finalChanceUsed` 标志保证只发生一次，杜绝无限续命）。这把改进点 6 从缺陷转为可控的"剧情未完则续一口气"机制，且 director 关闭时行为与现状完全一致。

### 5.7 生命周期对接

- `pgAutoChatStart`（:165）→ `pgDirectorReset()`：清零 `repliesSinceLastEval / narrationCount / finalChanceUsed`，abort 在途 fetch。
- `pgAutoChatStop`（:415）/ `pgAutoChatFinish`（:444）→ 同上（`session++` 已使在途回调失效，abort 仅为省流量）。
- `cleanupPlayground`（pg-lifecycle.js:25）→ 追加 abort director/narrator 的 AbortController。
- 群聊模态框：token 水位条（`pgGcUpdateTokenBar` :855）统计 timeline 全量，narrator 条目自动计入，无需改动。

---

## 6. 对现有代码的改动点汇总（最小侵入清单）

| 文件 | 改动 | 规模 |
|---|---|---|
| `index.html` | 加载 `pg-setup.js`、`pg-director.js` 两行 | +2 行 |
| `pg-autochat.js` | ① `pgAutoChatRenderPerspective` 加 narrator 分支（:125 旁）② `pgAutoChatOnFinish` 尾部加 `pgDirectorOnAgentReply` 守卫调用（:372 后）③ `pgAutoChatCheckAllDone` 头部加 pending 短路、allDone 后加 `pgDirectorOnBeforeFinish` 守卫（:379/:399）④ start/stop/finish 各加 `pgDirectorReset` 守卫 ⑤ timeline 追加函数导出为全局 ⑥ `pgAutoChatMaybeSummarize` 序列化加 narrator 行 | ~15 行 |
| `pg-state.js` | `pgState.autoChat.director` 默认子对象 + `pgSaveScenario/pgLoadScenario` | ~20 行 |
| `pg-ui.js` | 侧边栏 Director 面板 + 「设定生成」入口按钮 | 中 |
| `pg-modal.js` / 新模块 | 设定生成向导模态框（M1 分步 / M2 / M3 单页 + 预览编辑 + 导入导出） | 新增为主 |
| `pg-lifecycle.js` | cleanup 追加 director abort | +3 行 |

`pg-stream.js`、`pg-request.js`、`pg-render.js` **零改动**——设定生成与 director/narrator 全部走 `pgAutoChatMaybeSummarize` 同款裸 fetch 旁路，不进入窗口流式状态机。

---

## 7. 风险与权衡

1. **行中 system 消息的模型兼容性**（最大技术风险）：部分模型/代理对非首位 `role:'system'` 支持不佳（忽略或报错）。缓解：`【旁白】` 前缀 + systemPrompt 告知条款已使语义自足；预留每档案级降级开关 `narratorAsUser`（映射为 `{role:'user', content:'[旁白]: …'}`，恰是 :127-128 其他分支的既有形状），默认关闭，遇到不兼容模型时用户可切。
2. **JSON 服从性**：M2/M3 大 JSON 输出在弱模型上易破损。缓解：容错解析（剥围栏、平衡括号提取、`characters` 长度不符时截断/报缺）+ 每阶段独立"重试"按钮（M1 天然按阶段隔离故障域；M3 失败成本 = 整次重来，这正是三模式速度/可控性梯度的一部分，在 UI 上明示）。另可在提示词尾部追加"若无法完成请输出 `{\"error\":\"原因\"}`"兜底通道，避免自由文本污染解析器。

3. **Director 判决抖动**（连续 advance 导致旁白刷屏）：三重抑制——提示词内置克制原则（§5.2"连续两次倾向 continue"）；客户端硬规则"两次 narration 之间至少间隔 `everyNReplies` 条 agent 回复"（`repliesSinceLastEval` 在注入后同样清零）；`maxNarrations` 上限。三层中客户端硬规则是最终防线，不信任提示词自律。

4. **Director 评估的上下文窗口成本**：timeline 尾部 20 条对长对话可能不足以判断"停滞"。缓解：若滚动总结已产生（`pgAutoChatMaybeSummarize` 的产物），把最近一次总结文本作为"前情提要"前置注入判决输入——复用已有压缩成果，零额外成本。

5. **narrator 唤醒风暴**：一条旁白同时唤醒 N 个窗口，N 个模型并发回应同一事件，可能齐声复读。缓解：现有 `delaySeconds` 的随机化（base×[0.5,1.5]，:244-246）已天然错峰；文档建议开启 director 时设 `delaySeconds>=2`；后到窗口的视角重建（`pgAutoChatDoSend` :267-273 的未读复检）会看到先到者的回应，模型自会差异化。不做代码级串行化——那会引入新的调度器复杂度，收益不成比例。

6. **参数映射的争议性**：任何"性格→温度"公式都是启发式。缓解已内建：公式极简（三轴、线性、台阶化）、rationale 逐窗口可见、一键改回、`paramsOverridden` 保护用户改动不被重生成冲掉。公式本身放在 `pg-setup.js` 顶部的纯函数 `pgSetupMapAxesToParams(axes)`，便于后续调参与单测。

7. **localStorage 容量**：`ScenarioProfile` 含 N 张完整卡片 + N 份合成 prompt，估算 10–30KB，远低于 5MB 限额；但与既有 `tinyrouter.playground.v1`（含各窗口 messages）叠加需留意。缓解：scenario key 只存最近一份，`pgSaveScenario` 失败（QuotaExceeded）时 toast 提示改用导出文件，不静默丢失。

8. **与申请书改进点的交互备忘**：
   - 改进点 1（`pgAutoChatSendWithPerspective` 冗余形参）、2（`w.inbox` 弃用）：本特性不触碰，不顺手清理——保持改动集正交，降低回归面。
   - 改进点 3（重试无退避）：director/narrator fetch 失败采取"静默跳过本周期"（下个计数周期自然重来），**不复用** agent 的 1 次/3s 重试——旁白丢一拍无碍剧情，重试反而延长 `narratorPending` 对 `CheckAllDone` 的阻塞窗口。
   - 改进点 5（session 手工纪元）：director 的在途 fetch 全部挂 AbortController 且比对 capturedSession，等于在新代码中示范了改进点 5 建议的统一方式，未来若重构 autochat 可对齐。
   - 改进点 7（O(timeline) 视角重建）：narrator 分支不改变复杂度阶；narrator 条目数量受 `maxNarrations` 与间隔硬规则约束，对 timeline 长度贡献可忽略。

---

## 8. 验收场景（设计自检）

| 场景 | 预期行为 | 覆盖的需求点 |
|---|---|---|
| 零输入 + M3 + 2 窗口 | 一次调用产出 scenario + 2 卡片 → 客户端合成填入 → 建议种子消息预填 → 用户按 Enter 走路径 A 启动 | §1.1 完全自动、§1.5 |
| M1 逐阶段，用户在②后手改世界观 | ③④以改后文本为输入；⑤合成反映改动 | §1.2 可审阅微调 |
| 用户预填 3 个 agent 名 + M2 | 第一步 profiles 采用给定名；数量 = splitCount | §1.1 |
| 严谨角色 vs 疯批角色 | temp 0.25 vs 1.05，rationale 可见，手改后重生成不覆盖 | §1.6、开放问题 4 |
| director 开、对话陷入寒暄 | ≤2 个评估周期内判 advance → 旁白注入 → 全窗口被唤醒且回复计入各自 replyCount | §2.1、§2.2、§5.5 |
| 旁白注入瞬间用户点 Stop | `session++` 使 narrator 回调作废，无孤儿条目；`pgDirectorReset` abort 在途 fetch | §5.7、§9 停止机制兼容 |
| 所有窗口 idle 但剧情未收束 | `pgDirectorOnBeforeFinish` 终局判决 advance → 续一轮；再次 allDone 时 `finalChanceUsed` 保证正常 finish | §5.6 |
| 导出 → 清空 localStorage → 导入 | 全部窗口配置复原（model 除外）；version 校验通过 | §1.7、开放问题 6 |
| 导入 v2 档案到 v1 客户端 | 明确报错 toast，不静默降级 | 开放问题 6 |
| director 关闭 | autochat 行为与现状字节级一致（所有新调用点均守卫短路） | 最小侵入原则 |

---

## 9. 开放问题裁决索引（对照第二部分 §4）

| 开放问题 | 裁决位置 | 一句话结论 |
|---|---|---|
| 1. 统一 schema | §2 | `ScenarioProfile v1`，characters（素材）/agents（产物）分离 |
| 2. 监督提示词 | §5.2 | 判决型 JSON 输出，克制原则内置，方向指令与正文分离 |
| 3. 监督/旁白关系 | §5.1 | 职责与调用分离、模型可同可异；格式服从性与成本结构是分离依据 |
| 4. 性格→参数 | §4.2 | LLM 打分三轴 + 客户端确定性公式 + rationale + 覆盖保护 |
| 5. narrator 三影响 | §5.5 | 推游标、不碰迭代（结构性免疫）、入总结、以 pending 标志护终止 |
| 6. 版本兼容 | §2 末、§4.4 | schema+version 头、迁移链、高版本拒绝、字段只增不改义 |
| 7. 端点约束 | D8、§6 | 全部裸 fetch `/v1/chat/completions` 非流式，复用 :760 通路，pg-stream 零改动 |

---

## 10. 结语：设计的三条主线

1. **产物落入既有通路，而非开辟新通路**——setup 的一切最终收敛为 `w.config.*` 写入，此后 `pgAutoChatRenderPerspective`、`pgBuildBodyForWin`、侧边栏编辑全部"免费"复用；用户随时可手动接管，AI 生成只是"帮你把表单填好"。
2. **旁路写入者，而非第 N+1 个参与者**——director/narrator 不进入窗口流式状态机，只通过 timeline 唯一入口写入并触发既有广播；`replyCount` 免疫是结构性的而非防御性的，这是把"不占轮次"从需求约束变成架构性质。
3. **守卫式钩子的第三次复刻**——pg-stream→pg-autochat 的 4 钩子模式已被验证，本设计以同一惯例接入 6 个新钩子；director 关闭或模块缺失时，每个调用点单行短路，现有行为零漂移。这使特性可以分相位（先 A 后 B）独立交付与回滚。
