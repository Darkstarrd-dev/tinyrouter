// ===================== Combos Page =====================

async function renderCombos(c) {
  showSkeleton(c, 3);
  const data = await apiGet('/combos');
  const combos = data.combos || [];
  c.innerHTML = '\
    <h2>' + t('combos') + '</h2>\
    <button class="btn btn-primary mb-12" onclick="showAddCombo()">' + t('addCombo') + '</button>\
    <div id="combo-list"></div>\
    <div id="combo-form" style="display:none"></div>';
  const list = document.getElementById('combo-list');
  if (combos.length === 0) {
    list.innerHTML = '<div class="empty">' + t('noCombos') + '</div>';
    return;
  }
  list.innerHTML = combos.map(function(cb) {
    return '\
    <div class="card">\
      <div class="card-header">\
        <span class="card-title">' + escapeHtml(cb.name) + '</span>\
        <span class="badge badge-active">' + escapeHtml(cb.strategy) + '</span>\
      </div>\
      <p class="muted">' + t('models') + ' ' + (cb.models ? cb.models.join(', ') : 'none') + '</p>' +
      (cb.fusionJudge ? '<p class="muted">Judge: ' + escapeHtml(cb.fusionJudge) + '</p>' : '') + '\
      <div class="mt-12" style="display:flex;gap:8px">\
        <button class="btn btn-sm" onclick="showEditCombo(\'' + cb.id + '\')">' + t('editCombo') + '</button>\
        <button class="btn btn-sm btn-danger" onclick="deleteCombo(\'' + cb.id + '\')">' + t('delete') + '</button>\
      </div>\
    </div>';
  }).join('');
}

function showAddCombo() {
  const el = document.getElementById('combo-form');
  el.style.display = 'block';
  el.innerHTML = '\
    <div class="card">\
      <div class="card-title">' + t('newCombo') + '</div>\
      <div class="form-group mt-12"><label>' + t('name') + '</label><input id="c-name" placeholder="Fast + Smart"></div>\
      <div class="form-group"><label>' + t('comboStrategy') + '</label>\
        <select id="c-strategy">\
          <option value="fallback">' + t('fallbackDesc') + '</option>\
          <option value="round-robin">' + t('roundRobinDesc') + '</option>\
          <option value="fusion">' + t('fusionDesc') + '</option>\
        </select>\
      </div>\
      <div class="form-group"><label>' + t('comboModels') + '</label>\
        <div style="display:flex;gap:8px;margin-bottom:8px">\
          <button class="btn btn-sm" onclick="importModelsFromProvider(\'models\')">' + t('importFromProvider') + '</button>\
        </div>\
        <textarea id="c-models" rows="3" placeholder="deepseek/deepseek-chat\nmy-custom/gpt-4o"></textarea>\
      </div>\
      <div class="form-group"><label>' + t('fusionJudge') + '</label>\
        <div style="display:flex;gap:8px;margin-bottom:8px">\
          <button class="btn btn-sm" onclick="importModelsFromProvider(\'judge\')">' + t('importFromProvider') + '</button>\
        </div>\
        <input id="c-judge" placeholder="deepseek/deepseek-chat"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn btn-primary" onclick="addCombo()">' + t('create') + '</button>\
        <button class="btn" onclick="document.getElementById(\'combo-form\').style.display=\'none\'">' + t('cancel') + '</button>\
      </div>\
    </div>';
}

async function addCombo() {
  const models = document.getElementById('c-models').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
  const c = {
    name: document.getElementById('c-name').value,
    strategy: document.getElementById('c-strategy').value,
    models: models,
    fusionJudge: document.getElementById('c-judge').value || null
  };
  await apiPost('/combos', c);
  document.getElementById('combo-form').style.display = 'none';
  toast(t('comboCreated'), 'success');
  renderCombos(document.getElementById('page-content'));
}

async function deleteCombo(id) {
  const ok = await confirmModal(t('confirmDeleteCombo'));
  if (!ok) return;
  await apiDelete('/combos/' + id);
  toast(t('comboDeleted'), 'success');
  renderCombos(document.getElementById('page-content'));
}

async function showEditCombo(id) {
  const data = await apiGet('/combos');
  const cb = (data.combos || []).find(function(x) { return x.id === id; });
  if (!cb) return;
  const el = document.getElementById('combo-form');
  el.style.display = 'block';
  el.innerHTML = '\
    <div class="card">\
      <div class="card-title">' + t('comboEdit') + '</div>\
      <div class="form-group mt-12"><label>' + t('name') + '</label><input id="c-name" value="' + escapeHtml(cb.name) + '"></div>\
      <div class="form-group"><label>' + t('comboStrategy') + '</label>\
        <select id="c-strategy">\
          <option value="fallback"' + (cb.strategy === 'fallback' ? ' selected' : '') + '>' + t('fallbackDesc') + '</option>\
          <option value="round-robin"' + (cb.strategy === 'round-robin' ? ' selected' : '') + '>' + t('roundRobinDesc') + '</option>\
          <option value="fusion"' + (cb.strategy === 'fusion' ? ' selected' : '') + '>' + t('fusionDesc') + '</option>\
        </select>\
      </div>\
      <div class="form-group"><label>' + t('comboModels') + '</label>\
        <div style="display:flex;gap:8px;margin-bottom:8px">\
          <button class="btn btn-sm" onclick="importModelsFromProvider(\'models\')">' + t('importFromProvider') + '</button>\
        </div>\
        <textarea id="c-models" rows="3" placeholder="deepseek/deepseek-chat\nmy-custom/gpt-4o">' + escapeHtml((cb.models || []).join('\n')) + '</textarea>\
      </div>\
      <div class="form-group"><label>' + t('fusionJudge') + '</label>\
        <div style="display:flex;gap:8px;margin-bottom:8px">\
          <button class="btn btn-sm" onclick="importModelsFromProvider(\'judge\')">' + t('importFromProvider') + '</button>\
        </div>\
        <input id="c-judge" value="' + escapeHtml(cb.fusionJudge || '') + '" placeholder="deepseek/deepseek-chat"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn btn-primary" onclick="saveEditCombo(\'' + id + '\')">' + t('saveCombo') + '</button>\
        <button class="btn" onclick="document.getElementById(\'combo-form\').style.display=\'none\'">' + t('cancel') + '</button>\
      </div>\
    </div>';
}

