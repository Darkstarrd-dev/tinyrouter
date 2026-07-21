# 搜索引擎抓取 Raw Markdown 的结构化清洗与解析方案

下面给出一套面向 **AnySearch / Jina / 网页提取服务返回的原始 `searchRaw` 文本** 的工程化解决方案。

目标是在 `marked.parse()` 之前，将结构损坏、语法粘连、换行丢失的 Raw 文本恢复为尽可能合法、可读、可渲染的 Markdown。

---

## 一、结论先行

你们当前的问题本质不是“正则写得不够多”，而是处理模型错了。

继续用一堆 `.replace()` 打补丁会不可避免地陷入：

- 修好标题粘连，打破代码块；
- 修好表格，打破 YAML frontmatter；
- 修好列表，打破正文中的破折号；
- 修好代码块，打破内联 Markdown；
- 修好案例 A，打破案例 B。

更稳健的方案应该是：

> **先保护不可解析区域，再重建块边界，最后做局部结构化恢复。**

推荐采用如下五阶段管道：

```text
Raw Text
  ↓
1. 基础清洗
  - 统一换行
  - 清理控制字符
  - 处理全角空格
  - 可选解除 Markdown 转义
  ↓
2. Fence-First 代码块状态机
  - 优先识别 ``` / ~~~
  - 将代码块替换为占位符
  - 后续所有结构化处理都不碰代码内容
  ↓
3. 行边界重建
  - Heading 前插入块边界
  - List 前插入块边界
  - Blockquote 前插入块边界
  - Metadata Key 前插入块边界
  - HR / Frontmatter 边界处理
  ↓
4. 结构化恢复
  - GFM 表格恢复
  - 单行 pipe 元数据拆分
  - 标题与正文粘连切分
  - 过长标题降级，避免全屏巨型粗体
  ↓
5. 占位符恢复
  - 恢复 inline code
  - 恢复 fenced code block
  - 清理空行
  - 输出给 marked.parse()
```

这套方案可以显著减少对正则启发式的依赖，并且比当前纯补丁方案更稳定。

---

## 二、核心设计原则

### 1. 代码块最高优先级：Fence-First

Markdown 里最不能随意切分的区域是代码块。

因此必须在处理标题、表格、列表之前，先识别并隔离代码块。

例如：

```md
### Kotlin ``` val EXPECTED_FORMAT = ... ``` ### Java ``` final AudioFormat ...
```

应该先恢复为：

```md
### Kotlin

```kotlin
val EXPECTED_FORMAT = ...
```

### Java

```java
final AudioFormat ...
```
```

而不是让标题、代码、语言名、闭合 fence 全部粘在一行。

---

### 2. 用“边界插入”代替“内容替换”

不要试图一次性把错误文本替换成正确文本。

更稳的方式是：

> 在可能是块边界的位置插入换行。

例如：

```md
AnySearch — AI Search Infrastructure # AnySearch Skill
```

不要直接猜哪里是标题结束，而是先在满足条件的 `#` 前插入块边界：

```md
AnySearch — AI Search Infrastructure

# AnySearch Skill
```

然后再做标题安全切分。

---

### 3. 不要追求 100% 还原，要建立“安全降级”

抓取文本不是标准 Markdown，而是 DOM 扁平化后的残骸。

因此算法目标应该是：

1. 能恢复结构就恢复；
2. 不确定时不要制造更严重的视觉崩溃；
3. 长标题不确定时，降级为普通段落或加粗段落；
4. 表格不确定时，退化为列表或普通文本；
5. 代码块不确定时，至少保证闭合，避免满屏行内紫条。

---

### 4. 建立轻量级 Line Stream / Block State Machine

你们文档中问：

> 是否建议在 `marked.parse` 之前，先建立一个轻量级的纯文本 Line Stream 状态机？

答案是：**强烈建议。**

但不需要一开始就实现完整 CommonMark AST。

推荐先实现一个轻量块状态机：

```text
State:
  TEXT
  FENCED_CODE
  INLINE_CODE
  FRONTMATTER
  TABLE
  LIST
  HEADING
  BLOCKQUOTE
```

最小处理逻辑：

```text
scan raw text:
  if inside fenced code:
    collect until closing fence
    replace with CODE_PLACEHOLDER
  else:
    detect fence open
    detect inline code
    detect heading boundary
    detect list boundary
    detect table-like line
    detect metadata key
    insert line breaks
```

这比纯正则补丁更可控。

---

## 三、关键问题的解决方案

---

