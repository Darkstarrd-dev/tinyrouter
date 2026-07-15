// ===================== QuickSlots Page =====================

var quickSlotCache = [];
var qsEditingModels = [];
var qsEditingDisabledModels = [];
var qsProvidersCache = null;
var qsDragFromIndex = -1;

function renderQuickSlotListInline(quickslots) {
  var el = document.getElementById('quickslot-list');
  if (!el) return;
  var list = (quickslots || []).slice();
  list.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
  if (list.length === 0) {
    el.innerHTML = emptyState(t('noQuickSlots'));
    return;
  }
  el.innerHTML = list.map(function(qs) {
    return '\
    <div class="card' + (qs.disabled ? ' quickslot-disabled' : '') + '">\
      <div class="card-header">\
        <span class="card-title copyable" data-name="' + escapeHtml(qs.name) + '" onclick="copyToClipboard(this.dataset.name, this.dataset.name)" title="' + t('clickToCopy') + '">#' + (qs.order || 0) + ' ' + escapeHtml(qs.name) + '</span>\
        <div class="flex" style="gap:8px">\
          <span class="badge ' + (qs.disabled ? 'badge-inactive' : 'badge-active') + '">order: ' + (qs.order || 0) + '</span>\
          <button type="button" class="btn btn-sm" onclick="toggleQuickSlotDisabled(\'' + qs.id + '\')">' + (qs.disabled ? t('enable') : t('disable')) + '</button>\
          <button type="button" class="btn btn-sm" onclick="showEditQuickSlot(\'' + qs.id + '\')">' + t('edit') + '</button>\
          <button type="button" class="btn btn-sm btn-danger" onclick="deleteQuickSlot(\'' + qs.id + '\')">' + t('delete') + '</button>\
        </div>\
      </div>\
      <p class="muted">' + t('models') + ' ' + (qs.models ? qs.models.join(', ') : 'none') + '</p>\
    </div>';
  }).join('');
}

function showAddQuickSlot() {
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '<div class="modal" style="max-width:520px">\
    <div class="modal-title">' + t('newQuickSlot') + '</div>\
    <div class="form-group"><label for="qs-name">' + t('name') + '</label><input id="qs-name" placeholder="' + t('name') + '"></div>\
    <div class="form-group"><label for="qs-order">' + t('quickSlotOrder') + '</label>\
      <input type="number" id="qs-order" min="1" max="9" value="1">\
      <p class="muted mt-12">' + t('quickSlotOrderHint') + '</p>\
    </div>\
    <div class="form-group"><label>' + t('quickSlotModels') + '</label>\
      <div style="display:flex;gap:8px;margin-bottom:8px">\
        <button type="button" class="btn btn-sm" onclick="importModelsForQuickSlot()">' + t('importFromProvider') + '</button>\
      </div>\
      <div id="qs-models-list"></div>\
    </div>\
    <div class="modal-footer">\
      <button type="button" class="btn" onclick="closeModalOverlay()">' + t('cancel') + '</button>\
      <button type="button" class="btn btn-primary" onclick="withLoading(this, () => addQuickSlot())">' + t('create') + '</button>\
    </div>\
  </div>';
  requestAnimationFrame(function() { overlay.classList.add('show'); });
  qsEditingModels = [];
  qsEditingDisabledModels = [];
  loadQuickSlotProvidersAndRender();
}

