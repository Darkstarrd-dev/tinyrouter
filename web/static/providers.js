// ===================== Providers Page =====================

var expandedModelDetails = new Set();
var allKeysTestResults = {};
var batchManageMode = false;
var batchSelectedModels = new Set();

async function renderProviders(c) {
  if (currentProviderId) {
    showSkeleton(c, 1);
    await renderProviderDetail(c, currentProviderId);
    return;
  }
  showSkeleton(c, 3);
  const data = await apiGet('/providers');
  providersCache = data.providers || [];
  c.innerHTML = '\
    <h2>' + t('providers') + '</h2>\
    <button type="button" class="btn btn-primary mb-12" onclick="showAddProvider()">' + t('addProvider') + '</button>\
    <div id="provider-list"></div>\
    <div id="provider-form" style="display:none"></div>';
  renderProviderList();
}

function renderProviderList() {
  const el = document.getElementById('provider-list');
  if (providersCache.length === 0) {
    el.innerHTML = emptyState(t('noProviders'));
    return;
  }
  el.innerHTML = providersCache.map(function(p) {
    var brand = getProviderBrand(p.name);
    var brandStyle = brand ? ' style="border-left:3px solid ' + brand + ';padding-left:18px"' : '';
    return '\
    <div class="card provider-card"' + brandStyle + ' onclick="openProviderDetail(\'' + p.id + '\')">\
      <div class="card-header">\
        <span class="card-title">' + escapeHtml(p.name) + '</span>\
        <div class="flex" style="gap:8px">\
          <span class="badge ' + (p.isActive ? 'badge-active' : 'badge-inactive') + '">' + (p.isActive ? t('active') : t('inactive')) + '</span>\
          <button type="button" class="btn btn-sm" onclick="toggleProviderList(event, \'' + p.id + '\',' + (!p.isActive) + ')">' + (p.isActive ? t('disable') : t('enable')) + '</button>\
        </div>\
      </div>\
      <p class="muted">' + t('prefix') + ' <span class="code">' + escapeHtml(p.prefix) + '</span> | ' + t('baseUrl') + ' <span class="code">' + escapeHtml(p.baseUrl) + '</span></p>\
      <p class="muted mt-12">' + t('keys') + ' ' + (p.keys ? p.keys.length : 0) + ' | ' + t('models') + ' ' + (p.models ? p.models.length : 0) + '</p>\
    </div>';
  }).join('');
}

function openProviderDetail(id) {
  currentProviderId = id;
  renderProviders(document.getElementById('page-content'));
}

async function toggleProviderList(event, id, active) {
  event.stopPropagation();
  var p = providersCache.find(function(x) { return x.id === id; });
  if (!p) return;
  p.isActive = active;
  await apiPut('/providers/' + id, p);
  renderProviderList();
  toast(active ? t('providerEnabled') : t('providerDisabled'), 'success');
}

function backToProviderList() {
  currentProviderId = null;
  providerDetailCache = null;
  modelTestStatus = {};
  expandedModelDetails = new Set();
  allKeysTestResults = {};
  renderEndpoint(document.getElementById('page-content'));
}

function showAddProvider() {
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '<div class="modal" style="max-width:520px">\
    <div class="modal-title">' + t('newProvider') + '</div>\
    <div class="form-group"><label for="p-name">' + t('name') + '</label><input id="p-name" placeholder="DeepSeek"></div>\
    <div class="form-group"><label for="p-prefix">' + t('prefixLabel') + '</label><input id="p-prefix" placeholder="deepseek"></div>\
    <div class="form-group"><label for="p-url">' + t('baseUrlLabel') + '</label><input id="p-url" placeholder="https://api.deepseek.com"></div>\
    <div class="form-group"><label for="p-apikey">' + t('apiKeyLabel') + '</label><input type="password" id="p-apikey" placeholder="sk-..."></div>\
    <div class="form-group"><label for="p-modelid">' + t('modelIdLabel') + '</label><input id="p-modelid" placeholder="deepseek-chat"></div>\
    <div id="p-check-result" class="mt-12"></div>\
    <div class="modal-footer">\
      <button type="button" class="btn" onclick="closeModalOverlay()">' + t('cancel') + '</button>\
      <button type="button" class="btn" onclick="withLoading(this, () => checkProvider())">' + t('check') + '</button>\
      <button type="button" class="btn btn-primary" onclick="withLoading(this, () => addProvider())">' + t('create') + '</button>\
    </div>\
  </div>';
  requestAnimationFrame(function() { overlay.classList.add('show'); });
  overlay.onclick = function(e) { if (e.target === overlay) closeModalOverlay(); };
}

async function checkProvider() {
  const baseUrl = document.getElementById('p-url').value.trim();
  const apiKey = document.getElementById('p-apikey').value.trim();
  const modelId = document.getElementById('p-modelid').value.trim();
  const resultEl = document.getElementById('p-check-result');
  if (!baseUrl || !apiKey) {
    resultEl.innerHTML = '<span class="badge badge-invalid">' + t('baseUrlKeyRequired') + '</span>';
    return;
  }
  resultEl.innerHTML = '<span class="badge badge-testing">' + t('checking') + '</span>';
  try {
    const result = await apiPost('/providers/validate', { baseUrl: baseUrl, apiKey: apiKey, modelId: modelId || undefined });
    if (result.valid) {
      const method = result.method ? ' (via ' + result.method + ')' : '';
      resultEl.innerHTML = '<span class="badge badge-valid">' + t('validProvider') + method + '</span>';
    } else {
      resultEl.innerHTML = '<span class="badge badge-invalid">' + t('invalidProvider', [result.error || 'unknown error']) + '</span>';
    }
  } catch (e) {
    resultEl.innerHTML = '<span class="badge badge-invalid">' + t('failed', [e.message]) + '</span>';
  }
}

async function addProvider() {
  const p = {
    name: document.getElementById('p-name').value.trim(),
    prefix: document.getElementById('p-prefix').value.trim(),
    baseUrl: document.getElementById('p-url').value.trim(),
    apiType: 'openai-compatible',
    isActive: true,
    keys: [],
    models: []
  };
  if (!p.name || !p.prefix || !p.baseUrl) {
    toast(t('requiredFields'), 'error');
    return;
  }
  await apiPost('/providers', p);
  closeModalOverlay();
  toast(t('providerCreated'), 'success');
  renderProviders(document.getElementById('page-content'));
}