## 1. 如何建立通用的 Markdown AST 状态机或流式 tokenizer？

### 推荐模型

不要直接做完整 AST，而是做：

```text
Raw Text
  → Protected Text
  → Logical Lines
  → Block Fragments
  → Normalized Markdown
```

也就是：

```text
PreTokenizer
  ↓
BlockBoundaryRestorer
  ↓
LineBlockParser
  ↓
MarkdownEmitter
```

### 最小块模型

```js
type Block =
  | { type: 'paragraph', text: string }
  | { type: 'heading', level: number, text: string }
  | { type: 'code', lang: string, code: string }
  | { type: 'table', rows: string[][] }
  | { type: 'list', ordered: boolean, items: string[] }
  | { type: 'blockquote', text: string }
  | { type: 'hr' }
  | { type: 'frontmatter', lang: 'yaml', data: string };
```

### 状态机伪代码

```text
state = TEXT
buffer = []

for each char in rawText:
  if state == TEXT:
    if detectFenceOpen():
      flush paragraph
      state = FENCED_CODE
    else if detectHeadingBoundary():
      insert block break
    else if detectListBoundary():
      insert block break
    else:
      append char

  else if state == FENCED_CODE:
    collect code
    if detectFenceClose():
      emit code block placeholder
      state = TEXT
```

实际工程中，可以不用逐字符生成 AST，而是像下面一样：

1. 先用状态机保护代码块；
2. 再按行处理标题、表格、列表；
3. 最后恢复代码块。

这是无依赖浏览器 JS 中最实用的折中方案。

---

## 2. 如何稳健识别与隔离 Fenced Code Blocks？

### 核心策略

代码块识别必须满足：

1. **优先于所有其他块处理**；
2. **支持扁平化单行粘连**；
3. **支持开 fence 后没有换行**；
4. **支持闭合 fence 后直接跟正文或标题**；
5. **支持未闭合 fence 自动关闭**；
6. **尽量推断语言**；
7. **代码内容不参与后续结构化清洗**。

### 典型错误样本

```md
### Kotlin ``` val EXPECTED_FORMAT: AudioFormat = AudioFormat.Builder() .setEncoding(...) .build() fun startPlayback() { ... } ``` ### Java ``` final AudioFormat EXPECTED_FORMAT = new AudioFormat.Builder() ...
```

### 恢复目标

```md
### Kotlin

```kotlin
val EXPECTED_FORMAT: AudioFormat = AudioFormat.Builder()
  .setEncoding(...)
  .build()

fun startPlayback() {
  ...
}
```

### Java

```java
final AudioFormat EXPECTED_FORMAT = new AudioFormat.Builder()
  ...
```
```

### 关键算法

#### 1. 扫描连续反引号

```text
runLen >= 3 → 可能是 fence
```

#### 2. 开 fence 前如果粘着标题，保留标题

例如：

```md
### Kotlin ```
```

应拆成：

```md
### Kotlin

```kotlin
```

#### 3. 从标题尾词或 fence info 推断语言

例如：

```md
### Kotlin ``` val x = 1
```

可推断：

```md
```kotlin
val x = 1
```
```

#### 4. 闭合 fence 后强制块边界

例如：

```md
``` ### Java
```

应变成：

```md
```

