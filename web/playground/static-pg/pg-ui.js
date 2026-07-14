// pg-ui.js
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
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pgCancelEdit(i, idx); }
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
  if (!text) return;

  // Auto chat mode: allow sending even while generating (messages go to inbox).
  if (pgState.autoChat.enabled) {
    ta.value = '';
    if (pgState.autoChat.isRunning) {
      pgAutoChatUserSend(text);
    } else {
      pgAutoChatStart(text);
    }
    return;
  }

  if (pgIsGenerating()) return;
  if (!pgAnyWindowHasModel()) {
    pgToast(pgT('pgSelectModel'), 'warning'); return;
  }

  var skipped = [];
  var now = Date.now();
  var hadImages = false;
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    if (!w.config.model) {
      skipped.push(i);
      pgToast(pgT('pgNoModelWin', [i + 1]), 'warning');
      continue;
    }
    var content = text;
    if (w.config.imageEnabled && w.config.imageUrls && w.config.imageUrls.length > 0) {
      var urls = w.config.imageUrls.filter(function(u) { return u && u.trim(); });
      if (urls.length > 0) {
        var parts = [];
        if (text) parts.push({ type: 'text', text: text });
        urls.forEach(function(u) {
          parts.push({ type: 'image_url', image_url: { url: u } });
        });
        content = parts;
      }
      w.config.imageUrls = [];
      w.config.imageEnabled = false;
      hadImages = true;
    }
    w.messages.push({ role: 'user', content: content, createdAt: now });
    w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: now });
  }
  ta.value = '';
  if (hadImages) {
    pgRenderInputThumbs();
    pgRenderSidebar();
  }
  for (var i2 = 0; i2 < pgState.splitCount; i2++) {
    if (skipped.indexOf(i2) >= 0) continue;
    pgRenderMessages(i2);
    var w2 = pgWinAt(i2);
    pgSend(i2, w2.messages.length - 1);
  }
  pgSave();
}

function pgUserSendText(text) {
  var ta = document.getElementById('pg-input');
  if (ta) ta.value = text;
  pgUserSend();
}

// ----- Module 12: Paste image from clipboard ------------------------
function pgPasteImage(e) {
  var w = pgWin();
  if (!w) return;
  var items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  var hasImage = false;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image/') === 0) {
      hasImage = true;
      break;
    }
  }
  if (!hasImage) return;
  if (!w.config.imageEnabled) {
    w.config.imageEnabled = true;
  }
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
        pgRenderInputThumbs();
        pgToast(pgT('pgImagePasteAdded'), 'success');
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
    }
  }
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
    var paneLabel = (w && w.config.agentName) ? w.config.agentName : pgT('pgPaneName', [i + 1]);
    html += '<div class="pg-pane" data-win="' + i + '">' +
      '<div class="pg-pane-head">' +
        '<span class="pg-pane-idx">' + pgEscapeHtml(paneLabel) +
          '<span class="pg-pane-typing" style="display:none"></span>' +
        '</span>' +
        '<span class="pg-pane-model">' + modelLabel + '</span>' +
        '<button class="pg-pane-btn" onclick="event.stopPropagation();pgClearWindowMessages(' + i + ')" title="' + pgEscapeHtml(pgT('pgClearWin')) + '">' + PG_ICON_DELETE + '</button>' +
        '<button class="pg-pane-btn" onclick="event.stopPropagation();pgOpenDebugModal(' + i + ')" title="' + pgEscapeHtml(pgT('pgDebugWin')) + '">' + PG_ICON_DEBUG + '</button>' +
      '</div>' +
      '<div class="pg-messages" id="pg-messages-' + i + '"></div>' +
    '</div>';
  }
  panes.innerHTML = html;
  var inner = document.getElementById('pg-main-inner');
  if (inner) {
    inner.classList.toggle('pg-split', n > 1);
  }
  var showReqLeft = !pgState.autoChat.enabled && n === 1;
  var layout = document.querySelector('.pg-layout');
  if (layout) {
    layout.classList.toggle('pg-req-left-mode', showReqLeft);
  }
  pgRenderReqLeft(showReqLeft);
  for (var i2 = 0; i2 < n; i2++) {
    pgRenderMessages(i2);
  }
}

