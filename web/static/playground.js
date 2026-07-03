// =====================================================================
// Playground — interactive chat testing UI.
// Talks directly to the existing /v1/chat/completions proxy endpoint
// (which already does OpenAI-compatible SSE passthrough).
// Config + messages persist to localStorage. No backend changes needed.
// =====================================================================

// ----- Module 1: State management -----------------------------------
var PG_LS_KEY = 'tinyrouter.playground.v1';
var PG_DEFAULT_CFG = {
  model: '',
  temperature: 0.8,
  topP: 1,
  maxTokens: 0,          // 0 = inherit/unset
  frequencyPenalty: 0,
  presencePenalty: 0,
  stream: true,
  useCustomBody: false,
  customBody: '',
};
var pgState = {
  config: JSON.parse(JSON.stringify(PG_DEFAULT_CFG)),
  messages: [],          // {role, content, reasoning, error, status}
  models: [],            // cached /api/models list
  streaming: false,
  abortCtrl: null,
  sseEvents: [],         // raw SSE lines for debug panel
  lastProvider: '',
  lastKey: '',
  renderTimer: null,
  pendingContent: '',    // buffered streaming chunks
  pendingReasoning: '',
};

function pgLoad() {
  try {
    var raw = localStorage.getItem(PG_LS_KEY);
    if (!raw) return;
    var saved = JSON.parse(raw);
    if (saved.config) {
      Object.keys(PG_DEFAULT_CFG).forEach(function(k) {
        if (saved.config[k] !== undefined) pgState.config[k] = saved.config[k];
      });
    }
    if (Array.isArray(saved.messages)) pgState.messages = saved.messages;
  } catch (e) { /* ignore corrupt storage */ }
}

var pgSaveTimer = null;
function pgSave() {
  if (pgSaveTimer) clearTimeout(pgSaveTimer);
  pgSaveTimer = setTimeout(function() {
    try {
      localStorage.setItem(PG_LS_KEY, JSON.stringify({
        config: pgState.config,
        messages: pgState.messages,
      }));
    } catch (e) { /* storage full / disabled */ }
  }, 500);
}

// ----- Module 2: Model list ----------------------------------------
function pgLoadModels() {
  return apiGet('/models').then(function(res) {
    pgState.models = (res && res.models) ? res.models : [];
  }).catch(function() {
    pgState.models = [];
  });
}

// ----- Module 4+5: Markdown rendering -------------------------------
// Configure marked once with the katex extension. Guard against re-init.
var pgMarkerReady = false;
function pgInitMarker() {
  if (pgMarkerReady) return;
  if (typeof marked === 'undefined') return;
  if (typeof markedKatex !== 'undefined') {
    try { marked.use(markedKatex({ throwOnError: false, nonStandard: true })); } catch (e) { /* duplicate use is fine */ }
  }
  pgMarkerReady = true;
}

// Render markdown text -> sanitized HTML. Falls back to escaped plain text
// when vendor libs are unavailable so the UI never breaks.
function pgRenderMarkdown(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined') {
    pgInitMarker();
    try {
      var html = marked.parse(text, { breaks: true, gfm: true });
      if (typeof DOMPurify !== 'undefined') {
        html = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
      }
      return html;
    } catch (e) { /* fall through to escaping */ }
  }
  return '<p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>';
}

// Highlight code blocks after the bubble is in the DOM.
function pgHighlight(container) {
  if (typeof hljs === 'undefined') return;
  container.querySelectorAll('pre code').forEach(function(block) {
    try { hljs.highlightElement(block); } catch (e) { /* unknown language */ }
  });
}

// Reasoning tag tokens. Built from char codes so literal mentions never
// collide with tooling that may interpret them as live markup.
var PG_THINK_OPEN = String.fromCharCode(60) + 'think' + String.fromCharCode(62);
var PG_THINK_CLOSE = String.fromCharCode(60) + '/think' + String.fromCharCode(62);
var PG_THINK_RE = new RegExp('^\\s*' + PG_THINK_OPEN.replace(/([< \/])/g, '\\$1') + '([\\s\\S]*?)' + PG_THINK_CLOSE.replace(/([< \/])/g, '\\$1'));

