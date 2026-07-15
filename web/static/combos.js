// ===================== Combos Page =====================

var comboEditingModels = [];
var comboEditingDisabledModels = [];
var comboProvidersCache = null;

async function renderCombos(c) {
  showSkeleton(c, 3);
  const data = await apiGet('/combos');
  const combos = data.combos || [];
  c.innerHTML = '\
    <h2>' + t('combos') + '</h2>\
    <button type="button" class="btn btn-primary mb-12" onclick="showAddCombo()">' + t('addCombo') + '</button>\
    <div id="combo-list"></div>\
    <div id="combo-form" style="display:none"></div>';
  const list = document.getElementById('combo-list');
  if (combos.length === 0) {
    list.innerHTML = emptyState(t('noCombos'));
    return;
  }
  list.innerHTML = combos.map(function(cb) {
    return '\
    <div class="card' + (cb.disabled ? ' combo-disabled' : '') + '">\
      <div class="card-header">\
        <span class="card-title copyable" data-name="' + escapeHtml(cb.name) + '" onclick="copyToClipboard(this.dataset.name, this.dataset.name)" title="' + t('clickToCopy') + '">' + escapeHtml(cb.name) + '</span>\
        <div class="flex" style="gap:8px">\
          <span class="badge ' + (cb.disabled ? 'badge-inactive' : 'badge-active') + '">' + escapeHtml(cb.strategy) + '</span>\
          <button type="button" class="btn btn-sm" onclick="toggleComboDisabled(\'' + cb.id + '\')">' + (cb.disabled ? t('enable') : t('disable')) + '</button>\
          <button type="button" class="btn btn-sm" onclick="showEditCombo(\'' + cb.id + '\')">' + t('edit') + '</button>\
          <button type="button" class="btn btn-sm btn-danger" onclick="deleteCombo(\'' + cb.id + '\')">' + t('delete') + '</button>\
        </div>\
      </div>\
      <p class="muted">' + t('models') + ' ' + (cb.models ? cb.models.join(', ') : 'none') + '</p>\
    </div>';
  }).join('');
}

async function toggleComboDisabled(id) {
  const data = await apiGet('/combos');
  const cb = (data.combos || []).find(function(x) { return x.id === id; });
  if (!cb) return;
  cb.disabled = !cb.disabled;
  await apiPut('/combos/' + id, cb);
  var settingsPanel = document.querySelector('.settings-panel-section');
  if (settingsPanel) {
    renderEndpoint(document.getElementById('page-content'));
  } else {
    renderCombos(document.getElementById('page-content'));
  }
  toast(cb.disabled ? t('comboDisabled') : t('comboEnabled'), 'success');
}

function showAddCombo() {
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '<div class="modal" style="max-width:520px">\
    <div class="modal-title">' + t('newCombo') + '</div>\
    <div class="form-group"><label for="c-name">' + t('name') + '</label><input id="c-name" placeholder="Fast + Smart"></div>\
    <div class="form-group"><label for="c-strategy">' + t('comboStrategy') + '</label>\
      <select id="c-strategy">\
        <option value="fallback">' + t('fallbackDesc') + '</option>\
        <option value="round-robin">' + t('roundRobinDesc') + '</option>\
        <option value="greedy-squirrel">' + t('greedySquirrelDesc') + '</option>\
      </select>\
    </div>\
    <div class="form-group"><label>' + t('comboModels') + '</label>\
      <div style="display:flex;gap:8px;margin-bottom:8px">\
        <button type="button" class="btn btn-sm" onclick="importModelsFromProvider(\'models\')">' + t('importFromProvider') + '</button>\
      </div>\
      <div id="c-models-list"></div>\
    </div>\
    <div id="greedy-squirrel-hint" class="form-group" style="display:none">\
      <p class="muted">' + t('greedySquirrelHint') + '</p>\
    </div>\
    <div class="modal-footer">\
      <button type="button" class="btn" onclick="closeModalOverlay()">' + t('cancel') + '</button>\
      <button type="button" class="btn btn-primary" onclick="withLoading(this, () => addCombo())">' + t('create') + '</button>\
    </div>\
  </div>';
  requestAnimationFrame(function() { overlay.classList.add('show'); });
  var sel = overlay.querySelector('#c-strategy');
  var hintBox = overlay.querySelector('#greedy-squirrel-hint');
  if (sel && hintBox) {
    function syncHint() {
      hintBox.style.display = (sel.value === 'greedy-squirrel') ? 'block' : 'none';
    }
    sel.addEventListener('change', syncHint);
    syncHint();
  }
  comboEditingModels = [];
  loadComboProvidersAndRender();
}