async function addQuickSlot() {
  var order = parseInt(document.getElementById('qs-order').value, 10);
  if (isNaN(order)) order = 1;
  var c = {
    name: document.getElementById('qs-name').value,
    order: order,
    models: qsEditingModels.slice(),
    disabledModels: qsEditingDisabledModels.slice()
  };
  try {
    var result = await apiPost('/quickslots', c);
    if (result && result.error) {
      toast(result.error, 'error');
      return;
    }
    closeModalOverlay();
    toast(t('quickSlotCreated'), 'success');
    renderEndpoint(document.getElementById('page-content'));
    renderHeaderQuickSlots();
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function deleteQuickSlot(id) {
  var ok = await confirmModal(t('confirmDeleteQuickSlot'));
  if (!ok) return;
  await apiDelete('/quickslots/' + id);
  toast(t('quickSlotDeleted'), 'success');
  renderEndpoint(document.getElementById('page-content'));
  renderHeaderQuickSlots();
}

async function toggleQuickSlotDisabled(id) {
  var data = await apiGet('/quickslots');
  var qs = (data.quickslots || []).find(function(x) { return x.id === id; });
  if (!qs) return;
  qs.disabled = !qs.disabled;
  await apiPut('/quickslots/' + id, qs);
  toast(qs.disabled ? t('quickSlotDisabled') : t('quickSlotEnabled'), 'success');
  renderEndpoint(document.getElementById('page-content'));
  renderHeaderQuickSlots();
}

async function showEditQuickSlot(id) {
  var data = await apiGet('/quickslots');
  var qs = (data.quickslots || []).find(function(x) { return x.id === id; });
  if (!qs) return;
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '<div class="modal" style="max-width:520px">\
    <div class="modal-title">' + t('quickSlotEdit') + '</div>\
    <div class="form-group"><label for="qs-name">' + t('name') + '</label><input id="qs-name" value="' + escapeHtml(qs.name) + '"></div>\
    <div class="form-group"><label for="qs-order">' + t('quickSlotOrder') + '</label>\
      <input type="number" id="qs-order" min="1" max="9" value="' + (qs.order || 1) + '">\
      <p class="muted mt-12">' + t('quickSlotOrderHint') + '</p>\
    </div>\
    <div class="form-group"><label>' + t('quickSlotModels') + '</label>\
      <div style="display:flex;gap:8px;margin-bottom:8px">\
        <button type="button" class="btn btn-sm" onclick="importModelsForQuickSlot()">' + t('importFromProvider') + '</button>\
      </div>\
      <div id="qs-models-list"></div>\
    </div>\
    <div class="modal-footer">\
      <button type="button" class="btn" onclick="closeModalOverlay()">' + t('cancel') + '</button>\
      <button type="button" class="btn btn-primary" onclick="withLoading(this, () => saveEditQuickSlot(\'' + id + '\'))">' + t('saveQuickSlot') + '</button>\
    </div>\
  </div>';
  requestAnimationFrame(function() { overlay.classList.add('show'); });
  qsEditingModels = (qs.models || []).slice();
  qsEditingDisabledModels = (qs.disabledModels || []).slice();
  loadQuickSlotProvidersAndRender();
}

async function saveEditQuickSlot(id) {
  var data = await apiGet('/quickslots');
  var existing = (data.quickslots || []).find(function(x) { return x.id === id; });
  if (!existing) existing = {};
  var order = parseInt(document.getElementById('qs-order').value, 10);
  if (isNaN(order)) order = 1;
  var c = {
    name: document.getElementById('qs-name').value,
    order: order,
    models: qsEditingModels.slice(),
    disabledModels: qsEditingDisabledModels.slice(),
    disabled: !!existing.disabled,
    selectedIndex: existing.selectedIndex || 0
  };
  try {
    await apiPut('/quickslots/' + id, c);
    closeModalOverlay();
    toast(t('quickSlotUpdated'), 'success');
    renderEndpoint(document.getElementById('page-content'));
    renderHeaderQuickSlots();
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function importModelsForQuickSlot() {
  var providers = await apiGet('/providers');
  providers = providers.providers || [];
  if (providers.length === 0) {
    toast(t('noModelsAvailable'), 'warning');
    return;
  }
  var html = '<div class="modal" style="width:500px">\
    <div class="modal-title">' + t('selectModels') + '</div>\
    <div class="modal-body" style="max-height:400px;overflow-y:auto">\
    <input type="text" id="import-filter" placeholder="' + t('filterModels') + '" style="width:100%;margin-bottom:8px;padding:6px 10px;box-sizing:border-box;background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:6px;color:var(--text-primary)">\
    <div style="display:flex;gap:6px;margin-bottom:12px">\
      <button type="button" class="btn btn-sm" id="import-select-all">' + t('selectAll') + '</button>\
      <button type="button" class="btn btn-sm" id="import-deselect-all">' + t('deselectAll') + '</button>\
    </div>';
  for (var i = 0; i < providers.length; i++) {
    var p = providers[i];
    if (!p.isActive) continue;
    var models = p.models || [];
    html += '<div class="import-provider-group" style="margin-bottom:12px">';
    html += '<div><strong>' + escapeHtml(p.name) + ' (' + escapeHtml(p.prefix) + ')</strong></div>';
    if (models.length === 0) {
      html += '<div class="muted" style="margin-bottom:8px">' + t('noModels') + '</div>';
    } else {
      for (var j = 0; j < models.length; j++) {
        var displayId = models[j].alias || models[j].id;
        var fullId = p.prefix + '/' + displayId;
        var note = models[j].note || '';
        var itemCls = 'import-model-item' + (note ? ' has-model-note' : '');
        var noteAttr = note ? ' data-model-note="' + escapeHtml(note) + '"' : '';
        html += '<div class="' + itemCls + '"' + noteAttr + ' data-value="' + escapeHtml(fullId) + '" onclick="toggleImportModel(this)" style="padding:6px 10px;margin-bottom:3px;border-radius:6px;cursor:pointer;transition:background .15s;border:1px solid transparent">' + escapeHtml(fullId) + '</div>';
      }
    }
    html += '</div>';
  }
  html += '</div>\
    <div class="modal-footer">\
      <button type="button" class="btn btn-ghost" id="import-close">' + t('close') + '</button>\
      <button type="button" class="btn btn-primary" id="import-add">' + t('addSelected') + '</button>\
    </div></div>';
  var importOverlay = document.createElement('div');
  importOverlay.className = 'modal-overlay';
  importOverlay.innerHTML = html;
  document.body.appendChild(importOverlay);
  requestAnimationFrame(function() { importOverlay.classList.add('show'); });
  importOverlay.__close = closeImport;
  var filterInput = importOverlay.querySelector('#import-filter');
  if (filterInput) filterInput.focus();
  function closeImport() {
    importOverlay.classList.remove('show');
    setTimeout(function() { if (importOverlay.parentNode) importOverlay.remove(); }, 400);
    renderQuickSlotModelsList();
  }
  importOverlay.querySelector('#import-filter').oninput = function() {
    var keyword = this.value.toLowerCase().trim();
    var groups = importOverlay.querySelectorAll('.import-provider-group');
    for (var gi = 0; gi < groups.length; gi++) {
      var group = groups[gi];
      var items = group.querySelectorAll('.import-model-item');
      var visibleCount = 0;
      for (var ii = 0; ii < items.length; ii++) {
        var val = items[ii].getAttribute('data-value') || '';
        if (keyword === '' || val.toLowerCase().indexOf(keyword) >= 0) {
          items[ii].style.display = '';
          visibleCount++;
        } else {
          items[ii].style.display = 'none';
        }
      }
      group.style.display = visibleCount > 0 ? '' : 'none';
    }
  };
  importOverlay.querySelector('#import-close').onclick = closeImport;
  importOverlay.querySelector('#import-select-all').onclick = function() {
    var items = importOverlay.querySelectorAll('.import-model-item');
    for (var k = 0; k < items.length; k++) { items[k].classList.add('selected'); }
  };
  importOverlay.querySelector('#import-deselect-all').onclick = function() {
    var items = importOverlay.querySelectorAll('.import-model-item');
    for (var k = 0; k < items.length; k++) { items[k].classList.remove('selected'); }
  };
  importOverlay.querySelector('#import-add').onclick = function() {
    var selected = [];
    var items = importOverlay.querySelectorAll('.import-model-item.selected');
    for (var k = 0; k < items.length; k++) selected.push(items[k].getAttribute('data-value'));
    for (var k = 0; k < selected.length; k++) {
      if (qsEditingModels.indexOf(selected[k]) < 0) qsEditingModels.push(selected[k]);
    }
    closeImport();
  };
}

async function loadQuickSlotProvidersAndRender() {
  if (!qsProvidersCache) {
    var data = await apiGet('/providers');
    qsProvidersCache = (data.providers || []);
  }
  renderQuickSlotModelsList();
}

function findQsProviderByPrefix(prefix) {
  if (!qsProvidersCache) return null;
  for (var i = 0; i < qsProvidersCache.length; i++) {
    if (qsProvidersCache[i].prefix === prefix) return qsProvidersCache[i];
  }
  return null;
}

function renderQuickSlotModelsList() {
  var container = document.getElementById('qs-models-list');
  if (!container) return;
  if (qsEditingModels.length === 0) {
    container.innerHTML = emptyState(t('noModels'));
    return;
  }
  var html = '';
  for (var i = 0; i < qsEditingModels.length; i++) {
    var fullId = qsEditingModels[i];
    var slashIdx = fullId.indexOf('/');
    var prefix = slashIdx > 0 ? fullId.substring(0, slashIdx) : '';
    var modelId = slashIdx > 0 ? fullId.substring(slashIdx + 1) : fullId;
    var provider = findQsProviderByPrefix(prefix);
    var pid = provider ? provider.id : '';
    var ts = modelTestStatus[modelId];
    var fullIdEsc = escapeHtml(fullId);
    var modelIdEsc = escapeHtml(modelId);
    var pidEsc = escapeHtml(pid);
    var isDisabled = qsEditingDisabledModels.indexOf(fullId) >= 0;
    var note = provider ? findModelNote(provider, modelId) : '';
    var noteAttr = note ? ' data-model-note="' + escapeHtml(note) + '"' : '';
    var hasNoteCls = note ? ' has-model-note' : '';
    var disabledRowStyle = isDisabled ? ' style="opacity:0.5"' : '';
    var isFirst = i === 0;
    var isLast = i === qsEditingModels.length - 1;
    html += '<div class="model-row' + hasNoteCls + '" data-index="' + i + '" draggable="true"' + disabledRowStyle + '>' +
      '<div class="model-row-main"' + noteAttr + '>' +
        '<span class="drag-handle" title="' + t('dragToReorder') + '" draggable="false">⠿</span>' +
        '<button type="button" class="btn btn-sm ' + (ts ? (ts.ok ? 'btn-test-ok' : 'btn-test-err') : '') + '" onclick="withLoading(this, () => testQuickSlotModel(' + i + '))">' + t('test') + '</button>' +
        '<button type="button" class="btn btn-sm ' + (isFirst ? 'disabled ' : '') + 'onclick="moveQuickSlotModel(' + i + ',' + (i - 1) + ')">' + t('moveUp') + '</button>' +
        '<button type="button" class="btn btn-sm ' + (isLast ? 'disabled ' : '') + 'onclick="moveQuickSlotModel(' + i + ',' + (i + 1) + ')">' + t('moveDown') + '</button>' +
        '<button type="button" class="btn btn-sm btn-danger" onclick="removeQuickSlotModel(' + i + ')">' + t('delete') + '</button>' +
        '<span class="model-id copyable" onclick="copyToClipboard(\'' + escapeForJsString(fullIdEsc) + '\')" title="' + t('clickToCopy') + '">' + fullIdEsc + '</span>' +
      '</div>' +
    '</div>';
  }
  container.innerHTML = html;
  attachQuickSlotRowDragHandlers(container);
}

function attachQuickSlotRowDragHandlers(container) {
  var rows = container.querySelectorAll('.model-row');
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    row.addEventListener('dragstart', function(e) {
      qsDragFromIndex = parseInt(this.getAttribute('data-index'), 10);
      this.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(qsDragFromIndex)); } catch (err) {}
      }
    });
    row.addEventListener('dragend', function() {
      this.classList.remove('dragging');
      qsDragFromIndex = -1;
    });
    row.addEventListener('dragover', function(e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      this.classList.add('drag-over');
    });
    row.addEventListener('dragleave', function() {
      this.classList.remove('drag-over');
    });
    row.addEventListener('drop', function(e) {
      e.preventDefault();
      this.classList.remove('drag-over');
      var to = parseInt(this.getAttribute('data-index'), 10);
      if (qsDragFromIndex >= 0 && qsDragFromIndex !== to) {
        moveQuickSlotModel(qsDragFromIndex, to);
      }
    });
  }
}

