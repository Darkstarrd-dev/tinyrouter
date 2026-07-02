const API = '/api';

// ===================== Translation System =====================
const L = {
  en: {
    endpoint: 'Endpoint', providers: 'Providers', combos: 'Combos', usage: 'Usage', console: 'Console',
    shutdown: 'Shutdown',
    listenPort: 'Listen Port', save: 'Save',
    apiEndpoint: 'API Endpoint:', noKeyRequired: 'No API key required. Any key or no key works.',
    rotationSettings: 'Rotation Settings (Global Default)',
    strategy: 'Strategy', stickyLimit: 'Sticky Limit (round-robin)',
    maxRetries: 'Max Retries (429 temp)', retryDelay: 'Retry Delay (seconds)',
    backoffMax: 'Backoff Max (seconds)', saveRotation: 'Save Rotation',
    addProvider: '+ Add Provider', noProviders: 'No providers yet. Click "Add Provider" to create one.',
    active: 'Active', inactive: 'Inactive', disable: 'Disable', enable: 'Enable',
    prefix: 'Prefix:', baseUrl: 'Base URL:', keys: 'Keys:', models: 'Models:',
    newProvider: 'New Provider', name: 'Name', prefixLabel: 'Prefix (used in model field)',
    baseUrlLabel: 'Base URL', apiKeyLabel: 'API Key (for connectivity test, not saved)',
    modelIdLabel: 'Model ID (optional, fallback test if /models unavailable)',
    check: 'Check', create: 'Create', cancel: 'Cancel',
    back: 'Back', edit: 'Edit', delete: 'Delete',
    keysTitle: 'Keys', addKey: '+ Add Key', bulkAdd: 'Bulk Add', noKeys: 'No keys yet.',
    keyName: 'Name', key: 'Key', priority: 'Priority', status: 'Status', actions: 'Actions',
    test: 'Test', pause: 'Pause', resume: 'Resume',
    newKey: 'New Key', apiKeyInput: 'API Key', priorityLabel: 'Priority (lower = higher)',
    bulkAddKeys: 'Bulk Add Keys', bulkFormat: 'One key per line. Format: name|key or just key',
    defaultPriority: 'Default Priority', addAll: 'Add All',
    rotationSection: 'Rotation Strategy', rotationDesc: 'Overrides global settings for this provider. Leave "Inherit" to use global default.',
    inheritGlobal: 'Inherit Global', fillFirst: 'fill-first', roundRobin: 'round-robin',
    stickyLabel: 'Sticky Limit (0 = inherit global, round-robin only)',
    modelsTitle: 'Models', modelPlaceholder: 'model-id (e.g. deepseek-chat)',
    importModels: 'Import from /models', noModels: 'No models configured. Use "Import from /models" or add manually.',
    untested: 'untested',
    editProvider: 'Edit Provider',
    providerNotFound: 'Provider not found.',
    providerCreated: 'Provider created', providerUpdated: 'Provider updated', providerDeleted: 'Provider deleted',
    providerEnabled: 'Provider enabled', providerDisabled: 'Provider disabled',
    keyAdded: 'Key added', keyDeleted: 'Key deleted',
    keyValid: 'Key is valid.', keyInvalid: 'Key invalid: ',
    modelAdded: 'Model added', modelDeleted: 'Model deleted',
    modelTestFailed: 'Model test failed: ',
    addCombo: '+ Add Combo', noCombos: 'No combos yet.',
    newCombo: 'New Combo', comboStrategy: 'Strategy', comboModels: 'Models (one per line, e.g. deepseek/deepseek-chat)',
    fusionJudge: 'Fusion Judge (optional, fusion only)',
    comboCreated: 'Combo created', comboDeleted: 'Combo deleted',
    totalRequests: 'Total Requests', success: 'Success', errors: 'Errors', avgLatency: 'Avg Latency',
    totalInput: 'Total Input', totalOutput: 'Total Output',
    recentRequests: 'Recent Requests', clear: 'Clear', noUsage: 'No usage data yet.',
    time: 'Time', provider: 'Provider', model: 'Model', latency: 'Latency', tokens: 'Tokens (in/out)',
    connecting: 'Connecting...', connected: 'Connected', disconnected: 'Disconnected. Reconnecting...',
    consoleCleared: 'Console cleared', usageCleared: 'Usage data cleared',
    portSaved: 'Port saved. Restart TinyRouter to apply.',
    rotationSaved: 'Rotation settings saved.', rotationStrategySaved: 'Rotation strategy saved.',
    enterModelId: 'Enter a model ID first', enterModelId2: 'Enter a model ID',
    apiKeyRequired: 'API Key is required', requiredFields: 'Name, Prefix, and Base URL are required',
    confirmDeleteKey: 'Delete this key?', confirmDeleteProvider: 'Delete this provider and all its keys?',
    confirmDeleteModel: 'Delete model ', confirmDeleteCombo: 'Delete this combo?',
    confirmShutdown: 'Shutdown TinyRouter?',
    confirm: 'Confirm', confirmTitle: 'Confirm',
    serverStopped: 'TinyRouter Stopped',
    serverStoppedDesc: 'The server has been shut down. You may close this window.',
    fetchingModels: 'Fetching models...', noModelsUpstream: 'No models returned by upstream',
    importedModels: 'Imported {0} models ({1} total from upstream, {2} already existed)',
    testing: 'Testing {0}...', testOk: '{0}: OK ({1}ms)', testFail: '{0}: {1}',
    invalidProvider: 'Invalid: {0}', validProvider: 'Valid', checking: 'Checking...',
    baseUrlKeyRequired: 'Base URL and API Key required',
    adding: 'Adding...', addedKeys: 'Added {0} keys', addedKeysErrors: 'Added: {0}',
    fetching: 'Fetching...', failed: 'Failed: {0}',
    fallback: 'fallback', fusion: 'fusion',
    fallbackDesc: 'fallback', roundRobinDesc: 'round-robin', fusionDesc: 'fusion',
    copied: 'copied', copyFailed: 'Copy failed',
    clickToCopy: 'Click to copy',
    comboEdit: 'Edit Combo', editCombo: 'Edit', saveCombo: 'Update',
    comboUpdated: 'Combo updated', importFromProvider: 'Import from Provider',
    selectModels: 'Select Models', addSelected: 'Add Selected', noModelsAvailable: 'No models available',
    selectAll: 'Select All', deselectAll: 'Deselect All', close: 'Close',
    pause: 'Paused',
  },
  cn: {
    endpoint: '端点', providers: '服务商', combos: '模型组', usage: '用量', console: '控制台',
    shutdown: '关闭',
    listenPort: '监听端口', save: '保存',
    apiEndpoint: 'API 地址:', noKeyRequired: '无需 API Key，任意 Key 或无 Key 均可访问。',
    rotationSettings: '轮询设置 (全局默认)',
    strategy: '策略', stickyLimit: '粘性限制 (round-robin)',
    maxRetries: '最大重试 (429 临时)', retryDelay: '重试延迟 (秒)',
    backoffMax: '退避上限 (秒)', saveRotation: '保存轮询设置',
    addProvider: '+ 添加服务商', noProviders: '暂无服务商，点击"添加服务商"创建。',
    active: '启用', inactive: '停用', disable: '停用', enable: '启用',
    prefix: '前缀:', baseUrl: '基础 URL:', keys: '密钥:', models: '模型:',
    newProvider: '新建服务商', name: '名称', prefixLabel: '前缀 (用于 model 字段)',
    baseUrlLabel: '基础 URL', apiKeyLabel: 'API Key (仅用于连通性测试，不保存)',
    modelIdLabel: '模型 ID (可选，/models 不可用时的回退测试)',
    check: '检测', create: '创建', cancel: '取消',
    back: '返回', edit: '编辑', delete: '删除',
    keysTitle: '密钥', addKey: '+ 添加密钥', bulkAdd: '批量添加', noKeys: '暂无密钥。',
    keyName: '名称', key: '密钥', priority: '优先级', status: '状态', actions: '操作',
    test: '测试', pause: '暂停', resume: '恢复',
    newKey: '新建密钥', apiKeyInput: 'API Key', priorityLabel: '优先级 (越低越优先)',
    bulkAddKeys: '批量添加密钥', bulkFormat: '每行一个密钥。格式: 名称|key 或仅 key',
    defaultPriority: '默认优先级', addAll: '全部添加',
    rotationSection: '轮询策略', rotationDesc: '覆盖此服务商的全局设置。选择"继承全局"以使用默认设置。',
    inheritGlobal: '继承全局', fillFirst: 'fill-first', roundRobin: 'round-robin',
    stickyLabel: '粘性限制 (0 = 继承全局, 仅 round-robin)',
    modelsTitle: '模型', modelPlaceholder: '模型 ID (如 deepseek-chat)',
    importModels: '从 /models 导入', noModels: '未配置模型。使用"从 /models 导入"或手动添加。',
    untested: '未测试',
    editProvider: '编辑服务商',
    providerNotFound: '未找到服务商。',
    providerCreated: '服务商已创建', providerUpdated: '服务商已更新', providerDeleted: '服务商已删除',
    providerEnabled: '服务商已启用', providerDisabled: '服务商已停用',
    keyAdded: '密钥已添加', keyDeleted: '密钥已删除',
    keyValid: '密钥有效。', keyInvalid: '密钥无效: ',
    modelAdded: '模型已添加', modelDeleted: '模型已删除',
    modelTestFailed: '模型测试失败: ',
    addCombo: '+ 添加模型组', noCombos: '暂无模型组。',
    newCombo: '新建模型组', comboStrategy: '策略', comboModels: '模型 (每行一个，如 deepseek/deepseek-chat)',
    fusionJudge: 'Fusion 裁决模型 (可选，仅 fusion)',
    comboCreated: '模型组已创建', comboDeleted: '模型组已删除',
    totalRequests: '总请求', success: '成功', errors: '失败', avgLatency: '平均延迟',
    totalInput: '总输入', totalOutput: '总输出',
    recentRequests: '最近请求', clear: '清空', noUsage: '暂无用量数据。',
    time: '时间', provider: '服务商', model: '模型', latency: '延迟', tokens: 'Token (入/出)',
    connecting: '连接中...', connected: '已连接', disconnected: '已断开，重连中...',
    consoleCleared: '控制台已清空', usageCleared: '用量数据已清空',
    portSaved: '端口已保存。重启 TinyRouter 生效。',
    rotationSaved: '轮询设置已保存。', rotationStrategySaved: '轮询策略已保存。',
    enterModelId: '请先输入模型 ID', enterModelId2: '请输入模型 ID',
    apiKeyRequired: 'API Key 不能为空', requiredFields: '名称、前缀和基础 URL 不能为空',
    confirmDeleteKey: '确定删除此密钥？', confirmDeleteProvider: '确定删除此服务商及其所有密钥？',
    confirmDeleteModel: '确定删除模型 ', confirmDeleteCombo: '确定删除此模型组？',
    confirmShutdown: '确定关闭 TinyRouter？',
    confirm: '确定', confirmTitle: '确认',
    serverStopped: 'TinyRouter 已停止',
    serverStoppedDesc: '服务器已关闭，您可以关闭此窗口。',
    fetchingModels: '正在获取模型列表...', noModelsUpstream: '上游未返回模型',
    importedModels: '已导入 {0} 个模型 (上游共 {1} 个，已存在 {2} 个)',
    testing: '正在测试 {0}...', testOk: '{0}: 正常 ({1}ms)', testFail: '{0}: {1}',
    invalidProvider: '无效: {0}', validProvider: '有效', checking: '检测中...',
    baseUrlKeyRequired: '基础 URL 和 API Key 不能为空',
    adding: '添加中...', addedKeys: '已添加 {0} 个密钥', addedKeysErrors: '已添加: {0}',
    fetching: '获取中...', failed: '失败: {0}',
    fallback: 'fallback', fusion: 'fusion',
    fallbackDesc: 'fallback', roundRobinDesc: 'round-robin', fusionDesc: 'fusion',
    copied: '已复制', copyFailed: '复制失败',
    clickToCopy: '点击复制',
    comboEdit: '编辑模型组', editCombo: '编辑', saveCombo: '更新',
    comboUpdated: '模型组已更新', importFromProvider: '从服务商导入',
    selectModels: '选择模型', addSelected: '添加选中', noModelsAvailable: '无可用模型',
    selectAll: '全选', deselectAll: '取消全选', close: '关闭',
    pause: '已暂停',
  }
};