async function addCombo() {
  const models = comboEditingModels.slice();
  const c = {
    name: document.getElementById('c-name').value,
    strategy: document.getElementById('c-strategy').value,
    models: models
  };
  try {
    const result = await apiPost('/combos', c);
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    closeModalOverlay();
    toast(t('comboCreated'), 'success');
    renderEndpoint(document.getElementById('page-content'));
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function deleteCombo(id) {
  const ok = await confirmModal(t('confirmDeleteCombo'));
  if (!ok) return;
  await apiDelete('/combos/' + id);
  toast(t('comboDeleted'), 'success');
  renderEndpoint(document.getElementById('page-content'));
}

async function showEditCombo(id) {
  const data = await apiGet('/combos');
  const cb = (data.combos || []).find(function(x) { return x.id === id; });
  if (!cb) return;
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '<div class="modal" style="max-width:70vw;width:70vw">\
    <div class="modal-title">' + t('comboEdit') + '</div>\
    <div class="form-group"><label for="c-name">' + t('name') + '</label><input id="c-name" value="' + escapeHtml(cb.name) + '"></div>\
    <div class="form-group"><label for="c-strategy">' + t('comboStrategy') + '</label>\
      <select id="c-strategy">\
        <option value="fallback"' + (cb.strategy === 'fallback' ? ' selected' : '') + '>' + t('fallbackDesc') + '</option>\
        <option value="round-robin"' + (cb.strategy === 'round-robin' ? ' selected' : '') + '>' + t('roundRobinDesc') + '</option>\
        <option value="greedy-squirrel"' + (cb.strategy === 'greedy-squirrel' ? ' selected' : '') + '>' + t('greedySquirrelDesc') + '</option>\
      </select>\
    </div>\
    <div class="form-group"><label>' + t('comboModels') + '</label>\
      <div style="display:flex;gap:8px;margin-bottom:8px">\
        <button type="button" class="btn btn-sm" onclick="importModelsFromProvider(\'models\')">' + t('importFromProvider') + '</button>\
      </div>\
      <div id="c-models-list"></div>\
    </div>\
    <div id="greedy-squirrel-hint" class="form-group" style="display:none">\
      <p class="muted">' + t('greedySquirrelHint') + '</p>\
    </div>\
    <div class="modal-footer">\
      <button type="button" class="btn" onclick="closeModalOverlay()">' + t('cancel') + '</button>\
      <button type="button" class="btn btn-primary" onclick="withLoading(this, () => saveEditCombo(\'' + id + '\'))">' + t('saveCombo') + '</button>\
    </div>\
  </div>';
  requestAnimationFrame(function() { overlay.classList.add('show'); });
  var sel = overlay.querySelector('#c-strategy');
  var hintBox = overlay.querySelector('#greedy-squirrel-hint');
  if (sel && hintBox) {
    function syncHint() {
      hintBox.style.display = (sel.value === 'greedy-squirrel') ? 'block' : 'none';
    }
    sel.addEventListener('change', syncHint);
    syncHint();
  }
  comboEditingModels = (cb.models || []).slice();
  comboEditingDisabledModels = (cb.disabledModels || []).slice();
  loadComboProvidersAndRender();
}

async function saveEditCombo(id) {
  const models = comboEditingModels.slice();
  const c = {
    name: document.getElementById('c-name').value,
    strategy: document.getElementById('c-strategy').value,
    models: models,
    disabledModels: comboEditingDisabledModels
  };
  await apiPut('/combos/' + id, c);
  closeModalOverlay();
  toast(t('comboUpdated'), 'success');
  renderEndpoint(document.getElementById('page-content'));
}

async function importModelsFromProvider(target) {
  importTarget = target || 'models';
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
    renderComboModelsList();
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
      if (comboEditingModels.indexOf(selected[k]) < 0) comboEditingModels.push(selected[k]);
    }
    closeImport();
  };
}

function toggleImportModel(el) {
  el.classList.toggle('selected');
}

async function loadComboProvidersAndRender() {
  if (!comboProvidersCache) {
    var data = await apiGet('/providers');
    comboProvidersCache = (data.providers || []);
  }
  renderComboModelsList();
}

function findProviderByPrefix(prefix) {
  if (!comboProvidersCache) return null;
  for (var i = 0; i < comboProvidersCache.length; i++) {
    if (comboProvidersCache[i].prefix === prefix) return comboProvidersCache[i];
  }
  return null;
}