function moveQuickSlotModel(from, to) {
  if (from < 0 || from >= qsEditingModels.length) return;
  if (to < 0 || to >= qsEditingModels.length) return;
  if (from === to) return;
  var m = qsEditingModels.splice(from, 1)[0];
  qsEditingModels.splice(to, 0, m);
  renderQuickSlotModelsList();
}

function toggleQuickSlotModelDisabled(i) {
  var fullId = qsEditingModels[i];
  var idx = qsEditingDisabledModels.indexOf(fullId);
  if (idx >= 0) {
    qsEditingDisabledModels.splice(idx, 1);
  } else {
    qsEditingDisabledModels.push(fullId);
  }
  renderQuickSlotModelsList();
}

async function testQuickSlotModel(idx) {
  var fullId = qsEditingModels[idx];
  if (!fullId) return;
  var slashIdx = fullId.indexOf('/');
  var prefix = slashIdx > 0 ? fullId.substring(0, slashIdx) : '';
  var modelId = slashIdx > 0 ? fullId.substring(slashIdx + 1) : fullId;
  var provider = findQsProviderByPrefix(prefix);
  if (!provider) {
    toast(t('modelTestFailed') + 'provider not found', 'error');
    return;
  }
  try {
    var result = await apiPost('/providers/' + provider.id + '/models/test', { model: modelId });
    modelTestStatus[modelId] = result;
    if (!result.ok) {
      toast(t('modelTestFailed') + (result.error || 'unknown error'), 'error');
    }
  } catch (e) {
    toast(t('modelTestFailed') + e.message, 'error');
  }
  renderQuickSlotModelsList();
}

