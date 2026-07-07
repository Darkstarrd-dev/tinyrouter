// =====================================================================
// Playground — interactive chat testing UI.
// Talks directly to /v1/chat/completions (OpenAI-compatible SSE passthrough).
// Config + parameterEnabled + messages persist to localStorage (v2 schema).
// Features: parameterEnabled toggles, seed, image_url multimodal, role
// toggle (user/assistant/system), system prompt, reasoning duration,
// sources rendering, show-source/preview, HTML iframe preview, mermaid,
// message timing, error retry/edit-prompt actions, v2 localStorage.
// Multi-window: split panes (1-4), each with independent conversation.
// =====================================================================

// ----- Module 1: State management -----------------------------------
// localStorage v2 schema (hard cut from v1; v1 data is ignored entirely).
var PG_CFG_KEY = 'tinyrouter.playground.cfg.v2';
var PG_MSG_KEY = 'tinyrouter.playground.msg.v2';
var PG_PARAM_KEY = 'tinyrouter.playground.params.v2';

var PG_DEFAULT_CFG = {
  model: '',
  temperature: 0.8,
  topP: 1,
  maxTokens: 0,          // 0 = inherit/unset
  frequencyPenalty: 0,
  presencePenalty: 0,
  seed: '',              // empty string = null (not sent)
  stream: true,
  useCustomBody: false,
  customBody: '',
  // Multimodal
  imageEnabled: false,
  imageUrls: [],
  // System prompt (sent as first message when non-empty)
  systemPrompt: '',
};

// parameterEnabled mirrors new-api defaults: max_tokens + seed off.
var PG_DEFAULT_PARAMS = {
  temperature: true,
  topP: true,
  maxTokens: false,
  frequencyPenalty: true,
  presencePenalty: true,
  seed: false,
};

var PG_ICON_COPY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
var PG_ICON_SRC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
var PG_ICON_REGEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
var PG_ICON_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
var PG_ICON_DELETE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>';
var PG_ICON_RETRY = PG_ICON_REGEN;
var PG_ICON_ROLE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><path d="M20 8v6M23 11h-6"></path></svg>';

// =====================================================================
// Adapter contract — 宿主可以注入 PG_HOST 来覆盖默认全局函数。
// 不注入时, fallback 到现有全局 (apiGet/toast/pgEscapeHtml/copyToClipboard/t),
// 保持 TinyRouter 宿主原行为不变; 外部宿主可通过 window.PG_HOST = {...}
// 替换为自身实现, 实现模块的零侵入移植。
// =====================================================================
var PG_HOST = (typeof window !== 'undefined' && window.PG_HOST) ? window.PG_HOST : null;
function pgApiGet(p)         { return PG_HOST && PG_HOST.apiGet ? PG_HOST.apiGet(p) : apiGet(p); }
function pgToast(m, ty)      { return PG_HOST && PG_HOST.toast ? PG_HOST.toast(m, ty) : toast(m, ty); }
function pgEscapeHtml(s)     { return PG_HOST && PG_HOST.escapeHtml ? PG_HOST.escapeHtml(s) : escapeHtml(s); }
function pgCopyToClipboard(tx, lb) { return PG_HOST && PG_HOST.copyToClipboard ? PG_HOST.copyToClipboard(tx, lb) : copyToClipboard(tx, lb); }
function pgT(k, ar) {
  if (PG_HOST && PG_HOST.t) return PG_HOST.t(k, ar);
  if (typeof window !== 'undefined' && window.PG_I18N) {
    var lang = document.documentElement.getAttribute('data-lang') || (localStorage && localStorage.getItem('lang')) || 'en';
    var dict = window.PG_I18N[lang] || window.PG_I18N['en'] || {};
    var s = dict[k];
    if (s != null) {
      if (ar && ar.length) {
        return s.replace(/\{(\d+)\}/g, function(_, i) { return ar[+i] != null ? ar[+i] : ''; });
      }
      return s;
    }
  }
  if (typeof t === 'function') return t(k, ar);
  return k;
}

// Storage limits (mirrors new-api storage.ts constraints)
var PG_MAX_MSGS = 100;
var PG_MAX_MSGS_BYTES = 1024 * 1024;       // 1MB raw string cap
var PG_MAX_MSG_CHARS = 40000;              // single message content cap
var PG_MAX_MSGS_CHARS = 120000;            // total loaded content cap

function makeWin() {
  return {
    config: JSON.parse(JSON.stringify(PG_DEFAULT_CFG)),
    parameterEnabled: JSON.parse(JSON.stringify(PG_DEFAULT_PARAMS)),
    messages: [],
    streaming: false,
    abortCtrl: null,
    sseEvents: [],
    lastProvider: '',
    lastKey: '',
    debugTab: 'preview',
    debugRequest: '',
    debugPreview: '',
    debugResponse: '',
    debugTimestamp: null,
    debugPreviewTimestamp: null,
    renderTimer: null,
    pendingContent: '',
    pendingReasoning: '',
    pendingSources: [],
    reasoningStartedAt: null,
    reasoningCompletedAt: null,
  };
}

var pgState = {
  winInit: false,
  splitCount: 1,
  activeWin: 0,
  windows: [],
  models: [],
};

function pgWin() { return pgState.windows[pgState.activeWin]; }
function pgWinAt(i) { return pgState.windows[i]; }

function pgLoad() {
  if (!pgState.windows.length) pgState.windows.push(makeWin());
  var w = pgState.windows[0];
  try {
    var rawCfg = localStorage.getItem(PG_CFG_KEY);
    if (rawCfg) {
      var savedCfg = JSON.parse(rawCfg);
      if (savedCfg) {
        Object.keys(PG_DEFAULT_CFG).forEach(function(k) {
          if (savedCfg[k] !== undefined) w.config[k] = savedCfg[k];
        });
      }
    }
  } catch (e) { /* corrupt storage */ }
  try {
    var rawParams = localStorage.getItem(PG_PARAM_KEY);
    if (rawParams) {
      var savedParams = JSON.parse(rawParams);
      if (savedParams) {
        Object.keys(PG_DEFAULT_PARAMS).forEach(function(k) {
          if (savedParams[k] !== undefined) w.parameterEnabled[k] = savedParams[k];
        });
      }
    }
  } catch (e) { /* corrupt storage */ }
  try {
    var rawMsgs = localStorage.getItem(PG_MSG_KEY);
    if (rawMsgs) {
      if (rawMsgs.length > PG_MAX_MSGS_BYTES) {
        localStorage.removeItem(PG_MSG_KEY);
      } else {
        var msgs = JSON.parse(rawMsgs);
        if (Array.isArray(msgs)) {
          if (msgs.length > PG_MAX_MSGS) msgs = msgs.slice(-PG_MAX_MSGS);
          var totalSize = 0;
          var trimmedBySize = [];
          for (var mi = msgs.length - 1; mi >= 0; mi--) {
            var mc = pgTextContent(msgs[mi].content || '').length
                   + ((msgs[mi].reasoning || '').length);
            if (trimmedBySize.length > 0 && totalSize + mc > PG_MAX_MSGS_CHARS) break;
            totalSize += mc;
            trimmedBySize.unshift(msgs[mi]);
          }
          trimmedBySize = trimmedBySize.map(function(m) {
            var copy = Object.assign({}, m);
            if (typeof copy.content === 'string' && copy.content.length > PG_MAX_MSG_CHARS) {
              copy.content = copy.content.slice(0, PG_MAX_MSG_CHARS) + '\n\n[...]';
            }
            if (copy.reasoning && copy.reasoning.length > PG_MAX_MSG_CHARS) {
              copy.reasoning = copy.reasoning.slice(0, PG_MAX_MSG_CHARS) + '\n\n[...]';
            }
            return pgNormalizeLoadedMessage(copy);
          });
          w.messages = trimmedBySize;
        }
      }
    }
  } catch (e) { /* corrupt storage */ }
}

function pgEnsureWindows() {
  if (pgState.winInit) return;
  if (!pgState.windows.length) pgState.windows.push(makeWin());
  for (var k = 1; k < 4; k++) {
    var clone = JSON.parse(JSON.stringify(pgState.windows[0]));
    clone.messages = [];
    clone.streaming = false; clone.abortCtrl = null; clone.renderTimer = null;
    clone.pendingContent = ''; clone.pendingReasoning = ''; clone.pendingSources = [];
    clone.reasoningStartedAt = null; clone.reasoningCompletedAt = null;
    clone.sseEvents = []; clone.lastProvider = ''; clone.lastKey = '';
    clone.debugTab = 'preview'; clone.debugRequest = ''; clone.debugResponse = '';
    clone.debugTimestamp = null; clone.debugPreview = ''; clone.debugPreviewTimestamp = null;
    pgState.windows.push(clone);
  }
  pgState.winInit = true;
}

var pgSaveTimer = null;
function pgSave() {
  if (pgSaveTimer) clearTimeout(pgSaveTimer);
  pgSaveTimer = setTimeout(function() {
    var w = pgState.windows[0];
    try { localStorage.setItem(PG_CFG_KEY, JSON.stringify(w.config)); } catch (e) {}
    try { localStorage.setItem(PG_PARAM_KEY, JSON.stringify(w.parameterEnabled)); } catch (e) {}
    try {
      var trimmed = w.messages;
      if (trimmed.length > PG_MAX_MSGS) trimmed = trimmed.slice(-PG_MAX_MSGS);
      localStorage.setItem(PG_MSG_KEY, JSON.stringify(trimmed));
    } catch (e) {}
  }, 500);
}

// ----- Module 2: Model list ---------------------------------------
function pgLoadModels() {
  return pgApiGet('/models').then(function(res) {
    pgState.models = (res && res.models) ? res.models : [];
  }).catch(function() {
    pgState.models = [];
  });
}

// ----- Module 3: Markdown rendering pipeline ----------------------
var pgMarkerReady = false;
function pgInitMarker() {
  if (pgMarkerReady) return;
  if (typeof marked === 'undefined') return;
  if (typeof markedKatex !== 'undefined') {
    try { marked.use(markedKatex({ throwOnError: false, nonStandard: true })); } catch (e) {}
  }
  pgMarkerReady = true;
}