async function renderProviderDetail(c, id) {
  showSkeleton(c, 1);
  const data = await apiGet('/providers');
  const p = (data.providers || []).find(function(x) { return x.id === id; });
  if (!p) {
    c.innerHTML = emptyState(t('providerNotFound'));
    return;
  }
  providerDetailCache = p;
  c.innerHTML = '\
    <div class="detail-header">\
      <h2>' + escapeHtml(p.name) + '</h2>\
      <div class="flex" style="gap:8px">\
        <button type="button" class="btn btn-sm" onclick="backToProviderList()">' + t('back') + '</button>\
        <button type="button" class="btn btn-sm" onclick="showEditProvider(\'' + p.id + '\')">' + t('edit') + '</button>\
        <button type="button" class="btn btn-sm ' + (p.isActive ? '' : 'btn-primary') + '" onclick="toggleProvider(\'' + p.id + '\',' + (!p.isActive) + ')">' + (p.isActive ? t('disable') : t('enable')) + '</button>\
        <button type="button" class="btn btn-sm btn-danger" onclick="deleteProvider(\'' + p.id + '\')">' + t('delete') + '</button>\
      </div>\
    </div>\
    <div id="detail-info">\
      <div class="card">\
        <p class="muted">' + t('prefix') + ' <span class="code">' + escapeHtml(p.prefix) + '</span> | ' + t('baseUrl') + ' <span class="code">' + escapeHtml(p.baseUrl) + '</span></p>\
      </div>\
    </div>\
    <div id="detail-keys"></div>\
    <div id="detail-rotation"></div>\
    <div id="detail-models"></div>';
  renderDetailKeys(p);
  renderDetailRotation(p);
  renderDetailModels(p);
}

function renderDetailKeys(p) {
  const el = document.getElementById('detail-keys');
  const keys = p.keys || [];
  el.innerHTML = '\
    <div class="card">\
      <div class="section-title">' + t('keysTitle') + ' (' + keys.length + ')</div>\
      <div class="flex mb-12" style="gap:8px">\
        <button type="button" class="btn btn-sm btn-primary" onclick="showAddKeyDetail(\'' + p.id + '\')">' + t('addKey') + '</button>\
        <button type="button" class="btn btn-sm" onclick="showBulkAddKeys(\'' + p.id + '\')">' + t('bulkAdd') + '</button>\
      </div>\
      <div id="key-form-' + p.id + '"></div>' +
      (keys.length === 0 ? emptyState(t('noKeys')) : '\
      <table>\
        <thead><tr><th>' + t('keyName') + '</th><th>' + t('actions') + '</th><th>' + t('key') + '</th><th>' + t('priority') + '</th><th>' + t('status') + '</th></tr></thead>\
        <tbody>' +
          keys.map(function(k) {
            return '<tr>\
              <td>' + escapeHtml(k.name) + '</td>\
              <td>\
                <button type="button" class="btn btn-sm" onclick="withLoading(this, () => testKeyDetail(\'' + p.id + '\',\'' + k.id + '\'))">' + t('test') + '</button>\
                <button type="button" class="btn btn-sm" onclick="toggleKeyDetail(\'' + p.id + '\',\'' + k.id + '\',' + (!k.isActive) + ')">' + (k.isActive ? t('pause') : t('resume')) + '</button>\
                <button type="button" class="btn btn-sm btn-danger" onclick="deleteKeyDetail(\'' + p.id + '\',\'' + k.id + '\')">' + t('delete') + '</button>\
              </td>\
              <td><span class="code copyable" data-copy="' + escapeHtml(k.key) + '" onclick="copyToClipboard(this.getAttribute(\'data-copy\'), \'' + escapeHtml(k.name || 'key') + '\')" title="' + t('clickToCopy') + '">' + maskKey(k.key) + '</span></td>\
              <td>' + k.priority + '</td>\
              <td><span class="badge ' + (k.isActive ? 'badge-active' : 'badge-inactive') + '">' + (k.isActive ? t('active') : t('pause')) + '</span></td>\
            </tr>';
          }).join('') + '\
        </tbody>\
      </table>') + '\
    </div>';
}

function showAddKeyDetail(providerId) {
  const el = document.getElementById('key-form-' + providerId);
  el.innerHTML = '\
    <div class="card" style="background:var(--glass-bg)">\
      <div class="card-title">' + t('newKey') + '</div>\
      <div class="form-group mt-12"><label for="dk-name">' + t('keyName') + '</label><input id="dk-name" placeholder="Main"></div>\
      <div class="form-group"><label for="dk-key">' + t('apiKeyInput') + '</label><input type="password" id="dk-key" placeholder="sk-..."></div>\
      <div class="form-group"><label for="dk-priority">' + t('priorityLabel') + '</label><input type="number" id="dk-priority" value="1" style="max-width:120px"></div>\
      <div class="flex" style="gap:8px">\
        <button type="button" class="btn btn-primary" onclick="withLoading(this, () => addKeyDetail(\'' + providerId + '\'))">' + t('create') + '</button>\
        <button type="button" class="btn" onclick="document.getElementById(\'key-form-' + providerId + '\').innerHTML=\'\'">' + t('cancel') + '</button>\
      </div>\
    </div>';
}

async function addKeyDetail(providerId) {
  const k = {
    name: document.getElementById('dk-name').value.trim(),
    key: document.getElementById('dk-key').value.trim(),
    priority: parseInt(document.getElementById('dk-priority').value) || 1,
    isActive: true
  };
  if (!k.key) { toast(t('apiKeyRequired'), 'error'); return; }
  await apiPost('/providers/' + providerId + '/keys', k);
  toast(t('keyAdded'), 'success');
  currentProviderId = providerId;
  const data = await apiGet('/providers');
  const p = (data.providers || []).find(function(x) { return x.id === providerId; });
  if (p) {
    providerDetailCache = p;
    renderDetailKeys(p);
    renderDetailModels(p);
  }
  const formEl = document.getElementById('key-form-' + providerId);
  if (formEl) formEl.innerHTML = '';
}

function showBulkAddKeys(providerId) {
  const el = document.getElementById('key-form-' + providerId);
  el.innerHTML = '\
    <div class="card" style="background:var(--glass-bg)">\
      <div class="card-title">' + t('bulkAddKeys') + '</div>\
      <p class="muted mt-12">' + t('bulkFormat') + '</p>\
      <div class="form-group mt-12"><textarea id="bk-textarea" rows="8" placeholder="Main|sk-aaa\nBackup|sk-bbb\nsk-ccc"></textarea></div>\
      <div class="form-group"><label for="bk-priority">' + t('defaultPriority') + '</label><input type="number" id="bk-priority" value="1" style="max-width:120px"></div>\
      <div class="flex" style="gap:8px">\
        <button type="button" class="btn btn-primary" onclick="withLoading(this, () => bulkAddKeys(\'' + providerId + '\'))">' + t('addAll') + '</button>\
        <button type="button" class="btn" onclick="document.getElementById(\'key-form-' + providerId + '\').innerHTML=\'\'">' + t('cancel') + '</button>\
      </div>\
      <div id="bk-result" class="mt-12"></div>\
    </div>';
}