### Java
```

#### 5. 未闭合 fence 自动关闭

避免后续整篇文本被 `marked` 当作代码或行内代码。

---

## 3. 单行 / 扁平化 GFM 表格如何恢复？

### 典型错误样本

```md
| Header | | --- | | Cell |
```

或：

```md
| a | b | | --- | --- | | c | d |
```

### 恢复目标

```md
| a | b |
| --- | --- |
| c | d |
```

### 推荐算法

不要简单用：

```js
text.replace(/\|\s*\|/g, '|\n|')
```

因为这会误伤合法空单元格。

更稳健的方式是：

```text
1. 按 | split 成 tokens
2. 去掉首尾空 token
3. 优先根据空 token 恢复行
4. 如果失败，则寻找 separator run
5. 根据 separator 列数 N 分组 cells
6. 输出标准 GFM table
```

### 示例

输入：

```md
| a | b | | --- | --- | | c | d |
```

Split：

```text
['', 'a', 'b', '', '---', '---', '', 'c', 'd', '']
```

空 token 作为行边界：

```text
row1: a, b
row2: ---, ---
row3: c, d
```

输出：

```md
| a | b |
| --- | --- |
| c | d |
```

如果没有空 token：

```md
| a | b | --- | --- | c | d |
```

则找到连续 separator：

```text
---, ---
```

列数：

```text
N = 2
```

然后：

```text
header: a, b
separator: ---, ---
data: c, d
```

输出：

```md
| a | b |
| --- | --- |
| c | d |
```

---

## 4. 标题吞噬正文如何处理？

### 典型错误样本

```md
# AnySearch Skill：跨 Agent 统一搜索引擎 skill 图片疑似AI生成，请注意甄别 阅读说明 这是一篇技术内容...
```

### 处理策略

标题切分不能完全依赖词数。

应组合使用以下信号：

1. 后面是否跟着块级标记；
2. 后面是否跟着元数据 Key；
3. 是否有括号标签；
4. 是否有引语；
5. 是否有句子终止符；
6. 是否明显过长；
7. 是否是中文标题后接中文正文；
8. 不确定时降级为普通段落。

### 安全降级策略

如果标题候选超过阈值：

```js
maxHeadingChars: 120
maxHeadingWords: 18
```

则不要渲染为 `<h1>` / `<h2>` / `<h3>`。

例如：

```md
# 一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的文本
```

应降级为：

```md
一个非常非常...的文本
```

或者：

```md
**一个非常非常...的文本**
```

这样可以避免全屏巨型粗体。

---

## 5. 列表粘连如何处理？

### 典型错误样本

```md
AnySearch is a search tool - It supports web search - It supports vertical search
```

### 处理策略

只在较可信的列表标记前插入换行：

```text
- Item
* Item
+ Item
1. Item
2) Item
```

并且要求后面大概率是列表项开头：

```text
大写字母
数字
中文
引号
粗体 **
链接 [
代码 `
```

避免误切：

```md
2024-01-01
A-B
C# 
issue #123
```

---

## 四、推荐实现：`normalizeRawMarkdown`

下面是一份无依赖、可在浏览器 ES6 环境运行的参考实现。

它可以作为你们 `pg-markdown.js` 的替代或增强版本。

---

### 完整代码

````js
// normalizeRawMarkdown.js
// ES6, no dependencies.

function normalizeRawMarkdown(src, options = {}) {
  const opts = Object.assign({
    maxHeadingChars: 120,
    maxHeadingWords: 18,
    demoteLongHeadings: true,
    splitPipeMetadata: true,
    prettyCodeLines: true,
    unescape: true
  }, options);

  if (!src) return '';

  const codeBlocks = [];
  const inlineBlocks = [];

  let text = String(src);

  // 1. Basic normalization
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(/\u0000/g, '');

  if (opts.unescape) {
    text = pgUnescapeMarkdownSyntax(text);
  }

  // NBSP -> normal space
  text = text.replace(/\u00a0/g, ' ');

  // Full-width spaces often indicate paragraph breaks in scraped Chinese text.
  text = text.replace(/[ \t]*\u3000{1,8}[ \t]*/g, '\n\n');

  // 2. Protect code first.
  text = extractFencedCode(text, codeBlocks);
  text = extractInlineCode(text, inlineBlocks);

  // 3. Normalize frontmatter before general HR handling.
  text = normalizeFrontmatter(text, codeBlocks);

  // 4. Restore block boundaries.
  text = insertBlockBreaks(text);

  // 5. Rebuild tables and pipe metadata.
  text = rebuildTablesAndPipeLines(text, opts);

  // 6. Split glued headings safely.
  text = splitGluedHeadings(text, opts);

  // 7. Cleanup.
  text = cleanupLines(text);

  // 8. Restore protected placeholders.
  text = restorePlaceholders(text, codeBlocks, inlineBlocks, opts);

  return text.trim();
}

function pgUnescapeMarkdownSyntax(text) {
  if (!text || text.indexOf('\\') < 0) return text;

  const P = '\u0000BS\u0000';

  return text
    .replace(/\\\\/g, P)
    .replace(/\\([`*_{}[\]()#+\-.!|~])/g, '$1')
    .replace(/\u0000BS\u0000/g, '\\');
}

function extractFencedCode(text, blocks) {
  const LANG_RE = /^(?:kotlin|java|python|py|javascript|js|typescript|ts|c\+\+|cpp|c#|cs|c|go|rust|html|css|json|yaml|yml|sql|bash|sh|shell|php|swift|ruby|xml|toml|ini|diff|text|md|markdown)\b/i;

  let out = '';
  let i = 0;

  let inFence = false;
  let fenceLen = 0;
  let lang = '';
  let code = '';

  while (i < text.length) {
    const ch = text[i];

    if (ch === '`') {
      let j = i;
      while (j < text.length && text[j] === '`') j++;

      const runLen = j - i;

      // Opening fence
      if (!inFence && runLen >= 3) {
        let inferredLang = '';

        // Try to infer language from a glued heading:
        // ### Kotlin ```
        const hm = out.match(/(?:^|\n)(#{1,6}\s+)([^\n]*?)\s*$/);
        if (hm) {
          const lm = hm[2].trim().match(/(^|\s)([A-Za-z0-9_+\-#]+)$/);
          if (lm && LANG_RE.test(lm[2])) {
            inferredLang = lm[2].toLowerCase();
          }
        }

        i = j;

        // Try to read fence info string:
        // ```js console.log(...)
        let infoLang = '';
        const im = text.slice(i).match(/^[ \t]*([A-Za-z0-9_+\-#]+)/);
        if (im && LANG_RE.test(im[1])) {
          infoLang = im[1].toLowerCase();
          i += im[0].length;
        }

        lang = infoLang || inferredLang || '';
        inFence = true;
        fenceLen = runLen;
        code = '';

        // Skip spaces/tabs after language, but keep newlines as code content.
        while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;

        continue;
      }

      // Possible closing fence
      if (inFence && runLen >= fenceLen) {
        let k = j;
        while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;

        const next = k < text.length ? text[k] : '';

        // If the next char looks like code continuation, keep it as code.
        // Otherwise treat this as closing fence.
        const likelyEmbeddedInCode = next && /[.,;:)\]}%]/.test(next);
        const looksLikeClosing = next === '' || next === '\n' || !likelyEmbeddedInCode;

        if (looksLikeClosing) {
          blocks.push({ lang: lang, code: code });
          out += '\n\n\u0000CODE' + (blocks.length - 1) + '\u0000\n\n';

          inFence = false;
          lang = '';
          code = '';
          i = k;

          continue;
        }

        code += text.slice(i, j);
        i = j;
        continue;
      }

      // Backticks inside code or normal text
      if (inFence) code += text.slice(i, j);
      else out += text.slice(i, j);

      i = j;
      continue;
    }

    if (inFence) code += ch;
    else out += ch;

    i++;
  }

  // Auto-close unclosed fence.
  if (inFence) {
    blocks.push({ lang: lang, code: code });
    out += '\n\n\u0000CODE' + (blocks.length - 1) + '\u0000\n\n';
  }

  return out;
}

function extractInlineCode(text, inlineBlocks) {
  return text.replace(/(`{1,2})(?!\s)([^`]*?)\1/g, function (m, ticks, code) {
    if (!code || !code.trim()) return m;

    inlineBlocks.push(code.trim());
    return '\u0000INLINE' + (inlineBlocks.length - 1) + '\u0000';
  });
}

function normalizeFrontmatter(text, codeBlocks) {
  const m = text.match(/^\s*---\s*([\s\S]*?)\s*---\s*(?:\n|$)/);
  if (!m) return text;

  const body = m[1];

  // Only treat as frontmatter if it looks like key:value metadata.
  if (!/:/.test(body) || body.length > 3000) return text;

  const yaml = body
    .replace(
      /\s+(?=(?:name|description|version|authors|credentials|required|storage|type|license|topics|created_at|source_url|source_type|stars_at_write|pair_article|pair_mechanism|cluster|round):)/gi,
      '\n'
    )
    .replace(/\s+(?=-\s)/g, '\n')
    .trim();

  codeBlocks.push({ lang: 'yaml', code: yaml });

  return text.replace(
    m[0],
    '\n\n\u0000CODE' + (codeBlocks.length - 1) + '\u0000\n\n'
  );
}

function insertBlockBreaks(text) {
  // "- # Heading" -> "# Heading"
  text = text.replace(/^[ \t]*[-*+][ \t]+(#{1,6}\s)/gm, '\n$1');

  // Break before ATX headings.
  // This avoids C# because previous char must be whitespace/start/punctuation.
  text = text.replace(/(^|[\s\)\]\}>])(#{1,6}\s)/g, function (m, p1, p2) {
    if (p1 === '\n') return m;
    return p1 + '\n\n' + p2;
  });

  // Break before unordered list items.
  text = text.replace(
    /(^|[\s\)\]\}>])([-*+]\s+)(?=[A-Z0-9\u4e00-\u9fa5"“”‘’'*\[])/g,
    '$1\n$2'
  );

  // Break before ordered list items.
  text = text.replace(
    /(^|[\s\)\]\}>])(\d{1,3}[.)]\s+)(?=[A-Z0-9\u4e00-\u9fa5"“”‘’'*\[])/g,
    '$1\n$2'
  );

  // Blockquotes.
  text = text.replace(/(^|[\s\)\]\}>])(>{1,}\s)/g, '$1\n$2');

  // Metadata-like keys.
  const keys = [
    'URL',
    'Source',
    'Published',
    'Language',
    'Author',
    'Repository',
    'Branch',
    'License',
    'Stars',
    'Topics',
    'created_at',
    'source_url',
    'source_type',
    'license',
    'stars_at_write',
    'pair_article',
    'pair_mechanism',
    'cluster',
    'round',
    'description',
    'version',
    'authors',
    'credentials',
    'required',
    'storage'
  ].join('|');

  text = text.replace(
    new RegExp('(^|[\\s\\)\\]\\}>])((?:' + keys + ')\\s*:)', 'gi'),
    '$1\n$2'
  );

  // Conservative horizontal rule separation.
  // Avoid pipes and placeholders.
  text = text.replace(
    /([^\n|`\u0000])\s+(-{3,})\s+([^\n|`\u0000])/g,
    '$1\n\n$2\n\n$3'
  );

  return text;
}