function renderComboModelsList() {
  var container = document.getElementById('c-models-list');
  if (!container) return;
  if (comboEditingModels.length === 0) {
    container.innerHTML = emptyState(t('noModels'));
    return;
  }
  var html = '';
  for (var i = 0; i < comboEditingModels.length; i++) {
    var fullId = comboEditingModels[i];
    var slashIdx = fullId.indexOf('/');
    var prefix = slashIdx > 0 ? fullId.substring(0, slashIdx) : '';
    var modelId = slashIdx > 0 ? fullId.substring(slashIdx + 1) : fullId;
    var provider = findProviderByPrefix(prefix);
    var pid = provider ? provider.id : '';
    var ts = modelTestStatus[modelId];
    var fullIdEsc = escapeHtml(fullId);
    var modelIdEsc = escapeHtml(modelId);
    var pidEsc = escapeHtml(pid);
    var isDisabled = comboEditingDisabledModels.indexOf(fullId) >= 0;
    var note = provider ? findModelNote(provider, modelId) : '';
    var noteAttr = note ? ' data-model-note="' + escapeHtml(note) + '"' : '';
    var hasNoteCls = note ? ' has-model-note' : '';
    var disabledRowStyle = isDisabled ? ' style="opacity:0.5"' : '';
    var isFirst = i === 0;
    var isLast = i === comboEditingModels.length - 1;
    html += '<div class="model-row' + hasNoteCls + '" data-index="' + i + '" draggable="true"' + disabledRowStyle + '>' +
      '<div class="model-row-main"' + noteAttr + '>' +
        '<span class="drag-handle" title="' + t('dragToReorder') + '" draggable="false">⠿</span>' +
        (isDisabled
          ? '<button type="button" class="btn btn-sm" onclick="toggleComboModelDisabled(' + i + ')">' + t('enable') + '</button>'
          : '<button type="button" class="btn btn-sm" onclick="toggleComboModelDisabled(' + i + ')">' + t('disable') + '</button>') +
        '<button type="button" class="btn btn-sm ' + (ts ? (ts.ok ? 'btn-test-ok' : 'btn-test-err') : '') + '"' + (isDisabled ? ' disabled' : '') + ' onclick="withLoading(this, () => testComboModel(' + i + '))">' + t('test') + '</button>' +
        '<button type="button" class="btn btn-sm btn-info"' + (ts ? '' : ' disabled') + ' onclick="showModelInfo(\'' + escapeForJsString(modelIdEsc) + '\')">' + t('info') + '</button>' +
        '<button type="button" class="btn btn-sm ' + (isFirst ? 'disabled ' : '') + 'onclick="moveComboModel(' + i + ',' + (i - 1) + ')">' + t('moveUp') + '</button>' +
        '<button type="button" class="btn btn-sm ' + (isLast ? 'disabled ' : '') + 'onclick="moveComboModel(' + i + ',' + (i + 1) + ')">' + t('moveDown') + '</button>' +
        '<button type="button" class="btn btn-sm btn-danger" onclick="removeComboModel(' + i + ')">' + t('delete') + '</button>' +
        '<span class="model-id copyable" onclick="copyToClipboard(\'' + fullIdEsc + '\')" title="' + t('clickToCopy') + '">' + fullIdEsc + '</span>' +
      '</div>' +
    '</div>';
  }
  container.innerHTML = html;
  attachComboRowDragHandlers(container);
}

var comboDragFromIndex = -1;

function attachComboRowDragHandlers(container) {
  var rows = container.querySelectorAll('.model-row');
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    row.addEventListener('dragstart', function(e) {
      comboDragFromIndex = parseInt(this.getAttribute('data-index'), 10);
      this.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(comboDragFromIndex)); } catch (err) {}
      }
    });
    row.addEventListener('dragend', function() {
      this.classList.remove('dragging');
      comboDragFromIndex = -1;
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
      if (comboDragFromIndex >= 0 && comboDragFromIndex !== to) {
        moveComboModel(comboDragFromIndex, to);
      }
    });
  }
}

function moveComboModel(from, to) {
  if (from < 0 || from >= comboEditingModels.length) return;
  if (to < 0 || to >= comboEditingModels.length) return;
  if (from === to) return;
  var m = comboEditingModels.splice(from, 1)[0];
  comboEditingModels.splice(to, 0, m);
  renderComboModelsList();
}

function toggleComboModelDisabled(i) {
  var fullId = comboEditingModels[i];
  var idx = comboEditingDisabledModels.indexOf(fullId);
  if (idx >= 0) {
    comboEditingDisabledModels.splice(idx, 1);
  } else {
    comboEditingDisabledModels.push(fullId);
  }
  renderComboModelsList();
}

async function testComboModel(idx) {
  var fullId = comboEditingModels[idx];
  if (!fullId) return;
  var slashIdx = fullId.indexOf('/');
  var prefix = slashIdx > 0 ? fullId.substring(0, slashIdx) : '';
  var modelId = slashIdx > 0 ? fullId.substring(slashIdx + 1) : fullId;
  var provider = findProviderByPrefix(prefix);
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
  renderComboModelsList();
}

function removeComboModel(idx) {
  comboEditingModels.splice(idx, 1);
  renderComboModelsList();
}