// DOMPurify config that allows KaTeX output (SVG/MathML + presentation attrs).
var PG_PURIFY_CONFIG = (function() {
  var mathTags = ['math','semantics','annotation','annotation-xml','mrow','mi','mo','mn',
    'msup','msub','msubsup','mfrac','mtable','mtr','mtd','mtext','mspace','menclose',
    'mstyle','merror','msqrt','mroot','mfenced','mover','munder','munderover','mpadded',
    'mphantom','maligngroup','malignmark','maction','mfrac','mlongdiv','mscarries','mscarry',
    'msgroup','mstack','msline','msrow'];
  var mathAttrs = ['aria-hidden','class','style','encoding','stretchy','fence','separator',
    'movablelimits','symmetric','maxsize','minsize','largeop','scriptlevel','displaystyle',
    'columnalign','rowalign','columnspacing','rowspacing','columnlines','rowlines','frame',
    'framespacing','mathbackground','mathcolor','notation','lspace','rspace','depth','height',
    'width','voffset','role','crossout','location','form','linethickness','accent',
    'accentunder','align','stackalign','link','href','stretchy','symmetric','lquote',
    'rquote','xlink:href','xref','columnspan','rowspan','bevelled','close','open','separators',
    'selection','side','decimalpoint','shift','position','href','target','d','viewBox',
    'preserveAspectRatio','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin',
    'transform','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','xlink:title','xmlns',
    'xmlns:xlink','textContent','mathvariant'];
  return {
    ADD_TAGS: mathTags.concat(['svg','g','path','line','rect','circle','ellipse','polygon',
      'polyline','defs','use','clippath','clipPath','text','tspan','title','desc','symbol','marker','foreignobject','use']),
    ADD_ATTR: mathAttrs,
  };
})();

function pgEscapeBrackets(text) {
  var pattern = /(```[\s\S]*?```|`[^`]*`)|\\\[([\s\S]*?[^\\])\\\]|\\\((.*?)\\\)/g;
  return text.replace(pattern, function(m, code, sq, rd) {
    if (code) return code;
    if (sq !== undefined) return '$$' + sq + '$$';
    if (rd !== undefined) return '$' + rd + '$';
    return m;
  });
}

function pgNormalizeDisplayMath(text) {
  var parts = [];
  var last = 0;
  var fence = /```[\s\S]*?```/g;
  var m;
  while ((m = fence.exec(text)) !== null) {
    var chunk = text.slice(last, m.index);
    parts.push(pgNormalizeInChunk(chunk));
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(pgNormalizeInChunk(text.slice(last)));
  return parts.join('');
}
function pgNormalizeInChunk(chunk) {
  chunk = chunk.replace(/\$\$([^\n$]+?)\$\$/g, function(_, inner) {
    return '\n$$\n' + inner.trim() + '\n$$\n';
  });
  chunk = chunk.replace(/\$\$(?!\n)([\s\S]*?)\$\$/g, function(_, inner) {
    return '\n$$\n' + inner.trim() + '\n$$\n';
  });
  return chunk;
}

function pgTryWrapHtmlCode(text) {
  if (text.indexOf('```') >= 0) return text;
  text = text.replace(/([`]*?)(\w*?)([\n\r]*?)(<!DOCTYPE html>)/g, function(m, qs, lang, nl, dt) {
    return qs ? m : '\n```html\n' + dt;
  });
  text = text.replace(/(<\/body>)([\r\n\s]*?)(<\/html>)([\n\r]*)([`]*)([\n\r]*?)/g, function(m, b, sp, h, nl, qe, nl2) {
    return qe ? m : b + sp + h + '\n```\n';
  });
  return text;
}

function pgRenderMarkdown(text, isUser) {
  if (!text) return '';
  if (typeof marked !== 'undefined') {
    pgInitMarker();
    try {
      var pre = pgTryWrapHtmlCode(text);
      pre = pgEscapeBrackets(pre);
      pre = pgNormalizeDisplayMath(pre);
      var html = marked.parse(pre, { breaks: true, gfm: true });
      if (typeof DOMPurify !== 'undefined') {
        html = DOMPurify.sanitize(html, PG_PURIFY_CONFIG);
      }
      return html;
    } catch (e) { /* fall through to escaping */ }
  }
  return '<p>' + pgEscapeHtml(text).replace(/\n/g, '<br>') + '</p>';
}

function pgHighlight(container) {
  if (typeof hljs === 'undefined') return;
  container.querySelectorAll('pre code').forEach(function(block) {
    if (block.dataset.pgHl === '1') return;
    block.dataset.pgHl = '1';
    try { hljs.highlightElement(block); } catch (e) {}
  });
}

var PG_THINK_OPEN = String.fromCharCode(60) + 'think' + String.fromCharCode(62);
var PG_THINK_CLOSE = String.fromCharCode(60) + '/think' + String.fromCharCode(62);
var PG_THINK_RE = new RegExp('^\\s*' + PG_THINK_OPEN.replace(/([<\/ ])/g, '\\$1') + '([\\s\\S]*?)' + PG_THINK_CLOSE.replace(/([<\/ ])/g, '\\$1'));
var PG_THINK_ALL_RE = new RegExp(PG_THINK_OPEN.replace(/([<\/ ])/g, '\\$1') + '([\\s\\S]*?)' + PG_THINK_CLOSE.replace(/([<\/ ])/g, '\\$1'), 'g');

function pgSplitReasoning(text) {
  var reasoning = '';
  var m = text.match(PG_THINK_RE);
  if (m) {
    reasoning = m[1];
    text = text.slice(m[0].length);
  } else if (text.indexOf(PG_THINK_OPEN) === 0) {
    reasoning = text.slice(PG_THINK_OPEN.length);
    text = '';
  }
  return { content: text, reasoning: reasoning };
}

function pgExtractAllReasoning(text) {
  if (text.indexOf(PG_THINK_OPEN) < 0) return { content: text, reasoning: '' };
  var reasoningParts = [];
  text = text.replace(PG_THINK_ALL_RE, function(_, inner) {
    reasoningParts.push(inner);
    return '';
  });
  var openIdx = text.indexOf(PG_THINK_OPEN);
  if (openIdx >= 0) {
    reasoningParts.push(text.slice(openIdx + PG_THINK_OPEN.length));
    text = text.slice(0, openIdx);
  }
  return { content: text.trim(), reasoning: reasoningParts.join('\n').trim() };
}

// ----- Module 4: Content helpers (text / images) ------------------
function pgTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(function(p) { return p.type === 'text'; })
      .map(function(p) { return p.text || ''; }).join('');
  }
  return '';
}

function pgImageParts(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(function(p) { return p.type === 'image_url' && p.image_url && p.image_url.url; });
}

// ----- Module 5: SSE streaming request -----------------------------
function pgParseSSELine(line) {
  if (!line || line.indexOf('data:') !== 0) return null;
  var payload = line.slice(5).trim();
  if (payload === '[DONE]') return { done: true };
  try { return JSON.parse(payload); } catch (e) { return null; }
}

function pgMergeChunk(current, next) {
  if (!current || !next || next.indexOf(current) !== 0) {
    return (current || '') + (next || '');
  }
  return next;
}

function pgParseErrorDetails(text) {
  if (!text) return { errorMessage: 'Request error occurred', errorCode: null };
  try {
    var parsed = JSON.parse(text);
    if (parsed && parsed.error) {
      return { errorMessage: parsed.error.message || text, errorCode: parsed.error.code || null };
    }
    if (parsed && parsed.message) {
      return { errorMessage: parsed.message, errorCode: parsed.error_code || null };
    }
  } catch (e) { /* not JSON */ }
  return { errorMessage: text, errorCode: null };
}

function pgBuildBodyForWin(i) {
  var w = pgWinAt(i);
  if (w.config.useCustomBody && w.config.customBody) {
    try { return JSON.parse(w.config.customBody); } catch (e) {
      throw new Error('Invalid custom body JSON');
    }
  }
  var en = w.parameterEnabled;
  var cfg = w.config;
  var messages = w.messages
    .filter(function(m) {
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') return false;
      if (m.role === 'assistant' && m.error) return false;
      if (m.role === 'assistant' && m.status === 'loading') return false;
      return true;
    })
    .map(function(m) {
      return { role: m.role, content: m.content };
    });
  var body = {
    model: cfg.model,
    messages: messages,
    stream: cfg.stream,
  };
  if (en.temperature) body.temperature = cfg.temperature;
  if (en.topP) body.top_p = cfg.topP;
  if (en.maxTokens && cfg.maxTokens > 0) body.max_tokens = cfg.maxTokens;
  if (en.frequencyPenalty) body.frequency_penalty = cfg.frequencyPenalty;
  if (en.presencePenalty) body.presence_penalty = cfg.presencePenalty;
  if (en.seed && cfg.seed !== '' && cfg.seed !== null) {
    var seedNum = Number(cfg.seed);
    body.seed = isNaN(seedNum) ? cfg.seed : seedNum;
  }
  return body;
}

function pgBuildBody() {
  return pgBuildBodyForWin(pgState.activeWin);
}

function pgFinalizeBodyForSend(body, lastUserMessage, i) {
  var w = pgWinAt(i);
  if (w.config.systemPrompt && w.config.systemPrompt.trim()) {
    var hasSystem = (body.messages || []).some(function(m) { return m.role === 'system'; });
    if (!hasSystem) {
      body.messages = [{ role: 'system', content: w.config.systemPrompt }].concat(body.messages);
    }
  }
  if (w.config.imageEnabled && Array.isArray(w.config.imageUrls)) {
    var urls = w.config.imageUrls.filter(function(u) { return u && u.trim(); });
    if (urls.length > 0 && lastUserMessage) {
      var text = (typeof lastUserMessage.content === 'string')
        ? lastUserMessage.content
        : pgTextContent(lastUserMessage.content);
      var parts = [];
      if (text) parts.push({ type: 'text', text: text });
      urls.forEach(function(u) {
        parts.push({ type: 'image_url', image_url: { url: u } });
      });
      lastUserMessage.content = parts;
    }
  }
  return body;
}

function pgSend(i, assistantIdx) {
  var w = pgWinAt(i);
  var body;
  try { body = pgBuildBodyForWin(i); } catch (e) {
    pgToast(e.message, 'error'); return;
  }
  w.sseEvents = [];
  w.lastProvider = '';
  w.lastKey = '';
  w.pendingContent = '';
  w.pendingReasoning = '';
  w.pendingSources = [];
  w.reasoningStartedAt = null;
  w.reasoningCompletedAt = null;

  var lastUser = null;
  for (var j = body.messages.length - 1; j >= 0; j--) {
    if (body.messages[j].role === 'user') { lastUser = body.messages[j]; break; }
  }
  body = pgFinalizeBodyForSend(body, lastUser, i);
  w.debugRequest = JSON.stringify(body, null, 2);
  w.debugResponse = '';
  w.debugTimestamp = new Date().toISOString();

  if (w.config.stream) {
    pgStream(i, body, assistantIdx);
  } else {
    pgSendNonStream(i, body, assistantIdx);
  }
}

