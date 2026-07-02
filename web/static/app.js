const API = '/api';

let currentPage = 'endpoint';
let currentProviderId = null;
let providersCache = [];
let providerDetailCache = null;
let modelTestStatus = {};

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initFontSize();
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const page = el.dataset.page;
      if (page) navigateTo(page);
    });
  });
  navigateTo('endpoint');
});

function navigateTo(page) {
  currentPage = page;
  currentProviderId = null;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const container = document.getElementById('page-content');
  container.innerHTML = '';
  container.classList.remove('page-enter');
  const p = (() => {
    switch (page) {
      case 'endpoint': return renderEndpoint(container);
      case 'providers': return renderProviders(container);
      case 'combos': return renderCombos(container);
      case 'usage': return renderUsage(container);
      case 'console': return renderConsole(container);
    }
  })();
  if (p && p.then) p.then(() => container.classList.add('page-enter'));
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 8) + '...';
}

function toast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '\u2713', error: '\u2715', info: '\u2139', warning: '\u26A0' };
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = '<span class="toast-icon">' + icons[type] + '</span><span class="toast-message">' + escapeHtml(message) + '</span><div class="toast-progress"></div>';
  container.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('show'); });
  setTimeout(function() {
    el.classList.remove('show');
    el.addEventListener('transitionend', function() { el.remove(); }, { once: true });
  }, duration);
}

function confirmModal(message) {
  return new Promise(function(resolve) {
    var overlay = document.getElementById('modal-overlay');
    if (overlay.classList.contains('show')) { resolve(false); return; }
    overlay.innerHTML = '<div class="modal"><div class="modal-title">Confirm</div><div class="modal-body">' + escapeHtml(message) + '</div><div class="modal-footer"><button class="btn btn-ghost" id="modal-cancel">Cancel</button><button class="btn btn-primary" id="modal-confirm">Confirm</button></div></div>';
    requestAnimationFrame(function() { overlay.classList.add('show'); });
    function close(result) {
      overlay.classList.remove('show');
      overlay.addEventListener('transitionend', function() { overlay.innerHTML = ''; }, { once: true });
      resolve(result);
    }
    document.getElementById('modal-cancel').onclick = function() { close(false); };
    document.getElementById('modal-confirm').onclick = function() { close(true); };
    overlay.onclick = function(e) { if (e.target === overlay) close(false); };
  });
}

function initTheme() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  updateThemeButton(theme);
}