function removeQuickSlotModel(idx) {
  qsEditingModels.splice(idx, 1);
  renderQuickSlotModelsList();
}

// ===================== Header QuickSlots =====================

async function renderHeaderQuickSlots() {
  var container = document.getElementById('quickslot-header');
  if (!container) return;
  try {
    var data = await apiGet('/quickslots');
    var quickslots = (data.quickslots || []).filter(function(qs) { return !qs.disabled; });
    quickslots.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
    if (quickslots.length === 0) {
      container.innerHTML = '';
      container.style.gridTemplateColumns = '';
      return;
    }
    var cols = quickslots.length <= 3 ? quickslots.length : Math.ceil(quickslots.length / 2);
    container.style.gridTemplateColumns = 'repeat(' + cols + ', 110px)';
    var html = '';
    for (var i = 0; i < quickslots.length; i++) {
      var qs = quickslots[i];
      var models = qs.models || [];
      var idx = qs.selectedIndex || 0;
      if (idx < 0 || idx >= models.length) idx = 0;
      var bottom = '—';
      var fullId = models[idx] || '';
      if (models.length > 0) {
        var slashIdx = fullId.indexOf('/');
        var prefix = slashIdx > 0 ? fullId.substring(0, slashIdx) : fullId;
        var modelPart = slashIdx > 0 ? fullId.substring(slashIdx + 1) : '';
        var lastSlashIdx = modelPart.lastIndexOf('/');
        var lastSegment = lastSlashIdx >= 0 ? modelPart.substring(lastSlashIdx + 1) : modelPart;
        bottom = lastSegment ? prefix + '/' + lastSegment : prefix;
      }
      var nameEsc = escapeHtml(qs.name);
      var bottomEsc = escapeHtml(bottom);
      var fullIdEsc = escapeHtml(fullId);
      var num = i + 1;
      var titleAttr = fullIdEsc ? nameEsc + '&#10;' + fullIdEsc : nameEsc;
      html += '<div class="quickslot-btn" onclick="showQuickSlotDropdown(\'' + qs.id + '\')" data-qs-id="' + qs.id + '" title="' + titleAttr + '">\
        <div class="qs-number">' + num + '</div>\
        <div class="qs-content">\
          <div class="qs-name">' + nameEsc + '</div>\
          <div class="qs-bottom">' + bottomEsc + '</div>\
        </div>\
      </div>';
    }
    container.innerHTML = html;
  } catch (e) {
    // ignore render errors (e.g. not yet on settings page)
  }
}