function pgStream(i, body, assistantIdx) {
  var w = pgWinAt(i);
  w.streaming = true;
  w.abortCtrl = new AbortController();
  pgUpdateInputBar();

  fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify(body),
    signal: w.abortCtrl.signal,
  }).then(function(resp) {
    w.lastProvider = resp.headers.get('X-TinyRouter-Provider') || '';
    w.lastKey = resp.headers.get('X-TinyRouter-Key') || '';
    if (!resp.ok || !resp.body) {
      resp.text().then(function(text) {
        var details = pgParseErrorDetails(text);
        pgFail(i, assistantIdx, details.errorMessage || ('HTTP ' + resp.status), details.errorCode);
      }).catch(function() {
        pgFail(i, assistantIdx, 'HTTP ' + resp.status);
      });
      return Promise.reject(new Error('HTTP ' + resp.status));
    }
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function pump() {
      return reader.read().then(function(chunk) {
        if (chunk.done) {
          pgFinish(i, assistantIdx);
          var w2 = pgWinAt(i);
          w2.streaming = false;
          pgUpdateInputBar();
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var events = buffer.split('\n');
        buffer = events.pop();
        for (var j = 0; j < events.length; j++) {
          var line = events[j].trim();
          if (!line) continue;
          if (line.indexOf('data:') === 0) {
            var w3 = pgWinAt(i);
            w3.sseEvents.push(line);
          }
          var data = pgParseSSELine(line);
          if (!data) continue;
          if (data.done) {
            pgFinish(i, assistantIdx);
            var w4 = pgWinAt(i);
            w4.streaming = false;
            pgUpdateInputBar();
            return;
          }
          pgApplyChunk(i, data, assistantIdx);
        }
        pgFlushRender(i, assistantIdx);
        return pump();
      });
    }
    return pump();
  }).catch(function(err) {
    if (err && err.name === 'AbortError') {
      pgFinish(i, assistantIdx);
    } else {
      var w5 = pgWinAt(i);
      if (w5.streaming) {
        pgFail(i, assistantIdx, err && err.message ? err.message : String(err));
      } else {
        pgUpdateInputBar();
      }
    }
  });
}

function pgApplyChunk(i, data, assistantIdx) {
  var w = pgWinAt(i);
  var choices = data.choices;
  if (!choices || !choices.length) {
    pgApplySourcesFromObject(i, data);
    return;
  }
  var delta = choices[0].delta || {};
  if (delta.content) w.pendingContent = pgMergeChunk(w.pendingContent, delta.content);
  var reasonChunk = delta.reasoning_content || delta.reasoning || delta.thinking || delta.thought;
  if (reasonChunk) {
    if (!w.reasoningStartedAt) w.reasoningStartedAt = Date.now();
    w.pendingReasoning = pgMergeChunk(w.pendingReasoning, reasonChunk);
  }
  pgApplySourcesFromObject(i, delta);
  if (choices[0].message) {
    pgApplySourcesFromObject(i, choices[0].message);
  }
}

function pgApplySourcesFromObject(i, obj) {
  var w = pgWinAt(i);
  if (!obj || typeof obj !== 'object') return;
  var candidates = ['sources', 'citations', 'web_search_citation', 'web_search'];
  for (var j = 0; j < candidates.length; j++) {
    var key = candidates[j];
    var val = obj[key];
    if (!val) continue;
    if (Array.isArray(val)) {
      val.forEach(function(item) {
        if (!item) return;
        var href = item.url || item.href || item.link || (typeof item === 'string' ? item : '');
        if (!href) return;
        var title = item.title || item.name || item.snippet || (typeof item === 'string' ? '' : '');
        if (!w.pendingSources.some(function(s) { return s.href === href; })) {
          w.pendingSources.push({ href: href, title: title || href });
        }
      });
    }
  }
}

function pgFlushRender(i, assistantIdx) {
  var w = pgWinAt(i);
  if (w.renderTimer) return;
  w.renderTimer = setTimeout(function() {
    var w2 = pgWinAt(i);
    w2.renderTimer = null;
    if (!w2.streaming) return;
    var msg = w2.messages[assistantIdx];
    if (!msg) return;
    var split = pgExtractAllReasoning(w2.pendingContent);
    if (split.reasoning) {
      w2.pendingReasoning = w2.pendingReasoning
        ? w2.pendingReasoning + '\n' + split.reasoning
        : split.reasoning;
      w2.pendingContent = split.content;
      if (!w2.reasoningStartedAt) w2.reasoningStartedAt = Date.now();
    }
    if (!w2.pendingContent && w2.pendingReasoning) {
    }
    msg.content = w2.pendingContent;
    msg.reasoning = w2.pendingReasoning;
    msg.sources = w2.pendingSources.slice();
    if (w2.reasoningStartedAt) {
      msg.reasoningStartedAt = w2.reasoningStartedAt;
      if (w2.reasoningCompletedAt) {
        msg.reasoningCompletedAt = w2.reasoningCompletedAt;
        msg.reasoningDurationMs = w2.reasoningCompletedAt - w2.reasoningStartedAt;
      } else {
        msg.reasoningDurationMs = Date.now() - w2.reasoningStartedAt;
      }
    }
    msg.status = 'streaming';
    if (w2.reasoningStartedAt && !w2.reasoningCompletedAt && w2.pendingContent) {
      w2.reasoningCompletedAt = Date.now();
      msg.reasoningCompletedAt = w2.reasoningCompletedAt;
      msg.reasoningDurationMs = w2.reasoningCompletedAt - w2.reasoningStartedAt;
    }
    pgRenderBubble(i, assistantIdx);
    pgRenderDebug();
    pgScrollBottom(i);
  }, 50);
}

function pgSendNonStream(i, body, assistantIdx) {
  var w = pgWinAt(i);
  w.streaming = true;
  w.abortCtrl = new AbortController();
  pgUpdateInputBar();
  fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: w.abortCtrl.signal,
  }).then(function(resp) {
    w.lastProvider = resp.headers.get('X-TinyRouter-Provider') || '';
    w.lastKey = resp.headers.get('X-TinyRouter-Key') || '';
    return resp.json().then(function(j) {
      if (!resp.ok) {
        var details = pgParseErrorDetails(JSON.stringify(j));
        var err2 = new Error(details.errorMessage || ('HTTP ' + resp.status));
        if (details.errorCode) {
          var msg2 = w.messages[assistantIdx];
          if (msg2) msg2.errorCode = details.errorCode;
        }
        throw err2;
      }
      var msg = w.messages[assistantIdx];
      var choice = j.choices && j.choices[0];
      msg.startedAt = msg.startedAt || Date.now();
      msg.completedAt = Date.now();
      msg.durationMs = msg.completedAt - msg.startedAt;
      if (choice && choice.message) {
        msg.content = choice.message.content || '';
        msg.reasoning = choice.message.reasoning_content || '';
        msg.status = 'complete';
        pgApplySourcesFromObject(i, choice.message);
        msg.sources = w.pendingSources.slice();
        if (msg.reasoning) {
          msg.reasoningStartedAt = msg.startedAt;
          msg.reasoningCompletedAt = msg.completedAt;
          msg.reasoningDurationMs = msg.reasoningCompletedAt - msg.reasoningStartedAt;
        }
      } else {
        msg.content = '';
        msg.status = 'complete';
      }
      w.sseEvents.push(JSON.stringify(j, null, 2));
      w.debugResponse = JSON.stringify(j, null, 2);
      pgRenderBubble(i, assistantIdx);
      pgRenderDebug();
      pgSave();
      pgUpdateInputBar();
    });
  }).catch(function(err) {
    if (err && err.name === 'AbortError') {
      pgFinish(i, assistantIdx);
    } else {
      var ec = (w.messages[assistantIdx] && w.messages[assistantIdx].errorCode) || null;
      pgFail(i, assistantIdx, err && err.message ? err.message : String(err), ec);
    }
  });
}

function pgFinish(i, assistantIdx) {
  var w = pgWinAt(i);
  if (!w.streaming) return;
  w.streaming = false;
  if (w.renderTimer) { clearTimeout(w.renderTimer); w.renderTimer = null; }
  w.abortCtrl = null;
  var msg = w.messages[assistantIdx];
  if (msg) {
    msg.content = w.pendingContent;
    msg.reasoning = w.pendingReasoning;
    msg.sources = w.pendingSources.slice();
    var split = pgExtractAllReasoning(msg.content);
    if (split.reasoning) msg.reasoning = (msg.reasoning ? msg.reasoning + '\n\n---\n\n' : '') + split.reasoning;
    msg.content = split.content;
    if (msg.status !== 'error') msg.status = 'complete';
    if (w.reasoningStartedAt && !w.reasoningCompletedAt) {
      w.reasoningCompletedAt = Date.now();
    }
    if (msg.reasoningStartedAt && !msg.reasoningCompletedAt && w.reasoningCompletedAt) {
      msg.reasoningCompletedAt = w.reasoningCompletedAt;
    }
    if (msg.reasoningStartedAt && msg.reasoningCompletedAt) {
      msg.reasoningDurationMs = msg.reasoningCompletedAt - msg.reasoningStartedAt;
    }
    if (!msg.completedAt) {
      msg.completedAt = Date.now();
      if (msg.startedAt) msg.durationMs = msg.completedAt - msg.startedAt;
    }
  }
  w.pendingContent = '';
  w.pendingReasoning = '';
  w.pendingSources = [];
  w.reasoningStartedAt = null;
  w.reasoningCompletedAt = null;
  if (i === 0) pgSave();
  pgRenderBubble(i, assistantIdx);
  pgRenderDebug();
  pgUpdateInputBar();
}

function pgFail(i, assistantIdx, errMsg, errorCode) {
  var w = pgWinAt(i);
  w.streaming = false;
  if (w.renderTimer) { clearTimeout(w.renderTimer); w.renderTimer = null; }
  w.abortCtrl = null;
  var msg = w.messages[assistantIdx];
  if (msg) {
    msg.error = errMsg;
    if (errorCode) msg.errorCode = errorCode;
    msg.content = pgTextContent(w.pendingContent) ? w.pendingContent : '';
    msg.reasoning = w.pendingReasoning;
    msg.status = 'error';
    if (!msg.completedAt) {
      msg.completedAt = Date.now();
      if (msg.startedAt) msg.durationMs = msg.completedAt - msg.startedAt;
    }
  }
  w.sseEvents.push('[ERROR] ' + errMsg);
  if (i === 0) pgSave();
  pgRenderBubble(i, assistantIdx);
  pgRenderDebug();
  pgUpdateInputBar();
}

// ----- Module 6: Stop / Clear / Global controls --------------------
function pgStop() {
  for (var i = 0; i < pgState.windows.length; i++) {
    var w = pgWinAt(i);
    if (w.abortCtrl) {
      try { w.abortCtrl.abort(); } catch (e) {}
      w.abortCtrl = null;
    }
    if (w.streaming) {
      var last = w.messages.length - 1;
      for (var j = last; j >= 0; j--) {
        if (w.messages[j].role === 'assistant'
            && (w.messages[j].status === 'streaming'
                || w.messages[j].status === 'loading')) {
          pgFinish(i, j);
          break;
        }
      }
    }
    // Safety: force streaming off
    if (pgWinAt(i).streaming) {
      pgWinAt(i).streaming = false;
    }
  }
  pgUpdateInputBar();
}