// Split leading reasoning block from visible content.
function pgSplitReasoning(text) {
  var reasoning = '';
  var m = text.match(PG_THINK_RE);
  if (m) {
    reasoning = m[1];
    text = text.slice(m[0].length);
  }
  // Also handle an unclosed leading reasoning block (stream interrupted).
  if (text.indexOf(PG_THINK_OPEN) === 0) {
    reasoning += text.slice(PG_THINK_OPEN.length);
    text = '';
  }
  return { content: text, reasoning: reasoning };
}

// ----- Module 6: SSE streaming request -----------------------------
// Parse a single SSE "data: ..." line, return JSON object or null.
function pgParseSSELine(line) {
  if (!line || line.indexOf('data:') !== 0) return null;
  var payload = line.slice(5).trim();
  if (payload === '[DONE]') return { done: true };
  try { return JSON.parse(payload); } catch (e) { return null; }
}

// Build the OpenAI-compatible request body from current UI state.
function pgBuildBody() {
  if (pgState.config.useCustomBody && pgState.config.customBody) {
    try { return JSON.parse(pgState.config.customBody); } catch (e) {
      throw new Error('Invalid custom body JSON');
    }
  }
  var body = {
    model: pgState.config.model,
    messages: pgState.messages
      .filter(function(m) { return m.role === 'user' || (m.role === 'assistant' && !m.error); })
      .map(function(m) { return { role: m.role, content: m.content }; }),
    stream: pgState.config.stream,
  };
  body.temperature = pgState.config.temperature;
  body.top_p = pgState.config.topP;
  if (pgState.config.maxTokens > 0) body.max_tokens = pgState.config.maxTokens;
  if (pgState.config.frequencyPenalty) body.frequency_penalty = pgState.config.frequencyPenalty;
  if (pgState.config.presencePenalty) body.presence_penalty = pgState.config.presencePenalty;
  return body;
}

// Send a chat completion request (stream or non-stream) and wire up debug info.
function pgSend(assistantIdx) {
  var body;
  try { body = pgBuildBody(); } catch (e) {
    toast(e.message, 'error'); return;
  }
  pgState.sseEvents = [];
  pgState.lastProvider = '';
  pgState.lastKey = '';
  pgState.pendingContent = '';
  pgState.pendingReasoning = '';

  if (pgState.config.stream) {
    pgStream(body, assistantIdx);
  } else {
    pgSendNonStream(body, assistantIdx);
  }
}

// Streaming path: fetch + ReadableStream parsing (same pattern as
// providers.js test-all). AbortController for stop.
function pgStream(body, assistantIdx) {
  pgState.streaming = true;
  pgState.abortCtrl = new AbortController();
  pgUpdateInputBar();

  fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify(body),
    signal: pgState.abortCtrl.signal,
  }).then(function(resp) {
    // Capture provider/key from injected debug headers.
    pgState.lastProvider = resp.headers.get('X-TinyRouter-Provider') || '';
    pgState.lastKey = resp.headers.get('X-TinyRouter-Key') || '';
    if (!resp.ok || !resp.body) {
      var err = 'HTTP ' + resp.status;
      pgFail(assistantIdx, err);
      return Promise.reject(new Error(err));
    }
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function pump() {
      return reader.read().then(function(chunk) {
        if (chunk.done) { pgFinish(assistantIdx); return; }
        buffer += decoder.decode(chunk.value, { stream: true });
        var events = buffer.split('\n');
        buffer = events.pop();          // keep partial line
        for (var i = 0; i < events.length; i++) {
          var line = events[i].trim();
          if (!line) continue;
          pgState.sseEvents.push(line);
          var data = pgParseSSELine(line);
          if (!data) continue;
          if (data.done) { pgFinish(assistantIdx); return; }
          pgApplyChunk(data, assistantIdx);
        }
        pgFlushRender(assistantIdx);
        return pump();
      });
    }
    return pump();
  }).catch(function(err) {
    if (err && err.name === 'AbortError') {
      pgFinish(assistantIdx);
    } else if (pgState.streaming) {
      pgFail(assistantIdx, err && err.message ? err.message : String(err));
    }
  });
}