function t(key, args) {
  var lang = document.documentElement.getAttribute('data-lang') || 'en';
  var dict = L[lang] || L['en'];
  var msg = dict[key] || (L['en'][key] || key);
  if (args) {
    for (var i = 0; i < args.length; i++) {
      msg = msg.replace('{' + i + '}', args[i]);
    }
  }
  return msg;
}

function currentLang() {
  return document.documentElement.getAttribute('data-lang') || 'en';
}

function toggleLang() {
  var current = currentLang();
  var next = current === 'en' ? 'cn' : 'en';
  document.documentElement.setAttribute('data-lang', next);
  localStorage.setItem('lang', next);
  updateLangButton(next);
  updateSidebarNav();
  var page = currentPage;
  if (currentProviderId) {
    renderProviders(document.getElementById('page-content'));
  } else {
    navigateTo(page);
  }
}

function updateLangButton(lang) {
  var btn = document.getElementById('lang-btn');
  if (btn) btn.textContent = lang === 'en' ? 'EN' : 'CN';
}

// --- State ---
let currentPage = 'endpoint';
let currentProviderId = null;
let providersCache = [];
let providerDetailCache = null;
let modelTestStatus = {};
let importTarget = 'models';
var usageEventSource = null;

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initFontSize();
  initLang();
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
  stopUsageRefresh();
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