function showQuickSlotDropdown(id) {
  removeQuickSlotDropdown();
  var btn = document.querySelector('.quickslot-btn[data-qs-id="' + id + '"]');
  if (!btn) return;
  Promise.all([apiGet('/quickslots'), apiGet('/models')]).then(function(res) {
    var data = res[0];
    var modelsData = res[1] || {};
    var noteMap = {};
    (modelsData.models || []).forEach(function(m) {
      if (m.note) noteMap[m.id] = m.note;
    });
    var qs = (data.quickslots || []).find(function(x) { return x.id === id; });
    if (!qs) return;
    var models = qs.models || [];
    var sel = qs.selectedIndex || 0;
    var html = '<div class="quickslot-dropdown" id="quickslot-dropdown" style="position:absolute;z-index:1000;background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:8px;min-width:160px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.35)">';
    if (models.length === 0) {
      html += '<div class="quickslot-dropdown-item" style="opacity:0.6">' + escapeHtml('—') + '</div>';
    } else {
      for (var i = 0; i < models.length; i++) {
        var note = noteMap[models[i]] || '';
        var noteAttr = note ? ' data-model-note="' + escapeHtml(note) + '" class="quickslot-dropdown-item has-model-note' + (i === sel ? ' selected' : '') + '"' : ' class="quickslot-dropdown-item' + (i === sel ? ' selected' : '') + '"';
        html += '<div' + noteAttr + ' onclick="selectQuickSlotModel(\'' + id + '\',' + i + ')">' + escapeHtml(models[i]) + '</div>';
      }
    }
    html += '</div>';
    var dd = document.createElement('div');
    dd.innerHTML = html;
    var menu = dd.firstChild;
    document.body.appendChild(menu);
    var rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    setTimeout(function() {
      document.addEventListener('click', closeQuickSlotDropdownOutside);
      document.addEventListener('keydown', closeQuickSlotDropdownEsc);
    }, 0);
  });
}

