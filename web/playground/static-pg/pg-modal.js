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