function pgClear() {
  pgStop();
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    w.messages = [];
    w.sseEvents = [];
    pgRenderMessages(i);
  }
  pgSave();
  pgRenderDebug();
}

function pgIsGenerating() {
  return pgState.windows.some(function(w) { return w.streaming; });
}

function pgAnyWindowHasModel() {
  for (var i = 0; i < pgState.splitCount; i++) {
    if (pgWinAt(i).config.model) return true;
  }
  return false;
}

// ----- Module 8/9: Edit / Regenerate --------------------------------
function pgBeginEdit(i, idx) {
  var w = pgWinAt(i);
  var msg = w.messages[idx];
  if (!msg) return;
  var wrap = document.getElementById('pg-bubble-' + i + '-' + idx);
  if (!wrap) return;
  var txt = pgTextContent(msg.content);
  wrap.innerHTML =
    '<div class="pg-editor-title"><span>' + pgEscapeHtml(pgT('pgEdit')) +
      '<span class="' + (txt !== pgTextContent(msg.content) ? 'unsaved' : 'saved') + '"></span></span></div>' +
    '<textarea class="pg-editor" id="pg-edit-ta-' + i + '-' + idx + '">' + pgEscapeHtml(txt) + '</textarea>' +
    '<div class="pg-editor-row">' +
      '<button class="pg-btn" onclick="pgCancelEdit(' + i + ',' + idx + ')">' + pgEscapeHtml(pgT('cancel')) + '</button>' +
      '<button class="pg-btn" onclick="pgApplyEdit(' + i + ',' + idx + ',false)">' + pgEscapeHtml(pgT('pgSave')) + '</button>' +
      '<button class="pg-btn active" onclick="pgApplyEdit(' + i + ',' + idx + ',true)">' + pgEscapeHtml(pgT('pgSendMessage')) + '</button>' +
    '</div>';
  var ta = document.getElementById('pg-edit-ta-' + i + '-' + idx);
  if (ta) {
    ta.focus();
    ta.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { e.preventDefault(); pgCancelEdit(i, idx); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        pgApplyEdit(i, idx, true);
      }
    });
  }
}

function pgCancelEdit(i, idx) {
  pgRenderBubble(i, idx);
}

function pgApplyEdit(i, idx, submit) {
  var w = pgWinAt(i);
  var ta = document.getElementById('pg-edit-ta-' + i + '-' + idx);
  if (!ta) return;
  var msg = w.messages[idx];
  if (!msg) return;
  if (typeof msg.content === 'string') {
    msg.content = ta.value;
  } else {
    var replaced = false;
    msg.content = (msg.content || []).map(function(p) {
      if (p.type === 'text') { replaced = true; return { type: 'text', text: ta.value }; }
      return p;
    });
    if (!replaced) msg.content.unshift({ type: 'text', text: ta.value });
  }
  if (submit) {
    if (pgIsGenerating()) { pgToast(pgT('pgStreaming'), 'warning'); return; }
    w.messages = w.messages.slice(0, idx + 1);
    w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: Date.now() });
    if (i === 0) pgSave();
    pgRenderMessages(i);
    pgSend(i, w.messages.length - 1);
  } else {
    pgRenderBubble(i, idx);
    if (i === 0) pgSave();
  }
}

function pgRegenerate(i, idx) {
  if (pgIsGenerating()) return;
  var w = pgWinAt(i);
  w.messages = w.messages.slice(0, idx);
  w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: Date.now() });
  if (i === 0) pgSave();
  pgRenderMessages(i);
  pgSend(i, w.messages.length - 1);
}

function pgDeleteMessage(i, idx) {
  var w = pgWinAt(i);
  w.messages.splice(idx, 1);
  if (i === 0) pgSave();
  pgRenderMessages(i);
}

function pgToggleRole(i, idx) {
  if (pgIsGenerating()) return;
  var w = pgWinAt(i);
  var msg = w.messages[idx];
  if (!msg) return;
  var order = { user: 'assistant', assistant: 'system', system: 'user' };
  msg.role = order[msg.role] || 'user';
  if (i === 0) pgSave();
  pgRenderMessages(i);
}

function pgPrevUserBefore(i, idx) {
  var w = pgWinAt(i);
  for (var j = idx - 1; j >= 0; j--) {
    if (w.messages[j].role === 'user') return j;
  }
  return -1;
}

function pgRetryError(i, idx) {
  if (pgIsGenerating()) return;
  pgRegenerate(i, idx);
}

function pgEditPromptForError(i, idx) {
  if (pgIsGenerating()) return;
  var prevUser = pgPrevUserBefore(i, idx);
  if (prevUser < 0) { pgToast(pgT('pgNoPrevUser'), 'warning'); return; }
  pgBeginEdit(i, prevUser);
}

// ----- Module: New message send (broadcast) -------------------------
function pgUserSend() {
  var ta = document.getElementById('pg-input');
  if (!ta) return;
  var text = ta.value.trim();
  if (!text || pgIsGenerating()) return;
  if (!pgAnyWindowHasModel()) {
    pgToast(pgT('pgSelectModel'), 'warning'); return;
  }
  var skipped = [];
  var now = Date.now();
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    if (!w.config.model) {
      skipped.push(i);
      pgToast(pgT('pgNoModelWin', [i + 1]), 'warning');
      continue;
    }
    w.messages.push({ role: 'user', content: text, createdAt: now });
    w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: now });
  }
  ta.value = '';
  for (var i2 = 0; i2 < pgState.splitCount; i2++) {
    if (skipped.indexOf(i2) >= 0) continue;
    pgRenderMessages(i2);
    var w2 = pgWinAt(i2);
    pgSend(i2, w2.messages.length - 1);
  }
  pgSave();
  // After send, auto-disable image attach (mirrors new-api behavior).
  var activeW = pgWin();
  if (activeW && activeW.config.imageEnabled) {
    setTimeout(function() { activeW.config.imageEnabled = false; pgSave(); pgRenderSidebar(); }, 100);
  }
}

function pgUserSendText(text) {
  var ta = document.getElementById('pg-input');
  if (ta) ta.value = text;
  pgUserSend();
}

// ----- Module 12: Paste image from clipboard ------------------------
function pgPasteImage(e) {
  var w = pgWin();
  if (!w || !w.config.imageEnabled) return;
  var items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image/') === 0) {
      var blob = items[i].getAsFile();
      if (!blob) continue;
      var reader = new FileReader();
      reader.onload = function(ev) {
        var dataUrl = ev.target.result;
        w.config.imageUrls.push(dataUrl);
        pgSave();
        pgRenderSidebar();
        pgToast(pgT('pgImagePasteAdded'), 'success');
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
    }
  }
}

// ----- Renderers ----------------------------------------------------
function pgScrollBottom(i) {
  var box = document.getElementById('pg-messages-' + i);
  if (box) box.scrollTop = box.scrollHeight;
}

function pgFormatTime(ts) {
  if (!ts || typeof ts !== 'number') return '';
  var d = new Date(ts);
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function pgFormatDuration(ms) {
  if (typeof ms !== 'number' || !isFinite(ms)) return '';
  if (ms < 1000) return pgT('pgDurationMs', [Math.max(1, Math.round(ms))]);
  return pgT('pgDurationSec', [(ms / 1000).toFixed(2)]);
}

function pgRenderBubble(i, idx) {
  var w = pgWinAt(i);
  var wrap = document.getElementById('pg-bubble-' + i + '-' + idx);
  if (!wrap) return;
  var msg = w.messages[idx];
  if (!msg) return;
  var isSourceVisible = !!msg.sourceVisible;
  var html = pgMsgInnerHTML(i, idx, msg, isSourceVisible);
  wrap.innerHTML = html;
  try {
    var metaWrap = document.getElementById('pg-msg-' + i + '-' + idx);
    if (metaWrap) {
      var metaEl = metaWrap.querySelector('.pg-msg-meta');
      if (metaEl) {
        metaEl.innerHTML = pgMsgMetaInnerHTML(i, idx, msg);
      } else if (msg.role !== 'loading') {
        var meta = document.createElement('div');
        meta.className = 'pg-msg-meta' + (msg.role === 'assistant' && idx === w.messages.length - 1 ? ' always-show' : '');
        meta.innerHTML = pgMsgMetaInnerHTML(i, idx, msg);
        metaWrap.appendChild(meta);
      }
    }
  } catch (e) { /* meta 更新失败不影响气泡内容 */ }
  if (isSourceVisible) {
    pgHighlight(wrap);
  }
  pgPostProcessCode(wrap);
  wrap.querySelectorAll('.pg-code-copy').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var codeEl = btn.parentElement && btn.parentElement.querySelector('code');
      pgCopyToClipboard(codeEl ? codeEl.textContent : '', pgT('pgCodeCopied'));
    });
  });
  wrap.querySelectorAll('.pg-mermaid').forEach(function(el) {
    el.addEventListener('click', function() { pgOpenMermaidSvg(el); });
  });
}

function pgPostProcessCode(container) {
  var pres = container.querySelectorAll('pre');
  pres.forEach(function(pre) {
    if (pre.dataset.pgPost === '1') return;
    pre.dataset.pgPost = '1';
    var codeEl = pre.querySelector('code');
    if (!codeEl) return;
    var cls = codeEl.className || '';
    var langMatch = cls.match(/language-(\w+)/);
    var lang = langMatch ? langMatch[1] : '';
    var raw = codeEl.textContent || '';
    if (lang === 'mermaid') {
      pgRenderMermaid(pre, raw);
    } else if (lang === 'html' || /^<!DOCTYPE/i.test(raw) || /^<svg/i.test(raw) || /^<\?xml/i.test(raw)) {
      pgRenderHtmlPreview(pre, raw);
    }
  });
}

function pgRenderMermaid(pre, code) {
  if (typeof window.mermaid === 'undefined') return;
  var placeholder = document.createElement('div');
  placeholder.className = 'pg-mermaid';
  placeholder.textContent = code;
  pre.parentNode.insertBefore(placeholder, pre.nextSibling);
  try {
    window.mermaid.run({ nodes: [placeholder], suppressErrors: true }).catch(function(e) {
      placeholder.classList.add('mermaid-error');
      placeholder.textContent = '[mermaid] ' + (e && e.message ? e.message : String(e));
    });
  } catch (e) {
    placeholder.classList.add('mermaid-error');
    placeholder.textContent = '[mermaid] ' + (e && e.message ? e.message : String(e));
  }
}

