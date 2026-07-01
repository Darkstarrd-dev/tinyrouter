// TinyRouter UI - single page app, vanilla JS

const API = '/api';

// --- State ---
let currentPage = 'endpoint';

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
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
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const container = document.getElementById('page-content');
  container.innerHTML = '';
  switch (page) {
    case 'endpoint': renderEndpoint(container); break;
    case 'providers': renderProviders(container); break;
    case 'combos': renderCombos(container); break;
    case 'usage': renderUsage(container); break;
    case 'console': renderConsole(container); break;
  }
}

// --- API helpers ---
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

// --- Endpoint Page ---
async function renderEndpoint(c) {
  const settings = await apiGet('/settings');
  c.innerHTML = `
    <h2>Endpoint</h2>
    <div class="card">
      <div class="form-group">
        <label>Listen Port</label>
        <div class="flex">
          <input type="number" id="port" value="${settings.port}" style="max-width:120px">
          <button class="btn btn-primary" onclick="savePort()">Save</button>
        </div>
      </div>
      <p class="muted mt-12">API Endpoint: <span class="code">http://localhost:${settings.port}/v1</span></p>
      <p class="muted mt-12">No API key required. Any key or no key works.</p>
    </div>
    <div class="card">
      <div class="card-title">Rotation Settings</div>
      <div class="form-group mt-12">
        <label>Strategy</label>
        <select id="strategy">
          <option value="fill-first" ${settings.rotation?.strategy === 'fill-first' ? 'selected' : ''}>fill-first</option>
          <option value="round-robin" ${settings.rotation?.strategy === 'round-robin' ? 'selected' : ''}>round-robin</option>
        </select>
      </div>
      <div class="form-group">
        <label>Sticky Limit (round-robin)</label>
        <input type="number" id="stickyLimit" value="${settings.rotation?.stickyLimit || 3}" style="max-width:120px">
      </div>
      <div class="form-group">
        <label>Max Retries (429 temp)</label>
        <input type="number" id="maxRetries" value="${settings.rotation?.maxRetries || 5}" style="max-width:120px">
      </div>
      <div class="form-group">
        <label>Retry Delay (seconds)</label>
        <input type="number" id="retryDelaySec" value="${settings.rotation?.retryDelaySec || 5}" style="max-width:120px">
      </div>
      <div class="form-group">
        <label>Backoff Max (seconds)</label>
        <input type="number" id="backoffMaxSec" value="${settings.rotation?.backoffMaxSec || 240}" style="max-width:120px">
      </div>
      <button class="btn btn-primary" onclick="saveRotation()">Save Rotation</button>
    </div>
  `;
}

async function savePort() {
  const port = parseInt(document.getElementById('port').value);
  await apiPatch('/settings', { port });
  alert('Port saved. Restart TinyRouter to apply.');
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
  alert('Rotation settings saved.');
}

// --- Providers Page ---
let providersCache = [];
async function renderProviders(c) {
  const data = await apiGet('/providers');
  providersCache = data.providers || [];
  c.innerHTML = `
    <h2>Providers</h2>
    <button class="btn btn-primary mb-12" onclick="showAddProvider()">+ Add Provider</button>
    <div id="provider-list"></div>
    <div id="provider-form" style="display:none"></div>
  `;
  renderProviderList();
}

function renderProviderList() {
  const el = document.getElementById('provider-list');
  if (providersCache.length === 0) {
    el.innerHTML = '<div class="empty">No providers yet. Click "Add Provider" to create one.</div>';
    return;
  }
  el.innerHTML = providersCache.map(p => `
    <div class="card">
      <div class="card-header">
        <span class="card-title">${p.name}</span>
        <span class="badge ${p.isActive ? 'badge-active' : 'badge-inactive'}">${p.isActive ? 'Active' : 'Inactive'}</span>
      </div>
      <p class="muted">Prefix: <span class="code">${p.prefix}</span> | Base URL: <span class="code">${p.baseUrl}</span> | Keys: ${p.keys?.length || 0}</p>
      <div class="flex mt-12" style="gap:8px">
        <button class="btn btn-sm btn-primary" onclick="toggleProvider('${p.id}', ${!p.isActive})">${p.isActive ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteProvider('${p.id}')">Delete</button>
      </div>
      <div class="mt-12" id="keys-${p.id}"></div>
    </div>
  `).join('');
  providersCache.forEach(p => renderKeys(p));
}