// Apply one SSE chunk's delta to the assistant message buffer.
function pgApplyChunk(data, assistantIdx) {
  var choices = data.choices;
  if (!choices || !choices.length) return;
  var delta = choices[0].delta || {};
  if (delta.content) pgState.pendingContent += delta.content;
  if (delta.reasoning_content) pgState.pendingReasoning += delta.reasoning_content;
  // Some upstreams embed reasoning in reasoning_content only.
}

// Flush buffered content into the message state + DOM periodically (~60ms
// throttle) to avoid re-rendering markdown on every single token chunk.
function pgFlushRender(assistantIdx) {
  if (pgState.renderTimer) return;
  pgState.renderTimer = setTimeout(function() {
    pgState.renderTimer = null;
    var msg = pgState.messages[assistantIdx];
    if (!msg) return;
    msg.content = pgState.pendingContent;
    msg.reasoning = pgState.pendingReasoning;
    msg.status = 'streaming';
    pgRenderBubble(assistantIdx);
    pgRenderDebug();
    pgScrollBottom();
  }, 60);
}

// Non-streaming path.
function pgSendNonStream(body, assistantIdx) {
  pgState.streaming = true;
  pgState.abortCtrl = new AbortController();
  pgUpdateInputBar();
  fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: pgState.abortCtrl.signal,
  }).then(function(resp) {
    pgState.lastProvider = resp.headers.get('X-TinyRouter-Provider') || '';
    pgState.lastKey = resp.headers.get('X-TinyRouter-Key') || '';
    return resp.json().then(function(j) {
      if (!resp.ok) throw new Error(j.error && j.error.message ? j.error.message : ('HTTP ' + resp.status));
      var msg = pgState.messages[assistantIdx];
      var choice = j.choices && j.choices[0];
      if (choice && choice.message) {
        msg.content = choice.message.content || '';
        msg.reasoning = choice.message.reasoning_content || '';
        msg.status = 'complete';
      } else {
        msg.content = '';
        msg.status = 'complete';
      }
      pgState.sseEvents.push(JSON.stringify(j, null, 2));
      pgRenderBubble(assistantIdx);
      pgRenderDebug();
    });
  }).catch(function(err) {
    if (err && err.name === 'AbortError') {
      pgFinish(assistantIdx);
    } else {
      pgFail(assistantIdx, err && err.message ? err.message : String(err));
    }
  });
}

// Mark the assistant message done (after [DONE] or stop).
function pgFinish(assistantIdx) {
  if (!pgState.streaming) return;
  pgState.streaming = false;
  pgState.abortCtrl = null;
  var msg = pgState.messages[assistantIdx];
  if (msg) {
    msg.content = pgState.pendingContent;
    msg.reasoning = pgState.pendingReasoning;
    if (msg.status !== 'error') msg.status = 'complete';
    var split = pgSplitReasoning(msg.content);
    if (split.reasoning) msg.reasoning += split.reasoning;
    msg.content = split.content;
  }
  pgState.pendingContent = '';
  pgState.pendingReasoning = '';
  pgSave();
  pgRenderBubble(assistantIdx);
  pgRenderDebug();
  pgUpdateInputBar();
}