function pgOpenMermaidSvg(el) {
  var svg = el.querySelector('svg');
  if (!svg) return;
  var text = new XMLSerializer().serializeToString(svg);
  var blob = new Blob([text], { type: 'image/svg+xml' });
  var url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

function pgRenderHtmlPreview(pre, html) {
  if (pre.dataset.pgHtml === '1') return;
  pre.dataset.pgHtml = '1';
  var wrap = document.createElement('div');
  wrap.className = 'pg-html-preview';
  var title = document.createElement('div');
  title.className = 'pg-html-preview-title';
  title.textContent = pgT('pgHtmlPreview');
  var iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('srcDoc', html);
  iframe.style.height = '150px';
  iframe.addEventListener('load', function() {
    try {
      var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (doc) {
        var h = Math.max(doc.documentElement.scrollHeight || 0, doc.body.scrollHeight || 0);
        iframe.style.height = Math.min(Math.max(h + 16, 60), 600) + 'px';
      }
    } catch (e) {}
  });
  wrap.appendChild(title);
  wrap.appendChild(iframe);
  pre.parentNode.insertBefore(wrap, pre.nextSibling);
}

function pgMsgInnerHTML(i, idx, msg, isSourceVisible) {
  if (msg.status === 'loading') {
    return '<div class="pg-bubble"><span class="pg-toast-inline">⏳ ' + pgEscapeHtml(pgT('pgWaiting')) + '</span></div>';
  }
  var inner = '';
  var isUser = msg.role === 'user';
  if (msg.role === 'assistant' && msg.sources && msg.sources.length) {
    inner += '<div class="pg-sources collapsed" onclick="this.classList.toggle(\'collapsed\')">' +
      '<div class="pg-sources-head">' + pgEscapeHtml(pgT('pgSourcesCount', [msg.sources.length])) + ' ▾</div>' +
      '<div class="pg-sources-list">' +
        msg.sources.map(function(s, si) {
          return '<a class="pg-source-item" href="' + pgEscapeHtml(s.href) + '" target="_blank" rel="noreferrer">' +
            '<span class="pg-source-idx">[' + (si + 1) + ']</span>' +
            '<span>' + pgEscapeHtml(s.title || s.href) + '</span></a>';
        }).join('') +
      '</div></div>';
  }
  if (msg.reasoning) {
    var lbl;
    var streamingThink = msg.status === 'streaming' && msg.reasoningStartedAt && !msg.reasoningCompletedAt;
    if (streamingThink) {
      lbl = '<span class="pg-thinking-spinner"></span> ' + pgEscapeHtml(pgT('pgThinkingTitle')) + '...';
    } else if (msg.reasoningDurationMs != null) {
      var dstr = pgFormatDuration(msg.reasoningDurationMs);
      lbl = '💭 ' + (dstr ? pgEscapeHtml(pgT('pgThinkingSec', [dstr])) : pgEscapeHtml(pgT('pgThinkingDone')));
    } else {
      lbl = '💭 ' + pgEscapeHtml(pgT('pgThinkingDone'));
    }
    var thinkCls = streamingThink ? 'pg-thinking' : 'pg-thinking collapsed';
    inner += '<div class="' + thinkCls + '" onclick="this.classList.toggle(\'collapsed\')">' +
      '<div class="pg-thinking-head"><span class="pg-think-label">' + lbl + '</span>' +
      '<span class="pg-think-chev">▾</span></div>' +
      '<div class="pg-thinking-body">' + pgEscapeHtml(msg.reasoning) + '</div>' +
    '</div>';
  }
  if (msg.role === 'system') {
    inner += '<div class="pg-bubble" data-system-badge="' + pgEscapeHtml(pgT('pgSystemBadge')) + '">'
      + pgRenderMarkdown(pgTextContent(msg.content), false) + '</div>';
    return inner;
  }
  var isError = msg.status === 'error';
  var cls = 'pg-bubble' + (isError ? ' pg-bubble-error' : '');
  var imgs = pgImageParts(msg.content);
  if (imgs.length) {
    inner += '<div class="pg-image-row">' + imgs.map(function(p) {
      return '<img class="pg-image-thumb" src="' + pgEscapeHtml(p.image_url.url) + '" alt="image">';
    }).join('') + '</div>';
  }
  var bodyMd;
  if (isError) {
    bodyMd = msg.content ? pgRenderMarkdown(pgTextContent(msg.content), false) : '';
    if (msg.error) {
      bodyMd += (bodyMd ? '<br>' : '') + '<span style="color:#ffcdd2">[' + pgEscapeHtml(pgT('pgError')) + '] ' + pgEscapeHtml(msg.error) + '</span>';
    }
    if (msg.errorCode) {
      bodyMd += '<div class="pg-error-code">[' + pgEscapeHtml(pgT('pgErrorCode', [msg.errorCode])) + ']</div>';
    }
  } else if (isSourceVisible) {
    var rawSrc = pgTextContent(msg.content);
    bodyMd = '<pre><code class="language-markdown">' + pgEscapeHtml(rawSrc) + '</code></pre>';
  } else {
    bodyMd = pgRenderMarkdown(pgTextContent(msg.content), isUser);
  }
  inner += '<div class="' + cls + '">' + bodyMd + '</div>';
  return inner;
}

function pgMsgMetaInnerHTML(i, idx, msg) {
  var metaTime = pgFormatTime(msg.createdAt || msg.completedAt || msg.startedAt);
  var metaLines = '';
  if (msg.role === 'assistant' && msg.durationMs != null) {
    var dur = pgFormatDuration(msg.durationMs);
    if (metaTime && dur) {
      metaLines = pgEscapeHtml(metaTime) + ' · ' + pgEscapeHtml(pgT('pgMetaResponse', [dur]));
    } else if (dur) {
      metaLines = pgEscapeHtml(pgT('pgMetaResponse', [dur]));
    } else {
      metaLines = pgEscapeHtml(metaTime);
    }
  } else if (metaTime) {
    metaLines = pgEscapeHtml(metaTime);
  }
  var html = '<span>' + metaLines + '</span>';
  html += '<div class="pg-msg-actions">';
  if (msg.role === 'assistant' && msg.status !== 'loading') {
    html += '<button class="pg-action" onclick="pgActionCopy(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgCopy')) + '">' + PG_ICON_COPY + '</button>';
    html += '<button class="pg-action" onclick="pgToggleSource(' + i + ',' + idx + ')" title="' + pgEscapeHtml(msg.sourceVisible ? pgT('pgShowPreview') : pgT('pgShowSource')) + '">' + PG_ICON_SRC + '</button>';
    html += '<button class="pg-action" onclick="pgRegenerate(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgRegenerate')) + '">' + PG_ICON_REGEN + '</button>';
    if (msg.status === 'error') {
      html += '<button class="pg-action" onclick="pgRetryError(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgRetry')) + '">' + PG_ICON_RETRY + '</button>';
      html += '<button class="pg-action" onclick="pgEditPromptForError(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgEditPrompt')) + '">' + PG_ICON_EDIT + '</button>';
    }
    html += '<button class="pg-action danger" onclick="pgActionDelete(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgDelete')) + '">' + PG_ICON_DELETE + '</button>';
  } else if (msg.role === 'user') {
    html += '<button class="pg-action" onclick="pgActionCopy(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgCopy')) + '">' + PG_ICON_COPY + '</button>';
    html += '<button class="pg-action" onclick="pgToggleRole(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgToggleRole')) + '">' + PG_ICON_ROLE + '</button>';
    html += '<button class="pg-action" onclick="pgBeginEdit(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgEdit')) + '">' + PG_ICON_EDIT + '</button>';
    html += '<button class="pg-action danger" onclick="pgActionDelete(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgDelete')) + '">' + PG_ICON_DELETE + '</button>';
  } else if (msg.role === 'system') {
    html += '<button class="pg-action" onclick="pgToggleRole(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgToggleRole')) + '">' + PG_ICON_ROLE + '</button>';
    html += '<button class="pg-action" onclick="pgBeginEdit(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgEdit')) + '">' + PG_ICON_EDIT + '</button>';
    html += '<button class="pg-action danger" onclick="pgActionDelete(' + i + ',' + idx + ')" title="' + pgEscapeHtml(pgT('pgDelete')) + '">' + PG_ICON_DELETE + '</button>';
  }
  html += '</div>';
  return html;
}

function pgRenderMessages(i) {
  var w = pgWinAt(i);
  var box = document.getElementById('pg-messages-' + i);
  if (!box) return;
  if (!w.messages.length) {
    box.innerHTML = '<div class="pg-pane-empty">' + pgEscapeHtml(pgT('pgEmptyState')) + '</div>';
    return;
  }
  var html = '';
  w.messages.forEach(function(msg, idx) {
    var side = msg.role === 'user' ? 'user' : (msg.role === 'system' ? 'system' : 'assistant');
    var errCls = msg.status === 'error' ? ' error' : '';
    html += '<div class="pg-msg ' + side + errCls + '" id="pg-msg-' + i + '-' + idx + '">';
    html += '<div class="pg-bubble-slot" id="pg-bubble-' + i + '-' + idx + '">' + pgMsgInnerHTML(i, idx, msg, !!msg.sourceVisible) + '</div>';
    if (msg.role !== 'loading') {
      html += '<div class="pg-msg-meta' + (msg.role === 'assistant' && idx === w.messages.length - 1 ? ' always-show' : '') + '">' + pgMsgMetaInnerHTML(i, idx, msg) + '</div>';
    }
    html += '</div>';
  });
  box.innerHTML = html;
  w.messages.forEach(function(_, idx) { pgRenderBubble(i, idx); });
  pgScrollBottom(i);
}

function pgActionCopy(i, idx) {
  var w = pgWinAt(i);
  var msg = w.messages[idx];
  if (!msg) return;
  var txt = pgTextContent(msg.content);
  if (!txt) { pgToast(pgT('pgCopy'), 'warning'); return; }
  pgCopyToClipboard(txt, pgT('pgCopiedMsg'));
}
function pgActionDelete(i, idx) {
  if (!confirm(pgT('pgClearConfirm'))) return;
  pgDeleteMessage(i, idx);
}

function pgToggleSource(i, idx) {
  var w = pgWinAt(i);
  var msg = w.messages[idx];
  if (!msg) return;
  msg.sourceVisible = !msg.sourceVisible;
  pgRenderBubble(i, idx);
}