function updateThemeButton(theme) {
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

function initFontSize() {
  const size = document.documentElement.getAttribute('data-font-size') || 's';
  updateFontButton(size);
}

function updateFontButton(size) {
  const btn = document.getElementById('font-btn');
  if (btn) btn.textContent = size.toUpperCase();
}

function toggleFontSize() {
  const current = document.documentElement.getAttribute('data-font-size') || 's';
  const order = { 's': 'm', 'm': 'l', 'l': 's' };
  const next = order[current] || 's';
  document.documentElement.setAttribute('data-font-size', next);
  localStorage.setItem('fontSize', next);
  updateFontButton(next);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton(next);
}

async function shutdownServer() {
  const ok = await confirmModal('Shutdown TinyRouter?');
  if (!ok) return;
  try {
    await apiPost('/shutdown', {});
  } catch (e) {}
  document.body.innerHTML = '\
    <div class="app" style="align-items:center;justify-content:center">\
      <div class="card" style="text-align:center;max-width:360px">\
        <div class="card-title">TinyRouter Stopped</div>\
        <p class="muted mt-12">The server has been shut down. You may close this window.</p>\
      </div>\
    </div>';
  window.close();
}

function showSkeleton(container, count) {
  if (count === undefined) count = 3;
  var cards = [];
  for (var i = 0; i < count; i++) {
    var s = document.createElement('div');
    s.className = 'skeleton skeleton-card';
    cards.push(s);
  }
  container.replaceChildren.apply(container, cards);
}

async function apiGet(path) {
  const r = await fetch(API + path);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}
async function apiPatch(path, body) {
  const r = await fetch(API + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}
async function apiPut(path, body) {
  const r = await fetch(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}
async function apiDelete(path) {
  const r = await fetch(API + path, { method: 'DELETE' });
  return r.json();
}

// ===================== Endpoint Page =====================

async function renderEndpoint(c) {
  showSkeleton(c, 2);
  const settings = await apiGet('/settings');
  c.innerHTML = '\
    <h2>Endpoint</h2>\
    <div class="card">\
      <div class="form-group">\
        <label>Listen Port</label>\
        <div class="flex">\
          <input type="number" id="port" value="' + settings.port + '" style="max-width:120px">\
          <button class="btn btn-primary" onclick="savePort()">Save</button>\
        </div>\
      </div>\
      <p class="muted mt-12">API Endpoint: <span class="code">http://localhost:' + settings.port + '/v1</span></p>\
      <p class="muted mt-12">No API key required. Any key or no key works.</p>\
    </div>\
    <div class="card">\
      <div class="card-title">Rotation Settings (Global Default)</div>\
      <div class="form-group mt-12">\
        <label>Strategy</label>\
        <select id="strategy">\
          <option value="fill-first"' + (settings.rotation && settings.rotation.strategy === 'fill-first' ? ' selected' : '') + '>fill-first</option>\
          <option value="round-robin"' + (settings.rotation && settings.rotation.strategy === 'round-robin' ? ' selected' : '') + '>round-robin</option>\
        </select>\
      </div>\
      <div class="form-group">\
        <label>Sticky Limit (round-robin)</label>\
        <input type="number" id="stickyLimit" value="' + ((settings.rotation && settings.rotation.stickyLimit) || 3) + '" style="max-width:120px">\
      </div>\
      <div class="form-group">\
        <label>Max Retries (429 temp)</label>\
        <input type="number" id="maxRetries" value="' + ((settings.rotation && settings.rotation.maxRetries) || 5) + '" style="max-width:120px">\
      </div>\
      <div class="form-group">\
        <label>Retry Delay (seconds)</label>\
        <input type="number" id="retryDelaySec" value="' + ((settings.rotation && settings.rotation.retryDelaySec) || 5) + '" style="max-width:120px">\
      </div>\
      <div class="form-group">\
        <label>Backoff Max (seconds)</label>\
        <input type="number" id="backoffMaxSec" value="' + ((settings.rotation && settings.rotation.backoffMaxSec) || 240) + '" style="max-width:120px">\
      </div>\
      <button class="btn btn-primary" onclick="saveRotation()">Save Rotation</button>\
    </div>';
}

async function savePort() {
  const port = parseInt(document.getElementById('port').value);
  await apiPatch('/settings', { port });
  toast('Port saved. Restart TinyRouter to apply.', 'success');
}
async function saveRotation() {
  const rotation = {
    strategy: document.getElementById('strategy').value,
    stickyLimit: parseInt(document.getElementById('stickyLimit').value),
    maxRetries: parseInt(document.getElementById('maxRetries').value),
    retryDelaySec: parseInt(document.getElementById('retryDelaySec').value),
    backoffMaxSec: parseInt(document.getElementById('backoffMaxSec').value),
  };
  await apiPatch('/settings', { rotation });
  toast('Rotation settings saved.', 'success');
}

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
    <h2>Providers</h2>\
    <button class="btn btn-primary mb-12" onclick="showAddProvider()">+ Add Provider</button>\
    <div id="provider-list"></div>\
    <div id="provider-form" style="display:none"></div>';
  renderProviderList();
}

function renderProviderList() {
  const el = document.getElementById('provider-list');
  if (providersCache.length === 0) {
    el.innerHTML = '<div class="empty">No providers yet. Click "Add Provider" to create one.</div>';
    return;
  }
  el.innerHTML = providersCache.map(function(p) {
    return '\
    <div class="card provider-card" onclick="openProviderDetail(\'' + p.id + '\')">\
      <div class="card-header">\
        <span class="card-title">' + escapeHtml(p.name) + '</span>\
        <span class="badge ' + (p.isActive ? 'badge-active' : 'badge-inactive') + '">' + (p.isActive ? 'Active' : 'Inactive') + '</span>\
      </div>\
      <p class="muted">Prefix: <span class="code">' + escapeHtml(p.prefix) + '</span> | Base URL: <span class="code">' + escapeHtml(p.baseUrl) + '</span></p>\
      <p class="muted mt-12">Keys: ' + (p.keys ? p.keys.length : 0) + ' | Models: ' + (p.models ? p.models.length : 0) + '</p>\
    </div>';
  }).join('');
}

function openProviderDetail(id) {
  currentProviderId = id;
  renderProviders(document.getElementById('page-content'));
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
      <div class="card-title">New Provider</div>\
      <div class="form-group mt-12"><label>Name</label><input id="p-name" placeholder="DeepSeek"></div>\
      <div class="form-group"><label>Prefix (used in model field)</label><input id="p-prefix" placeholder="deepseek"></div>\
      <div class="form-group"><label>Base URL</label><input id="p-url" placeholder="https://api.deepseek.com"></div>\
      <div class="form-group"><label>API Key (for connectivity test, not saved)</label><input type="password" id="p-apikey" placeholder="sk-..."></div>\
      <div class="form-group"><label>Model ID (optional, fallback test if /models unavailable)</label><input id="p-modelid" placeholder="deepseek-chat"></div>\
      <div id="p-check-result" class="mt-12"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn" onclick="checkProvider()">Check</button>\
        <button class="btn btn-primary" onclick="addProvider()">Create</button>\
        <button class="btn" onclick="document.getElementById(\'provider-form\').style.display=\'none\'">Cancel</button>\
      </div>\
    </div>';
}

async function checkProvider() {
  const baseUrl = document.getElementById('p-url').value.trim();
  const apiKey = document.getElementById('p-apikey').value.trim();
  const modelId = document.getElementById('p-modelid').value.trim();
  const resultEl = document.getElementById('p-check-result');
  if (!baseUrl || !apiKey) {
    resultEl.innerHTML = '<span class="badge badge-invalid">Base URL and API Key required</span>';
    return;
  }
  resultEl.innerHTML = '<span class="badge badge-testing">Checking...</span>';
  try {
    const result = await apiPost('/providers/validate', { baseUrl: baseUrl, apiKey: apiKey, modelId: modelId || undefined });
    if (result.valid) {
      const method = result.method ? ' (via ' + result.method + ')' : '';
      resultEl.innerHTML = '<span class="badge badge-valid">Valid' + method + '</span>';
    } else {
      resultEl.innerHTML = '<span class="badge badge-invalid">Invalid: ' + escapeHtml(result.error || 'unknown error') + '</span>';
    }
  } catch (e) {
    resultEl.innerHTML = '<span class="badge badge-invalid">Error: ' + escapeHtml(e.message) + '</span>';
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
    toast('Name, Prefix, and Base URL are required', 'error');
    return;
  }
  await apiPost('/providers', p);
  document.getElementById('provider-form').style.display = 'none';
  toast('Provider created', 'success');
  renderProviders(document.getElementById('page-content'));
}

async function renderProviderDetail(c, id) {
  showSkeleton(c, 1);
  const data = await apiGet('/providers');
  const p = (data.providers || []).find(function(x) { return x.id === id; });
  if (!p) {
    c.innerHTML = '<div class="empty">Provider not found.</div>';
    return;
  }
  providerDetailCache = p;
  c.innerHTML = '\
    <div class="detail-header">\
      <h2>' + escapeHtml(p.name) + '</h2>\
      <div class="flex" style="gap:8px">\
        <button class="btn btn-sm" onclick="backToProviderList()">Back</button>\
        <button class="btn btn-sm ' + (p.isActive ? '' : 'btn-primary') + '" onclick="toggleProvider(\'' + p.id + '\',' + (!p.isActive) + ')">' + (p.isActive ? 'Disable' : 'Enable') + '</button>\
        <button class="btn btn-sm btn-danger" onclick="deleteProvider(\'' + p.id + '\')">Delete</button>\
      </div>\
    </div>\
    <div class="card">\
      <p class="muted">Prefix: <span class="code">' + escapeHtml(p.prefix) + '</span> | Base URL: <span class="code">' + escapeHtml(p.baseUrl) + '</span></p>\
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
      <div class="section-title">Keys (' + keys.length + ')</div>\
      <div class="flex mb-12" style="gap:8px">\
        <button class="btn btn-sm btn-primary" onclick="showAddKeyDetail(\'' + p.id + '\')">+ Add Key</button>\
        <button class="btn btn-sm" onclick="showBulkAddKeys(\'' + p.id + '\')">Bulk Add</button>\
      </div>\
      <div id="key-form-' + p.id + '"></div>' +
      (keys.length === 0 ? '<div class="empty">No keys yet.</div>' : '\
      <table>\
        <thead><tr><th>Name</th><th>Key</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead>\
        <tbody>' +
          keys.map(function(k) {
            return '<tr>\
              <td>' + escapeHtml(k.name) + '</td>\
              <td><span class="code">' + maskKey(k.key) + '</span></td>\
              <td>' + k.priority + '</td>\
              <td><span class="badge ' + (k.isActive ? 'badge-active' : 'badge-inactive') + '">' + (k.isActive ? 'Active' : 'Paused') + '</span></td>\
              <td>\
                <button class="btn btn-sm" onclick="testKeyDetail(\'' + p.id + '\',\'' + k.id + '\')">Test</button>\
                <button class="btn btn-sm" onclick="toggleKeyDetail(\'' + p.id + '\',\'' + k.id + '\',' + (!k.isActive) + ')">' + (k.isActive ? 'Pause' : 'Resume') + '</button>\
                <button class="btn btn-sm btn-danger" onclick="deleteKeyDetail(\'' + p.id + '\',\'' + k.id + '\')">Delete</button>\
              </td>\
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
      <div class="card-title">New Key</div>\
      <div class="form-group mt-12"><label>Name</label><input id="dk-name" placeholder="Main"></div>\
      <div class="form-group"><label>API Key</label><input type="password" id="dk-key" placeholder="sk-..."></div>\
      <div class="form-group"><label>Priority (lower = higher)</label><input type="number" id="dk-priority" value="1" style="max-width:120px"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn btn-primary" onclick="addKeyDetail(\'' + providerId + '\')">Create</button>\
        <button class="btn" onclick="document.getElementById(\'key-form-' + providerId + '\').innerHTML=\'\'">Cancel</button>\
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
  if (!k.key) { toast('API Key is required', 'error'); return; }
  await apiPost('/providers/' + providerId + '/keys', k);
  toast('Key added', 'success');
  const c = document.getElementById('page-content');
  currentProviderId = providerId;
  renderProviders(c);
}

function showBulkAddKeys(providerId) {
  const el = document.getElementById('key-form-' + providerId);
  el.innerHTML = '\
    <div class="card" style="background:var(--glass-bg)">\
      <div class="card-title">Bulk Add Keys</div>\
      <p class="muted mt-12">One key per line. Format: <span class="code">name|key</span> or just <span class="code">key</span></p>\
      <div class="form-group mt-12"><textarea id="bk-textarea" rows="8" placeholder="Main|sk-aaa\nBackup|sk-bbb\nsk-ccc"></textarea></div>\
      <div class="form-group"><label>Default Priority</label><input type="number" id="bk-priority" value="1" style="max-width:120px"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn btn-primary" onclick="bulkAddKeys(\'' + providerId + '\')">Add All</button>\
        <button class="btn" onclick="document.getElementById(\'key-form-' + providerId + '\').innerHTML=\'\'">Cancel</button>\
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
  resultEl.innerHTML = '<span class="badge badge-testing">Adding...</span>';
  const result = await apiPost('/providers/' + providerId + '/keys/bulk', { keys: keys });
  if (result.errors && result.errors.length > 0) {
    resultEl.innerHTML = '<span class="badge badge-valid">Added: ' + result.added + '</span> <span class="badge badge-invalid">Errors: ' + result.errors.length + '</span>';
  } else {
    resultEl.innerHTML = '<span class="badge badge-valid">Added ' + result.added + ' keys</span>';
  }
  setTimeout(function() {
    currentProviderId = providerId;
    renderProviders(document.getElementById('page-content'));
  }, 1000);
}

async function testKeyDetail(pid, kid) {
  const result = await apiPost('/providers/' + pid + '/test', { keyId: kid });
  if (result.valid) {
    toast('Key is valid.', 'success');
  } else {
    toast('Key invalid: ' + (result.error || 'unknown error'), 'error');
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
  const ok = await confirmModal('Delete this key?');
  if (!ok) return;
  await apiDelete('/providers/' + pid + '/keys/' + kid);
  toast('Key deleted', 'success');
  currentProviderId = pid;
  renderProviders(document.getElementById('page-content'));
}

function renderDetailRotation(p) {
  const el = document.getElementById('detail-rotation');
  const strategy = p.rotationStrategy || '';
  const sticky = p.stickyLimit || 0;
  el.innerHTML = '\
    <div class="card">\
      <div class="section-title">Rotation Strategy</div>\
      <p class="muted mb-12">Overrides global settings for this provider. Leave "Inherit" to use global default.</p>\
      <div class="form-group">\
        <label>Strategy</label>\
        <select id="r-strategy">\
          <option value=""' + (strategy === '' ? ' selected' : '') + '>Inherit Global</option>\
          <option value="fill-first"' + (strategy === 'fill-first' ? ' selected' : '') + '>fill-first</option>\
          <option value="round-robin"' + (strategy === 'round-robin' ? ' selected' : '') + '>round-robin</option>\
        </select>\
      </div>\
      <div class="form-group">\
        <label>Sticky Limit (0 = inherit global, round-robin only)</label>\
        <input type="number" id="r-sticky" value="' + sticky + '" style="max-width:120px">\
      </div>\
      <button class="btn btn-primary" onclick="saveProviderRotation(\'' + p.id + '\')">Save</button>\
    </div>';
}

async function saveProviderRotation(id) {
  const p = providerDetailCache;
  const strategy = document.getElementById('r-strategy').value;
  const sticky = parseInt(document.getElementById('r-sticky').value) || 0;
  p.rotationStrategy = strategy;
  p.stickyLimit = sticky;
  await apiPut('/providers/' + id, p);
  toast('Rotation strategy saved.', 'success');
}

function renderDetailModels(p) {
  const el = document.getElementById('detail-models');
  const models = p.models || [];
  var modelsHtml = models.map(function(m) {
    var ts = modelTestStatus[m];
    var statusClass = 'model-pending';
    var statusIcon = '';
    if (ts) {
      if (ts.ok) { statusClass = 'model-ok'; statusIcon = 'OK'; }
      else { statusClass = 'model-err'; statusIcon = 'FAIL'; }
    }
    return '<div class="model-row">\
      <span class="model-id">' + escapeHtml(p.prefix) + '/' + escapeHtml(m) + '</span>\
      <span class="model-status ' + statusClass + '">' + (statusIcon || 'untested') + '</span>\
      <button class="btn btn-sm" onclick="testSingleModel(\'' + p.id + '\',\'' + escapeHtml(m) + '\')">Test</button>\
      <button class="btn btn-sm btn-danger" onclick="deleteModelDetail(\'' + p.id + '\',\'' + escapeHtml(m) + '\')">Delete</button>\
    </div>';
  }).join('');
  el.innerHTML = '\
    <div class="card">\
      <div class="section-title">Models (' + models.length + ')</div>\
      <div class="flex mb-12" style="gap:8px">\
        <input id="m-input" placeholder="model-id (e.g. deepseek-chat)" style="flex:1">\
        <button class="btn btn-sm" onclick="testModelDetail(\'' + p.id + '\')">Test</button>\
        <button class="btn btn-sm btn-primary" onclick="addModelDetail(\'' + p.id + '\')">Add</button>\
      </div>\
      <div class="flex mb-12" style="gap:8px">\
        <button class="btn btn-sm" onclick="importModels(\'' + p.id + '\')">Import from /models</button>\
      </div>\
      <div id="m-test-result" class="mb-12"></div>\
      <div id="model-list">' +
        (models.length === 0 ? '<div class="empty">No models configured. Use "Import from /models" or add manually.</div>' : modelsHtml) + '\
      </div>\
    </div>';
}

async function testModelDetail(pid) {
  const modelId = document.getElementById('m-input').value.trim();
  if (!modelId) { toast('Enter a model ID first', 'error'); return; }
  await doTestModel(pid, modelId);
}

async function testSingleModel(pid, modelId) {
  await doTestModel(pid, modelId);
  currentProviderId = pid;
  renderProviders(document.getElementById('page-content'));
}

async function doTestModel(pid, modelId) {
  const resultEl = document.getElementById('m-test-result');
  if (resultEl) resultEl.innerHTML = '<span class="badge badge-testing">Testing ' + escapeHtml(modelId) + '...</span>';
  try {
    const result = await apiPost('/providers/' + pid + '/models/test', { model: modelId });
    modelTestStatus[modelId] = result;
    if (resultEl) {
      if (result.ok) {
        resultEl.innerHTML = '<span class="badge badge-valid">' + escapeHtml(modelId) + ': OK (' + result.latencyMs + 'ms)</span>';
      } else {
        resultEl.innerHTML = '<span class="badge badge-invalid">' + escapeHtml(modelId) + ': ' + escapeHtml(result.error || 'failed') + ' (' + result.latencyMs + 'ms)</span>';
      }
    }
  } catch (e) {
    if (resultEl) resultEl.innerHTML = '<span class="badge badge-invalid">Error: ' + escapeHtml(e.message) + '</span>';
  }
}

async function addModelDetail(pid) {
  const modelId = document.getElementById('m-input').value.trim();
  if (!modelId) { toast('Enter a model ID', 'error'); return; }
  await apiPost('/providers/' + pid + '/models', { model: modelId });
  toast('Model added', 'success');
  currentProviderId = pid;
  renderProviders(document.getElementById('page-content'));
}

async function deleteModelDetail(pid, modelId) {
  const ok = await confirmModal('Delete model ' + modelId + '?');
  if (!ok) return;
  await apiDelete('/providers/' + pid + '/models/' + encodeURIComponent(modelId));
  delete modelTestStatus[modelId];
  toast('Model deleted', 'success');
  currentProviderId = pid;
  renderProviders(document.getElementById('page-content'));
}

async function importModels(pid) {
  const p = providerDetailCache;
  const resultEl = document.getElementById('m-test-result');
  if (resultEl) resultEl.innerHTML = '<span class="badge badge-testing">Fetching models...</span>';
  try {
    const data = await apiGet('/providers/' + pid + '/models');
    const models = data.models || [];
    if (models.length === 0) {
      if (resultEl) resultEl.innerHTML = '<span class="badge badge-invalid">No models returned by upstream</span>';
      return;
    }
    const existing = new Set(p.models || []);
    var added = 0;
    for (const m of models) {
      if (!existing.has(m.id)) {
        await apiPost('/providers/' + pid + '/models', { model: m.id });
        added++;
      }
    }
    if (resultEl) resultEl.innerHTML = '<span class="badge badge-valid">Imported ' + added + ' models (' + models.length + ' total from upstream, ' + (models.length - added) + ' already existed)</span>';
    setTimeout(function() {
      currentProviderId = pid;
      renderProviders(document.getElementById('page-content'));
    }, 1500);
  } catch (e) {
    if (resultEl) {
      resultEl.innerHTML = '<span class="badge badge-invalid">Failed: ' + escapeHtml(e.message || 'unknown error') + '</span>';
    }
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
  const ok = await confirmModal('Delete this provider and all its keys?');
  if (!ok) return;
  await apiDelete('/providers/' + id);
  toast('Provider deleted', 'success');
  backToProviderList();
}

// ===================== Combos Page =====================

async function renderCombos(c) {
  showSkeleton(c, 3);
  const data = await apiGet('/combos');
  const combos = data.combos || [];
  c.innerHTML = '\
    <h2>Combos</h2>\
    <button class="btn btn-primary mb-12" onclick="showAddCombo()">+ Add Combo</button>\
    <div id="combo-list"></div>\
    <div id="combo-form" style="display:none"></div>';
  const list = document.getElementById('combo-list');
  if (combos.length === 0) {
    list.innerHTML = '<div class="empty">No combos yet.</div>';
    return;
  }
  list.innerHTML = combos.map(function(cb) {
    return '\
    <div class="card">\
      <div class="card-header">\
        <span class="card-title">' + escapeHtml(cb.name) + '</span>\
        <span class="badge badge-active">' + escapeHtml(cb.strategy) + '</span>\
      </div>\
      <p class="muted">Models: ' + (cb.models ? cb.models.join(', ') : 'none') + '</p>' +
      (cb.fusionJudge ? '<p class="muted">Judge: ' + escapeHtml(cb.fusionJudge) + '</p>' : '') + '\
      <div class="mt-12">\
        <button class="btn btn-sm btn-danger" onclick="deleteCombo(\'' + cb.id + '\')">Delete</button>\
      </div>\
    </div>';
  }).join('');
}

function showAddCombo() {
  const el = document.getElementById('combo-form');
  el.style.display = 'block';
  el.innerHTML = '\
    <div class="card">\
      <div class="card-title">New Combo</div>\
      <div class="form-group mt-12"><label>Name</label><input id="c-name" placeholder="Fast + Smart"></div>\
      <div class="form-group"><label>Strategy</label>\
        <select id="c-strategy">\
          <option value="fallback">fallback</option>\
          <option value="round-robin">round-robin</option>\
          <option value="fusion">fusion</option>\
        </select>\
      </div>\
      <div class="form-group"><label>Models (one per line, e.g. deepseek/deepseek-chat)</label>\
        <textarea id="c-models" rows="3" placeholder="deepseek/deepseek-chat\nmy-custom/gpt-4o"></textarea>\
      </div>\
      <div class="form-group"><label>Fusion Judge (optional, fusion only)</label><input id="c-judge" placeholder="deepseek/deepseek-chat"></div>\
      <div class="flex" style="gap:8px">\
        <button class="btn btn-primary" onclick="addCombo()">Create</button>\
        <button class="btn" onclick="document.getElementById(\'combo-form\').style.display=\'none\'">Cancel</button>\
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
  toast('Combo created', 'success');
  renderCombos(document.getElementById('page-content'));
}

async function deleteCombo(id) {
  const ok = await confirmModal('Delete this combo?');
  if (!ok) return;
  await apiDelete('/combos/' + id);
  toast('Combo deleted', 'success');
  renderCombos(document.getElementById('page-content'));
}

// ===================== Usage Page =====================

async function renderUsage(c) {
  showSkeleton(c, 4);
  const [summary, usage] = await Promise.all([
    apiGet('/usage/summary'),
    apiGet('/usage?limit=500')
  ]);
  const entries = usage.entries || [];
  c.innerHTML = '\
    <h2>Usage</h2>\
    <div class="stat-grid">\
      <div class="stat-card"><div class="stat-value">' + summary.total + '</div><div class="stat-label">Total Requests</div></div>\
      <div class="stat-card"><div class="stat-value" style="color:var(--accent2)">' + summary.success + '</div><div class="stat-label">Success</div></div>\
      <div class="stat-card"><div class="stat-value" style="color:var(--danger)">' + summary.error + '</div><div class="stat-label">Errors</div></div>\
      <div class="stat-card"><div class="stat-value">' + summary.avgLatencyMs + 'ms</div><div class="stat-label">Avg Latency</div></div>\
    </div>\
    <div class="flex-between mb-12">\
      <h3>Recent Requests</h3>\
      <button class="btn btn-danger btn-sm" onclick="clearUsage()">Clear</button>\
    </div>' +
    (entries.length === 0 ? '<div class="empty">No usage data yet.</div>' : '\
    <table>\
      <thead><tr><th>Time</th><th>Provider</th><th>Model</th><th>Key</th><th>Status</th><th>Latency</th><th>Tokens (in/out)</th></tr></thead>\
      <tbody>' +
        entries.map(function(e) {
          return '<tr>\
            <td>' + new Date(e.timestamp).toLocaleTimeString() + '</td>\
            <td>' + escapeHtml(e.provider) + '</td>\
            <td>' + escapeHtml(e.model) + '</td>\
            <td>' + escapeHtml(e.keyName) + '</td>\
            <td><span class="badge ' + (e.status === 'success' ? 'badge-active' : 'badge-locked') + '">' + e.status + '</span></td>\
            <td>' + e.latencyMs + 'ms</td>\
            <td>' + e.inputTokens + '/' + e.outputTokens + '</td>\
          </tr>';
        }).join('') + '\
      </tbody>\
    </table>');
}

async function clearUsage() {
  await apiDelete('/usage');
  toast('Usage data cleared', 'info');
  renderUsage(document.getElementById('page-content'));
}

// ===================== Console Page =====================

var consoleEventSource = null;
async function renderConsole(c) {
  c.innerHTML = '\
    <h2>Console</h2>\
    <div class="flex-between mb-12">\
      <span class="muted" id="console-status">Connecting...</span>\
      <button class="btn btn-danger btn-sm" onclick="clearConsole()">Clear</button>\
    </div>\
    <div class="log-container" id="log-container"></div>';
  startConsoleStream();
}

function startConsoleStream() {
  if (consoleEventSource) consoleEventSource.close();
  const container = document.getElementById('log-container');
  const status = document.getElementById('console-status');

  apiGet('/console-logs').then(function(data) {
    (data.lines || []).forEach(function(line) { appendLogLine(container, line); });
  });

  consoleEventSource = new EventSource('/api/console-logs/stream');
  consoleEventSource.onopen = function() { status.textContent = 'Connected'; };
  consoleEventSource.onerror = function() { status.textContent = 'Disconnected. Reconnecting...'; };
  consoleEventSource.onmessage = function(e) {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'line' && msg.line) {
        appendLogLine(container, msg.line);
      }
    } catch (err) {}
  };
}

function appendLogLine(container, line) {
  const div = document.createElement('div');
  div.className = 'log-line log-info';
  if (line.includes('[ERROR]')) div.className = 'log-line log-error';
  else if (line.includes('\u26A0')) div.className = 'log-line log-warn';
  else if (line.includes('[DEBUG]')) div.className = 'log-line log-debug';
  div.textContent = line;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function clearConsole() {
  await apiDelete('/console-logs');
  document.getElementById('log-container').innerHTML = '';
  toast('Console cleared', 'info');
}