async function bulkAddKeys(providerId) {
  const text = document.getElementById('bk-textarea').value;
  const priority = parseInt(document.getElementById('bk-priority').value) || 1;
  const lines = text.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
  const keys = lines.map(function(line) {
    const idx = line.indexOf('|');
    if (idx > 0) {
      return { name: line.slice(0, idx).trim(), key: line.slice(idx + 1).trim(), priority: priority };
    }
    return { name: '', key: line.trim(), priority: priority };
  });
  const resultEl = document.getElementById('bk-result');
  resultEl.innerHTML = '<span class="badge badge-testing">' + t('adding') + '</span>';
  const result = await apiPost('/providers/' + providerId + '/keys/bulk', { keys: keys });
  if (result.error) {
    resultEl.innerHTML = '<span class="badge badge-invalid">' + escapeHtml(result.error) + '</span>';
  } else if (result.warning) {
    resultEl.innerHTML = '<span class="badge badge-valid">' + t('addedKeys', [result.added]) + '</span> <span class="badge badge-invalid">' + escapeHtml(result.warning) + '</span>';
  } else if (result.errors && result.errors.length > 0) {
    resultEl.innerHTML = '<span class="badge badge-valid">' + t('addedKeysErrors', [result.added]) + '</span> <span class="badge badge-invalid">Errors: ' + result.errors.length + '</span>';
  } else {
    resultEl.innerHTML = '<span class="badge badge-valid">' + t('addedKeys', [result.added]) + '</span>';
  }
  setTimeout(async function() {
    currentProviderId = providerId;
    const data = await apiGet('/providers');
    const p = (data.providers || []).find(function(x) { return x.id === providerId; });
    if (p) {
      providerDetailCache = p;
      renderDetailKeys(p);
      renderDetailModels(p);
    }
    const formEl = document.getElementById('key-form-' + providerId);
    if (formEl) formEl.innerHTML = '';
  }, 1000);
}

async function testKeyDetail(pid, kid) {
  const result = await apiPost('/providers/' + pid + '/test', { keyId: kid });
  if (result.valid) {
    toast(t('keyValid'), 'success');
  } else {
    toast(t('keyInvalid') + (result.error || 'unknown error'), 'error');
  }
}

async function toggleKeyDetail(pid, kid, active) {
  const p = providerDetailCache;
  const k = (p.keys || []).find(function(x) { return x.id === kid; });
  if (!k) return;
  k.isActive = active;
  await apiPut('/providers/' + pid + '/keys/' + kid, k);
  currentProviderId = pid;
  const data = await apiGet('/providers');
  const np = (data.providers || []).find(function(x) { return x.id === pid; });
  if (np) {
    providerDetailCache = np;
    renderDetailKeys(np);
    renderDetailModels(np);
  }
}

async function deleteKeyDetail(pid, kid) {
  var ok = await confirmModal(t('confirmDeleteKey'));
  if (!ok) return;
  await apiDelete('/providers/' + pid + '/keys/' + kid);
  toast(t('keyDeleted'), 'success');
  currentProviderId = pid;
  const data = await apiGet('/providers');
  const p = (data.providers || []).find(function(x) { return x.id === pid; });
  if (p) {
    providerDetailCache = p;
    renderDetailKeys(p);
    renderDetailModels(p);
  }
}

function renderDetailRotation(p) {
  const el = document.getElementById('detail-rotation');
  const strategy = p.rotationStrategy || '';
  const sticky = p.stickyLimit || 0;
  el.innerHTML = '\
    <div class="card">\
      <div class="section-title">' + t('rotationSection') + '</div>\
      <p class="muted mb-12">' + t('rotationDesc') + '</p>\
      <div class="form-group">\
        <label for="r-strategy">' + t('strategy') + '</label>\
        <select id="r-strategy">\
          <option value=""' + (strategy === '' ? ' selected' : '') + '>' + t('inheritGlobal') + '</option>\
          <option value="fill-first"' + (strategy === 'fill-first' ? ' selected' : '') + '>' + t('fillFirst') + '</option>\
          <option value="round-robin"' + (strategy === 'round-robin' ? ' selected' : '') + '>' + t('roundRobin') + '</option>\
          <option value="failover"' + (strategy === 'failover' ? ' selected' : '') + '>' + t('failover') + '</option>\
        </select>\
      </div>\
      <div class="form-group">\
        <label for="r-sticky">' + t('stickyLabel') + '</label>\
        <input type="number" id="r-sticky" value="' + sticky + '" style="max-width:120px">\
      </div>\
      <button type="button" class="btn btn-primary" onclick="withLoading(this, () => saveProviderRotation(\'' + p.id + '\'))">' + t('save') + '</button>\
    </div>';
}

async function saveProviderRotation(id) {
  const p = providerDetailCache;
  const strategy = document.getElementById('r-strategy').value;
  const sticky = parseInt(document.getElementById('r-sticky').value) || 0;
  p.rotationStrategy = strategy;
  p.stickyLimit = sticky;
  await apiPut('/providers/' + id, p);
  toast(t('rotationStrategySaved'), 'success');
}