function pgCodeViewer(content, title) {
  var formatted = '';
  if (content) {
    if (typeof content === 'object') {
      try { formatted = JSON.stringify(content, null, 2); } catch (e) { formatted = String(content); }
    } else if (typeof content === 'string') {
      try { var p = JSON.parse(content); formatted = JSON.stringify(p, null, 2); } catch (e) { formatted = content; }
    } else {
      formatted = String(content);
    }
  }
  if (!formatted) {
    var ph = title === 'preview' ? pgT('pgDebugNoPreview') : (title === 'request' ? pgT('pgDebugNoRequest') : pgT('pgDebugNoResponse'));
    return '<div class="pg-code-empty">' + pgEscapeHtml(ph) + '</div>';
  }
  var MAX_DISPLAY = 50000;
  var PREVIEW_LEN = 5000;
  var isLarge = formatted.length > MAX_DISPLAY;
  var display = isLarge ? formatted.substring(0, PREVIEW_LEN) + '\n\n' + pgT('pgCodeTruncated') : formatted;
  var warning = isLarge ? '<div class="pg-code-warning">⚡ ' + pgEscapeHtml(pgT('pgCodeLargeContent')) + '</div>' : '';
  var highlighted = pgEscapeHtml(display);
  if (typeof hljs !== 'undefined') {
    try {
      var tmp = document.createElement('code');
      tmp.className = 'language-json';
      tmp.textContent = display;
      hljs.highlightElement(tmp);
      highlighted = tmp.innerHTML;
    } catch (e) { highlighted = pgEscapeHtml(display); }
  }
  var expandBtn = isLarge ? '<button class="pg-code-expand-btn" onclick="pgCodeToggleExpand(this)">' + pgEscapeHtml(pgT('pgCodeShowFull')) + '</button>' : '';
  return '<div class="pg-code-viewer" data-full="' + pgEscapeHtml(formatted) + '" data-large="' + (isLarge ? '1' : '0') + '">' + warning +
    '<button class="pg-code-copy-btn" onclick="pgCodeCopy(this)">' + pgEscapeHtml(pgT('pgCopy')) + '</button>' +
    '<pre>' + highlighted + '</pre>' + expandBtn + '</div>';
}

function pgCodeCopy(btn) {
  var viewer = btn.closest('.pg-code-viewer');
  var pre = viewer ? viewer.querySelector('pre') : null;
  var text = pre ? pre.textContent : '';
  pgCopyToClipboard(text, pgT('pgCodeCopiedClipboard'));
}

function pgCodeToggleExpand(btn) {
  var viewer = btn.closest('.pg-code-viewer');
  if (!viewer) return;
  var isExpanded = btn.dataset.expanded === '1';
  var full = viewer.getAttribute('data-full') || '';
  var pre = viewer.querySelector('pre');
  if (!pre) return;
  if (isExpanded) {
    var truncated = full.substring(0, 5000) + '\n\n' + pgT('pgCodeTruncated');
    pre.textContent = truncated;
    if (typeof hljs !== 'undefined') { try { hljs.highlightElement(pre); } catch(e){} }
    btn.textContent = pgT('pgCodeShowFull');
    btn.dataset.expanded = '0';
  } else {
    pre.textContent = full;
    if (typeof hljs !== 'undefined') { try { hljs.highlightElement(pre); } catch(e){} }
    btn.textContent = pgT('pgCodeCollapse');
    btn.dataset.expanded = '1';
  }
}

function pgSSEViewer(events) {
  if (!events || !events.length) {
    return '<div class="pg-sse-empty">' + pgEscapeHtml(pgT('pgSSEEmpty')) + '</div>';
  }
  var parsed = events.map(function(item, index) {
    var isDone = false, parsedObj = null, error = null;
    var payload = item;
    if (item.indexOf('data:') === 0) payload = item.slice(5).trim();
    if (payload === '[DONE]') { isDone = true; }
    else if (item.indexOf('[ERROR]') === 0) { error = item.slice(7).trim(); }
    else {
      try { parsedObj = JSON.parse(payload); } catch (e) { error = e.message; }
    }
    return { index: index, raw: item, parsed: parsedObj, error: error, isDone: isDone };
  });
  var total = parsed.length;
  var errors = parsed.filter(function(p) { return p.error; }).length;
  var done = parsed.filter(function(p) { return p.isDone; }).length;
  var valid = total - errors - done;

  var items = parsed.map(function(p) {
    var header = '';
    var body = '';
    if (p.isDone) {
      header = '<span class="pg-sse-badge idx">#' + (p.index + 1) + '</span> <span style="color:#4ade80">[DONE]</span>';
      body = '<div class="pg-sse-item-done">✓ ' + pgEscapeHtml(pgT('pgSSEComplete')) + '</div>';
    } else if (p.error) {
      header = '<span class="pg-sse-badge idx">#' + (p.index + 1) + '</span> <span style="color:var(--danger)">' + pgEscapeHtml(pgT('pgSSEParseError')) + '</span>';
      body = '<div class="pg-sse-item-error">✕ ' + pgEscapeHtml(p.error) + '<pre>' + pgEscapeHtml(p.raw) + '</pre></div>';
    } else {
      var id = p.parsed.id || p.parsed.object || pgT('pgSSEEvent');
      var deltaKeys = '';
      if (p.parsed.choices && p.parsed.choices[0] && p.parsed.choices[0].delta) {
        var d = p.parsed.choices[0].delta;
        deltaKeys = Object.keys(d).filter(function(k) { return d[k]; }).join(', ');
      }
      header = '<span class="pg-sse-badge idx">#' + (p.index + 1) + '</span> ' + pgEscapeHtml(id);
      if (deltaKeys) header += ' <span style="color:var(--text-muted);font-size:10px">• ' + pgEscapeHtml(deltaKeys) + '</span>';
      var summary = '';
      if (p.parsed.choices && p.parsed.choices[0]) {
        var ch = p.parsed.choices[0];
        if (ch.delta && ch.delta.content) summary += '<span class="pg-sse-badge content">' + pgEscapeHtml(pgT('pgSSEContent')) + ': "' + pgEscapeHtml(String(ch.delta.content).substring(0, 20)) + '..."</span>';
        if (ch.delta && ch.delta.reasoning_content) summary += '<span class="pg-sse-badge reasoning">' + pgEscapeHtml(pgT('pgSSEReasoning')) + '</span>';
        if (ch.finish_reason) summary += '<span class="pg-sse-badge finish">' + pgEscapeHtml(pgT('pgSSEFinish')) + ': ' + pgEscapeHtml(ch.finish_reason) + '</span>';
      }
      if (p.parsed.usage) summary += '<span class="pg-sse-badge usage">' + pgEscapeHtml(pgT('pgSSETokens')) + ': ' + (p.parsed.usage.prompt_tokens || 0) + '/' + (p.parsed.usage.completion_tokens || 0) + '</span>';
      var jsonStr = JSON.stringify(p.parsed, null, 2);
      body = '<div class="pg-sse-item-body"><pre>' + pgEscapeHtml(jsonStr) + '</pre>' +
        (summary ? '<div class="pg-sse-item-summary">' + summary + '</div>' : '') + '</div>';
    }
    return '<div class="pg-sse-item">' +
      '<div class="pg-sse-item-header" onclick="pgSSEToggle(this)">' + header + '</div>' +
      body + '</div>';
  }).join('');

  return '<div class="pg-sse-viewer">' +
    '<div class="pg-sse-header">' +
      '<div class="pg-sse-header-left">⚡ ' + pgEscapeHtml(pgT('pgSSEDataFlow')) + ' <span class="pg-sse-badge idx">' + total + '</span>' +
        (errors > 0 ? ' <span class="pg-sse-badge content" style="background:rgba(239,68,68,.2);color:var(--danger)">' + errors + ' ' + pgEscapeHtml(pgT('pgSSEErrors')) + '</span>' : '') +
      '</div>' +
      '<div class="pg-sse-header-actions">' +
        '<button class="pg-sse-action" onclick="pgSSECopyAll()">' + pgEscapeHtml(pgT('pgSSECopyAll')) + '</button>' +
        '<button class="pg-sse-action" onclick="pgSSEToggleAll()">' + pgEscapeHtml(pgT('pgSSEExpandAll')) + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="pg-sse-list" id="pg-sse-list">' + items + '</div>' +
  '</div>';
}

function pgSSEToggle(header) {
  var body = header.nextElementSibling;
  if (body) body.style.display = (body.style.display === 'none' ? '' : 'none');
}

function pgSSEToggleAll() {
  var list = document.getElementById('pg-sse-list');
  if (!list) return;
  var bodies = list.querySelectorAll('.pg-sse-item-body');
  var allHidden = Array.prototype.every.call(bodies, function(b) { return b.style.display === 'none'; });
  bodies.forEach(function(b) { b.style.display = allHidden ? '' : 'none'; });
}

function pgSSECopyAll() {
  var w = pgWin();
  if (w) {
    var text = w.sseEvents.join('\n\n');
    pgCopyToClipboard(text, pgT('pgSSECopiedAll'));
  }
}

var pgPreviewTimer = null;
function pgSchedulePreview() {
  if (pgPreviewTimer) clearTimeout(pgPreviewTimer);
  pgPreviewTimer = setTimeout(function() {
    pgPreviewTimer = null;
    var w = pgWin();
    if (!w) return;
    var preview = null;
    try {
      if (w.config.useCustomBody && w.config.customBody) {
        preview = JSON.parse(w.config.customBody);
      } else {
        preview = pgBuildBody();
      }
    } catch (e) { preview = null; }
    w.debugPreview = preview ? JSON.stringify(preview, null, 2) : '';
    w.debugPreviewTimestamp = new Date().toISOString();
    if (w.debugTab === 'preview') pgRenderDebugContent();
  }, 300);
}

function pgRenderDebugContent() {
  var container = document.getElementById('pg-debug-content');
  if (!container) return;
  var w = pgWin();
  if (!w) return;
  var html = '';
  var tab = w.debugTab;
  if (tab === 'preview') {
    html = pgCodeViewer(w.debugPreview, 'preview');
  } else if (tab === 'request') {
    html = pgCodeViewer(w.debugRequest, 'request');
  } else if (tab === 'response') {
    if (w.sseEvents && w.sseEvents.length) {
      html = pgSSEViewer(w.sseEvents);
    } else {
      html = pgCodeViewer(w.debugResponse, 'response');
    }
  }
  container.innerHTML = html;
  var footer = document.getElementById('pg-debug-footer');
  if (footer) {
    var ts = (tab === 'preview') ? w.debugPreviewTimestamp : w.debugTimestamp;
    if (ts) {
      var label = (tab === 'preview') ? pgT('pgDebugPreviewUpdated') : pgT('pgDebugLastRequest');
      footer.textContent = label + ': ' + new Date(ts).toLocaleString();
    } else {
      footer.textContent = '';
    }
  }
}

function pgSetDebugTab(tab) {
  var w = pgWin();
  if (!w) return;
  w.debugTab = tab;
  var tabs = document.querySelectorAll('.pg-tab');
  tabs.forEach(function(el) { el.classList.toggle('active', el.dataset.tab === tab); });
  pgRenderDebugContent();
}

