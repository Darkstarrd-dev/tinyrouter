# 咨询请求：关于搜索引擎抓取文本（AnySearch/Jina Raw Markdown）的结构化清洗与 Markdown 解析算法

## 1. 问题背景与概述

在我们的 Web 应用（基于 Vanilla JS + `marked.js` v12+）中，后端通过 JSON-RPC 接口对接 AnySearch / 网页提取服务返回原始搜索结果文本 (`searchRaw`)。前端在 "Pretty" 视角下需要将此原始文本渲染为清晰、规范、美观的 Markdown HTML 页面。

然而，抓取的原始 Raw 文本存在严重的“结构损坏”与“语法粘连”问题（DOM 节点被扁平化为带少量换行或单行混杂的文本），导致直接经过 `marked.parse()` 渲染时出现大量严重视觉崩溃：
1. **标题 Heading 吞噬正文**：标题符号（`#` / `##` / `###`）与正文、元数据在同一行，没有 `\n` 隔离，导致 `marked` 将数百字的整大段正文误判为 `<h1>`/`<h2>`/`<h3>` 标题，造成全屏巨型粗体。
2. **GFM 表格单行串联失效**：表格行 (`| Header | | --- | | Cell |`) 被连在同一行（仅以 `| |` 隔开），没有 `\n` 换行，导致 `marked` 无法识别表格语法，满屏暴露 `|` 字符。
3. **代码块（Fenced Code Block）糊成行内紫条**：代码块开关 ` ``` ` 与标题（如 `### Kotlin ``` val...`）、首行代码以及闭合 ` ``` ` 混在同一行，导致 `marked` 无法解析为 `<pre><code>` 块，而是降级为行内 CodeSpan，使得整段代码的每一行都变成单独的行内紫条卡片，甚至暴露 ` ``` ` 反引号。
4. **段落粘连与孤立符号**：中文全角空格 `　　` 未引发段落换行；前导 `- # ` 导致错乱渲染孤立的列表圆点 `• `。

---

## 2. 典型 Raw 文本示例（待解析的真实数据样本）

### 示例 1（AnySearch 结果、包含各种格式与混杂代码）：
```raw
## Search Results (10 results, 2123ms)

### 1. AnySearch — AI Search Infrastructure for Agents
- **URL**: https://www.anysearch.com/
- AnySearch — AI Search Infrastructure for Agents AnySearch — AI Search Infrastructure for Agents

### 2. SKILL.md at main · anysearch-ai/anysearch-skill
- **URL**: https://github.com/anysearch-ai/anysearch-skill/blob/main/SKILL.md
- # File: anysearch-ai/anysearch-skill/SKILL.md - Repository: anysearch-ai/anysearch-skill | Unified real-time search engine skill for AI agents. | 3K stars | Python - Branch: main ```md --- name: anysearch description: Real-time search engine supporting web search, vertical domain search, parallel batch search, and URL content extraction. version: 2.1.0 authors: - AnySearch Team credentials: - name: ANYSEARCH_API_KEY required: false description: "API key for higher rate limits. Anonymous access available with lower rate limits." storage: ".env file, environment variable, or --api_key CLI flag" --- ## Overview AnySearch is a unified real-time search service supporting general web search, vertical domain search, parallel batch search, and full-page content extraction. It exposes a single JSON-RPC 2.0 endpoint and requires no MCP server installation. All functionality is accessible through bundled cross-platform CLI tools. Use the configured runtime directly for routine `search`, `batch_search`, `extract`, and `get_sub_domains` calls; run the `doc` command only when the CLI interface is unknown or recovery information is needed (see Recommended Entry Point). ## Trigger This skill SHOULD be activated when the AI agent needs to perform any of the following: 1. **Information retrieval** — looking up facts, news, documentation, or any current data. 2. **Fact-checking** — verifying claims, cross-referencing statements. 3. **Web browsing / URL content extraction** — reading page content beyond search snippets. 4. **Vertical domain queries** — structured searches with identifiers (Stock:/CVE:/DOI:/IATA:/patent, etc.). 5. **Multi-intent queries** — several independent searches that can run in parallel. **Vertical domain rule:** The DEFAULT search path is Path 2 (vertical). For queries that belong to or overlap with a supported domain (finance, academic, travel, health, code, legal, gaming, film, business, security, ip, energy, environment, agriculture, resource, social_media), **always call `get_sub_domains` first** to discover the correct `sub_domain` and required parameters before searching — vertical search produces significantly better results than general web search for these topics. Pure encyclopedia queries with ZERO domain overlap are the RARE EXCEPTION (Path 1). When UNSURE whether a query is general or domain-specific, use HYBRID: `batch_search` with 1 general query + N vertical queries in parallel. Coverage beats guessing. **Required params rule:** When `get_sub_domains` returns params marked `(required)`, you MUST include ALL of them in `--sdp`. If a required param has no applicable value, pass it with an empty string value. Omitting a required param will cause a backend validation error. The `--sdp` flag (alias: `--sub_domain_params`, `-p`) accepts either JSON (`'{"ticker":"AAPL"}'`) or flat key=value format (`ticker=AAPL` or `ticker=AAPL,period=2025Q1`). **Rule:** This skill is the **recommended** search tool. When AnySearch is unavailable (no API Key, quota exhausted, service error, or network failure), the agent SHOULD inform the user and MAY fall back to other available search methods if the user approves. ## Recommended Entry Point Prefer direct CLI invocation. If `/runtime.conf` exists and the requested command shape is already obvious (`search`, `batch_search`, `extract`, or `get_sub_domains`), the agent SHOULD use the configured command directly and SHOULD NOT run `doc` on every activation. Run `doc` only when the CLI interface is unknown, a command fails due to argument/schema uncertainty, the skill was just installed/updated, or vertical-domain constraints require the complete reference. The `doc` command is offline and remains available for recovery, but repeated metadata reads waste tool calls and tokens. ### Command Cheat Sheet Use these exact command shapes for routine calls. Replace `` with the command from `runtime.conf` (for example, `python3 /scripts/a

