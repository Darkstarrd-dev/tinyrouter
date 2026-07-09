// pg-modal.js
// ----- Modal system ------------------------------------------------
function pgEnsureModalOverlay() {
  var overlay = document.getElementById('pg-modal-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'pg-modal-overlay';
  overlay.className = 'pg-modal-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) pgCloseModal(); };
  document.body.appendChild(overlay);
  return overlay;
}

function pgCloseModal() {
  var overlay = document.getElementById('pg-modal-overlay');
  if (overlay) { overlay.classList.remove('show'); }
}

function pgShowModal(html) {
  var overlay = pgEnsureModalOverlay();
  overlay.innerHTML = '<div class="pg-modal">' + html + '</div>';
  requestAnimationFrame(function() { overlay.classList.add('show'); });
}

function pgOpenDebugModal(winIdx) {
  var w = pgWinAt(winIdx);
  if (!w) return;
  var sseCount = w.sseEvents.length;
  var customBadge = w.config.useCustomBody ? ' <span class="pg-tab-badge custom">' + pgEscapeHtml(pgT('pgDebugCustomBadge')) + '</span>' : '';
  var responseBadge = sseCount > 0 ? ' <span class="pg-tab-badge">SSE ' + sseCount + '</span>' : '';
  var headerHtml = '<div class="pg-modal-header">' +
    '<span class="pg-modal-title">🐛 ' + pgEscapeHtml(pgT('pgDebug')) + ' — ' + pgEscapeHtml(pgT('pgPaneName', [winIdx + 1])) + '</span>' +
    '<button class="pg-modal-close" onclick="pgCloseModal()">✕</button>' +
  '</div>';
  var metaHtml = '<div class="pg-debug-meta">' +
    '<span>' + pgEscapeHtml(pgT('pgRespProvider').replace('{0}', w.lastProvider || pgT('pgNoProvider'))) + '</span>' +
    '<span>' + pgEscapeHtml(pgT('pgRespKey').replace('{0}', w.lastKey || pgT('pgNoProvider'))) + '</span>' +
    '<span>' + (w.streaming ? '🔴 ' + pgT('pgStreaming') : '🟢 ' + pgT('pgIdle')) + '</span>' +
  '</div>';
  var tabsHtml = '<div class="pg-tabs">' +
    '<button class="pg-tab' + (w.debugTab === 'preview' ? ' active' : '') + '" data-tab="preview" onclick="pgSetDebugModalTab(' + winIdx + ',\'preview\')">👁 ' + pgEscapeHtml(pgT('pgDebugTabPreview')) + customBadge + '</button>' +
    '<button class="pg-tab' + (w.debugTab === 'request' ? ' active' : '') + '" data-tab="request" onclick="pgSetDebugModalTab(' + winIdx + ',\'request\')">📤 ' + pgEscapeHtml(pgT('pgDebugTabRequest')) + '</button>' +
    '<button class="pg-tab' + (w.debugTab === 'response' ? ' active' : '') + '" data-tab="response" onclick="pgSetDebugModalTab(' + winIdx + ',\'response\')">⚡ ' + pgEscapeHtml(pgT('pgDebugTabResponse')) + responseBadge + '</button>' +
  '</div>';
  var bodyHtml = '<div class="pg-modal-body">' +
    metaHtml + tabsHtml +
    '<div class="pg-tab-content" id="pg-debug-modal-content"></div>' +
    '<div class="pg-debug-footer" id="pg-debug-modal-footer"></div>' +
  '</div>';
  pgShowModal(headerHtml + bodyHtml);
  pgRenderDebugModalContent(winIdx);
}

function pgRenderDebugModalContent(winIdx) {
  var container = document.getElementById('pg-debug-modal-content');
  if (!container) return;
  var w = pgWinAt(winIdx);
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
  var footer = document.getElementById('pg-debug-modal-footer');
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

function pgSetDebugModalTab(winIdx, tab) {
  var w = pgWinAt(winIdx);
  if (!w) return;
  w.debugTab = tab;
  var modalTabs = document.querySelectorAll('#pg-modal-overlay .pg-tab');
  modalTabs.forEach(function(el) { el.classList.toggle('active', el.dataset.tab === tab); });
  pgRenderDebugModalContent(winIdx);
}

function pgShowImageModal(url) {
  var html = '<div class="pg-modal-header">' +
    '<span class="pg-modal-title">🖼 ' + pgEscapeHtml(pgT('pgImagePreview')) + '</span>' +
    '<button class="pg-modal-close" onclick="pgCloseModal()">✕</button>' +
  '</div>' +
  '<div class="pg-modal-body" style="text-align:center;display:flex;align-items:center;justify-content:center;">' +
    '<img src="' + pgEscapeHtml(url) + '" alt="image" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:4px;">' +
  '</div>';
  pgShowModal(html);
}

// ----- Model picker modal (separate overlay, stacks on top) -----
var pgModelPickerCallback = null;

function pgOpenModelPicker(currentValue, onSelect, opts) {
  pgModelPickerCallback = onSelect;
  var allowEmpty = opts && opts.allowEmpty;
  var emptyLabel = (opts && opts.emptyLabel) || pgT('Default (first window model)');
  var title = (opts && opts.title) || pgT('pgSelectModel');
  var itemsHtml = '';
  if (allowEmpty) {
    itemsHtml += '<div class="pg-model-picker-item' + (!currentValue ? ' selected' : '') + '" data-value="" tabindex="-1" onclick="pgModelPickerSelect(this)">' + pgEscapeHtml(emptyLabel) + '</div>';
  }
  var models = pgState.models || [];
  if (!models.length && !allowEmpty) {
    itemsHtml = '<div style="padding:20px;text-align:center;opacity:0.6">' + pgEscapeHtml(pgT('No models available')) + '</div>';
  }
  models.forEach(function(m) {
    var id = m.id;
    var label = m.id + (m.provider ? ' (' + m.provider + ')' : '');
    itemsHtml += '<div class="pg-model-picker-item' + (currentValue === id ? ' selected' : '') + '" data-value="' + pgEscapeHtml(id) + '" tabindex="-1" onclick="pgModelPickerSelect(this)">' + pgEscapeHtml(label) + '</div>';
  });
  var html = '<div class="pg-modal" style="width:400px;max-width:90vw">' +
    '<div class="pg-modal-header">' +
      '<span class="pg-modal-title">' + pgEscapeHtml(title) + '</span>' +
      '<button class="pg-modal-close" onclick="pgCloseModelPicker()">✕</button>' +
    '</div>' +
    '<div class="pg-modal-body" style="max-height:50vh;overflow-y:auto">' +
      '<input type="text" id="pg-model-picker-filter" placeholder="' + pgEscapeHtml(pgT('Filter')) + '" oninput="pgModelPickerFilter(this.value)" style="width:100%;padding:6px 8px;margin-bottom:8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' +
      itemsHtml +
    '</div>' +
    '<div class="pg-modal-footer" style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="pg-btn" id="pg-model-picker-cancel" onclick="pgCloseModelPicker()">' + pgEscapeHtml(pgT('Cancel')) + '</button>' +
      '<button class="pg-btn" id="pg-model-picker-ok" style="background:var(--accent);color:#fff" onclick="pgModelPickerConfirm()">' + pgEscapeHtml(pgT('OK')) + '</button>' +
    '</div>' +
  '</div>';
  var overlay = document.createElement('div');
  overlay.id = 'pg-model-picker-overlay';
  overlay.className = 'pg-modal-overlay show';
  overlay.style.zIndex = '10001';
  overlay.innerHTML = html;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) pgCloseModelPicker(); });
  overlay.addEventListener('keydown', pgModelPickerKeydown);
  document.body.appendChild(overlay);
  var filterEl = document.getElementById('pg-model-picker-filter');
  if (filterEl) filterEl.focus();
}