// ----- Panes layout ------------------------------------------------
function pgRenderPanes() {
  var panes = document.getElementById('pg-panes');
  if (!panes) return;
  var n = pgState.splitCount;
  var cols = n === 1 ? '1fr' : (n === 2 ? '1fr 1fr' : (n === 3 ? '1fr 1fr 1fr' : '1fr 1fr'));
  var rows = n === 4 ? '1fr 1fr' : '1fr';
  panes.style.gridTemplateColumns = cols;
  panes.style.gridTemplateRows = rows;
  var html = '';
  for (var i = 0; i < n; i++) {
    var w = pgWinAt(i);
    var modelLabel = w && w.config && w.config.model ? w.config.model : pgEscapeHtml(pgT('pgSelectModel'));
    if (modelLabel.length > 30) modelLabel = modelLabel.substring(0, 30) + '…';
    html += '<div class="pg-pane" data-win="' + i + '">' +
      '<div class="pg-pane-head"><span class="pg-pane-idx">' + pgEscapeHtml(pgT('pgPaneName', [i + 1])) + '</span><span class="pg-pane-model">' + modelLabel + '</span></div>' +
      '<div class="pg-messages" id="pg-messages-' + i + '"></div>' +
    '</div>';
  }
  panes.innerHTML = html;
  var inner = document.getElementById('pg-main-inner');
  if (inner) {
    inner.classList.toggle('pg-split', n > 1);
  }
  for (var i2 = 0; i2 < n; i2++) {
    pgRenderMessages(i2);
  }
}

function pgSetSplitCount(n) {
  if (pgIsGenerating()) { pgToast(pgT('pgGenSwitchLock'), 'warning'); return; }
  pgState.splitCount = n;
  if (pgState.activeWin >= n) pgState.activeWin = n - 1;
  pgRenderPanes();
  pgRenderSidebar();
}

function pgSetActiveWin(i) {
  if (pgIsGenerating()) return;
  pgState.activeWin = i;
  pgRenderSidebar();
}

// ----- Sidebar: model select + params + image + system + debug -----
function pgRenderSidebar() {
  var side = document.getElementById('pg-side');
  if (!side) return;
  var w = pgWin();
  if (!w) return;
  var en = w.parameterEnabled;
  var cfg = w.config;
  var customMode = cfg.useCustomBody;
  var dimCls = customMode ? ' disabled' : '';

  // --- WinBar ---
  var generating = pgIsGenerating();
  var winBtns = '';
  for (var k = 0; k < 4; k++) {
    var isActive = k === pgState.activeWin ? ' active' : '';
    var isDisabled = (k >= pgState.splitCount || generating) ? ' disabled' : '';
    winBtns += '<button class="pg-win-btn' + isActive + '" onclick="pgSetActiveWin(' + k + ')"' + (isDisabled ? ' disabled' : '') + ' title="' + pgEscapeHtml(pgT('pgWinBtnTitle', [k + 1])) + '">' + (k + 1) + '</button>';
  }
  var splitOpts = '';
  for (var s = 1; s <= 4; s++) {
    splitOpts += '<option value="' + s + '"' + (pgState.splitCount === s ? ' selected' : '') + '>' + s + '</option>';
  }
  var winbar =
    '<div class="pg-panel pg-winbar">' +
      '<div class="pg-panel-title">' + pgEscapeHtml(pgT('pgWinBarTitle')) + '</div>' +
      '<div class="pg-winbar-row">' +
        '<div class="pg-winbar-btns">' + winBtns + '</div>' +
        '<select onchange="pgSetSplitCount(parseInt(this.value,10))"' + (generating ? ' disabled' : '') + '>' + splitOpts + '</select>' +
      '</div>' +
      '<div class="pg-winbar-hint">' + pgEscapeHtml(pgT('pgEditWindow', [pgState.activeWin + 1])) + '</div>' +
    '</div>';

  // --- Model select ---
  var optGroups = '<option value="">' + pgEscapeHtml(pgT('pgSelectModel')) + '</option>';
  var byType = { provider: [], combo: [] };
  pgState.models.forEach(function(m) { if (byType[m.type]) byType[m.type].push(m); });
  if (byType.combo.length) {
    optGroups += '<optgroup label="Combos">';
    byType.combo.forEach(function(m) { optGroups += '<option value="' + pgEscapeHtml(m.id) + '"' + (cfg.model === m.id ? ' selected' : '') + '>' + pgEscapeHtml(m.id) + '</option>'; });
    optGroups += '</optgroup>';
  }
  if (byType.provider.length) {
    optGroups += '<optgroup label="Providers">';
    byType.provider.forEach(function(m) { optGroups += '<option value="' + pgEscapeHtml(m.id) + '"' + (cfg.model === m.id ? ' selected' : '') + '>' + pgEscapeHtml(m.id) + ' (' + pgEscapeHtml(m.provider) + ')</option>'; });
    optGroups += '</optgroup>';
  }
  var modelSel = '<select id="pg-model" onchange="pgOnModelChange(this.value)"' + (customMode ? ' disabled' : '') + '>' + optGroups + '</select>';

  // --- Parameters ---
  function paramRow(key, label, min, max, step, isNum) {
    var on = en[key];
    var val = cfg[key];
    var disabled = !on || customMode;
    var valAttr = isNum ? 'value="' + (val || 0) + '"' : 'value="' + (val != null ? val : 0) + '"';
    var input = isNum
      ? '<input type="number" min="' + min + '" step="' + step + '" ' + valAttr + ' onchange="pgOnParam(\'' + key + '\', this.value==\'\'?0:'+ (min < 0 ? 'parseFloat(this.value)' : 'parseInt(this.value,10)||0') + ')">'
      : '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" oninput="pgOnParam(\'' + key + '\', parseFloat(this.value))"><span class="pg-val" id="pg-val-' + key + '">' + val + '</span>';
    return '<div class="pg-param' + (disabled ? ' disabled' : '') + '">' +
      '<button class="pg-toggle' + (on ? ' on' : '') + '" onclick="pgToggleParam(\'' + key + '\')" title="' + pgEscapeHtml(pgT('pgParamToggle')) + '">' + (on ? '✓' : '✕') + '</button>' +
      '<label>' + pgEscapeHtml(pgT(label)) + '</label>' +
      input +
    '</div>';
  }
  var params =
    paramRow('temperature', 'pgTemperature', 0, 2, 0.1, false) +
    paramRow('topP', 'pgTopP', 0, 1, 0.05, false) +
    paramRow('frequencyPenalty', 'pgFreqPenalty', -2, 2, 0.1, false) +
    paramRow('presencePenalty', 'pgPresPenalty', -2, 2, 0.1, false) +
    paramRow('maxTokens', 'pgMaxTokens', 0, 1, 1, true) +
    '<div class="pg-param' + (!en.seed || customMode ? ' disabled' : '') + '">' +
      '<button class="pg-toggle' + (en.seed ? ' on' : '') + '" onclick="pgToggleParam(\'seed\')" title="' + pgEscapeHtml(pgT('pgParamToggle')) + '">' + (en.seed ? '✓' : '✕') + '</button>' +
      '<label>' + pgEscapeHtml(pgT('pgSeed')) + '</label>' +
      '<input type="text" placeholder="' + pgEscapeHtml(pgT('pgSeedPlaceholder')) + '" value="' + pgEscapeHtml(cfg.seed || '') + '" oninput="pgOnParam(\'seed\', this.value)"' + (!en.seed || customMode ? ' disabled' : '') + '>' +
    '</div>' +
    '<div class="pg-switch"><input type="checkbox" id="pg-stream" ' + (cfg.stream ? 'checked' : '') + ' onchange="pgOnParam(\'stream\', this.checked)"' + (customMode ? ' disabled' : '') + '><label for="pg-stream">' + pgEscapeHtml(pgT('pgStream')) + '</label></div>';

  // --- System prompt ---
  var sysPrompt =
    '<textarea class="pg-system-prompt" id="pg-sysprompt" placeholder="' + pgEscapeHtml(pgT('pgSystemPromptPlaceholder')) + '" oninput="pgOnSystemPrompt(this.value)"' + (customMode ? ' disabled' : '') + '>' + pgEscapeHtml(cfg.systemPrompt || '') + '</textarea>';

  // --- Image URL input ---
  var imgBlock = pgRenderImageBlock(customMode);

  // --- Custom body ---
  var customValid = true;
  var customErr = '';
  if (cfg.useCustomBody && cfg.customBody && cfg.customBody.trim()) {
    try { JSON.parse(cfg.customBody); } catch (e) { customValid = false; customErr = e.message; }
  }
  var customStatus = cfg.useCustomBody
    ? (customValid
      ? '<div class="pg-custom-status valid">✓ ' + pgEscapeHtml(pgT('pgCustomJsonValid')) + '</div>'
      : '<div class="pg-custom-status invalid">✕ ' + pgEscapeHtml(pgT('pgCustomJsonInvalid')) + '</div>')
    : '';
  var customWarning = cfg.useCustomBody ? '<div class="pg-custom-warning">⚠ ' + pgEscapeHtml(pgT('pgCustomWarning')) + '</div>' : '';
  var formatBtn = cfg.useCustomBody && customValid
    ? '<button class="pg-sse-action" onclick="pgCustomFormat()">' + pgEscapeHtml(pgT('pgCustomFormat')) + '</button>'
    : '';
  var customErrLine = (!customValid && customErr) ? '<div class="pg-custom-error-msg">' + pgEscapeHtml(pgT('pgCustomJsonError', [customErr])) + '</div>' : '';
  var custom =
    '<div class="pg-custom-toolbar">' +
      '<div class="pg-switch" style="margin-bottom:0"><input type="checkbox" id="pg-customtoggle" ' + (cfg.useCustomBody ? 'checked' : '') + ' onchange="pgOnCustomToggle(this.checked)"><label for="pg-customtoggle">' + pgEscapeHtml(pgT('pgUseCustomBody')) + '</label></div>' +
      '<div style="display:flex;gap:4px;align-items:center">' + customStatus + formatBtn + '</div>' +
    '</div>' +
    customWarning +
    '<div class="pg-custom-editor">' +
      '<textarea class="pg-custom-body' + (!customValid ? ' invalid' : '') + '" id="pg-custombody" oninput="pgOnParam(\'customBody\', this.value); pgRenderSidebar()" placeholder=\'{"model":"...","messages":[...]}\'>' + pgEscapeHtml(cfg.customBody || '') + '</textarea>' +
    '</div>' +
    customErrLine;

  // --- Debug ---
  var sseCount = w.sseEvents.length;
  var customBadge = cfg.useCustomBody ? ' <span class="pg-tab-badge custom">' + pgEscapeHtml(pgT('pgDebugCustomBadge')) + '</span>' : '';
  var responseBadge = sseCount > 0 ? ' <span class="pg-tab-badge">SSE ' + sseCount + '</span>' : '';
  var debugTabs = '<div class="pg-tabs">' +
    '<button class="pg-tab' + (w.debugTab === 'preview' ? ' active' : '') + '" data-tab="preview" onclick="pgSetDebugTab(\'preview\')">👁 ' + pgEscapeHtml(pgT('pgDebugTabPreview')) + customBadge + '</button>' +
    '<button class="pg-tab' + (w.debugTab === 'request' ? ' active' : '') + '" data-tab="request" onclick="pgSetDebugTab(\'request\')">📤 ' + pgEscapeHtml(pgT('pgDebugTabRequest')) + '</button>' +
    '<button class="pg-tab' + (w.debugTab === 'response' ? ' active' : '') + '" data-tab="response" onclick="pgSetDebugTab(\'response\')">⚡ ' + pgEscapeHtml(pgT('pgDebugTabResponse')) + responseBadge + '</button>' +
  '</div>';
  var debugMeta = '<div class="pg-debug-meta">' +
    '<span>' + pgEscapeHtml(pgT('pgRespProvider').replace('{0}', w.lastProvider || pgT('pgNoProvider'))) + '</span>' +
    '<span>' + pgEscapeHtml(pgT('pgRespKey').replace('{0}', w.lastKey || pgT('pgNoProvider'))) + '</span>' +
    '<span>' + (w.streaming ? '🔴 ' + pgT('pgStreaming') : '🟢 ' + pgT('pgIdle')) + '</span></div>';
  var debug = debugMeta + debugTabs + '<div class="pg-tab-content" id="pg-debug-content"></div><div class="pg-debug-footer" id="pg-debug-footer"></div>';

  side.innerHTML =
    winbar +
    '<div class="pg-panel"><div class="pg-panel-title">' + pgEscapeHtml(pgT('pgSelectModel')) + '</div>' + modelSel + '</div>' +
    '<div class="pg-panel' + dimCls + '"><div class="pg-panel-title">' + pgEscapeHtml(pgT('pgParams')) + '</div>' + params + '</div>' +
    '<div class="pg-panel' + dimCls + '"><div class="pg-panel-title">' + pgEscapeHtml(pgT('pgSystemPrompt')) + '</div>' + sysPrompt + '</div>' +
    '<div class="pg-panel' + dimCls + '"><div class="pg-panel-title">' + pgEscapeHtml(pgT('pgImage')) + '</div>' + imgBlock + '</div>' +
    '<div class="pg-panel"><div class="pg-panel-title">' + pgEscapeHtml(pgT('pgCustomBody')) + '</div>' + custom + '</div>' +
    '<div class="pg-panel"><div class="pg-panel-title">' + pgEscapeHtml(pgT('pgDebug')) + '</div>' + debug + '</div>';
  pgSchedulePreview();
  pgRenderDebugContent();
}