function buildModelRowMainInner(p, m) {
  var ts = modelTestStatus[m.id];
  var quotaStr = '';
  if (ts) {
    if (ts.quotaTotal > 0) quotaStr = ts.quotaRemain + '/' + ts.quotaTotal;
  }
  var midEsc = escapeHtml(m.id);
  var pidEsc = escapeHtml(p.id);
  var prefixEsc = escapeHtml(p.prefix);
  var allRes = allKeysTestResults[p.id + '/' + m.id];
  var allBadge = '';
  if (allRes && allRes.results) {
    var okCnt = 0, failCnt = 0;
    allRes.results.forEach(function(r) { if (r.ok) okCnt++; else failCnt++; });
    allBadge = '<span class="model-alltest-badge show"><span class="ok">' + okCnt + '</span>/<span class="fail">' + failCnt + '</span></span>';
  } else {
    allBadge = '<span class="model-alltest-badge"></span>';
  }
  var chevronDown = '<svg class="quota-bar-chevron model-row-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  var rowOnclick = batchManageMode
    ? 'batchToggleModel(\'' + midEsc + '\')'
    : 'toggleModelDetailRow(event, \'' + pidEsc + '\', \'' + midEsc + '\')';
  var modelIdOnclick = batchManageMode
    ? 'event.stopPropagation(); batchToggleModel(\'' + midEsc + '\')'
    : 'event.stopPropagation(); copyToClipboard(\'' + prefixEsc + '/' + midEsc + '\')';
  return '<div class="model-row-main" onclick="' + rowOnclick + '">' +
    chevronDown +
    (ts
      ? (ts.ok
          ? '<span class="model-status model-ok" title="' + (ts.latencyMs != null ? ts.latencyMs + 'ms' : '') + '">' + (quotaStr ? 'OK <span class="model-quota-inline">' + escapeHtml(quotaStr) + '</span>' : 'OK') + '</span>'
          : '<span class="model-status model-err" title="' + escapeHtml(ts.error || 'failed') + '">FAIL</span>')
      : '<button type="button" class="btn btn-sm" onclick="event.stopPropagation(); withLoading(this, () => testSingleModel(\'' + pidEsc + '\', \'' + midEsc + '\'))">' + t('test') + '</button>') +
    (ts
      ? '<button type="button" class="btn btn-sm btn-info" onclick="event.stopPropagation(); showModelInfo(\'' + midEsc + '\')">' + t('info') + '</button>'
      : '<button type="button" class="btn btn-sm" disabled>' + t('info') + '</button>') +
    '<select class="model-quota-select" onclick="event.stopPropagation()" onchange="updateModelQuotaType(\'' + pidEsc + '\', this)" data-model="' + midEsc + '">' +
      '<option value="unlimited"' + (m.quotaType === 'unlimited' ? ' selected' : '') + '>' + t('unlimited') + '</option>' +
      '<option value="limited"' + (m.quotaType === 'limited' || !m.quotaType ? ' selected' : '') + '>' + t('limited') + '</option>' +
      '<option value="paid"' + (m.quotaType === 'paid' ? ' selected' : '') + '>' + t('paid') + '</option>' +
    '</select>' +
    allBadge +
    '<span class="model-quota-numbers"></span>' +
    '<button type="button" class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteModelDetail(\'' + pidEsc + '\', \'' + midEsc + '\')">' + t('delete') + '</button>' +
    '<span class="model-id copyable" onclick="' + modelIdOnclick + '" title="' + t('clickToCopy') + '">' + prefixEsc + '/' + midEsc + '</span>' +
  '</div>';
}

function renderDetailModels(p) {
  const el = document.getElementById('detail-models');
  const models = p.models || [];
  var modelsHtml = models.map(function(m) {
    var rowId = 'mrow-' + sanitizeId(p.id) + '-' + sanitizeId(m.id);
    var detailId = 'mdetail-' + sanitizeId(p.id) + '-' + sanitizeId(m.id);
    var batchSelected = batchSelectedModels.has(m.id);
    var batchClass = (batchManageMode && batchSelected) ? ' batch-selected' : '';
    return '<div class="model-row' + batchClass + '" id="' + rowId + '" data-batch-mid="' + escapeHtml(m.id) + '">' +
      buildModelRowMainInner(p, m) +
      '<div class="model-key-detail-wrap" id="' + detailId + '"></div>' +
    '</div>';
  }).join('');
  el.innerHTML = '\
    <div class="card">\
      <div class="section-title">' + t('modelsTitle') + ' (' + models.length + ')</div>\
      <div class="flex mb-12" style="gap:8px">\
        <input id="m-input" placeholder="' + t('modelPlaceholder') + '" style="flex:1">\
        <button type="button" class="btn btn-sm" onclick="withLoading(this, () => testModelDetail(\'' + escapeHtml(p.id) + '\'))">' + t('test') + '</button>\
        <button type="button" class="btn btn-sm btn-primary" onclick="withLoading(this, () => addModelDetail(\'' + escapeHtml(p.id) + '\'))">' + t('create') + '</button>\
      </div>\
      <div class="flex mb-12" style="gap:8px">\
        <button type="button" class="btn btn-sm" onclick="withLoading(this, () => importModels(\'' + escapeHtml(p.id) + '\'))">' + t('importModels') + '</button>\
        <button type="button" class="btn btn-sm" id="batch-manage-btn" onclick="enterBatchManage(\'' + escapeHtml(p.id) + '\')" style="display:' + (batchManageMode ? 'none' : '') + '">' + t('batchManage') + '</button>\
        <div id="batch-actions" style="display:' + (batchManageMode ? 'flex' : 'none') + ';gap:8px">\
          <button type="button" class="btn btn-sm" onclick="batchSelectAll()">' + t('selectAll') + '</button>\
          <button type="button" class="btn btn-sm" onclick="batchInvert()">' + t('invertSelection') + '</button>\
          <button type="button" class="btn btn-sm btn-danger" onclick="batchConfirm(\'' + escapeHtml(p.id) + '\')">' + t('confirm') + '</button>\
          <button type="button" class="btn btn-sm" onclick="batchCancel()">' + t('cancel') + '</button>\
        </div>\
      </div>\
      <div id="m-test-result" class="mb-12"></div>\
      <div id="model-list">' + (models.length === 0 ? emptyState(t('noModels')) : modelsHtml) + '</div>\
    </div>';
  // 重新展开之前打开的模型
  expandedModelDetails.forEach(function(setKey) {
    var parts = JSON.parse(setKey);
    if (parts[0] === p.id) {
      reexpandModelDetailRow(parts[0], parts[1]);
    }
  });
}

function toggleModelDetailRow(e, pid, mid) {
  if (e && e.target && e.target.closest) {
    if (e.target.closest('button, select, .copyable')) return;
  }
  var rowId = 'mrow-' + sanitizeId(pid) + '-' + sanitizeId(mid);
  var detailId = 'mdetail-' + sanitizeId(pid) + '-' + sanitizeId(mid);
  var wrap = document.getElementById(detailId);
  if (!wrap) return;
  var item = document.getElementById(rowId);
  var chevron = item ? item.querySelector('.model-row-chevron') : null;
  var key = JSON.stringify([pid, mid]);
  if (expandedModelDetails.has(key)) {
    expandedModelDetails.delete(key);
    wrap.classList.remove('expanded');
    if (chevron) chevron.style.transform = '';
    setTimeout(function() { if (!expandedModelDetails.has(key)) wrap.innerHTML = ''; }, 300);
  } else {
    expandedModelDetails.add(key);
    wrap.classList.add('expanded');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    wrap.innerHTML = '<div class="model-key-detail-loading">' + t('loading') + '...</div>';
    fetchModelDetailRow(pid, mid);
  }
}

async function fetchModelDetailRow(pid, mid) {
  var detailId = 'mdetail-' + sanitizeId(pid) + '-' + sanitizeId(mid);
  var wrap = document.getElementById(detailId);
  if (!wrap) return;
  try {
    var p = providerDetailCache;
    var data = await apiGet('/usage/model-keys?provider=' + encodeURIComponent(p.name) + '&model=' + encodeURIComponent(mid));
    renderModelKeyDetailRow(pid, mid, data);
  } catch (e) {
    wrap.innerHTML = '<div class="model-key-detail-empty">' + escapeHtml(e.message || String(e)) + '</div>';
  }
}