function closeQuickSlotDropdownOutside(e) {
  var dd = document.getElementById('quickslot-dropdown');
  if (!dd) return;
  if (dd.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.quickslot-btn')) return;
  removeQuickSlotDropdown();
}

function closeQuickSlotDropdownEsc(e) {
  if (e.key === 'Escape') removeQuickSlotDropdown();
}

function removeQuickSlotDropdown() {
  var dd = document.getElementById('quickslot-dropdown');
  if (dd && dd.parentNode) dd.parentNode.removeChild(dd);
  document.removeEventListener('click', closeQuickSlotDropdownOutside);
  document.removeEventListener('keydown', closeQuickSlotDropdownEsc);
}

function closeQuickSlotDropdown() {
  removeQuickSlotDropdown();
}

async function selectQuickSlotModel(id, index) {
  var data = await apiGet('/quickslots');
  var qs = (data.quickslots || []).find(function(x) { return x.id === id; });
  if (!qs) return;
  qs.selectedIndex = index;
  await apiPut('/quickslots/' + id, qs);
  removeQuickSlotDropdown();
  renderHeaderQuickSlots();
}

async function cycleQuickSlotModel(orderNum) {
  var data = await apiGet('/quickslots');
  var quickslots = (data.quickslots || []).filter(function(qs) { return !qs.disabled; });
  var qs = null;
  for (var i = 0; i < quickslots.length; i++) {
    if (quickslots[i].order === orderNum) { qs = quickslots[i]; break; }
  }
  if (!qs) return;
  var models = qs.models || [];
  var disabled = qs.disabledModels || [];
  var enabledIdx = [];
  for (var k = 0; k < models.length; k++) {
    if (disabled.indexOf(models[k]) < 0) enabledIdx.push(k);
  }
  if (enabledIdx.length === 0) return;
  var pos = enabledIdx.indexOf(qs.selectedIndex);
  if (pos < 0) pos = enabledIdx.length - 1;
  var nextPos = (pos + 1) % enabledIdx.length;
  var nextIndex = enabledIdx[nextPos];
  qs.selectedIndex = nextIndex;
  await apiPut('/quickslots/' + qs.id, qs);
  renderHeaderQuickSlots();
  toast(t('quickSlotSwitched', [qs.name, models[nextIndex]]), 'info', 2000, 'quickslot');
}