function pgSetMode(autoChat) {
  if (autoChat === pgState.autoChat.enabled) return;
  pgAutoChatToggle(autoChat);
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

function pgResetSettings() {
  var w = pgWin();
  if (!w) return;
  if (!confirm(pgT('pgResetConfirm'))) return;
  w.config = JSON.parse(JSON.stringify(PG_DEFAULT_CFG));
  w.parameterEnabled = JSON.parse(JSON.stringify(PG_DEFAULT_PARAMS));
  pgSave();
  pgRenderSidebar();
  pgRenderMessages(pgState.activeWin);
  pgToast(pgT('pgCfgReset'), 'success');
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
      '<div class="pg-panel-title">' + pgEscapeHtml(pgT('pgWinBarTitle')) +
        '<div class="pg-mode-toggle">' +
          '<button class="pg-mode-btn' + (!pgState.autoChat.enabled ? ' active' : '') + '" onclick="pgSetMode(false)">' + pgEscapeHtml(pgT('pgModeNormal')) + '</button>' +
          '<button class="pg-mode-btn' + (pgState.autoChat.enabled ? ' active' : '') + '" onclick="pgSetMode(true)">' + pgEscapeHtml(pgT('pgModeAutoChat')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="pg-winbar-row">' +
        '<div class="pg-winbar-btns">' + winBtns + '</div>' +
        '<select onchange="pgSetSplitCount(parseInt(this.value,10))"' + (generating ? ' disabled' : '') + '>' + splitOpts + '</select>' +
      '</div>' +
      '<div class="pg-winbar-hint">' + pgEscapeHtml(pgT('pgEditWindow', [pgState.activeWin + 1])) + '</div>' +
      '<button class="pg-btn" style="width:100%;margin-top:6px" onclick="pgResetSettings()">' + pgEscapeHtml(pgT('pgResetCfg')) + '</button>' +
    '</div>';

  // --- Model select ---
  var modelLabel = pgWin().config.model || pgT('pgSelectModel');
  var modelSel = '<button class="pg-btn pg-model-btn"' + (customMode ? ' disabled' : '') + ' onclick="pgOpenModelPicker(pgWin().config.model, function(v){ pgOnModelChange(v); pgRenderSidebar(); })" style="width:100%;text-align:left;justify-content:flex-start">' + pgEscapeHtml(modelLabel) + ' <span style="float:right;opacity:0.5">▼</span></button>';

  // --- Parameters ---
  function paramRow(key, label, min, max, step, isNum) {
    var on = en[key];
    var val = cfg[key];
    var disabled = !on || customMode;
    var valAttr = isNum ? 'value="' + (val || 0) + '"' : 'value="' + (val != null ? val : 0) + '"';
    var input = isNum
      ? '<input type="number" min="' + min + '" step="' + step + '" ' + valAttr + ' onchange="pgOnParam(\'' + key + '\', this.value==\'\'?0:'+ (min < 0 ? 'parseFloat(this.value)' : 'parseInt(this.value,10)||0') + ')">'
      : '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" oninput="pgOnParam(\'' + key + '\', parseFloat(this.value))"><span class="pg-val" id="pg-val-' + key + '">' + (typeof val === 'number' ? val.toFixed(2) : val) + '</span>';
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
    paramRow('thinkingBudget', 'pgThinking', 0, 100000, 100, true) +
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

  var autoChatPanels = pgState.autoChat.enabled ? (
    // --- Auto chat panel ---
    '<div class="pg-panel pg-autochat-panel">' +
      '<div class="pg-panel-title">' + pgEscapeHtml(pgT('pgAutoChat')) + '</div>' +
      '<div class="pg-autochat-config">' +
        '<div class="pg-param-row">' +
          '<label>' + pgEscapeHtml(pgT('pgAutoChatIterations')) + '</label>' +
          '<input type="number" min="0" value="' + pgState.autoChat.iterations + '" onchange="pgAutoChatSetIterations(this.value)">' +
        '</div>' +
        '<div class="pg-autochat-hint" id="pg-autochat-iterations-hint">' + (pgState.autoChat.iterations === 0 ? pgEscapeHtml(pgT('pgAutoChatInfiniteWarn')) : '') + '</div>' +
        '<div class="pg-param-row">' +
          '<label>' + pgEscapeHtml(pgT('pgAutoChatUserName')) + '</label>' +
          '<input type="text" value="' + pgEscapeHtml(pgState.autoChat.userName || 'User') + '" oninput="pgAutoChatSetUserName(this.value)">' +
        '</div>' +
        '<div class="pg-param-row">' +
          '<label>' + pgEscapeHtml(pgT('pgAutoChatDelay')) + '</label>' +
          '<input type="number" min="0" step="0.5" value="' + pgState.autoChat.delaySeconds + '" onchange="pgAutoChatSetDelay(this.value)">' +
        '</div>' +
        '<div class="pg-autochat-hint">' + pgEscapeHtml(pgT('pgAutoChatDelayHint')) + '</div>' +
      '</div>' +
      '<div class="pg-autochat-actions">' +
        '<button class="pg-btn danger' + (pgState.autoChat.isRunning ? ' running' : '') + '" onclick="pgAutoChatStop()" id="pg-autochat-stop-btn">' + pgEscapeHtml(pgT('pgAutoChatStop')) + '</button>' +
        '<button class="pg-btn" onclick="pgOpenGroupChatModal()">' + pgEscapeHtml(pgT('pgAutoChatOpenGroup')) + '</button>' +
        '<button class="pg-btn" onclick="if(typeof pgOpenSetupWizard===\'function\') pgOpenSetupWizard()">' + pgEscapeHtml(pgT('Scenario Setup')) + '</button>' +
      '</div>' +
    '</div>' +
    // --- Director panel ---
    '<div class="pg-panel pg-director-panel">' +
      '<div class="pg-panel-title">' + pgEscapeHtml(pgT('Director')) + '</div>' +
      '<div class="pg-param-row">' +
        '<label>' + pgEscapeHtml(pgT('Director Enable')) + '</label>' +
        '<input type="checkbox" id="pg-director-enable"' + (pgState.autoChat.director.enabled ? ' checked' : '') + ' onchange="pgDirectorToggle(this.checked)">' +
      '</div>' +
       '<div class="pg-param-row">' +
         '<label>' + pgEscapeHtml(pgT('Director Model')) + '</label>' +
         '<button class="pg-btn pg-model-btn" onclick="pgOpenModelPicker(pgState.autoChat.director.directorModel, function(v){ pgDirectorSetDirectorModel(v); pgRenderSidebar(); }, {allowEmpty:true})" style="width:100%;text-align:left;justify-content:flex-start">' + pgEscapeHtml(pgState.autoChat.director.directorModel || pgT('Default (first window model)')) + ' <span style="float:right;opacity:0.5">▼</span></button>' +
       '</div>' +
       '<div class="pg-param-row">' +
         '<label>' + pgEscapeHtml(pgT('Narrator Model')) + '</label>' +
         '<button class="pg-btn pg-model-btn" onclick="pgOpenModelPicker(pgState.autoChat.director.narratorModel, function(v){ pgDirectorSetNarratorModel(v); pgRenderSidebar(); }, {allowEmpty:true})" style="width:100%;text-align:left;justify-content:flex-start">' + pgEscapeHtml(pgState.autoChat.director.narratorModel || pgT('Default (first window model)')) + ' <span style="float:right;opacity:0.5">▼</span></button>' +
       '</div>' +
      '<div class="pg-param-row">' +
        '<label>' + pgEscapeHtml(pgT('Every N Replies')) + '</label>' +
        '<input type="number" min="1" value="' + pgState.autoChat.director.everyNReplies + '" onchange="pgDirectorSetEveryNReplies(this.value)">' +
      '</div>' +
      '<div class="pg-param-row">' +
        '<label>' + pgEscapeHtml(pgT('Max Narrations')) + '</label>' +
        '<input type="number" min="0" value="' + pgState.autoChat.director.maxNarrations + '" onchange="pgDirectorSetMaxNarrations(this.value)">' +
        '<span class="pg-autochat-hint" style="margin-left:4px">' + pgEscapeHtml(pgT('0 = ∞')) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="pg-panel"><div class="pg-panel-title">' + pgEscapeHtml(pgT('pgAutoChatAgentName')) + '</div>' +
      '<input type="text" class="pg-agent-name" placeholder="' + pgEscapeHtml(pgT('pgAutoChatAgentNamePlaceholder')) + '" value="' + pgEscapeHtml(cfg.agentName || '') + '" oninput="pgOnAgentName(this.value)">' +
      '<div class="pg-param-row" style="margin-top:8px"><label>' + pgEscapeHtml(pgT('pgContextLimit')) + '</label><input type="number" min="1000" step="1000" value="' + (cfg.contextLimit || 8000) + '" onchange="pgOnContextLimit(this.value)"></div>' +
    '</div>'
  ) : '';

  side.innerHTML =
    winbar +
    autoChatPanels +
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

// ----- Recent requests left panel (normal mode, single window) --------
var pgReqLeftTimer = null;

function pgRenderReqLeft(showReqLeft) {
  var container = document.getElementById('pg-req-left');
  if (!container) return;
  if (!showReqLeft) {
    container.innerHTML = '';
    pgStopReqLeftPolling();
    return;
  }
  container.innerHTML =
    '<div class="pg-req-left-inner">' +
      '<div class="pg-req-left-header">' + pgEscapeHtml(pgT('pgReqLeftTitle')) + '</div>' +
      '<div class="pg-req-table-wrap" id="pg-req-left-content"></div>' +
    '</div>';
  pgStartReqLeftPolling();
}

function pgStartReqLeftPolling() {
  pgStopReqLeftPolling();
  pgFetchReqLeft();
  pgReqLeftTimer = setInterval(pgFetchReqLeft, 3000);
}

function pgStopReqLeftPolling() {
  if (pgReqLeftTimer) {
    clearInterval(pgReqLeftTimer);
    pgReqLeftTimer = null;
  }
}

function pgFetchReqLeft() {
  pgApiGet('/usage?limit=50').then(function(res) {
    pgRenderReqLeftContent(res);
  }).catch(function() {});
}

function pgRenderReqLeftContent(data) {
  var container = document.getElementById('pg-req-left-content');
  if (!container) return;
  var entries = (data && data.entries) || [];
  entries = entries.filter(function(e) { return e.source === 'playground'; });
  pgReqLeftEntries = entries;
  if (!entries.length) {
    container.innerHTML = '<div class="pg-req-empty">' + pgEscapeHtml(pgT('pgReqEmpty')) + '</div>';
    return;
  }
  var html = '<table class="pg-req-table"><thead><tr>' +
    '<th class="pg-req-status-col"></th>' +
    '<th>' + pgEscapeHtml(pgT('pgReqColTime')) + '</th>' +
    '<th>' + pgEscapeHtml(pgT('pgReqColLatency')) + '</th>' +
    '<th>' + pgEscapeHtml(pgT('pgReqColTokens')) + '</th>' +
    '</tr></thead><tbody>';
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var dotCls = 'pg-req-dot';
    if (e.status === 'success') dotCls += ' pg-req-dot-success';
    else if (e.status === 'error') dotCls += ' pg-req-dot-error';
    else if (e.status === 'retry') dotCls += ' pg-req-dot-retry';
    else dotCls += ' pg-req-dot-processing';
    var timeStr = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '—';
    var latStr;
    if (e.status === 'processing') {
      latStr = e.timestamp ? ((Date.now() - new Date(e.timestamp).getTime()) / 1000).toFixed(1) + 's' : '—';
    } else {
      latStr = e.latencyMs ? (e.latencyMs / 1000).toFixed(1) + 's' : '—';
    }
    var tokStr = (e.status === 'processing') ? '—' : ((e.inputTokens || 0) + '/' + (e.outputTokens || 0));
    html += '<tr style="cursor:pointer" onclick="pgShowReqDetail(' + i + ')">' +
      '<td class="pg-req-status-col"><span class="' + dotCls + '"></span></td>' +
      '<td>' + pgEscapeHtml(timeStr) + '</td>' +
      '<td>' + pgEscapeHtml(latStr) + '</td>' +
      '<td>' + pgEscapeHtml(tokStr) + '</td>' +
    '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

var pgReqLeftEntries = [];

function pgShowReqDetail(idx) {
  var e = pgReqLeftEntries[idx];
  if (!e) return;
  var overlay = document.getElementById('info-modal-overlay');
  if (!overlay) return;
  var titleEl = document.getElementById('info-modal-title');
  var bodyEl = document.getElementById('info-modal-body');
  if (!titleEl || !bodyEl) return;

  titleEl.textContent = (e.provider || '?') + ' / ' + (e.model || '?') + ' \u2014 ' + (e.status || 'unknown') + ' (' + formatLatency(e.latencyMs || 0) + ')';

  __infoModalSections = [];
  var html = '';

  var summaryData = {};
  if (e.id) summaryData['ID'] = e.id;
  if (e.timestamp) summaryData['Timestamp'] = e.timestamp;
  if (e.provider) summaryData['Provider'] = e.provider;
  if (e.model) summaryData['Model'] = e.model;
  if (e.keyName) summaryData['Key'] = e.keyName;
  if (e.status) summaryData['Status'] = e.status;
  if (e.latencyMs !== undefined && e.latencyMs !== null) summaryData['Latency'] = formatLatency(e.latencyMs);
  if (e.ttftMs) summaryData['TTFT'] = e.ttftMs + 'ms';
  if (e.inputTokens) summaryData['Input Tokens'] = e.inputTokens;
  if (e.outputTokens) summaryData['Output Tokens'] = e.outputTokens;
  if (e.error) summaryData['Error'] = e.error;
  if (e.upstreamUrl) summaryData['Upstream URL'] = e.upstreamUrl;
  if (e.respStatus) summaryData['Response Status'] = e.respStatus;
  if (Object.keys(summaryData).length > 0) {
    html += renderInfoSection('Request Info', summaryData);
  }
  if (e.reqPayload) {
    html += renderInfoSection('Request', e.reqPayload);
  }
  if (e.reqHeaders) {
    html += renderInfoSection('Request Headers', e.reqHeaders);
  }
  if (e.respHeaders) {
    html += renderInfoSection('Response Headers', e.respHeaders);
  }
  if (e.respPayload) {
    html += renderInfoSection('Response Body', e.respPayload);
  }

  bodyEl.innerHTML = html || '<div class="info-section">' + t('noData') + '</div>';
  postProcessRawFields();

  overlay.classList.add('show');
  bodyEl.setAttribute('tabindex', '-1');
  bodyEl.focus();
}

// ----- Input bar (send/stop + clear) --------------------------------
function pgRenderInputBar() {
  var bar = document.getElementById('pg-inputbar');
  if (!bar) return;
  var sendBtn;
  if (pgIsGenerating() && !(pgState.autoChat.enabled && pgState.autoChat.isRunning)) {
    sendBtn = '<button class="pg-send stop" onclick="pgStop()">' + pgEscapeHtml(pgT('pgStop')) + '</button>';
  } else {
    sendBtn = '<button class="pg-send" onclick="pgUserSend()" ' + (!pgAnyWindowHasModel() ? 'disabled' : '') + '>' + pgEscapeHtml(pgT('pgSendMessage')) + '</button>';
  }
   bar.innerHTML =
    '<div class="pg-input-card">' +
      '<div class="pg-input-thumbs" id="pg-input-thumbs"></div>' +
      '<div class="pg-input-right">' +
        '<textarea class="pg-input" id="pg-input" placeholder="' + pgEscapeHtml(pgT('pgEnterMessage')) + '" onkeydown="pgOnInputKey(event)"></textarea>' +
        '<div class="pg-input-bar-toolbar"></div>' +
      '</div>' +
    '</div>' +
    '<div class="pg-input-actions">' +
      sendBtn +
      '<div class="pg-btn-row">' +
        (pgState.autoChat.enabled && pgState.autoChat.isRunning
          ? '<button class="pg-btn danger" onclick="pgAutoChatStop()" title="' + pgEscapeHtml(pgT('pgAutoChatStop')) + '">' + pgEscapeHtml(pgT('pgAutoChatStop')) + '</button>'
          : '') +
        '<button class="pg-btn danger" onclick="pgClear()">' + pgEscapeHtml(pgT('pgClear')) + '</button>' +
      '</div>' +
    '</div>';
  var ta = document.getElementById('pg-input');
  if (ta) ta.addEventListener('paste', pgPasteImage);
  pgRenderInputThumbs();
}
function pgUpdateInputBar() { pgRenderInputBar(); }

function pgEscapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function pgRenderInputThumbs() {
  var container = document.getElementById('pg-input-thumbs');
  if (!container) return;
  var w = pgWin();
  if (!w || !w.config.imageUrls || w.config.imageUrls.length === 0) {
    container.innerHTML = '';
    return;
  }
  var html = '';
  w.config.imageUrls.forEach(function(url, idx) {
    html += '<div class="pg-input-thumb-wrap">' +
      '<img class="pg-input-thumb" src="' + pgEscapeHtml(url) + '" alt="image" onclick="pgShowImageModal(\'' + pgEscapeAttr(url) + '\')">' +
      '<button class="pg-input-thumb-del" onclick="event.stopPropagation();pgRemoveInputImage(' + idx + ')" title="' + pgEscapeHtml(pgT('pgDelete')) + '">✕</button>' +
    '</div>';
  });
  container.innerHTML = html;
}

function pgRemoveInputImage(idx) {
  var w = pgWin();
  if (!w || !w.config.imageUrls) return;
  w.config.imageUrls.splice(idx, 1);
  pgSave();
  pgRenderInputThumbs();
  pgRenderSidebar();
}

// ----- Event handlers ----------------------------------------------
function pgOnModelChange(v) { var w = pgWin(); if (w) { w.config.model = v; pgSave(); pgRenderPanes(); pgUpdateInputBar(); } }
function pgOnParam(name, v) {
  var w = pgWin();
  if (!w) return;
  w.config[name] = v;
  var valEl = document.getElementById('pg-val-' + name);
  if (valEl) valEl.textContent = typeof v === 'number' ? v.toFixed(2) : v;
  pgSave();
}
function pgOnSystemPrompt(v) { var w = pgWin(); if (w) { w.config.systemPrompt = v; pgSave(); } }
function pgOnContextLimit(v) {
  var w = pgWin();
  if (!w) return;
  var n = parseInt(v, 10) || 8000;
  if (n < 1000) n = 1000;
  w.config.contextLimit = n;
  pgSave();
}
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