// Mark the assistant message failed.
function pgFail(assistantIdx, errMsg) {
  pgState.streaming = false;
  pgState.abortCtrl = null;
  var msg = pgState.messages[assistantIdx];
  if (msg) {
    msg.error = errMsg;
    msg.content = pgState.pendingContent;
    msg.reasoning = pgState.pendingReasoning;
    msg.status = 'error';
  }
  pgState.sseEvents.push('[ERROR] ' + errMsg);
  pgSave();
  pgRenderBubble(assistantIdx);
  pgRenderDebug();
  pgUpdateInputBar();
}

// ----- Module 7: Stop / Clear --------------------------------------
function pgStop() {
  if (pgState.abortCtrl) { try { pgState.abortCtrl.abort(); } catch (e) {} }
}

function pgClear() {
  if (pgState.streaming) pgStop();
  pgState.messages = [];
  pgState.sseEvents = [];
  pgSave();
  pgRenderMessages();
  pgRenderDebug();
}

// ----- Module 8/9: Edit / Regenerate --------------------------------
// Edit a user message; on save, truncate everything after it and resend.
function pgBeginEdit(idx) {
  var msg = pgState.messages[idx];
  if (!msg) return;
  var wrap = document.getElementById('pg-bubble-' + idx);
  if (!wrap) return;
  wrap.innerHTML =
    '<textarea class="pg-editor" id="pg-edit-ta-' + idx + '">' + escapeHtml(msg.content) + '</textarea>' +
    '<div class="pg-editor-row">' +
      '<button class="pg-btn" onclick="pgCancelEdit(' + idx + ')">' + t('cancel') + '</button>' +
      '<button class="pg-btn active" onclick="pgApplyEdit(' + idx + ',true)">' + t('pgSave') + '</button>' +
    '</div>';
}

function pgCancelEdit(idx) {
  pgRenderBubble(idx);
}

function pgApplyEdit(idx, submit) {
  var ta = document.getElementById('pg-edit-ta-' + idx);
  if (!ta) return;
  var msg = pgState.messages[idx];
  if (!msg) return;
  msg.content = ta.value;
  if (submit) {
    pgState.messages = pgState.messages.slice(0, idx + 1);
    pgState.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading' });
    pgSave();
    pgRenderMessages();
    pgSend(pgState.messages.length - 1);
  } else {
    pgRenderBubble(idx);
    pgSave();
  }
}

// Regenerate the assistant message at idx: drop it and anything after,
// then resend starting from the preceding user message.
function pgRegenerate(idx) {
  if (pgState.streaming) return;
  pgState.messages = pgState.messages.slice(0, idx);
  pgState.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading' });
  pgSave();
  pgRenderMessages();
  pgSend(pgState.messages.length - 1);
}

function pgDeleteMessage(idx) {
  pgState.messages.splice(idx, 1);
  pgSave();
  pgRenderMessages();
}

// ----- Module: New message send -------------------------------------
function pgUserSend() {
  var ta = document.getElementById('pg-input');
  if (!ta) return;
  var text = ta.value.trim();
  if (!text || pgState.streaming) return;
  if (!pgState.config.model) {
    toast(t('pgSelectModel'), 'warning'); return;
  }
  pgState.messages.push({ role: 'user', content: text });
  pgState.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading' });
  ta.value = '';
  pgSave();
  pgRenderMessages();
  pgSend(pgState.messages.length - 1);
}

// ----- Renderers ----------------------------------------------------
function pgScrollBottom() {
  var box = document.getElementById('pg-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

// Re-render a single bubble without rebuilding the list (preserves scroll).
function pgRenderBubble(idx) {
  var wrap = document.getElementById('pg-bubble-' + idx);
  if (!wrap) return;
  var msg = pgState.messages[idx];
  if (!msg) return;
  var html = pgMsgInnerHTML(idx, msg);
  wrap.innerHTML = html;
  // Highlight any code that just appeared.
  pgHighlight(wrap);
  // Wire copy buttons inside this bubble.
  wrap.querySelectorAll('.pg-code-copy').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var codeEl = btn.parentElement.querySelector('code');
      copyToClipboard(codeEl ? codeEl.textContent : '', 'code');
    });
  });
}