function formatMillionTokens(n) {
  return (Number(n || 0) / 1000000).toFixed(3) + 'M';
}

function copyToClipboard(text, label) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      toast((label || text) + ' ' + t('copied'), 'success');
    }).catch(function() {
      fallbackCopy(text, label);
    });
  } else {
    fallbackCopy(text, label);
  }
}

function fallbackCopy(text, label) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast((label || text) + ' ' + t('copied'), 'success');
  } catch (e) {
    toast(t('copyFailed'), 'error');
  }
  document.body.removeChild(ta);
}

function toast(message, type, duration) {
  if (type === undefined) type = 'info';
  if (duration === undefined) duration = 3500;
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
    overlay.innerHTML = '<div class="modal"><div class="modal-title">' + t('confirmTitle') + '</div><div class="modal-body">' + escapeHtml(message) + '</div><div class="modal-footer"><button class="btn btn-ghost" id="modal-cancel">' + t('cancel') + '</button><button class="btn btn-primary" id="modal-confirm">' + t('confirm') + '</button></div></div>';
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
  if (btn) btn.innerHTML = theme === 'dark' ? '&#9788;' : '&#9790;';
}

function initFontSize() {
  const size = document.documentElement.getAttribute('data-font-size') || 's';
  updateFontButton(size);
}