function rebuildTablesAndPipeLines(text, opts) {
  return text
    .split('\n')
    .map(function (line) {
      if (line.indexOf('\u0000') >= 0) return line;
      if (line.indexOf('|') < 0) return line;

      const table = tryRebuildTableLine(line);
      if (table) return table;

      if (opts.splitPipeMetadata) {
        const meta = trySplitPipeMetadata(line);
        if (meta) return meta;
      }

      return line;
    })
    .join('\n');
}

function tryRebuildTableLine(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;

  const pipeCount = (trimmed.match(/\|/g) || []).length;
  if (pipeCount < 2) return null;

  // Do not turn ordinary list items into tables.
  if (/^\s*[-*+]\s/.test(trimmed) && !/^\s*[-*+]\s+\|/.test(trimmed)) {
    return null;
  }

  const startsPipe = trimmed.startsWith('|');
  const endsPipe = trimmed.endsWith('|');

  let tokens = trimmed.split('|').map(function (s) {
    return s.trim();
  });

  if (startsPipe && tokens.length && tokens[0] === '') tokens.shift();
  if (endsPipe && tokens.length && tokens[tokens.length - 1] === '') tokens.pop();

  if (tokens.length < 2) return null;

  // First try row breaks encoded as empty cells:
  // | a | b | | --- | --- | | c | d |
  const rows = [];
  let cur = [];

  tokens.forEach(function (t) {
    if (t === '') {
      if (cur.length) {
        rows.push(cur);
        cur = [];
      }
    } else {
      cur.push(t);
    }
  });

  if (cur.length) rows.push(cur);

  const sepRowIndex = rows.findIndex(function (r) {
    return r.length > 0 && r.every(isSepCell);
  });

  if (rows.length >= 2 && sepRowIndex >= 0) {
    const n = rows[sepRowIndex].length;
    const normalized = rows.map(function (r) {
      return padRow(r, n);
    });

    return renderTable(normalized);
  }

  // Otherwise infer column count from a contiguous separator run:
  // | a | b | --- | --- | c | d |
  const sepRun = findSeparatorRun(tokens);

  if (sepRun && sepRun.length >= 1) {
    const n = sepRun.length;

    const before = tokens
      .slice(0, sepRun.start)
      .filter(function (t) {
        return t !== '';
      });

    const after = tokens
      .slice(sepRun.end)
      .filter(function (t) {
        return t !== '';
      });

    const header = before.length
      ? padRow(before.slice(-n), n)
      : new Array(n).fill('');

    const sep = new Array(n).fill('---');

    const data = chunk(after, n).map(function (r) {
      return padRow(r, n);
    });

    return renderTable([header, sep].concat(data));
  }

  return null;
}