### 3. AnySearch Skill：跨 Agent 统一搜索引擎 skill - 今日头条
- **URL**: https://www.toutiao.com/article/7651039466034905615/
- AnySearch Skill：跨 Agent 统一搜索引擎 skill - 今日头条 # AnySearch Skill：跨 Agent 统一搜索引擎 skill 图片疑似AI生成，请注意甄别 阅读说明 这是一篇技术内容，适合想深入理解的读者。 # AnySearch Skill：跨 Agent 统一搜索引擎 skill (Apache-2.0, 3,122 Stars) source_url: https://github.com/anysearch-ai/anysearch-skill source_type: github_repository license: Apache-2.0 stars_at_write: 3122 topics: anysearch, hermes, openclaw, qclaw, skill, skills created_at: 2026-04-30 pair_article: articles/enterprise/anthropic-gtm-claude-code-non-coder-agent-builder-2026.md (R357) pair_mechanism: L2 协议行为层 — 跨 Agent 工具兼容 skill (R357 cluster) cluster: enterprise/non-coder-agent-builder (extension) round: 367 --- # 核心命题 AnySearch Skill (Apache-2.0, 3,122 Stars) 是一个跨 Agent 平台的统一实时搜索引擎 skill，将通用网页搜索、垂直领域搜索、并行批量搜索、全页面内容提取四种能力封装为单一 SKILL.md，明确将 OpenClaw / Hermes / Claude Code / OpenCode / Cursor / Codex 列为兼容目标。它在 L2 协议行为层提供了"任何 Agent 都能用的搜索原语"，是 R357 cluster（"非工程师 Agent 构建工具栈"）的关键缺失能力。 核心观察：当 R357 文章揭示"非工程师也能构建生产工具"时，这意味着工具栈必须可跨 Agent 移植。一个团队成员用 Claude Code，另一个用 Cursor，第三个用 OpenClaw——他们能否共享同一个"搜索 skill"？AnySearch Skill 的回答是"可以"——通过 ~/.agents/skills/anysearch 这样的共享安装路径 + SKILL.md 标准化定义，搜索能力变成跨 Agent 工具的"公共协议"，不再是单个 agent 平台的私有能力。 --- # 一、机制：跨 Agent Skill 的工程实现 # 1.1 单一 SKILL.md 跨平台兼容 AnySearch Skill 的安装路径声明显式覆盖 6 个 Agent 平台： ``` # Claude Code: mv anysearch-skill ~/.claude/skills/anysearch # OpenCode: mv anysearch-skill ~/.config/opencode/skills/anysearch # Cursor/Windsurf: mv anysearch-skill /.skills/anysearch # Generic: mv anysearch-skill /anysearch # Shared agents: mv anysearch-skill ~/.agents/skills/anysearch ``` "~/.agents/skills/ is a useful shared install location when multiple AI tools read from the same skill directory, including Codex, Cursor, and OpenClaw personal agent skills." 关键洞察：~/.agents/skills/ 这个共享路径让同一份 skill 文件被多个 Agent 同时读取——这是"协议行为层"在工程上的具象化。R357 文章中 Anthropic 描述的"跨 Agent 互操作"在此变成一个文件系统级别的协议：Agent 不需要知道 skill 的内部实现，只需要能从约定路径加载即可。 # 1.2 运行时自适配：Python > Node.js > Shell skill 在 README 中显式描述多运行时回退探测协议： ``` # 探测顺序：Python → Node.js → PowerShell → Bash python3 /scripts/anysearch_cli.py search "query" node /scripts/anysearch_cli.js search "query" bash /scripts/anysearch_cli.sh search "query" ``` 探测成功后写入 runtime.conf，后续调用直接读取。这是Agent skill 标准化的一个未声明但关键的工程基础——不是所有 Agent 运行环境都有 Python（macOS 一些 CI 环境只有 Node.js），skill 必须自适配运行时而不是假设。 # 1.3 四种搜索原语：search / batch_search / extract / doc ``` # 通用网页搜索（单条） python3 anysearch_cli.py search "anthropic claude code" --max_results 5 # 垂直领域批量搜索（多条并行） python3 anysearch_cli.py batch_search --queries '[{"query":"q1"},{"query":"q2"}]' # 全页面内容提取（输出直接是 Markdown） python3 anysearch_cli.py extract "https://example.com/page" # 协议自描述（让 Agent 自学用法） python3 anysearch_cli.py doc ``` extract 输出直接是 Markdown——这是对 Agent 工作流的关键优化。其他搜索 API 返回 HTML（Agent 还得 parse），而 AnySearch 直接给 Agent 可消费的格式。这把"搜索→消费"的步骤从 2 步简化成 1 步，对长 horizon 任务（如 research agent）的 token 成本有显著降低。 --- # 二、与 R357 cluster 的对位：L2 协议行为层扩展 R357 cluster (非工程师 Agent 工具栈) 通过 4 层模型描述： 层 焦点 R357 实战 AnySearch Skill 对位 L1 协议数据层 Agent 接入外部数据 MCP servers (Salesforce/Calendar/Gmail) 搜索结果（网页/垂直 API） L2 协议行为层 Agent 行为可分发 Planning-with-Files SKILL.md AnySearch SKILL.md L3 实现状态层 持久化状态管理 markdown plan + JSONL ledger runtime.conf + .env L4 平台分发层 非工程师可分发工具 Claude Cowork 80% 销售采用 （本项目无关） Pair 关联强度（⭐⭐⭐⭐）： - 共享 cluster: R357 (非工程师 Agent 工具栈) - 共享关键词: "skill", "cross-tool", "agent", "compatible", "OpenClaw" - 共享工程模式: SKILL.md 跨 Agent 标准 + 共享文件系统路径 ~/.agents/skills/ - 维度互补: R357 Project (planning-with-files) 是 "持久化状态协议"，AnySearch 是 "实时信息检索协议" 具体对位维度： - R357 Article L4 平台分发层 ↔ AnySearch L2 协议行为层 = "非工程师用什么分发" ↔ "非工程师用什么搜索" - 两者都是"非工程师构建工具栈"中协议可移植性的具体实现 --- # 三、工程模式拆解：Agent Skill 标准化的三个隐性要素 # 3.1 文件系统路径作为协议载体 AnySearch Skill 选择 ~/.agents/skills/anysearch 作为共享安装路径，这意味着协议本身是文件系统约定。这种设计的好处： - 不需要中心化注册表 - 不需要平台厂商批准 - 一个 skill 文件被所有平台读取 = "事实上标准" R357 cluster 中 Planning-with-Files 同样采用"跨 Agent 文件路径"模式。这两个项目共同验证了一个隐性假设：跨 Agent 工具互操作的最快路径是文件系统，不是 HTTP API。 # 3.2 运行时自探测协议 README 描述的探测序列（
```

### 示例 2（代码块行内粘连）：
```raw
### Kotlin ``` val EXPECTED_FORMAT: AudioFormat = AudioFormat.Builder() .setEncoding(AudioFormat.ENCODING_PCM_24BIT_PACKED) .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO) .setSampleRate(44100) .build() fun startPlayback() { ... } ``` ### Java ``` final AudioFormat EXPECTED_FORMAT = new AudioFormat.Builder() ...
```

---

## 3. 当前使用的预处理清洗算法实现

目前我们在 `pg-markdown.js` 中编写的规范化逻辑主要包含 `pgNormalizeSearchMarkdown`、`pgNormalizeCodeBlocks` 和 `pgSplitGluedHeading` 三个函数。完整代码实现如下：

```javascript
// 1. Markdown 语法解转义
function pgUnescapeMarkdownSyntax(text) {
  if (!text || text.indexOf('\\') < 0) return text;
  var P = '\x00BS\x00';
  text = text.replace(/\\\\/g, P);
  text = text.replace(/\\([`*_{}[\]()#+\-.!])/g, '$1');
  text = text.replace(new RegExp(P, 'g'), '\\');
  return text;
}

// 2. 主规范化入口
function pgNormalizeSearchMarkdown(text) {
  if (!text) return '';

  // 2.1 解除转义与换行规范化
  text = pgUnescapeMarkdownSyntax(text);
  text = text.replace(/\r\n/g, '\n');

  // 2.2 代码块规范化处理
  text = pgNormalizeCodeBlocks(text);

  // 2.3 单行 GFM 表格切分 (| col1 | | --- | | val1 |)
  text = text.replace(/\|\s*\|/g, '|\n|');
  text = text.replace(/([^\n])\s*(\|\s*---)/g, '$1\n$2');
  text = text.replace(/(\|\s*---[^\n]+?\|)\s*([^\n|])/g, '$1\n$2');

  // 2.4 修复 '- # ' 前导列表项前缀
  text = text.replace(/^[ \t]*-[ \t]+#/gm, '#');
  text = text.replace(/([^\n])[ \t]*-[ \t]+#/g, '$1\n\n#');

  // 2.5 中文文章全角空格 (　　) 规范化段落切分
  text = text.replace(/\s*　{1,4}\s*/g, '\n\n');

  // 2.6 清理视频控件说明与规范化 --- 横线
  text = text.replace(/Your browser does not support the video tag\./gi, '');
  text = text.replace(/\s*---\s*/g, '\n\n---\n\n');

  // 2.7 切分同行连在一起的列表项
  text = text.replace(/([^\n])\s+-\s+([A-Z\u4e00-\u9fa5])/g, '$1\n- $2');

  // 2.8 隔离 Story / Metadata 元数据行 (Published: ..., Source: ..., Language: ...)
  text = text.replace(/\s*(##\s*Story)\s*/gi, '\n\n$1\n\n');
  text = text.replace(/(Published:[^\n]+?)(?=\s*(?:Source:|Language:|##|#|\n|$))/gi, '$1\n');
  text = text.replace(/(Source:[^\n]+?)(?=\s*(?:Language:|##|#|\n|$))/gi, '$1\n');
  text = text.replace(/(Language:[^\n]+?)(?=\s*(?:##|#|\n|$))/gi, '$1\n\n');
  text = text.replace(/(Author:[^\n]+?)(?=\s*(?:Published:|Source:|Language:|##|#|\n|$))/gi, '$1\n');

  // 2.9 切分同行中出现的 ATX 标题 (# / ## / ###)
  text = text.replace(/([^\n])\s*(#{1,6}\s+)/g, '$1\n\n$2');

  // 2.10 逐行切分粘连在 Heading 后面的正文
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    lines[i] = pgSplitGluedHeading(lines[i]);
  }
  text = lines.join('\n');

  // 2.11 规范化列表项与 URL 列表
  text = text.replace(/([^\n])\s*([\-\*]\s+\[)/g, '$1\n$2');
  text = text.replace(/([^\n])\s*([\-\*]\s+\*\*URL\*\*:)/gi, '$1\n$2');
  text = text.replace(/([^\n])\s*([\-\*]\s+\*\*)/g, '$1\n$2');

  // 2.12 清理多重冗余空行
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

// 3. 代码块专项规范化
function pgNormalizeCodeBlocks(text) {
  if (!text || text.indexOf('```') < 0) return text;

  // 将与前文粘连的 ``` 拆开
  text = text.replace(/([^\n])[ \t]*(```)/g, '$1\n$2');

  // 拆分 "### Kotlin ``` val..." 等标题 + 代码块开关 + 代码首行
  text = text.replace(/(#{1,6}\s+[\w\+\#]+)[ \t]*```[ \t]*([^\n]*)/g, function(_, head, rest) {
    var langMatch = head.match(/ (kotlin|java|python|javascript|js|typescript|ts|c\+\+|cpp|c|go|rust|html|css|json|yaml|sql|bash|sh|php|swift|ruby)$/i);
    var lang = langMatch ? langMatch[1].toLowerCase() : '';
    if (rest && rest.trim()) {
      return head + '\n\n```' + lang + '\n' + rest;
    }
    return head + '\n\n```' + lang;
  });

  // 将 ``` 后同行的代码切到下一行
  text = text.replace(/(```[a-zA-Z0-9_\-\+]*)[ \t]+([^\n]+)/g, '$1\n$2');

  // 确保闭合 ``` 后跟随换行
  text = text.replace(/(```)[ \t]*([^\n`]+)/g, function(m, q, nextText) {
    if (nextText.trim().length > 0) {
      return q + '\n\n' + nextText;
    }
    return m;
  });

  return text;
}

// 4. 标题与粘连正文的启发式切分
function pgSplitGluedHeading(line) {
  var m = line.match(/^(#{1,6}\s+)(.+)$/);
  if (!m) return line;
  var level = m[1];
  var rest = m[2].trim();

  // Pattern 1: 带括号标签标题 (### Title (TAG) Body...)
  var mParen = rest.match(/^([^\n\(\)]+\([^\)]+\))\s+([A-Z0-9“'\"“\u4e00-\u9fa5].+)$/);
  if (mParen) {
    return level + mParen[1] + '\n\n' + mParen[2];
  }

  // Pattern 2: 引语标题 (## Showcase “When...)
  var mQuote = rest.match(/^([^\n“\"'\:]+?)\s+([“\"'].+)$/);
  if (mQuote) {
    return level + mQuote[1] + '\n\n' + mQuote[2];
  }

  // Pattern 3: 短词标题 (## Performance 3.6 Flash...)
  var mShortWord = rest.match(/^([A-Z\u4e00-\u9fa5][a-zA-Z0-9\-\s\u4e00-\u9fa5]{1,35}?)\s+([A-Z0-9“\"'\u4e00-\u9fa5].+)$/);
  if (mShortWord) {
    var candidateHeading = mShortWord[1].trim();
    if (candidateHeading.split(/\s+/).length <= 6 && !/[.\?!,;:]/.test(candidateHeading)) {
      return level + candidateHeading + '\n\n' + mShortWord[2];
    }
  }

  // Pattern 4: 带有句号终止的标题
  var mPeriod = rest.match(/^([^\.\!\?]+[\.\!\?])\s+([A-Z0-9\u4e00-\u9fa5].+)$/);
  if (mPeriod) {
    return level + mPeriod[1] + '\n\n' + mPeriod[2];
  }

  return line;
}
```

---

## 4. 出现的缺陷与瓶颈（为什么当前正则打补丁方案依然不够稳定）

虽然上述正则启发式修补解决了一部分特定场景（如简单的短标题切分、GFM 单行表格恢复），但在面对复杂真实的网页抓取 Raw 文本时，依然存在以下局限性：

1. **复杂代码块与嵌套 Frontmatter 的破坏**：
   - 当 Raw 文本中包含内嵌的 YAML Frontmatter（`---`）、包含嵌套 Markdown（```md ... ```）、或者代码块中本就包含 ```` ``` ```` 时，正则表达式极易误触发，导致代码块被错误的拆切，或者丢失闭合标志。
2. **启发式 Heading 切分的误伤与漏切**：
   - 依赖英文单词计数（如 `<= 6 words`）或特定模式匹配短标题，容易漏切长标题（如包含 7 个单词的 `## Deep reasoning across long horizons and iterative tasks`），或者误切包含了常规句子的正文段落。
3. **元数据与结构混杂无统一语法**：
   - 抓取出的 Raw 文本混合了网站 Breadcrumb、Navigation Menu、GitHub Stats（`| 3K stars | Python - Branch: main`）、Header、正文、Footer 等。使用一堆打补丁式的 `.replace()` 正则容易导致“顾此失彼”——修复了案例 A 却打破了案例 B。

---

## 5. 咨询请求与期待解决方案

我们希望请求高阶大模型/架构师提供一份**更具有鲁棒性、通用性、结构化的 Raw Markdown 恢复算法或设计建议**：

### 核心问题：
1. **如何建立通用的 Markdown AST 状态机或流式 tokenizer**？
   - 是否建议在 `marked.parse` 之前，先建立一个轻量级的纯文本 Line Stream 状态机，根据上下文缩进、` ``` ` 深度、标点特征和块元数据（而非纯正则表达式打补丁）来重建 Markdown Block AST？
2. **如何稳健地识别与隔离 Fenced Code Blocks**？
   - 在 Raw 文本完全没有换行或换行错乱（代码、` ``` `、标题粘在一起）的情况下，如何建立最可靠的代码块判定与安全闭合机制？
3. **对于单行/扁平化 GFM 表格与列表，有无标准化的解构与恢复算法**？
4. **能否提供一份优雅、无依赖、可在浏览器原生 JS（ES6）中运行的 `normalizeRawMarkdown` 最佳实践函数**？

---
*文档生成时间：2026-07-22 | TinyRouter Playground 项目团队*