function renderModelKeyDetailRow(pid, mid, data) {
  var detailId = 'mdetail-' + sanitizeId(pid) + '-' + sanitizeId(mid);
  var wrap = document.getElementById(detailId);
  if (!wrap) return;
  if (!data || !data.keys || data.keys.length === 0) {
    wrap.innerHTML = '<div class="model-key-detail-empty">' + t('noKeysConfigured') + '</div>';
    return;
  }
  // Actions row first (Run All-Keys Test button + status)
  var html = '<div class="model-key-detail-actions">' +
    '<button type="button" class="btn btn-sm btn-primary" id="run-alltest-' + sanitizeId(pid) + '-' + sanitizeId(mid) + '" onclick="runAllKeysTest(\'' + escapeHtml(pid) + '\', \'' + escapeHtml(mid) + '\')">' + t('runAllKeysTest') + '</button>' +
    '<span class="model-alltest-status" id="alltest-status-' + sanitizeId(pid) + '-' + sanitizeId(mid) + '"></span>' +
  '</div>';
  // Each key on its own grid row
  html += '<div class="model-key-detail">';
  data.keys.forEach(function(k) {
    var color = typeof getModelColor !== 'undefined' ? getModelColor(data.provider, data.model) : 'var(--accent2)';
    var statusBadge = '';
    var quotaPct = 0;
    var quotaFillColor = 'var(--accent2)';
    var quotaNumText = '';
    if (data.hasQuota && k.hasQuota) {
      if (k.modelRemaining === 0) {
        statusBadge = '<span class="key-status-badge key-status-exhausted">' + t('exhausted') + '</span>';
      } else {
        statusBadge = '<span class="key-status-badge key-status-available">' + t('available') + '</span>';
      }
      quotaPct = k.modelLimit > 0 ? ((k.modelLimit - k.modelRemaining) / k.modelLimit * 100) : 0;
      quotaFillColor = quotaPct < 50 ? 'var(--accent2)' : (quotaPct < 80 ? 'var(--warn)' : 'var(--danger)');
      quotaNumText = (k.modelLimit - k.modelRemaining) + '/' + k.modelLimit;
    } else if (k.modelLock) {
      if (k.status === 'locked') {
        statusBadge = '<span class="key-status-badge key-status-locked">' + t('dailyLocked') + '</span>';
      } else {
        statusBadge = '<span class="key-status-badge key-status-cooldown">' + t('cooldown') + '</span>';
      }
    } else if (!k.isActive) {
      statusBadge = '<span class="key-status-badge key-status-inactive">' + t('inactive') + '</span>';
    } else {
      statusBadge = '<span class="key-status-badge key-status-available">' + t('available') + '</span>';
    }
    var quotaBar = '<div class="model-key-quota-bar"><div class="model-key-quota-fill" style="width:' + quotaPct + '%;background:' + quotaFillColor + '"></div></div>';
    var quotaInfo = '<span class="model-key-quota-numbers">' + quotaNumText + '</span>';
    var lockInfo = '';
    if (k.modelLock) {
      try {
        var lockTime = new Date(k.modelLock);
        lockInfo = '<span class="model-key-lock-info">' + t('unlockAt') + ' ' + lockTime.toLocaleTimeString() + '</span>';
      } catch (_) {}
    }
    var rowClass = 'model-key-row';
    if (!k.isActive || k.modelLock) {
      rowClass = 'model-key-row model-key-row-disabled';
    }
    var errStr = '';
    if (k.lastError) {
      errStr = k.lastError.length > 60 ? k.lastError.slice(0, 60) + '…' : k.lastError;
    }
    html += '<div class="' + rowClass + '" data-keyname="' + escapeHtml(k.keyName) + '">' +
      '<span class="model-color-dot" style="background:' + color + '"></span>' +
      '<span class="model-key-name">' + escapeHtml(k.keyName) + '</span>' +
      '<div class="model-key-badges">' + statusBadge + '</div>' +
      '<div class="model-key-quota">' + quotaBar + quotaInfo + '</div>' +
      (lockInfo || '<span></span>') +
      '<span class="model-key-ttft"></span>' +
      '<span class="model-key-speed"></span>' +
      '<span class="model-key-tokens"></span>' +
      '<span class="model-key-error"' + (k.lastError ? ' title="' + escapeHtml(k.lastError) + '"' : '') + '>' + (errStr ? escapeHtml(errStr) : '') + '</span>' +
    '</div>';
  });
  html += '</div>';
  wrap.innerHTML = html;
  // Aggregate quota totals and update parent model row
  var totalRemain = 0, totalLimit = 0;
  data.keys.forEach(function(k) {
    if (k.hasQuota) { totalRemain += (k.modelRemaining || 0); totalLimit += (k.modelLimit || 0); }
  });
  var modelRow = document.getElementById('mrow-' + sanitizeId(pid) + '-' + sanitizeId(mid));
  var quotaNumEl = modelRow ? modelRow.querySelector('.model-quota-numbers') : null;
  if (quotaNumEl) {
    if (totalLimit > 0) {
      quotaNumEl.textContent = totalRemain + '/' + totalLimit;
      quotaNumEl.style.display = '';
    } else {
      quotaNumEl.style.display = 'none';
    }
  }
  var prev = allKeysTestResults[pid + '/' + mid];
  if (prev && prev.results) {
    renderKeyTestResults(pid, mid, prev.results);
  }
}