async function renderKeys(p) {
  const el = document.getElementById('keys-' + p.id);
  if (!p.keys || p.keys.length === 0) {
    el.innerHTML = '<p class="muted">No keys. <a href="#" onclick="showAddKey(\'' + p.id + '\');return false">Add one</a></p>';
    return;
  }
  el.innerHTML = `
    <div class="flex-between mb-12">
      <span class="muted">Keys</span>
      <button class="btn btn-sm btn-primary" onclick="showAddKey('${p.id}')">+ Add Key</button>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Key</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${p.keys.map(k => `
          <tr>
            <td>${k.name}</td>
            <td><span class="code">${k.key.slice(0, 8)}...</span></td>
            <td>${k.priority}</td>
            <td><span class="badge ${k.isActive ? 'badge-active' : 'badge-inactive'}">${k.isActive ? 'Active' : 'Paused'}</span></td>
            <td>
              <button class="btn btn-sm" onclick="toggleKey('${p.id}','${k.id}',${!k.isActive})">${k.isActive ? 'Pause' : 'Resume'}</button>
              <button class="btn btn-sm btn-danger" onclick="deleteKey('${p.id}','${k.id}')">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function showAddProvider() {
  const el = document.getElementById('provider-form');
  el.style.display = 'block';
  el.innerHTML = `
    <div class="card">
      <div class="card-title">New Provider</div>
      <div class="form-group mt-12"><label>Name</label><input id="p-name" placeholder="DeepSeek"></div>
      <div class="form-group"><label>Prefix (used in model field)</label><input id="p-prefix" placeholder="deepseek"></div>
      <div class="form-group"><label>Base URL</label><input id="p-url" placeholder="https://api.deepseek.com"></div>
      <div class="flex" style="gap:8px">
        <button class="btn btn-primary" onclick="addProvider()">Create</button>
        <button class="btn" onclick="document.getElementById('provider-form').style.display='none'">Cancel</button>
      </div>
    </div>
  `;
}

async function addProvider() {
  const p = {
    name: document.getElementById('p-name').value,
    prefix: document.getElementById('p-prefix').value,
    baseUrl: document.getElementById('p-url').value,
    apiType: 'openai-compatible',
    isActive: true,
    keys: []
  };
  await apiPost('/providers', p);
  document.getElementById('provider-form').style.display = 'none';
  renderProviders(document.getElementById('page-content'));
}

function showAddKey(providerId) {
  const el = document.getElementById('keys-' + providerId);
  el.innerHTML = `
    <div class="card">
      <div class="card-title">New Key</div>
      <div class="form-group mt-12"><label>Name</label><input id="k-name" placeholder="Main"></div>
      <div class="form-group"><label>API Key</label><input id="k-key" placeholder="sk-..."></div>
      <div class="form-group"><label>Priority (lower = higher)</label><input type="number" id="k-priority" value="1" style="max-width:120px"></div>
      <div class="flex" style="gap:8px">
        <button class="btn btn-primary" onclick="addKey('${providerId}')">Create</button>
        <button class="btn" onclick="renderProviders(document.getElementById('page-content'))">Cancel</button>
      </div>
    </div>
  `;
}

async function addKey(providerId) {
  const k = {
    name: document.getElementById('k-name').value,
    key: document.getElementById('k-key').value,
    priority: parseInt(document.getElementById('k-priority').value),
    isActive: true
  };
  await apiPost('/providers/' + providerId + '/keys', k);
  renderProviders(document.getElementById('page-content'));
}

async function toggleProvider(id, active) {
  const p = providersCache.find(x => x.id === id);
  p.isActive = active;
  await apiPut('/providers/' + id, p);
  renderProviders(document.getElementById('page-content'));
}

async function deleteProvider(id) {
  if (!confirm('Delete this provider?')) return;
  await apiDelete('/providers/' + id);
  renderProviders(document.getElementById('page-content'));
}

async function toggleKey(pid, kid, active) {
  const p = providersCache.find(x => x.id === pid);
  const k = p.keys.find(x => x.id === kid);
  k.isActive = active;
  await apiPut('/providers/' + pid + '/keys/' + kid, k);
  renderProviders(document.getElementById('page-content'));
}

async function deleteKey(pid, kid) {
  if (!confirm('Delete this key?')) return;
  await apiDelete('/providers/' + pid + '/keys/' + kid);
  renderProviders(document.getElementById('page-content'));
}

// --- Combos Page ---
async function renderCombos(c) {
  const data = await apiGet('/combos');
  const combos = data.combos || [];
  c.innerHTML = `
    <h2>Combos</h2>
    <button class="btn btn-primary mb-12" onclick="showAddCombo()">+ Add Combo</button>
    <div id="combo-list"></div>
    <div id="combo-form" style="display:none"></div>
  `;
  const list = document.getElementById('combo-list');
  if (combos.length === 0) {
    list.innerHTML = '<div class="empty">No combos yet.</div>';
    return;
  }
  list.innerHTML = combos.map(cb => `
    <div class="card">
      <div class="card-header">
        <span class="card-title">${cb.name}</span>
        <span class="badge badge-active">${cb.strategy}</span>
      </div>
      <p class="muted">Models: ${cb.models?.join(', ') || 'none'}</p>
      ${cb.fusionJudge ? `<p class="muted">Judge: ${cb.fusionJudge}</p>` : ''}
      <div class="mt-12">
        <button class="btn btn-sm btn-danger" onclick="deleteCombo('${cb.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function showAddCombo() {
  const el = document.getElementById('combo-form');
  el.style.display = 'block';
  el.innerHTML = `
    <div class="card">
      <div class="card-title">New Combo</div>
      <div class="form-group mt-12"><label>Name</label><input id="c-name" placeholder="Fast + Smart"></div>
      <div class="form-group"><label>Strategy</label>
        <select id="c-strategy">
          <option value="fallback">fallback</option>
          <option value="round-robin">round-robin</option>
          <option value="fusion">fusion</option>
        </select>
      </div>
      <div class="form-group"><label>Models (comma-separated, e.g. deepseek/deepseek-chat,my-custom/gpt-4o)</label>
        <textarea id="c-models" rows="3" placeholder="deepseek/deepseek-chat&#10;my-custom/gpt-4o"></textarea>
      </div>
      <div class="form-group"><label>Fusion Judge (optional, fusion only)</label><input id="c-judge" placeholder="deepseek/deepseek-chat"></div>
      <div class="flex" style="gap:8px">
        <button class="btn btn-primary" onclick="addCombo()">Create</button>
        <button class="btn" onclick="document.getElementById('combo-form').style.display='none'">Cancel</button>
      </div>
    </div>
  `;
}

async function addCombo() {
  const models = document.getElementById('c-models').value
    .split('\n').map(s => s.trim()).filter(Boolean);
  const c = {
    name: document.getElementById('c-name').value,
    strategy: document.getElementById('c-strategy').value,
    models: models,
    fusionJudge: document.getElementById('c-judge').value || null
  };
  await apiPost('/combos', c);
  document.getElementById('combo-form').style.display = 'none';
  renderCombos(document.getElementById('page-content'));
}

async function deleteCombo(id) {
  if (!confirm('Delete this combo?')) return;
  await apiDelete('/combos/' + id);
  renderCombos(document.getElementById('page-content'));
}

// --- Usage Page ---
async function renderUsage(c) {
  const [summary, usage] = await Promise.all([
    apiGet('/usage/summary'),
    apiGet('/usage?limit=500')
  ]);
  const entries = usage.entries || [];
  c.innerHTML = `
    <h2>Usage</h2>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${summary.total}</div><div class="stat-label">Total Requests</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--accent2)">${summary.success}</div><div class="stat-label">Success</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--danger)">${summary.error}</div><div class="stat-label">Errors</div></div>
      <div class="stat-card"><div class="stat-value">${summary.avgLatencyMs}ms</div><div class="stat-label">Avg Latency</div></div>
    </div>
    <div class="flex-between mb-12">
      <h3>Recent Requests</h3>
      <button class="btn btn-danger btn-sm" onclick="clearUsage()">Clear</button>
    </div>
    ${entries.length === 0 ? '<div class="empty">No usage data yet.</div>' : `
    <table>
      <thead><tr><th>Time</th><th>Provider</th><th>Model</th><th>Key</th><th>Status</th><th>Latency</th><th>Tokens (in/out)</th></tr></thead>
      <tbody>
        ${entries.map(e => `
          <tr>
            <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
            <td>${e.provider}</td>
            <td>${e.model}</td>
            <td>${e.keyName}</td>
            <td><span class="badge ${e.status === 'success' ? 'badge-active' : 'badge-locked'}">${e.status}</span></td>
            <td>${e.latencyMs}ms</td>
            <td>${e.inputTokens}/${e.outputTokens}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `}
  `;
}

async function clearUsage() {
  await apiDelete('/usage');
  renderUsage(document.getElementById('page-content'));
}

// --- Console Page ---
let consoleEventSource = null;
async function renderConsole(c) {
  c.innerHTML = `
    <h2>Console</h2>
    <div class="flex-between mb-12">
      <span class="muted" id="console-status">Connecting...</span>
      <button class="btn btn-danger btn-sm" onclick="clearConsole()">Clear</button>
    </div>
    <div class="log-container" id="log-container"></div>
  `;
  startConsoleStream();
}

function startConsoleStream() {
  if (consoleEventSource) consoleEventSource.close();
  const container = document.getElementById('log-container');
  const status = document.getElementById('console-status');

  // Load existing logs
  apiGet('/console-logs').then(data => {
    (data.lines || []).forEach(line => appendLogLine(container, line));
  });

  consoleEventSource = new EventSource('/api/console-logs/stream');
  consoleEventSource.onopen = () => { status.textContent = 'Connected'; };
  consoleEventSource.onerror = () => { status.textContent = 'Disconnected. Reconnecting...'; };
  consoleEventSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'line' && msg.line) {
        appendLogLine(container, msg.line);
      }
    } catch {}
  };
}

function appendLogLine(container, line) {
  const div = document.createElement('div');
  div.className = 'log-line log-info';
  if (line.includes('[ERROR]')) div.className = 'log-line log-error';
  else if (line.includes('⚠')) div.className = 'log-line log-warn';
  else if (line.includes('[DEBUG]')) div.className = 'log-line log-debug';
  div.textContent = line;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function clearConsole() {
  await apiDelete('/console-logs');
  document.getElementById('log-container').innerHTML = '';
}