function updateFontButton(size) {
  const btn = document.getElementById('font-btn');
  if (btn) btn.textContent = size.toUpperCase();
}

function initLang() {
  const lang = document.documentElement.getAttribute('data-lang') || 'en';
  updateLangButton(lang);
  updateSidebarNav();
}

function updateSidebarNav() {
  document.querySelectorAll('.nav-item').forEach(function(el) {
    var page = el.dataset.page;
    if (page) el.textContent = t(page);
  });
  var shutdownBtn = document.querySelector('.shutdown-btn');
  if (shutdownBtn) shutdownBtn.textContent = t('shutdown');
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
  const ok = await confirmModal(t('confirmShutdown'));
  if (!ok) return;
  try {
    await apiPost('/shutdown', {});
  } catch (e) {}
  document.body.innerHTML = '\
    <div class="app" style="align-items:center;justify-content:center">\
      <div class="card" style="text-align:center;max-width:360px">\
        <div class="card-title">' + t('serverStopped') + '</div>\
        <p class="muted mt-12">' + t('serverStoppedDesc') + '</p>\
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
    <h2>' + t('endpoint') + '</h2>\
    <div class="card">\
      <div class="form-group">\
        <label>' + t('listenPort') + '</label>\
        <div class="flex">\
          <input type="number" id="port" value="' + settings.port + '" style="max-width:120px">\
          <button class="btn btn-primary" onclick="savePort()">' + t('save') + '</button>\
        </div>\
      </div>\
      <p class="muted mt-12">' + t('apiEndpoint') + ' <span class="code">http://localhost:' + settings.port + '/v1</span></p>\
      <p class="muted mt-12">' + t('noKeyRequired') + '</p>\
    </div>\
    <div class="card">\
      <div class="card-title">' + t('rotationSettings') + '</div>\
      <div class="form-group mt-12">\
        <label>' + t('strategy') + '</label>\
        <select id="strategy">\
          <option value="fill-first"' + (settings.rotation && settings.rotation.strategy === 'fill-first' ? ' selected' : '') + '>' + t('fillFirst') + '</option>\
          <option value="round-robin"' + (settings.rotation && settings.rotation.strategy === 'round-robin' ? ' selected' : '') + '>' + t('roundRobin') + '</option>\
        </select>\
      </div>\
      <div class="form-group">\
        <label>' + t('stickyLimit') + '</label>\
        <input type="number" id="stickyLimit" value="' + ((settings.rotation && settings.rotation.stickyLimit) || 3) + '" style="max-width:120px">\
      </div>\
      <div class="form-group">\
        <label>' + t('maxRetries') + '</label>\
        <input type="number" id="maxRetries" value="' + ((settings.rotation && settings.rotation.maxRetries) || 5) + '" style="max-width:120px">\
      </div>\
      <div class="form-group">\
        <label>' + t('retryDelay') + '</label>\
        <input type="number" id="retryDelaySec" value="' + ((settings.rotation && settings.rotation.retryDelaySec) || 5) + '" style="max-width:120px">\
      </div>\
      <div class="form-group">\
        <label>' + t('backoffMax') + '</label>\
        <input type="number" id="backoffMaxSec" value="' + ((settings.rotation && settings.rotation.backoffMaxSec) || 240) + '" style="max-width:120px">\
      </div>\
      <button class="btn btn-primary" onclick="saveRotation()">' + t('saveRotation') + '</button>\
    </div>';
}