async function runAllKeysTest(pid, mid) {
  var btnId = 'run-alltest-' + sanitizeId(pid) + '-' + sanitizeId(mid);
  var statusId = 'alltest-status-' + sanitizeId(pid) + '-' + sanitizeId(mid);
  var btn = document.getElementById(btnId);
  var statusEl = document.getElementById(statusId);
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.innerHTML = '<span class="badge badge-testing">' + t('runningAllKeysTest') + '</span>';
  // Clear any previous per-key metrics so a retest shows progress cleanly.
  var wrap = document.getElementById('mdetail-' + sanitizeId(pid) + '-' + sanitizeId(mid));
  if (wrap) {
    wrap.querySelectorAll('.model-key-row').forEach(function(row) {
      ['model-key-ttft', 'model-key-speed', 'model-key-tokens'].forEach(function(cls) {
        var el = row.querySelector('.' + cls);
        if (el) el.innerHTML = '';
      });
    });
  }
  var results = [];
  var total = 0;
  try {
    const resp = await fetch('/api/providers/' + pid + '/models/test-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ model: mid })
    });
    if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    var buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      var events = buffer.split('\n\n');
      buffer = events.pop();
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var lines = ev.split('\n');
        var eventType = '', dataStr = '';
        for (var j = 0; j < lines.length; j++) {
          if (lines[j].indexOf('event:') === 0) eventType = lines[j].slice(6).trim();
          else if (lines[j].indexOf('data:') === 0) dataStr += lines[j].slice(5).trim();
        }
        if (eventType === 'meta') {
          try { total = JSON.parse(dataStr).total; } catch (_) {}
          if (statusEl) statusEl.innerHTML = '<span class="badge badge-testing">0/' + total + '</span>';
        } else if (eventType === 'key') {
          var r;
          try { r = JSON.parse(dataStr); } catch (_) { continue; }
          results.push(r);
          renderKeySingleResult(pid, mid, r);
          if (statusEl) statusEl.innerHTML = '<span class="badge badge-testing">' + results.length + '/' + total + '</span>';
        } else if (eventType === 'done') {
          var summary;
          try { summary = JSON.parse(dataStr); } catch (_) { summary = {}; }
          allKeysTestResults[pid + '/' + mid] = { results: results };
          if (statusEl) statusEl.innerHTML = '<span class="badge badge-valid">' + t('allKeysTestDone') + ' (' + (summary.ok || 0) + '/' + (summary.fail || 0) + ')</span>';
          var okCnt = summary.ok || 0, failCnt = summary.fail || 0;
          var row = document.getElementById('mrow-' + sanitizeId(pid) + '-' + sanitizeId(mid));
          if (row) {
            var badge = row.querySelector('.model-alltest-badge');
            if (badge) {
              badge.classList.add('show');
              badge.innerHTML = '<span class="ok">' + okCnt + '</span>/<span class="fail">' + failCnt + '</span>';
            }
            // Re-aggregate quota from test results and update model row quota numbers
            var totalRemain = 0, totalLimit = 0;
            results.forEach(function(r) {
              if (r.quotaTotal > 0) { totalRemain += (r.quotaRemain || 0); totalLimit += (r.quotaTotal || 0); }
            });
            var quotaNumEl = row.querySelector('.model-quota-numbers');
            if (quotaNumEl && totalLimit > 0) {
              quotaNumEl.textContent = totalRemain + '/' + totalLimit;
              quotaNumEl.style.display = '';
            }
          }
        }
      }
    }
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<span class="badge badge-invalid">' + escapeHtml(e.message || String(e)) + '</span>';
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderKeySingleResult(pid, mid, r) {
  var detailId = 'mdetail-' + sanitizeId(pid) + '-' + sanitizeId(mid);
  var wrap = document.getElementById(detailId);
  if (!wrap) return;
  var rows = wrap.querySelectorAll('.model-key-row[data-keyname="' + escapeAttr(r.keyName) + '"]');
  rows.forEach(function(row) {
    var ttftEl = row.querySelector('.model-key-ttft');
    var speedEl = row.querySelector('.model-key-speed');
    var tokensEl = row.querySelector('.model-key-tokens');
    if (r.ok) {
      row.classList.remove('model-key-row-disabled');
      if (ttftEl) ttftEl.innerHTML = '<span class="model-key-metric">' + t('firstToken') + ' ' + r.ttftMs + 'ms</span>';
      if (speedEl) speedEl.innerHTML = '<span class="model-key-metric">' + t('speed') + ' ' + (r.tokensPerSec != null ? r.tokensPerSec.toFixed(1) : '0') + ' ' + t('tokPerSec') + '</span>';
      if (tokensEl) tokensEl.innerHTML = '<span class="model-key-metric">' + t('outputTokensLabel') + ' ' + r.outputTokens + '</span>';
    } else {
      row.classList.add('model-key-row-disabled');
      if (ttftEl) ttftEl.innerHTML = '<span class="model-key-metric model-key-metric-err">FAIL' + (r.status ? ' ' + r.status : '') + '</span>';
      if (speedEl) speedEl.innerHTML = '';
      if (tokensEl) tokensEl.innerHTML = '<span class="model-key-metric model-key-metric-err">' + escapeHtml(r.error || '') + '</span>';
    }
    // Refresh quota bar if backend returned quota info
    if (r.quotaTotal > 0) {
      var remain = r.quotaRemain || 0;
      var total = r.quotaTotal || 0;
      var pct = total > 0 ? ((total - remain) / total * 100) : 0;
      var fillColor = pct < 50 ? 'var(--accent2)' : (pct < 80 ? 'var(--warn)' : 'var(--danger)');
      var quotaFill = row.querySelector('.model-key-quota-fill');
      var quotaNumbers = row.querySelector('.model-key-quota-numbers');
      if (quotaFill) { quotaFill.style.width = pct + '%'; quotaFill.style.background = fillColor; }
      if (quotaNumbers) quotaNumbers.textContent = (total - remain) + '/' + total;
      var dot = row.querySelector('.model-color-dot');
      if (dot) dot.style.background = remain === 0 && total > 0 ? 'var(--danger)' : (pct >= 80 ? 'var(--warn)' : 'var(--accent2)');
      // Update status badge to reflect quota (skip if locked/cooldown/inactive)
      var badge = row.querySelector('.model-key-badges');
      if (badge && !badge.querySelector('.key-status-locked, .key-status-cooldown, .key-status-inactive')) {
        badge.innerHTML = remain === 0
          ? '<span class="key-status-badge key-status-exhausted">' + t('exhausted') + '</span>'
          : '<span class="key-status-badge key-status-available">' + t('available') + '</span>';
      }
    }
  });
}

function renderKeyTestResults(pid, mid, results) {
  results.forEach(function(r) {
    renderKeySingleResult(pid, mid, r);
  });
}

function reexpandModelDetailRow(pid, mid) {
  var detailId = 'mdetail-' + sanitizeId(pid) + '-' + sanitizeId(mid);
  var wrap = document.getElementById(detailId);
  if (!wrap) return;
  wrap.classList.add('expanded');
  var rowId = 'mrow-' + sanitizeId(pid) + '-' + sanitizeId(mid);
  var item = document.getElementById(rowId);
  var chevron = item ? item.querySelector('.model-row-chevron') : null;
  if (chevron) chevron.style.transform = 'rotate(180deg)';
  wrap.innerHTML = '<div class="model-key-detail-loading">' + t('loading') + '...</div>';
  fetchModelDetailRow(pid, mid);
}

function escapeAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function testModelDetail(pid) {
  const modelId = document.getElementById('m-input').value.trim();
  if (!modelId) { toast(t('enterModelId'), 'error'); return; }
  await doTestModel(pid, modelId);
}