function pgMsgInnerHTML(idx, msg) {
  if (msg.status === 'loading') {
    return '<div class="pg-bubble"><span class="pg-toast-inline">⏳ ' + escapeHtml(t('pgWaiting')) + '</span></div>';
  }
  var inner = '';
  // Reasoning panel (collapsible).
  if (msg.reasoning) {
    inner += '<div class="pg-thinking collapsed" onclick="this.classList.toggle(\'collapsed\')">' +
      '<div class="pg-thinking-head">💭 ' + escapeHtml(t('pgThinking')) + ' ▾</div>' +
      '<div class="pg-thinking-body">' + escapeHtml(msg.reasoning) + '</div>' +
    '</div>';
  }
  var isError = msg.status === 'error';
  var cls = 'pg-bubble' + (isError ? ' pg-bubble-error' : '');
  var bodyMd = msg.content || (isError ? ('[' + t('pgError') + '] ' + escapeHtml(msg.error || '')) : '');
  inner += '<div class="' + cls + '">' + pgRenderMarkdown(bodyMd) + '</div>';
  return inner;
}

function pgRenderMessages() {
  var box = document.getElementById('pg-messages');
  if (!box) return;
  if (!pgState.messages.length) {
    box.innerHTML = '<div class="pg-empty">' + escapeHtml(t('pgEmptyState')) + '</div>';
    return;
  }
  var html = '';
  pgState.messages.forEach(function(msg, idx) {
    var side = msg.role === 'user' ? 'user' : 'assistant';
    var errCls = msg.status === 'error' ? ' error' : '';
    html += '<div class="pg-msg ' + side + errCls + '" id="pg-msg-' + idx + '">';
    html += '<div id="pg-bubble-' + idx + '">' + pgMsgInnerHTML(idx, msg) + '</div>';
    if (side === 'assistant' && msg.status !== 'loading') {
      html += '<div class="pg-msg-meta"><div class="pg-msg-actions">' +
          '<button class="pg-action" onclick="pgActionCopy(' + idx + ')">' + escapeHtml(t('pgCopy')) + '</button>' +
          '<button class="pg-action" onclick="pgRegenerate(' + idx + ')">' + escapeHtml(t('pgRegenerate')) + '</button>' +
          '<button class="pg-action" onclick="pgActionDelete(' + idx + ')">✕</button>' +
        '</div></div>';
    }
    if (side === 'user') {
      html += '<div class="pg-msg-meta"><div class="pg-msg-actions">' +
          '<button class="pg-action" onclick="pgBeginEdit(' + idx + ')">' + escapeHtml(t('pgEdit')) + '</button>' +
          '<button class="pg-action" onclick="pgActionDelete(' + idx + ')">✕</button>' +
        '</div></div>';
    }
    html += '</div>';
  });
  box.innerHTML = html;
  pgHighlight(box);
  pgScrollBottom();
}

function pgActionCopy(idx) {
  var msg = pgState.messages[idx];
  if (!msg) return;
  copyToClipboard(msg.content || '', t('pgCopiedMsg'));
}
function pgActionDelete(idx) {
  if (!confirm(t('pgClearConfirm'))) return;
  pgDeleteMessage(idx);
}