async function saveEditCombo(id) {
  const models = document.getElementById('c-models').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
  const c = {
    name: document.getElementById('c-name').value,
    strategy: document.getElementById('c-strategy').value,
    models: models,
    fusionJudge: document.getElementById('c-judge').value || null
  };
  await apiPut('/combos/' + id, c);
  document.getElementById('combo-form').style.display = 'none';
  toast(t('comboUpdated'), 'success');
  renderCombos(document.getElementById('page-content'));
}

async function importModelsFromProvider(target) {
  importTarget = target || 'models';
  var providers = await apiGet('/providers');
  providers = providers.providers || [];
  if (providers.length === 0) {
    toast(t('noModelsAvailable'), 'warning');
    return;
  }
  var html = '<div class="modal" style="max-width:500px">\
    <div class="modal-title">' + t('selectModels') + '</div>\
    <div class="modal-body" style="max-height:400px;overflow-y:auto">\
    <div style="display:flex;gap:6px;margin-bottom:12px">\
      <button class="btn btn-sm" id="import-select-all">' + t('selectAll') + '</button>\
      <button class="btn btn-sm" id="import-deselect-all">' + t('deselectAll') + '</button>\
    </div>';
  for (var i = 0; i < providers.length; i++) {
    var p = providers[i];
    if (!p.isActive) continue;
    var models = p.models || [];
    html += '<div style="margin-bottom:12px"><strong>' + escapeHtml(p.name) + ' (' + escapeHtml(p.prefix) + ')</strong></div>';
    if (models.length === 0) {
      html += '<div class="muted" style="margin-bottom:8px">' + t('noModels') + '</div>';
    } else {
      for (var j = 0; j < models.length; j++) {
        var fullId = p.prefix + '/' + models[j];
        html += '<div class="import-model-item" data-value="' + escapeHtml(fullId) + '" onclick="toggleImportModel(this)" style="padding:6px 10px;margin-bottom:3px;border-radius:6px;cursor:pointer;transition:background .15s;border:1px solid transparent">' + escapeHtml(fullId) + '</div>';
      }
    }
  }
  html += '</div>\
    <div class="modal-footer">\
      <button class="btn btn-ghost" id="import-close">' + t('close') + '</button>\
      <button class="btn btn-primary" id="import-add">' + t('addSelected') + '</button>\
    </div></div>';
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = html;
  var isSingle = target === 'judge';
  requestAnimationFrame(function() { overlay.classList.add('show'); });
  document.getElementById('import-close').onclick = function() {
    overlay.classList.remove('show');
    overlay.addEventListener('transitionend', function() { overlay.innerHTML = ''; }, { once: true });
  };
  document.getElementById('import-select-all').onclick = function() {
    var items = document.querySelectorAll('.import-model-item');
    for (var k = 0; k < items.length; k++) { items[k].classList.add('selected'); if (isSingle) break; }
  };
  document.getElementById('import-deselect-all').onclick = function() {
    var items = document.querySelectorAll('.import-model-item');
    for (var k = 0; k < items.length; k++) { items[k].classList.remove('selected'); }
  };
  document.getElementById('import-add').onclick = function() {
    var selected = [];
    var items = document.querySelectorAll('.import-model-item.selected');
    for (var k = 0; k < items.length; k++) selected.push(items[k].getAttribute('data-value'));
    if (target === 'judge') {
      var inp = document.getElementById('c-judge');
      if (inp && selected.length > 0) inp.value = selected[0];
    } else {
      var ta = document.getElementById('c-models');
      if (ta && selected.length > 0) {
        var existing = ta.value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
        for (var k = 0; k < selected.length; k++) {
          if (existing.indexOf(selected[k]) < 0) existing.push(selected[k]);
        }
        ta.value = existing.join('\n');
      }
    }
    overlay.classList.remove('show');
    overlay.addEventListener('transitionend', function() { overlay.innerHTML = ''; }, { once: true });
  };
  overlay.onclick = function(e) { if (e.target === overlay) { overlay.classList.remove('show'); overlay.addEventListener('transitionend', function() { overlay.innerHTML = ''; }, { once: true }); } };
}

function toggleImportModel(el) {
  if (importTarget === 'judge') {
    var items = document.querySelectorAll('.import-model-item');
    for (var i = 0; i < items.length; i++) { items[i].classList.remove('selected'); }
    el.classList.add('selected');
  } else {
    el.classList.toggle('selected');
  }
}