function updateModelRowStatus(pid, modelId) {
  var p = providerDetailCache;
  if (!p || p.id !== pid) return;
  var m = (p.models || []).find(function(x) { return x.id === modelId; });
  if (!m) return;
  var rowId = 'mrow-' + sanitizeId(pid) + '-' + sanitizeId(modelId);
  var row = document.getElementById(rowId);
  if (!row) return;
  var main = row.querySelector('.model-row-main');
  if (!main) return;
  var oldChevron = main.querySelector('.model-row-chevron');
  var wasExpanded = oldChevron && oldChevron.style.transform === 'rotate(180deg)';
  main.outerHTML = buildModelRowMainInner(p, m);
  var newMain = row.querySelector('.model-row-main');
  if (!newMain) return;
  if (wasExpanded) {
    var newChevron = newMain.querySelector('.model-row-chevron');
    if (newChevron) newChevron.style.transform = 'rotate(180deg)';
  }
}

async function testSingleModel(pid, modelId) {
  await doTestModel(pid, modelId);
  var ts = modelTestStatus[modelId];
  if (ts && !ts.ok) {
    toast(t('modelTestFailed') + (ts.error || 'unknown error'), 'error');
  }
  currentProviderId = pid;
  updateModelRowStatus(pid, modelId);
}

async function doTestModel(pid, modelId) {
  const resultEl = document.getElementById('m-test-result');
  if (resultEl) resultEl.innerHTML = '<span class="badge badge-testing">' + t('testing', [modelId]) + '</span>';
  try {
    const result = await apiPost('/providers/' + pid + '/models/test', { model: modelId });
    modelTestStatus[modelId] = result;
    if (resultEl) {
      if (result.ok) {
        resultEl.innerHTML = '<span class="badge badge-valid">' + t('testOk', [modelId, result.latencyMs]) + '</span>';
      } else {
        var msg = result.error || 'failed';
        var extra = result.latencyMs != null ? ' (' + result.latencyMs + 'ms)' : '';
        resultEl.innerHTML = '<span class="badge badge-invalid">' + t('testFail', [modelId, msg]) + extra + '</span>';
      }
    }
  } catch (e) {
    if (resultEl) resultEl.innerHTML = '<span class="badge badge-invalid">' + t('failed', [e.message]) + '</span>';
  }
}

// ===================== Info Modal =====================

function showModelInfo(modelId) {
  var ts = modelTestStatus[modelId];
  if (!ts) return;

  var overlay = document.getElementById('info-modal-overlay');
  var titleEl = document.getElementById('info-modal-title');
  var bodyEl = document.getElementById('info-modal-body');

  titleEl.textContent = modelId + ' \u2014 ' + t('info');

  __infoModalSections = [];
  var html = '';

  if (ts.request) {
    var reqRawOverrides = {};
    if (ts.request.bodyRaw != null) reqRawOverrides.body = ts.request.bodyRaw;
    html += renderInfoSection(t('requestInfo'), ts.request, reqRawOverrides);
  }
  if (ts.responseHeaders) {
    html += renderInfoSection(t('responseHeaders'), ts.responseHeaders);
  }
  if (ts.responseBody != null) {
    var respRawOverrides = {};
    if (ts.responseBodyRaw != null) respRawOverrides.responseBody = ts.responseBodyRaw;
    html += renderInfoSection(t('responseBody'), ts.responseBody, respRawOverrides);
  }

  bodyEl.innerHTML = html;
  overlay.classList.add('show');

  document.addEventListener('keydown', infoModalEscapeHandler);
}

function closeInfoModal() {
  var overlay = document.getElementById('info-modal-overlay');
  overlay.classList.remove('show');
  document.removeEventListener('keydown', infoModalEscapeHandler);
}

function infoModalEscapeHandler(e) {
  if (e.key === 'Escape') {
    closeInfoModal();
  }
}

async function addModelDetail(pid) {
  const modelId = document.getElementById('m-input').value.trim();
  if (!modelId) { toast(t('enterModelId2'), 'error'); return; }
  await apiPost('/providers/' + pid + '/models', { model: modelId });
  toast(t('modelAdded'), 'success');
  currentProviderId = pid;
  const data = await apiGet('/providers');
  const p = (data.providers || []).find(function(x) { return x.id === pid; });
  if (p) {
    providerDetailCache = p;
    renderDetailModels(p);
  }
  const inputEl = document.getElementById('m-input');
  if (inputEl) inputEl.value = '';
}

async function deleteModelDetail(pid, modelId) {
  var resp = await apiDelete('/providers/' + pid + '/models?model=' + encodeURIComponent(modelId));
  if (resp.error) {
    toast(t('modelDeleteFailed') + resp.error, 'error');
    currentProviderId = pid;
    const errData = await apiGet('/providers');
    const errP = (errData.providers || []).find(function(x) { return x.id === pid; });
    if (errP) {
      providerDetailCache = errP;
      renderDetailModels(errP);
    }
    return;
  }
  delete modelTestStatus[modelId];
  toast(t('modelDeleted'), 'success');
  currentProviderId = pid;
  const data = await apiGet('/providers');
  const p = (data.providers || []).find(function(x) { return x.id === pid; });
  if (p) {
    providerDetailCache = p;
    renderDetailModels(p);
  }
}

function enterBatchManage(pid) {
  batchManageMode = true;
  batchSelectedModels.clear();
  renderDetailModels(providerDetailCache);
}

function batchToggleModel(mid) {
  if (batchSelectedModels.has(mid)) {
    batchSelectedModels.delete(mid);
  } else {
    batchSelectedModels.add(mid);
  }
  var rows = document.querySelectorAll('[data-batch-mid]');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-batch-mid') === mid) {
      if (batchSelectedModels.has(mid)) {
        rows[i].classList.add('batch-selected');
      } else {
        rows[i].classList.remove('batch-selected');
      }
      break;
    }
  }
}

function batchSelectAll() {
  var p = providerDetailCache;
  if (!p) return;
  var models = p.models || [];
  for (var i = 0; i < models.length; i++) {
    batchSelectedModels.add(models[i].id);
  }
  var rows = document.querySelectorAll('[data-batch-mid]');
  for (var j = 0; j < rows.length; j++) {
    rows[j].classList.add('batch-selected');
  }
}

function batchInvert() {
  var p = providerDetailCache;
  if (!p) return;
  var models = p.models || [];
  for (var i = 0; i < models.length; i++) {
    var mid = models[i].id;
    if (batchSelectedModels.has(mid)) {
      batchSelectedModels.delete(mid);
    } else {
      batchSelectedModels.add(mid);
    }
  }
  var rows = document.querySelectorAll('[data-batch-mid]');
  for (var j = 0; j < rows.length; j++) {
    var rmid = rows[j].getAttribute('data-batch-mid');
    if (batchSelectedModels.has(rmid)) {
      rows[j].classList.add('batch-selected');
    } else {
      rows[j].classList.remove('batch-selected');
    }
  }
}