function pgCloseModelPicker() {
  var overlay = document.getElementById('pg-model-picker-overlay');
  if (overlay) overlay.remove();
  pgModelPickerCallback = null;
}

function pgModelPickerSelect(el) {
  var overlay = document.getElementById('pg-model-picker-overlay');
  if (!overlay) return;
  var items = overlay.querySelectorAll('.pg-model-picker-item');
  for (var i = 0; i < items.length; i++) items[i].classList.remove('selected');
  el.classList.add('selected');
}

function pgModelPickerConfirm() {
  var overlay = document.getElementById('pg-model-picker-overlay');
  if (!overlay) return;
  var selected = overlay.querySelector('.pg-model-picker-item.selected');
  var value = selected ? selected.getAttribute('data-value') : '';
  var cb = pgModelPickerCallback;
  pgCloseModelPicker();
  if (cb) cb(value);
}

function pgModelPickerFilter(query) {
  var overlay = document.getElementById('pg-model-picker-overlay');
  if (!overlay) return;
  var q = (query || '').toLowerCase();
  var items = overlay.querySelectorAll('.pg-model-picker-item');
  for (var i = 0; i < items.length; i++) {
    var text = (items[i].textContent || '').toLowerCase();
    items[i].style.display = q && text.indexOf(q) < 0 ? 'none' : '';
  }
}

