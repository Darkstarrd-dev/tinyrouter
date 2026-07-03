// ===================== Providers Page =====================

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
    <button class="btn btn-primary mb-12" onclick="showAddProvider()">' + t('addProvider') + '</button>\
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
          <button class="btn btn-sm" onclick="toggleProviderList(event, \'' + p.id + '\',' + (!p.isActive) + ')">' + (p.isActive ? t('disable') : t('enable')) + '</button>\
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
  renderProviders(document.getElementById('page-content'));
}

function showAddProvider() {
  const el = document.getElementById('provider-form');
  el.style.display = 'block';
  el.innerHTML = '\
    <div class="card">\
      <div class="card-title">' + t('newProvider') + '</div>\
      <div class="form-group mt-12"><label>' + t('name') + '</label><input id="p-name" placeholder="DeepSeek"></div>\
      <div class="form-group"><label>' + t('prefixLabel') + '</label><input id="p-prefix" placeholder="deepseek"></div>\
      <div class="form-group"><label>' + t('baseUrlLabel') + '</label><input id="p-url" placeholder="https://api.deepseek.com"></div>\
      <div class="form-group"><label>' + t('apiKeyLabel') + '</label><input type="password" id="p-apikey" placeholder="sk-..."></div>\
      <div class="form-group"><label>' + t('modelIdLabel') + '</label><input id="p-modelid" placeholder="deepseek-chat"></div>\
      <div id="p-check-result" class="mt-12"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn" onclick="withLoading(this, () => checkProvider())">' + t('check') + '</button>\
        <button class="btn btn-primary" onclick="withLoading(this, () => addProvider())">' + t('create') + '</button>\
        <button class="btn" onclick="document.getElementById(\'provider-form\').style.display=\'none\'">' + t('cancel') + '</button>\
      </div>\
    </div>';
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
  document.getElementById('provider-form').style.display = 'none';
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
        <button class="btn btn-sm" onclick="backToProviderList()">' + t('back') + '</button>\
        <button class="btn btn-sm" onclick="showEditProvider(\'' + p.id + '\')">' + t('edit') + '</button>\
        <button class="btn btn-sm ' + (p.isActive ? '' : 'btn-primary') + '" onclick="toggleProvider(\'' + p.id + '\',' + (!p.isActive) + ')">' + (p.isActive ? t('disable') : t('enable')) + '</button>\
        <button class="btn btn-sm btn-danger" onclick="deleteProvider(\'' + p.id + '\')">' + t('delete') + '</button>\
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
        <button class="btn btn-sm btn-primary" onclick="showAddKeyDetail(\'' + p.id + '\')">' + t('addKey') + '</button>\
        <button class="btn btn-sm" onclick="showBulkAddKeys(\'' + p.id + '\')">' + t('bulkAdd') + '</button>\
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
                <button class="btn btn-sm" onclick="withLoading(this, () => testKeyDetail(\'' + p.id + '\',\'' + k.id + '\'))">' + t('test') + '</button>\
                <button class="btn btn-sm" onclick="toggleKeyDetail(\'' + p.id + '\',\'' + k.id + '\',' + (!k.isActive) + ')">' + (k.isActive ? t('pause') : t('resume')) + '</button>\
                <button class="btn btn-sm btn-danger" onclick="deleteKeyDetail(\'' + p.id + '\',\'' + k.id + '\')">' + t('delete') + '</button>\
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
      <div class="form-group mt-12"><label>' + t('keyName') + '</label><input id="dk-name" placeholder="Main"></div>\
      <div class="form-group"><label>' + t('apiKeyInput') + '</label><input type="password" id="dk-key" placeholder="sk-..."></div>\
      <div class="form-group"><label>' + t('priorityLabel') + '</label><input type="number" id="dk-priority" value="1" style="max-width:120px"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn btn-primary" onclick="withLoading(this, () => addKeyDetail(\'' + providerId + '\'))">' + t('create') + '</button>\
        <button class="btn" onclick="document.getElementById(\'key-form-' + providerId + '\').innerHTML=\'\'">' + t('cancel') + '</button>\
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
  const c = document.getElementById('page-content');
  currentProviderId = providerId;
  renderProviders(c);
}

function showBulkAddKeys(providerId) {
  const el = document.getElementById('key-form-' + providerId);
  el.innerHTML = '\
    <div class="card" style="background:var(--glass-bg)">\
      <div class="card-title">' + t('bulkAddKeys') + '</div>\
      <p class="muted mt-12">' + t('bulkFormat') + '</p>\
      <div class="form-group mt-12"><textarea id="bk-textarea" rows="8" placeholder="Main|sk-aaa\nBackup|sk-bbb\nsk-ccc"></textarea></div>\
      <div class="form-group"><label>' + t('defaultPriority') + '</label><input type="number" id="bk-priority" value="1" style="max-width:120px"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn btn-primary" onclick="withLoading(this, () => bulkAddKeys(\'' + providerId + '\'))">' + t('addAll') + '</button>\
        <button class="btn" onclick="document.getElementById(\'key-form-' + providerId + '\').innerHTML=\'\'">' + t('cancel') + '</button>\
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
  if (result.errors && result.errors.length > 0) {
    resultEl.innerHTML = '<span class="badge badge-valid">' + t('addedKeysErrors', [result.added]) + '</span> <span class="badge badge-invalid">Errors: ' + result.errors.length + '</span>';
  } else {
    resultEl.innerHTML = '<span class="badge badge-valid">' + t('addedKeys', [result.added]) + '</span>';
  }
  setTimeout(function() {
    currentProviderId = providerId;
    renderProviders(document.getElementById('page-content'));
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
  renderProviders(document.getElementById('page-content'));
}

async function deleteKeyDetail(pid, kid) {
  var ok = await confirmModal(t('confirmDeleteKey'));
  if (!ok) return;
  await apiDelete('/providers/' + pid + '/keys/' + kid);
  toast(t('keyDeleted'), 'success');
  currentProviderId = pid;
  var scrollTop = document.getElementById('page-content').scrollTop || document.querySelector('.main').scrollTop;
  renderProviders(document.getElementById('page-content'));
  requestAnimationFrame(function() { (document.querySelector('.main') || document.getElementById('page-content')).scrollTop = scrollTop; });
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
        <label>' + t('strategy') + '</label>\
        <select id="r-strategy">\
          <option value=""' + (strategy === '' ? ' selected' : '') + '>' + t('inheritGlobal') + '</option>\
          <option value="fill-first"' + (strategy === 'fill-first' ? ' selected' : '') + '>' + t('fillFirst') + '</option>\
          <option value="round-robin"' + (strategy === 'round-robin' ? ' selected' : '') + '>' + t('roundRobin') + '</option>\
        </select>\
      </div>\
      <div class="form-group">\
        <label>' + t('stickyLabel') + '</label>\
        <input type="number" id="r-sticky" value="' + sticky + '" style="max-width:120px">\
      </div>\
      <button class="btn btn-primary" onclick="withLoading(this, () => saveProviderRotation(\'' + p.id + '\'))">' + t('save') + '</button>\
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

function renderDetailModels(p) {
  const el = document.getElementById('detail-models');
  const models = p.models || [];
  var modelsHtml = models.map(function(m) {
    var ts = modelTestStatus[m.id];
    var statusClass = 'model-pending';
    var statusText = t('untested');
    var quotaStr = '';
    if (ts) {
      if (ts.ok) { statusClass = 'model-ok'; statusText = 'OK'; }
      else { statusClass = 'model-err'; statusText = 'FAIL'; }
      if (ts.quotaTotal > 0) {
        quotaStr = ts.quotaRemain + '/' + ts.quotaTotal;
      }
    }
    return '<div class="model-row">' +
      (ts
        ? (ts.ok
            ? '<span class="model-status model-ok" title="' + (ts.latencyMs != null ? ts.latencyMs + 'ms' : '') + '">' + (quotaStr ? 'OK <span class="model-quota-inline">' + escapeHtml(quotaStr) + '</span>' : 'OK') + '</span>'
            : '<span class="model-status model-err" title="' + escapeHtml(ts.error || 'failed') + '">FAIL</span>')
        : '<button class="btn btn-sm" onclick="withLoading(this, () => testSingleModel(\'' + p.id + '\',\'' + escapeHtml(m.id) + '\'))">' + t('test') + '</button>') +
      '<button class="btn btn-sm btn-danger" onclick="deleteModelDetail(\'' + p.id + '\',\'' + escapeHtml(m.id) + '\')">' + t('delete') + '</button>' +
      '<span class="model-id copyable" onclick="copyToClipboard(\'' + escapeHtml(p.prefix) + '/' + escapeHtml(m.id) + '\')" title="' + t('clickToCopy') + '">' + escapeHtml(p.prefix) + '/' + escapeHtml(m.id) + '</span>' +
      '<select class="model-quota-select" data-model="' + escapeHtml(m.id) + '" onchange="updateModelQuotaType(\'' + escapeHtml(p.id) + '\', this)">' +
        '<option value="unlimited"' + (m.quotaType === 'unlimited' ? ' selected' : '') + '>' + t('unlimited') + '</option>' +
        '<option value="limited"' + (m.quotaType === 'limited' || !m.quotaType ? ' selected' : '') + '>' + t('limited') + '</option>' +
        '<option value="paid"' + (m.quotaType === 'paid' ? ' selected' : '') + '>' + t('paid') + '</option>' +
      '</select>' +
    '</div>';
  }).join('');
  el.innerHTML = '\
    <div class="card">\
      <div class="section-title">' + t('modelsTitle') + ' (' + models.length + ')</div>\
      <div class="flex mb-12" style="gap:8px">\
        <input id="m-input" placeholder="' + t('modelPlaceholder') + '" style="flex:1">\
        <button class="btn btn-sm" onclick="withLoading(this, () => testModelDetail(\'' + p.id + '\'))">' + t('test') + '</button>\
        <button class="btn btn-sm btn-primary" onclick="withLoading(this, () => addModelDetail(\'' + p.id + '\'))">' + t('create') + '</button>\
      </div>\
      <div class="flex mb-12" style="gap:8px">\
        <button class="btn btn-sm" onclick="withLoading(this, () => importModels(\'' + p.id + '\'))">' + t('importModels') + '</button>\
      </div>\
      <div id="m-test-result" class="mb-12"></div>\
      <div id="model-list">' +
        (models.length === 0 ? emptyState(t('noModels')) : modelsHtml) + '\
      </div>\
    </div>';
}

async function testModelDetail(pid) {
  const modelId = document.getElementById('m-input').value.trim();
  if (!modelId) { toast(t('enterModelId'), 'error'); return; }
  await doTestModel(pid, modelId);
}

async function testSingleModel(pid, modelId) {
  await doTestModel(pid, modelId);
  var ts = modelTestStatus[modelId];
  if (ts && !ts.ok) {
    toast(t('modelTestFailed') + (ts.error || 'unknown error'), 'error');
  }
  currentProviderId = pid;
  renderProviders(document.getElementById('page-content'));
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

async function addModelDetail(pid) {
  const modelId = document.getElementById('m-input').value.trim();
  if (!modelId) { toast(t('enterModelId2'), 'error'); return; }
  await apiPost('/providers/' + pid + '/models', { model: modelId });
  toast(t('modelAdded'), 'success');
  currentProviderId = pid;
  renderProviders(document.getElementById('page-content'));
}

async function deleteModelDetail(pid, modelId) {
  var ok = await confirmModal(t('confirmDeleteModel') + modelId);
  if (!ok) return;
  var resp = await apiDelete('/providers/' + pid + '/models?model=' + encodeURIComponent(modelId));
  if (resp.error) { toast(t('modelTestFailed') + resp.error, 'error'); return; }
  delete modelTestStatus[modelId];
  toast(t('modelDeleted'), 'success');
  currentProviderId = pid;
  var scrollTop = document.getElementById('page-content').scrollTop || document.querySelector('.main').scrollTop;
  await renderProviders(document.getElementById('page-content'));
  requestAnimationFrame(function() { (document.querySelector('.main') || document.getElementById('page-content')).scrollTop = scrollTop; });
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
    setTimeout(function() {
      currentProviderId = pid;
      renderProviders(document.getElementById('page-content'));
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
      <div class="form-group mt-12"><label>' + t('name') + '</label><input id="ep-name" value="' + escapeHtml(p.name) + '"></div>\
      <div class="form-group"><label>' + t('prefixLabel') + '</label><input id="ep-prefix" value="' + escapeHtml(p.prefix) + '"></div>\
      <div class="form-group"><label>' + t('baseUrlLabel') + '</label><input id="ep-url" value="' + escapeHtml(p.baseUrl) + '"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn btn-primary" onclick="withLoading(this, () => saveEditProvider(\'' + id + '\'))">' + t('save') + '</button>\
        <button class="btn" onclick="cancelEditProvider()">' + t('cancel') + '</button>\
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
  renderProviders(document.getElementById('page-content'));
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