function pgRenderImageBlock(customMode) {
  var w = pgWin();
  if (!w) return '';
  var cfg = w.config;
  var en = cfg.imageEnabled && !customMode;
  var urls = cfg.imageUrls || [];
  var hintKey;
  if (customMode) hintKey = 'pgImageCustomDisabled';
  else if (!en) hintKey = 'pgImageHint';
  else if (urls.length === 0) hintKey = 'pgImageHintEmpty';
  else hintKey = 'pgImageCount';
  var hintText = pgT(hintKey, [urls.length]);
  var rows = '';
  if (en) {
    urls.forEach(function(u, i) {
      rows += '<div class="pg-image-row-input">' +
        '<input type="text" value="' + pgEscapeHtml(u || '') + '" oninput="pgOnImageUrl(' + i + ', this.value)" placeholder="https://example.com/image' + (i + 1) + '.jpg">' +
        '<button class="pg-image-rem" onclick="pgRemoveImageUrl(' + i + ')" title="×">✕</button>' +
      '</div>';
    });
  }
  return '<div class="pg-image-block' + (en ? '' : ' disabled') + '">' +
    '<div class="pg-switch"><input type="checkbox" id="pg-imgenable" ' + (cfg.imageEnabled ? 'checked' : '') + ' onchange="pgOnParam(\'imageEnabled\', this.checked); pgRenderSidebar()"' + (customMode ? ' disabled' : '') + '><label for="pg-imgenable">' + pgEscapeHtml(pgT('pgImageEnable')) + '</label>' +
      '<button class="pg-image-add" onclick="pgAddImageUrl()" ' + (en ? '' : 'disabled') + ' title="' + pgEscapeHtml(pgT('pgImageAdd')) + '">+</button>' +
    '</div>' +
    (rows || '') +
    '<div class="pg-image-hint">' + pgEscapeHtml(hintText) + '</div>' +
  '</div>';
}

function pgAddImageUrl() {
  var w = pgWin();
  if (!w || !w.config.imageEnabled) return;
  w.config.imageUrls.push('');
  pgSave();
  pgRenderSidebar();
}
function pgRemoveImageUrl(i) {
  var w = pgWin();
  if (!w) return;
  w.config.imageUrls.splice(i, 1);
  pgSave();
  pgRenderSidebar();
}
function pgOnImageUrl(i, v) {
  var w = pgWin();
  if (!w) return;
  w.config.imageUrls[i] = v;
  pgSave();
}

function pgRenderDebug() {
  var w = pgWin();
  if (!w) return;
  var side = document.getElementById('pg-side');
  if (side) {
    var meta = side.querySelector('.pg-debug-meta');
    if (meta) {
      meta.innerHTML =
        '<span>' + pgEscapeHtml(pgT('pgRespProvider').replace('{0}', w.lastProvider || pgT('pgNoProvider'))) + '</span>' +
        '<span>' + pgEscapeHtml(pgT('pgRespKey').replace('{0}', w.lastKey || pgT('pgNoProvider'))) + '</span>' +
        '<span>' + (w.streaming ? '🔴 ' + pgT('pgStreaming') : '🟢 ' + pgT('pgIdle')) + '</span>';
    }
  }
  pgRenderDebugContent();
  var respTab = document.querySelector('.pg-tab[data-tab="response"]');
  if (respTab) {
    var badge = respTab.querySelector('.pg-tab-badge');
    var count = w.sseEvents.length;
    if (count > 0) {
      if (badge) { badge.textContent = 'SSE ' + count; }
      else { var span = document.createElement('span'); span.className = 'pg-tab-badge'; span.textContent = 'SSE ' + count; respTab.appendChild(span); }
    } else {
      if (badge) badge.remove();
    }
  }
}

// ----- Input bar (send/stop + clear) --------------------------------
function pgRenderInputBar() {
  var bar = document.getElementById('pg-inputbar');
  if (!bar) return;
  var sendBtn;
  if (pgIsGenerating()) {
    sendBtn = '<button class="pg-send stop" onclick="pgStop()">' + pgEscapeHtml(pgT('pgStop')) + '</button>';
  } else {
    sendBtn = '<button class="pg-send" onclick="pgUserSend()" ' + (!pgAnyWindowHasModel() ? 'disabled' : '') + '>' + pgEscapeHtml(pgT('pgSendMessage')) + '</button>';
  }
  bar.innerHTML =
    '<div class="pg-input-card">' +
      '<textarea class="pg-input" id="pg-input" placeholder="' + pgEscapeHtml(pgT('pgEnterMessage')) + '" onkeydown="pgOnInputKey(event)"></textarea>' +
      '<div class="pg-input-bar-toolbar"></div>' +
    '</div>' +
    '<div class="pg-input-actions">' +
      sendBtn +
      '<div class="pg-btn-row">' +
        '<button class="pg-btn danger" onclick="pgClear()">' + pgEscapeHtml(pgT('pgClear')) + '</button>' +
      '</div>' +
    '</div>';
  var ta = document.getElementById('pg-input');
  if (ta) ta.addEventListener('paste', pgPasteImage);
}
function pgUpdateInputBar() { pgRenderInputBar(); }

// ----- Event handlers ----------------------------------------------
function pgOnModelChange(v) { var w = pgWin(); if (w) { w.config.model = v; pgSave(); pgRenderPanes(); } }
function pgOnParam(name, v) {
  var w = pgWin();
  if (!w) return;
  w.config[name] = v;
  var valEl = document.getElementById('pg-val-' + name);
  if (valEl) valEl.textContent = v;
  pgSave();
}
function pgOnSystemPrompt(v) { var w = pgWin(); if (w) { w.config.systemPrompt = v; pgSave(); } }
function pgToggleParam(name) {
  var w = pgWin();
  if (!w) return;
  w.parameterEnabled[name] = !w.parameterEnabled[name];
  pgSave();
  pgRenderSidebar();
}

function pgOnCustomToggle(enabled) {
  var w = pgWin();
  if (!w) return;
  w.config.useCustomBody = enabled;
  if (enabled && (!w.config.customBody || !w.config.customBody.trim())) {
    try {
      var preview = pgBuildBody();
      w.config.customBody = JSON.stringify(preview, null, 2);
    } catch (e) { /* ignore */ }
  }
  pgSave();
  pgRenderSidebar();
}

function pgCustomFormat() {
  var w = pgWin();
  if (!w) return;
  var ta = document.getElementById('pg-custombody');
  if (!ta) return;
  try {
    var parsed = JSON.parse(ta.value);
    var formatted = JSON.stringify(parsed, null, 2);
    ta.value = formatted;
    w.config.customBody = formatted;
    pgSave();
    pgRenderSidebar();
  } catch (e) { /* ignore - format button only shown when valid */ }
}
function pgOnInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pgUserSend(); }
}

// ----- Load fixup: finalize orphaned streaming assistants. ----------
function pgNormalizeLoadedMessage(msg) {
  if (!msg) return msg;
  if (typeof msg.role !== 'string') msg.role = 'assistant';
  if (msg.content === undefined) msg.content = '';
  if (msg.status === undefined) msg.status = 'complete';
  if (msg.role === 'assistant' && (msg.status === 'streaming' || msg.status === 'loading')) {
    var hasContent = pgTextContent(msg.content).trim() || (msg.reasoning && msg.reasoning.trim());
    if (hasContent) {
      msg.status = 'complete';
      if (!msg.completedAt) {
        msg.completedAt = msg.reasoningCompletedAt || msg.startedAt || Date.now();
      }
      if (msg.startedAt && !msg.durationMs) {
        msg.durationMs = msg.completedAt - msg.startedAt;
      }
    }
  }
  return msg;
}

// ----- Entry: render the page --------------------------------------
function renderPlayground(container) {
  pgLoad();
  pgEnsureWindows();
  pgInitMarker();
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.innerHTML =
    '<div class="pg-layout">' +
      '<div class="pg-main">' +
        '<div class="pg-main-inner" id="pg-main-inner">' +
          '<div class="pg-panes" id="pg-panes"></div>' +
        '</div>' +
      '</div>' +
      '<div class="pg-input-bar" id="pg-inputbar"></div>' +
      '<div class="pg-side" id="pg-side"></div>' +
    '</div>';
  pgRenderSidebar();
  pgRenderPanes();
  pgRenderInputBar();
  pgLoadModels().then(function() { pgRenderSidebar(); pgRenderPanes(); });
}

function cleanupPlayground() {
  for (var i = 0; i < pgState.windows.length; i++) {
    var w = pgWinAt(i);
    if (w.streaming) {
      if (w.abortCtrl) {
        try { w.abortCtrl.abort(); } catch (e) {}
        w.abortCtrl = null;
      }
      w.streaming = false;
    }
  }
}