async function batchConfirm(pid) {
  if (batchSelectedModels.size === 0) {
    toast(t('noModelsSelected'), 'warning');
    return;
  }
  var ok = await confirmModal(t('confirmBatchDelete', [batchSelectedModels.size]));
  if (!ok) return;
  var toDelete = Array.from(batchSelectedModels);
  var deleted = 0;
  for (var i = 0; i < toDelete.length; i++) {
    var resp = await apiDelete('/providers/' + pid + '/models?model=' + encodeURIComponent(toDelete[i]));
    if (!resp.error) {
      delete modelTestStatus[toDelete[i]];
      deleted++;
    }
  }
  batchManageMode = false;
  batchSelectedModels.clear();
  toast(t('batchDeleted', [deleted]), 'success');
  currentProviderId = pid;
  const data = await apiGet('/providers');
  const p = (data.providers || []).find(function(x) { return x.id === pid; });
  if (p) {
    providerDetailCache = p;
    renderDetailModels(p);
  }
}

function batchCancel() {
  batchManageMode = false;
  batchSelectedModels.clear();
  renderDetailModels(providerDetailCache);
}

async function importModels(pid) {
  const p = providerDetailCache;
  const resultEl = document.getElementById('m-test-result');
  if (resultEl) resultEl.innerHTML = '<span class="badge badge-testing">' + t('fetchingModels') + '</span>';
  try {
    const data = await apiGet('/providers/' + pid + '/models');
    if (data.error) {
      if (resultEl) resultEl.innerHTML = '<span class="badge badge-invalid">' + escapeHtml(data.error) + '</span>';
      return;
    }
    const models = data.models || [];
    if (models.length === 0) {
      if (resultEl) resultEl.innerHTML = '<span class="badge badge-invalid">' + t('noModelsUpstream') + '</span>';
      return;
    }
    const existing = new Set((p.models || []).map(function(x) { return x.id; }));
    var added = 0;
    for (const m of models) {
      if (!existing.has(m.id)) {
        await apiPost('/providers/' + pid + '/models', { model: m.id });
        added++;
      }
    }
    if (resultEl) resultEl.innerHTML = '<span class="badge badge-valid">' + t('importedModels', [added, models.length, models.length - added]) + '</span>';
    setTimeout(async function() {
      currentProviderId = pid;
      const data = await apiGet('/providers');
      const p = (data.providers || []).find(function(x) { return x.id === pid; });
      if (p) {
        providerDetailCache = p;
        renderDetailModels(p);
      }
    }, 1500);
  } catch (e) {
    if (resultEl) {
      resultEl.innerHTML = '<span class="badge badge-invalid">' + t('failed', [e.message || 'unknown error']) + '</span>';
    }
  }
}

async function updateModelQuotaType(pid, selectEl) {
  var modelId = selectEl.getAttribute('data-model');
  var quotaType = selectEl.value;
  try {
    await apiPatch('/providers/' + pid + '/models/quota', { model: modelId, quotaType: quotaType });
    toast(t('quotaType') + ' \u2192 ' + t(quotaType), 'success');
  } catch (e) {
    toast(e.message || t('failed'), 'error');
  }
}

async function toggleProvider(id, active) {
  const p = providerDetailCache || providersCache.find(function(x) { return x.id === id; });
  if (!p) return;
  p.isActive = active;
  await apiPut('/providers/' + id, p);
  currentProviderId = id;
  renderProviders(document.getElementById('page-content'));
}

async function deleteProvider(id) {
  const ok = await confirmModal(t('confirmDeleteProvider'));
  if (!ok) return;
  await apiDelete('/providers/' + id);
  toast(t('providerDeleted'), 'success');
  backToProviderList();
}

function showEditProvider(id) {
  var p = providerDetailCache;
  if (!p) return;
  var el = document.getElementById('detail-info');
  el.innerHTML = '\
    <div class="card">\
      <div class="card-title">' + t('editProvider') + '</div>\
      <div class="form-group mt-12"><label for="ep-name">' + t('name') + '</label><input id="ep-name" value="' + escapeHtml(p.name) + '"></div>\
      <div class="form-group"><label for="ep-prefix">' + t('prefixLabel') + '</label><input id="ep-prefix" value="' + escapeHtml(p.prefix) + '"></div>\
      <div class="form-group"><label for="ep-url">' + t('baseUrlLabel') + '</label><input id="ep-url" value="' + escapeHtml(p.baseUrl) + '"></div>\
      <div class="flex" style="gap:8px">\
        <button type="button" class="btn btn-primary" onclick="withLoading(this, () => saveEditProvider(\'' + id + '\'))">' + t('save') + '</button>\
        <button type="button" class="btn" onclick="cancelEditProvider()">' + t('cancel') + '</button>\
      </div>\
    </div>';
}

async function saveEditProvider(id) {
  var p = providerDetailCache;
  if (!p) return;
  p.name = document.getElementById('ep-name').value.trim();
  p.prefix = document.getElementById('ep-prefix').value.trim();
  p.baseUrl = document.getElementById('ep-url').value.trim();
  if (!p.name || !p.prefix || !p.baseUrl) {
    toast(t('requiredFields'), 'error');
    return;
  }
  await apiPut('/providers/' + id, p);
  toast(t('providerUpdated'), 'success');
  currentProviderId = id;
  const data = await apiGet('/providers');
  const np = (data.providers || []).find(function(x) { return x.id === id; });
  if (np) {
    providerDetailCache = np;
    var infoEl = document.getElementById('detail-info');
    if (infoEl) {
      infoEl.innerHTML = '<div class="card"><p class="muted">' + t('prefix') + ' <span class="code">' + escapeHtml(np.prefix) + '</span> | ' + t('baseUrl') + ' <span class="code">' + escapeHtml(np.baseUrl) + '</span></p></div>';
    }
    var h2 = document.querySelector('.detail-header h2');
    if (h2) h2.textContent = np.name;
    renderDetailRotation(np);
  }
}

function cancelEditProvider() {
  var p = providerDetailCache;
  if (!p) return;
  var el = document.getElementById('detail-info');
  el.innerHTML = '\
    <div class="card">\
      <p class="muted">' + t('prefix') + ' <span class="code">' + escapeHtml(p.prefix) + '</span> | ' + t('baseUrl') + ' <span class="code">' + escapeHtml(p.baseUrl) + '</span></p>\
    </div>';
}