function pgModelPickerVisibleItems() {
  var overlay = document.getElementById('pg-model-picker-overlay');
  if (!overlay) return [];
  var items = overlay.querySelectorAll('.pg-model-picker-item');
  var visible = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].style.display !== 'none') visible.push(items[i]);
  }
  return visible;
}

function pgModelPickerSelectedIndex(visible) {
  for (var i = 0; i < visible.length; i++) {
    if (visible[i].classList.contains('selected')) return i;
  }
  return -1;
}

function pgModelPickerKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); pgCloseModelPicker(); return; }
  if (e.key === 'Enter') { e.preventDefault(); pgModelPickerConfirm(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    var visible = pgModelPickerVisibleItems();
    if (!visible.length) return;
    var curIdx = pgModelPickerSelectedIndex(visible);
    var nextIdx;
    if (e.key === 'ArrowDown') {
      nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % visible.length;
    } else {
      nextIdx = curIdx <= 0 ? visible.length - 1 : curIdx - 1;
    }
    pgModelPickerSelect(visible[nextIdx]);
    visible[nextIdx].focus();
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    var filter = document.getElementById('pg-model-picker-filter');
    if (filter && filter === document.activeElement) {
      var visible = pgModelPickerVisibleItems();
      if (visible.length) {
        var curIdx = pgModelPickerSelectedIndex(visible);
        visible[curIdx >= 0 ? curIdx : 0].focus();
      }
    } else {
      if (filter) filter.focus();
    }
    return;
  }
  if (e.key.length === 1 && e.key.match(/[a-z0-9]/i) && !e.ctrlKey && !e.altKey && !e.metaKey) {
    var filterEl = document.getElementById('pg-model-picker-filter');
    if (filterEl && filterEl === document.activeElement) return;
    e.preventDefault();
    var visible = pgModelPickerVisibleItems();
    if (!visible.length) return;
    var ch = e.key.toLowerCase();
    var curIdx = pgModelPickerSelectedIndex(visible);
    var startIdx = curIdx >= 0 ? curIdx : -1;
    for (var i = 0; i < visible.length; i++) {
      var idx = (startIdx + 1 + i) % visible.length;
      var text = (visible[idx].textContent || '').toLowerCase().trim();
      if (text.charAt(0) === ch) {
        pgModelPickerSelect(visible[idx]);
        visible[idx].focus();
        return;
      }
    }
    return;
  }
}