// ----- Sidebar: model select + params + debug + custom body --------
function pgRenderSidebar() {
  var side = document.getElementById('pg-side');
  if (!side) return;

  var optGroups = '<option value="">' + escapeHtml(t('pgSelectModel')) + '</option>';
  var byType = { provider: [], combo: [] };
  pgState.models.forEach(function(m) { if (byType[m.type]) byType[m.type].push(m); });
  if (byType.combo.length) {
    optGroups += '<optgroup label="Combos">';
    byType.combo.forEach(function(m) { optGroups += '<option value="' + escapeHtml(m.id) + '"' + (pgState.config.model === m.id ? ' selected' : '') + '>' + escapeHtml(m.id) + '</option>'; });
    optGroups += '</optgroup>';
  }
  if (byType.provider.length) {
    optGroups += '<optgroup label="Providers">';
    byType.provider.forEach(function(m) { optGroups += '<option value="' + escapeHtml(m.id) + '"' + (pgState.config.model === m.id ? ' selected' : '') + '>' + escapeHtml(m.id) + ' (' + escapeHtml(m.provider) + ')</option>'; });
    optGroups += '</optgroup>';
  }
  var modelSel = '<select id="pg-model" onchange="pgOnModelChange(this.value)">' + optGroups + '</select>';

  var params =
    '<div class="pg-param"><label>' + t('pgTemperature') + '</label>' +
      '<input type="range" min="0" max="2" step="0.1" value="' + pgState.config.temperature + '" oninput="pgOnParam(\'temperature\', parseFloat(this.value))">' +
      '<span class="pg-val" id="pg-val-temperature">' + pgState.config.temperature + '</span></div>' +
    '<div class="pg-param"><label>' + t('pgTopP') + '</label>' +
      '<input type="range" min="0" max="1" step="0.05" value="' + pgState.config.topP + '" oninput="pgOnParam(\'topP\', parseFloat(this.value))">' +
      '<span class="pg-val" id="pg-val-topP">' + pgState.config.topP + '</span></div>' +
    '<div class="pg-param"><label>' + t('pgMaxTokens') + '</label>' +
      '<input type="number" min="0" step="100" value="' + pgState.config.maxTokens + '" onchange="pgOnParam(\'maxTokens\', parseInt(this.value)||0)"></div>' +
    '<div class="pg-param"><label>' + t('pgFreqPenalty') + '</label>' +
      '<input type="range" min="-2" max="2" step="0.1" value="' + pgState.config.frequencyPenalty + '" oninput="pgOnParam(\'frequencyPenalty\', parseFloat(this.value))">' +
      '<span class="pg-val" id="pg-val-frequencyPenalty">' + pgState.config.frequencyPenalty + '</span></div>' +
    '<div class="pg-param"><label>' + t('pgPresPenalty') + '</label>' +
      '<input type="range" min="-2" max="2" step="0.1" value="' + pgState.config.presencePenalty + '" oninput="pgOnParam(\'presencePenalty\', parseFloat(this.value))">' +
      '<span class="pg-val" id="pg-val-presencePenalty">' + pgState.config.presencePenalty + '</span></div>' +
    '<div class="pg-switch"><input type="checkbox" id="pg-stream" ' + (pgState.config.stream ? 'checked' : '') + ' onchange="pgOnParam(\'stream\', this.checked)"><label for="pg-stream">' + t('pgStream') + '</label></div>';

  var custom =
    '<div class="pg-switch"><input type="checkbox" id="pg-customtoggle" ' + (pgState.config.useCustomBody ? 'checked' : '') + ' onchange="pgOnParam(\'useCustomBody\', this.checked); pgRenderSidebar()"><label for="pg-customtoggle">' + t('pgUseCustomBody') + '</label></div>' +
    '<div class="pg-custom-hint">' + escapeHtml(t('pgCustomBodyHint')) + '</div>' +
    '<textarea class="pg-custom-body" id="pg-custombody" oninput="pgOnParam(\'customBody\', this.value)" placeholder=\'{"model":"...","messages":[...]}\'> ' + escapeHtml(pgState.config.customBody || '') + '</textarea>';

  var debugMeta = '<div class="pg-debug-meta">' +
    '<span>' + escapeHtml(t('pgRespProvider').replace('{0}', pgState.lastProvider || t('pgNoProvider'))) + '</span>' +
    '<span>' + escapeHtml(t('pgRespKey').replace('{0}', pgState.lastKey || t('pgNoProvider'))) + '</span>' +
    '<span>' + (pgState.streaming ? '🔴 ' + t('pgStreaming') : '🟢 idle') + '</span></div>';
  var debug = debugMeta + '<pre class="pg-debug-pre" id="pg-rawsse">' + escapeHtml(pgState.sseEvents.join('\n') || '') + '</pre>';

  side.innerHTML =
    '<div class="pg-panel"><div class="pg-panel-title">' + escapeHtml(t('pgSelectModel')) + '</div>' + modelSel + '</div>' +
    '<div class="pg-panel"><div class="pg-panel-title">' + escapeHtml(t('pgParams')) + '</div>' + params + '</div>' +
    '<div class="pg-panel"><div class="pg-panel-title">' + escapeHtml(t('pgCustomBody')) + '</div>' + custom + '</div>' +
    '<div class="pg-panel"><div class="pg-panel-title">' + escapeHtml(t('pgDebug')) + '</div>' + debug + '</div>';
}