function trySplitPipeMetadata(line) {
  const trimmed = line.trim();

  const separators = trimmed.match(/\s\|\s/g) || [];
  if (separators.length < 2) return null;

  const parts = trimmed
    .split(/\s\|\s/)
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);

  if (parts.length < 3 || parts.length > 10) return null;

  const metaish = parts.filter(function (p) {
    return (
      /:/.test(p) ||
      /^\d+\s/.test(p) ||
      /^(Python|JavaScript|TypeScript|Java|Go|Rust|C\+\+|Stars|License|Branch|Repository|Source|URL)/i.test(p)
    );
  }).length;

  if (metaish < 1) return null;

  return parts
    .map(function (p, idx) {
      if (idx === 0) return p;
      return /^[-*+]\s/.test(p) ? p : '- ' + p;
    })
    .join('\n');
}

function splitGluedHeadings(text, opts) {
  return text
    .split('\n')
    .map(function (line) {
      if (line.indexOf('\u0000') >= 0) return line;

      const m = line.match(/^(#{1,6})\s+(.*)$/);
      if (!m) return line;

      const level = m[1];

      const split = splitHeadingBody(m[2].trim());
      const parts = split.split('\n\n');

      const title = (parts[0] || '').trim();
      const body = parts.slice(1).join('\n\n').trim();

      if (!title) return body || '';

      // Safety fallback:
      // If heading is too long, it is probably glued paragraph text.
      if (opts.demoteLongHeadings && isTooLongHeading(title, opts)) {
        return body ? (title + '\n\n' + body) : title;
      }

      return level + ' ' + title + (body ? ('\n\n' + body) : '');
    })
    .join('\n');
}

function splitHeadingBody(rest) {
  const patterns = [
    // Strong block boundaries.
    // Intentionally excludes "-" to avoid cutting titles like "A - B".
    /^([^\n]+?)\s+(?=(?:\d{1,3}[.)]\s|>{1,}\s|#{1,6}\s|```|\|))/,

    // Metadata-like boundaries.
    /^([^\n]+?)\s+(?=(?:URL|Source|Published|Language|Author|Repository|Branch|License|Stars|Topics|created_at|source_url|source_type|license|stars_at_write|pair_article|pair_mechanism|cluster|round|description|version|authors|credentials|required|storage)\s*:)/i,

    // Title with parenthesized tag, then body.
    /^([^\n()]+\([^\)]+\))\s+(?=[A-Z0-9\u4e00-\u9fa5"“”‘'])/,

    // Title before quote.
    /^([^\n“”"'"]+?)\s+(?=[“”"'"])/,

    // Sentence-terminated title, then body.
    /^([^\n]+?[.!?。！？])\s+(?=[A-Z0-9\u4e00-\u9fa5"“”‘’'*\[])/
  ];

  for (let idx = 0; idx < patterns.length; idx++) {
    const m = rest.match(patterns[idx]);
    if (!m) continue;

    const candidate = m[1].trim();

    if (candidate.length < 2) continue;
    if (/^\d+[.)]$/.test(candidate)) continue;

    return candidate + '\n\n' + rest.slice(m[1].length).trim();
  }

  // Conservative CJK / long-text fallback.
  if (rest.length > 100) {
    const m = rest.match(/^([^\n]{8,90}?)\s+(?=[A-Z\u4e00-\u9fa5][^\n]{20,})/);

    if (m) {
      const candidate = m[1].trim();

      if (
        countWords(candidate) <= 12 &&
        !/[.!?,;:。、，；：]$/.test(candidate)
      ) {
        return candidate + '\n\n' + rest.slice(m[1].length).trim();
      }
    }
  }

  return rest;
}

function restorePlaceholders(text, codeBlocks, inlineBlocks, opts) {
  // Restore inline code first.
  text = text.replace(/\u0000INLINE(\d+)\u0000/g, function (m, idx) {
    const code = inlineBlocks[Number(idx)];
    return typeof code === 'string' ? ('`' + code + '`') : m;
  });

  // Restore fenced code blocks.
  text = text.replace(/\u0000CODE(\d+)\u0000/g, function (m, idx) {
    const block = codeBlocks[Number(idx)];
    if (!block) return m;

    let code = String(block.code || '')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (opts.prettyCodeLines) {
      code = prettyCodeLines(code);
    }

    return '\n```' + (block.lang || '') + '\n' + code + '\n```\n';
  });

  return text;
}

function prettyCodeLines(code) {
  return code
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\s+\.(?=[A-Za-z_$])/g, '\n.')
    .replace(/([}])\s+(?=[A-Za-z_$#])/g, '$1\n')
    .replace(
      /([)\]])\s+(?=(?:fun|def|function|public|private|protected|internal|val|var|final|const|let|if|for|while|return|class|import|package)\b)/g,
      '$1\n'
    )
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n');
}

function cleanupLines(text) {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

function isTooLongHeading(s, opts) {
  return s.length > opts.maxHeadingChars || countWords(s) > opts.maxHeadingWords;
}

function countWords(s) {
  return String(s)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isSepCell(s) {
  return /^:?-{1,}:?$/.test(String(s).trim());
}

function padRow(row, n) {
  const out = row.slice(0, n);

  while (out.length < n) {
    out.push('');
  }

  return out.map(function (c) {
    return String(c).trim();
  });
}

function chunk(arr, size) {
  const out = [];

  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }

  return out;
}

function findSeparatorRun(tokens) {
  let best = null;

  for (let i = 0; i < tokens.length; i++) {
    if (!isSepCell(tokens[i])) continue;

    let j = i;
    while (j < tokens.length && isSepCell(tokens[j])) j++;

    const run = {
      start: i,
      end: j,
      length: j - i
    };

    if (!best || run.length > best.length) {
      best = run;
    }

    i = j - 1;
  }

  return best;
}

function renderTable(rows) {
  if (!rows.length) return '';

  rows = rows.map(function (row) {
    return row.map(function (cell) {
      return String(cell).replace(/\|/g, '\\|');
    });
  });

  let sepIdx = rows.findIndex(function (r) {
    return r.length > 0 && r.every(isSepCell);
  });

  if (sepIdx === -1) {
    const sep = rows[0].map(function () {
      return '---';
    });

    rows = [rows[0], sep].concat(rows.slice(1));
  } else if (sepIdx !== 1) {
    const sep = rows[sepIdx];

    rows = [rows[0], sep]
      .concat(rows.slice(1, sepIdx))
      .concat(rows.slice(sepIdx + 1));
  }

  return rows
    .map(function (row) {
      return '| ' + row.join(' | ') + ' |';
    })
    .join('\n');
}
````

---

## 五、如何集成到 `marked.js`

你们当前使用 `marked.js` v12+，可以这样集成：

```js
const raw = searchRaw || '';

const normalized = normalizeRawMarkdown(raw, {
  maxHeadingChars: 120,
  maxHeadingWords: 18,
  demoteLongHeadings: true,
  splitPipeMetadata: true,
  prettyCodeLines: true,
  unescape: true
});

const html = marked.parse(normalized);

container.innerHTML = html;
```

如果你们有 Pretty / Raw 双视角：

```js
function renderPrettyView(searchRaw) {
  const normalized = normalizeRawMarkdown(searchRaw);
  return marked.parse(normalized);
}

function renderRawView(searchRaw) {
  return escapeHtml(searchRaw);
}
```

---

## 六、针对你们现有问题的修复效果

---

### 1. 标题吞噬正文

原始：

```md
# AnySearch Skill：跨 Agent 统一搜索引擎 skill 图片疑似AI生成，请注意甄别 阅读说明 这是一篇技术内容...
```

处理后倾向：

```md
# AnySearch Skill：跨 Agent 统一搜索引擎 skill

图片疑似AI生成，请注意甄别 阅读说明 这是一篇技术内容...
```

如果标题仍然过长，则降级为普通段落：

```md
AnySearch Skill：跨 Agent 统一搜索引擎 skill 图片疑似AI生成...
```

避免被 `marked` 渲染成全屏 `<h1>`。

---

### 2. 代码块糊成行内紫条

原始：

```md
### Kotlin ``` val EXPECTED_FORMAT: AudioFormat = AudioFormat.Builder() .setEncoding(AudioFormat.ENCODING_PCM_24BIT_PACKED) .build() ```
```

处理后：

```md
### Kotlin

```kotlin
val EXPECTED_FORMAT: AudioFormat = AudioFormat.Builder()
.setEncoding(AudioFormat.ENCODING_PCM_24BIT_PACKED)
.build()
```
```

如果开启 `prettyCodeLines`，还会进一步尝试恢复方法链换行。

---

### 3. GFM 表格单行串联失效

原始：

```md
| Header | | --- | | Cell |
```

处理后：

```md
| Header |
| --- |
| Cell |
```

原始：

```md
| a | b | | --- | --- | | c | d |
```

处理后：

```md
| a | b |
| --- | --- |
| c | d |
```

---

### 4. 元数据 pipe 串联

原始：

```md
Repository: anysearch-ai/anysearch-skill | Unified real-time search engine skill | 3K stars | Python - Branch: main
```

处理后：

```md
Repository: anysearch-ai/anysearch-skill
- Unified real-time search engine skill
- 3K stars
- Python - Branch: main
```

这比暴露一整行 pipe 更适合阅读。

---

### 5. `- #` 前导错乱

原始：

```md
- # File: anysearch-ai/anysearch-skill/SKILL.md
```

处理后：

```md
# File: anysearch-ai/anysearch-skill/SKILL.md
```

避免孤立列表圆点。

---

## 七、推荐配置参数

```js
normalizeRawMarkdown(raw, {
  // 超过该字符数的标题候选会被降级
  maxHeadingChars: 120,

  // 超过该词数的标题候选会被降级
  maxHeadingWords: 18,

  // 是否将过长标题降级为普通段落
  demoteLongHeadings: true,

  // 是否拆分非表格的 pipe metadata
  splitPipeMetadata: true,

  // 是否尝试美化代码块换行
  prettyCodeLines: true,

  // 是否解除 Markdown 转义
  // 如果代码内容中包含大量反斜杠，建议关闭
  unescape: true
});
```

如果你们的搜索结果中代码块非常重要，例如大量 GitHub README、SKILL.md、CLI 示例，建议：

```js
{
  unescape: false,
  prettyCodeLines: false
}
```

这样可以最大程度保留代码原貌。

如果主要是新闻、博客、中文内容，建议：

```js
{
  unescape: true,
  prettyCodeLines: true
}
```

---

## 八、为什么这个方案比当前正则补丁更稳？

你们当前实现的问题在于：

```js
text = text.replace(...)
text = text.replace(...)
text = text.replace(...)
```

这些 replace 之间没有隔离边界。

例如：

```md
--- name: anysearch description: ... ---
```

可能被 HR 正则误处理。

又如：

```md
| 3K stars | Python - Branch: main
```

可能被表格正则误处理。

而新方案的关键是：

```text
代码块先占位
Frontmatter 先占位
Inline code 先占位
后续只处理普通文本区域
```

这样能避免大量“顾此失彼”。

---

## 九、进一步优化建议

### 1. 建立 Golden Test Corpus

建议你们把真实 `searchRaw` 样本沉淀为测试集：

```text
/testcases/
  anysearch-001.json
  anysearch-002.json
  jina-001.json
  toutiao-001.json
  github-readme-001.json
```

每个样本包含：

```json
{
  "input": "raw search text",
  "expected": "normalized markdown"
}
```

然后每次修改清洗算法时跑 diff。

否则正则补丁会永远陷入回归问题。

---

### 2. 在 `marked` 渲染层增加防御

即使预处理失败，也不应该视觉崩溃。

建议自定义 `marked` renderer：

```js
const renderer = new marked.Renderer();

const originalHeading = renderer.heading.bind(renderer);

renderer.heading = function (text, level, raw, slugger) {
  const plain = String(text || '').replace(/<[^>]+>/g, '');

  if (plain.length > 160) {
    return `<p class="pg-fallback-heading"><strong>${text}</strong></p>`;
  }

  return originalHeading(text, level, raw, slugger);
};

marked.use({ renderer });
```

这样即使某个超长标题漏网，也不会变成全屏巨型粗体。

---

### 3. 如果允许依赖，升级到 AST 方案

如果你们未来可以接受依赖，推荐：

```text
unified
+ remark-parse
+ mdast-util-from-markdown
+ remark-gfm
+ remark-stringify
```

流程：

```text
Raw Text
  ↓
normalizeRawMarkdown
  ↓
remark parse
  ↓
mdast transform
  ↓
remark stringify
  ↓
marked.parse or rehype
```

这样可以获得真正的 Markdown AST。

但如果要求：

- 无依赖；
- 浏览器原生 JS；
- 轻量；
- 低延迟；
- 可嵌入 Vanilla JS；

那么上面给出的 `normalizeRawMarkdown` 是更现实的方案。

---

### 4. 后端最好保留基本换行

从根源上看，AnySearch / Jina / 网页提取服务最好返回：

```text
标题后保留换行
列表项保留换行
表格行保留换行
代码块保留换行
```

前端清洗只能补救，不能完美还原。

如果后端能返回“半结构化 Markdown”，前端稳定性会提升一个数量级。

---

## 十、最终建议

你们当前阶段最推荐的落地路径是：

```text
1. 用本文 normalizeRawMarkdown 替换现有 pgNormalizeSearchMarkdown
2. 保留 Raw 原文用于调试
3. 建立 20～50 个真实样本回归测试
4. 在 marked renderer 层增加超长标题降级
5. 对代码密集场景关闭 unescape 和 prettyCodeLines
6. 后续再考虑 remark / mdast AST 方案
```

一句话总结：

> 不要继续堆正则。  
> 应该采用 **Fence-First 状态机 + 占位符保护 + 行边界重建 + 表格/标题局部恢复 + 安全降级** 的结构化清洗管道。