async function savePort() {
  const port = parseInt(document.getElementById('port').value);
  await apiPatch('/settings', { port });
  toast(t('portSaved'), 'success');
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
  toast(t('rotationSaved'), 'success');
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
    <h2>' + t('providers') + '</h2>\
    <button class="btn btn-primary mb-12" onclick="showAddProvider()">' + t('addProvider') + '</button>\
    <div id="provider-list"></div>\
    <div id="provider-form" style="display:none"></div>';
  renderProviderList();
}

function renderProviderList() {
  const el = document.getElementById('provider-list');
  if (providersCache.length === 0) {
    el.innerHTML = '<div class="empty">' + t('noProviders') + '</div>';
    return;
  }
  el.innerHTML = providersCache.map(function(p) {
    return '\
    <div class="card provider-card" onclick="openProviderDetail(\'' + p.id + '\')">\
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
        <button class="btn" onclick="checkProvider()">' + t('check') + '</button>\
        <button class="btn btn-primary" onclick="addProvider()">' + t('create') + '</button>\
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
    c.innerHTML = '<div class="empty">' + t('providerNotFound') + '</div>';
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
      (keys.length === 0 ? '<div class="empty">' + t('noKeys') + '</div>' : '\
      <table>\
        <thead><tr><th>' + t('keyName') + '</th><th>' + t('actions') + '</th><th>' + t('key') + '</th><th>' + t('priority') + '</th><th>' + t('status') + '</th></tr></thead>\
        <tbody>' +
          keys.map(function(k) {
            return '<tr>\
              <td>' + escapeHtml(k.name) + '</td>\
              <td>\
                <button class="btn btn-sm" onclick="testKeyDetail(\'' + p.id + '\',\'' + k.id + '\')">' + t('test') + '</button>\
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
        <button class="btn btn-primary" onclick="addKeyDetail(\'' + providerId + '\')">' + t('create') + '</button>\
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
        <button class="btn btn-primary" onclick="bulkAddKeys(\'' + providerId + '\')">' + t('addAll') + '</button>\
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
      <button class="btn btn-primary" onclick="saveProviderRotation(\'' + p.id + '\')">' + t('save') + '</button>\
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
    var ts = modelTestStatus[m];
    var statusClass = 'model-pending';
    var statusText = t('untested');
    if (ts) {
      if (ts.ok) { statusClass = 'model-ok'; statusText = 'OK'; }
      else { statusClass = 'model-err'; statusText = ts.error || 'FAIL'; }
    }
    return '<div class="model-row">\
      <button class="btn btn-sm" onclick="testSingleModel(\'' + p.id + '\',\'' + escapeHtml(m) + '\')">' + t('test') + '</button>\
      <button class="btn btn-sm btn-danger" onclick="deleteModelDetail(\'' + p.id + '\',\'' + escapeHtml(m) + '\')">' + t('delete') + '</button>\
      <span class="model-id copyable" onclick="copyToClipboard(\'' + escapeHtml(p.prefix) + '/' + escapeHtml(m) + '\')" title="' + t('clickToCopy') + '">' + escapeHtml(p.prefix) + '/' + escapeHtml(m) + '</span>\
      <span class="model-status ' + statusClass + '">' + escapeHtml(statusText) + '</span>\
    </div>';
  }).join('');
  el.innerHTML = '\
    <div class="card">\
      <div class="section-title">' + t('modelsTitle') + ' (' + models.length + ')</div>\
      <div class="flex mb-12" style="gap:8px">\
        <input id="m-input" placeholder="' + t('modelPlaceholder') + '" style="flex:1">\
        <button class="btn btn-sm" onclick="testModelDetail(\'' + p.id + '\')">' + t('test') + '</button>\
        <button class="btn btn-sm btn-primary" onclick="addModelDetail(\'' + p.id + '\')">' + t('create') + '</button>\
      </div>\
      <div class="flex mb-12" style="gap:8px">\
        <button class="btn btn-sm" onclick="importModels(\'' + p.id + '\')">' + t('importModels') + '</button>\
      </div>\
      <div id="m-test-result" class="mb-12"></div>\
      <div id="model-list">' +
        (models.length === 0 ? '<div class="empty">' + t('noModels') + '</div>' : modelsHtml) + '\
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
    const existing = new Set(p.models || []);
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
        <button class="btn btn-primary" onclick="saveEditProvider(\'' + id + '\')">' + t('save') + '</button>\
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

// ===================== Usage Page =====================

async function renderUsage(c) {
  showSkeleton(c, 4);
  const [summary, usage] = await Promise.all([
    apiGet('/usage/summary'),
    apiGet('/usage?limit=500')
  ]);
  const entries = usage.entries || [];
  c.innerHTML = '\
    <h2>' + t('usage') + '</h2>\
    <div class="stat-grid">\
      <div class="stat-card"><div class="stat-value">' + summary.total + '</div><div class="stat-label">' + t('totalRequests') + '</div></div>\
      <div class="stat-card"><div class="stat-value" style="color:var(--accent2)">' + summary.success + '</div><div class="stat-label">' + t('success') + '</div></div>\
      <div class="stat-card"><div class="stat-value" style="color:var(--danger)">' + summary.error + '</div><div class="stat-label">' + t('errors') + '</div></div>\
      <div class="stat-card"><div class="stat-value">' + summary.avgLatencyMs + 'ms</div><div class="stat-label">' + t('avgLatency') + '</div></div>\
      <div class="stat-card"><div class="stat-value">' + formatMillionTokens(summary.totalInputTokens) + '</div><div class="stat-label">' + t('totalInput') + '</div></div>\
      <div class="stat-card"><div class="stat-value">' + formatMillionTokens(summary.totalOutputTokens) + '</div><div class="stat-label">' + t('totalOutput') + '</div></div>\
    </div>\
    <div class="flex-between mb-12">\
      <h3>' + t('recentRequests') + '</h3>\
      <button class="btn btn-danger btn-sm" onclick="clearUsage()">' + t('clear') + '</button>\
    </div>' +
    (entries.length === 0 ? '<div class="empty">' + t('noUsage') + '</div>' : '\
    <table>\
      <thead><tr><th>' + t('time') + '</th><th>' + t('provider') + '</th><th>' + t('model') + '</th><th>Key</th><th>' + t('status') + '</th><th>' + t('latency') + '</th><th>' + t('tokens') + '</th></tr></thead>\
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
  startUsageRefresh();
}

function startUsageRefresh() {
  stopUsageRefresh();
  usageEventSource = new EventSource('/api/usage/events');
  usageEventSource.onmessage = async function(ev) {
    try {
      var data = JSON.parse(ev.data);
      if (data.type === 'usage-updated') {
        const [summary, usage] = await Promise.all([
          apiGet('/usage/summary'),
          apiGet('/usage?limit=500')
        ]);
        updateUsageSummary(summary);
        updateUsageTable(usage.entries || []);
      }
    } catch(e) {}
  };
}

function stopUsageRefresh() {
  if (usageEventSource) {
    usageEventSource.close();
    usageEventSource = null;
  }
}

function updateUsageSummary(summary) {
  var grid = document.querySelector('.stat-grid');
  if (!grid) return;
  var cards = grid.querySelectorAll('.stat-value');
  if (cards.length >= 6) {
    cards[0].textContent = summary.total;
    cards[1].textContent = summary.success;
    cards[2].textContent = summary.error;
    cards[3].textContent = summary.avgLatencyMs + 'ms';
    cards[4].textContent = formatMillionTokens(summary.totalInputTokens);
    cards[5].textContent = formatMillionTokens(summary.totalOutputTokens);
  }
}

function updateUsageTable(entries) {
  var tbody = document.querySelector('#page-content table tbody');
  if (!tbody) return;
  tbody.innerHTML = entries.map(function(e) {
    return '<tr>\
      <td>' + new Date(e.timestamp).toLocaleTimeString() + '</td>\
      <td>' + escapeHtml(e.provider) + '</td>\
      <td>' + escapeHtml(e.model) + '</td>\
      <td>' + escapeHtml(e.keyName) + '</td>\
      <td><span class="badge ' + (e.status === 'success' ? 'badge-active' : 'badge-locked') + '">' + e.status + '</span></td>\
      <td>' + e.latencyMs + 'ms</td>\
      <td>' + e.inputTokens + '/' + e.outputTokens + '</td>\
    </tr>';
  }).join('');
}

async function clearUsage() {
  await apiDelete('/usage');
  toast(t('usageCleared'), 'info');
  renderUsage(document.getElementById('page-content'));
}

// ===================== Console Page =====================

var consoleEventSource = null;
async function renderConsole(c) {
  c.innerHTML = '\
    <h2>' + t('console') + '</h2>\
    <div class="flex-between mb-12">\
      <span class="muted" id="console-status">' + t('connecting') + '</span>\
      <button class="btn btn-danger btn-sm" onclick="clearConsole()">' + t('clear') + '</button>\
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
  consoleEventSource.onopen = function() { status.textContent = t('connected'); };
  consoleEventSource.onerror = function() { status.textContent = t('disconnected'); };
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
  toast(t('consoleCleared'), 'info');
}