// Update only the debug raw-SSE pre element (avoids full sidebar rebuild).
function pgRenderDebug() {
  var pre = document.getElementById('pg-rawsse');
  if (pre) pre.textContent = pgState.sseEvents.join('\n');
  var side = document.getElementById('pg-side');
  if (side) {
    var meta = side.querySelector('.pg-debug-meta');
    if (meta) {
      meta.innerHTML =
        '<span>' + escapeHtml(t('pgRespProvider').replace('{0}', pgState.lastProvider || t('pgNoProvider'))) + '</span>' +
        '<span>' + escapeHtml(t('pgRespKey').replace('{0}', pgState.lastKey || t('pgNoProvider'))) + '</span>' +
        '<span>' + (pgState.streaming ? '🔴 ' + t('pgStreaming') : '🟢 idle') + '</span>';
    }
  }
}

// ----- Input bar (send/stop + clear) --------------------------------
function pgRenderInputBar() {
  var bar = document.getElementById('pg-inputbar');
  if (!bar) return;
  var sendBtn;
  if (pgState.streaming) {
    sendBtn = '<button class="pg-send stop" onclick="pgStop()">' + escapeHtml(t('pgStop')) + '</button>';
  } else {
    sendBtn = '<button class="pg-send" onclick="pgUserSend()" ' + (!pgState.config.model ? 'disabled' : '') + '>' + escapeHtml(t('pgSendMessage')) + '</button>';
  }
  bar.innerHTML =
    '<textarea class="pg-input" id="pg-input" placeholder="' + escapeHtml(t('pgEnterMessage')) + '" onkeydown="pgOnInputKey(event)"></textarea>' +
    sendBtn +
    '<div class="pg-btn-row" style="flex-direction:column;gap:4px">' +
      '<button class="pg-btn danger" onclick="pgClear()">' + escapeHtml(t('pgClear')) + '</button>' +
    '</div>';
}

function pgUpdateInputBar() { pgRenderInputBar(); }

// ----- Event handlers ----------------------------------------------
function pgOnModelChange(v) { pgState.config.model = v; pgSave(); }
function pgOnParam(name, v) {
  pgState.config[name] = v;
  var valEl = document.getElementById('pg-val-' + name);
  if (valEl) valEl.textContent = v;
  pgSave();
}
function pgOnInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pgUserSend(); }
}

// ----- Entry: render the page --------------------------------------
function renderPlayground(container) {
  pgLoad();
  pgInitMarker();
  container.innerHTML =
    '<div class="pg-layout">' +
      '<div class="pg-main">' +
        '<div class="pg-messages" id="pg-messages"></div>' +
      '</div>' +
      '<div class="pg-input-bar" id="pg-inputbar"></div>' +
      '<div class="pg-side" id="pg-side"></div>' +
    '</div>';
  pgRenderSidebar();
  pgRenderMessages();
  pgRenderInputBar();
  pgLoadModels().then(function() { pgRenderSidebar(); });
}

// Cleanup when leaving the playground page (stops any active stream).
function cleanupPlayground() {
  if (pgState.streaming) pgStop();
}
