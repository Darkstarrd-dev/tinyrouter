// ===================== Endpoint Page (Settings) =====================

async function renderEndpoint(c) {
  showSkeleton(c, 2);
  const settings = await apiGet('/settings');
  window.__settings = settings;
  const s = settings;
  const [provData, comboData, qsData] = await Promise.all([apiGet('/providers'), apiGet('/combos'), apiGet('/quickslots')]);
  providersCache = provData.providers || [];
  const combos = comboData.combos || [];
  const quickslots = qsData.quickslots || [];
  c.innerHTML = '\
    <div class="settings-layout">\
      <div class="settings-panel-left">\
        <div class="settings-row">\
          <span class="settings-row-title" title="' + escapeHtml(t('listenPortDesc')) + '">' + t('listenPort') + '</span>\
          <span class="code copyable settings-row-endpoint" onclick="copyToClipboard(this.textContent, this.textContent)" title="' + t('clickToCopy') + '">http://localhost:' + s.port + '/v1</span>\
          <button type="button" class="btn btn-sm settings-row-btn" onclick="openPortModal()">' + t('settings') + '</button>\
        </div>\
        <div class="settings-row">\
          <span class="settings-row-title" title="' + escapeHtml(t('proxyDesc')) + '">' + t('proxySettings') + '</span>\
          <label class="toggle-switch settings-row-toggle" title="' + escapeHtml(t('proxyDesc')) + '"><input type="checkbox" id="proxy-toggle"' + (s.proxy && s.proxy.enabled ? ' checked' : '') + ' onchange="toggleProxy(this.checked)"><span class="toggle-slider"></span></label>\
          <button type="button" class="btn btn-sm settings-row-btn" onclick="openProxyModal()">' + t('settings') + '</button>\
        </div>\
        <div class="settings-row">\
          <span class="settings-row-title" title="' + escapeHtml(t('rotationDesc')) + '">' + t('rotationSettings') + '</span>\
          <button type="button" class="btn btn-sm settings-row-btn" onclick="openRotationModal()">' + t('settings') + '</button>\
        </div>\
        <div class="settings-row">\
          <span class="settings-row-title" title="' + escapeHtml(t('serverTimeoutDesc')) + '">' + t('serverTimeoutSettings') + '</span>\
          <button type="button" class="btn btn-sm settings-row-btn" onclick="openServerTimeoutModal()">' + t('settings') + '</button>\
        </div>\
        <div class="settings-row">\
          <span class="settings-row-title" title="' + escapeHtml(t('passwordProtectionDesc')) + '">' + t('passwordProtection') + '</span>\
          <label class="toggle-switch settings-row-toggle" title="' + escapeHtml(t('passwordProtectionDesc')) + '"><input type="checkbox" id="password-toggle"' + (s.security && s.security.passwordEnabled ? ' checked' : '') + ' onchange="togglePasswordProtection(this.checked)"><span class="toggle-slider"></span></label>\
          <button type="button" class="btn btn-sm settings-row-btn" onclick="openPasswordModal()">' + t('settings') + '</button>\
        </div>\
        <div class="settings-row">\
          <span class="settings-row-title" title="' + escapeHtml(t('debugModeDesc')) + '">' + t('debugMode') + '</span>\
          <label class="toggle-switch settings-row-toggle" title="' + escapeHtml(t('debugModeDesc')) + '"><input type="checkbox" id="debug-mode-toggle"' + (s.debugMode ? ' checked' : '') + ' onchange="toggleDebugMode(this.checked)"><span class="toggle-slider"></span></label>\
          <button type="button" class="btn btn-sm settings-row-btn" onclick="openDebugModal()">' + t('settings') + '</button>\
        </div>\
      </div>\
      <div class="settings-panel-right">\
        <div class="settings-panel-section" id="settings-section-providers" data-collapse-key="settings-providers">\
          <div class="settings-panel-header">\
            <span class="settings-panel-title settings-panel-title-clickable" onclick="toggleSettingsSectionCollapse(\'settings-providers\')">' + settingsSectionChevron() + t('providers') + '</span>\
            <button type="button" class="btn btn-primary btn-sm" onclick="showAddProvider()">' + t('addProvider') + '</button>\
          </div>\
          <div class="settings-panel-body">\
            <div id="provider-list" class="settings-card-grid"></div>\
          </div>\
        </div>\
        <div class="settings-panel-section settings-panel-split" id="settings-section-combos-quickslots">\
          <div class="settings-panel-half" id="settings-section-combos" data-collapse-key="settings-combos">\
            <div class="settings-panel-header">\
              <span class="settings-panel-title settings-panel-title-clickable" onclick="toggleSettingsSectionCollapse(\'settings-combos\')">' + settingsSectionChevron() + t('combos') + '</span>\
              <button type="button" class="btn btn-primary btn-sm" onclick="showAddCombo()">' + t('addCombo') + '</button>\
            </div>\
            <div class="settings-panel-body">\
              <div id="combo-list" class="settings-card-grid"></div>\
            </div>\
          </div>\
          <div class="settings-panel-half" id="settings-section-quickslots" data-collapse-key="settings-quickslots">\
            <div class="settings-panel-header">\
              <span class="settings-panel-title settings-panel-title-clickable" onclick="toggleSettingsSectionCollapse(\'settings-quickslots\')">' + settingsSectionChevron() + t('quickSlots') + '</span>\
              <button type="button" class="btn btn-primary btn-sm" onclick="showAddQuickSlot()">' + t('addQuickSlot') + '</button>\
            </div>\
            <div class="settings-panel-body">\
              <div id="quickslot-list" class="settings-card-grid"></div>\
            </div>\
          </div>\
        </div>\
      </div>\
    </div>';
  renderProviderList();
  renderComboListInline(combos);
  if (typeof renderQuickSlotListInline === 'function') renderQuickSlotListInline(quickslots);
  if (typeof renderHeaderQuickSlots === 'function') renderHeaderQuickSlots();
  applySettingsSectionCollapseState();
}

// Collapsed Settings sections persist across re-renders (renderEndpoint re-runs
// on every combo/quickslot/provider toggle).
var collapsedSettingsSections = new Set();

function settingsSectionChevron() {
  return '<svg class="settings-panel-title-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
}

function applySettingsSectionCollapseState() {
  document.querySelectorAll('[data-collapse-key]').forEach(function(el) {
    var key = el.getAttribute('data-collapse-key');
    var chevron = el.querySelector('.settings-panel-title-chevron');
    if (collapsedSettingsSections.has(key)) {
      el.classList.add('collapsed');
      if (chevron) chevron.style.transform = 'rotate(-90deg)';
    } else {
      el.classList.remove('collapsed');
      if (chevron) chevron.style.transform = '';
    }
  });
}

function toggleSettingsSectionCollapse(key) {
  if (collapsedSettingsSections.has(key)) {
    collapsedSettingsSections.delete(key);
  } else {
    collapsedSettingsSections.add(key);
  }
  applySettingsSectionCollapseState();
}

function renderComboListInline(combos) {
  var el = document.getElementById('combo-list');
  if (!el) return;
  if (combos.length === 0) {
    el.innerHTML = emptyState(t('noCombos'));
    return;
  }
  el.innerHTML = combos.map(function(cb) {
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

async function toggleDebugMode(enabled) {
  try {
    await apiPatch('/settings', { debugMode: enabled });
    toast(enabled ? t('debugModeOn') : t('debugModeOff'), 'success');
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
    var toggle = document.getElementById('debug-mode-toggle');
    if (toggle) toggle.checked = !enabled;
  }
}

async function savePort() {
  var port = parseInt(document.getElementById('port').value);
  if (!port || port < 1 || port > 65535) {
    toast(t('invalidPort'), 'error');
    return;
  }
  var ok = await confirmModal(t('confirmRestart'));
  if (!ok) return;
  try {
    var resp = await apiPatch('/settings', { port: port });
    if (resp.error) {
      toast(resp.error, 'error', 5000);
      return;
    }
    if (resp.restart) {
      showRestarting(port);
      pollNewPort(port);
    } else {
      toast(t('portSaved'), 'success');
    }
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

function showRestarting(newPort) {
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '<div class="modal" style="text-align:center;min-width:280px">' +
    '<div style="margin:16px auto;width:28px;height:28px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite"></div>' +
    '<div class="modal-title">' + t('restarting') + '</div>' +
    '<p class="muted mt-12">' + t('restartingDesc', [newPort]) + '</p>' +
    '</div>';
  overlay.classList.add('show');
  overlay.onclick = null;
}

async function pollNewPort(newPort) {
  var newBase = 'http://127.0.0.1:' + newPort;
  var startTime = Date.now();
  var timeout = 15000;
  while (Date.now() - startTime < timeout) {
    try {
      await fetch(newBase + '/api/settings');
      window.location.href = newBase + '/';
      return;
    } catch (e) {
      await new Promise(function(r) { setTimeout(r, 500); });
    }
  }
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '<div class="modal" style="text-align:center;min-width:280px">' +
    '<div class="modal-title">' + t('restartFailed') + '</div>' +
    '<p class="muted mt-12">' + t('restartFailedDesc') + '</p>' +
    '<div class="modal-footer" style="justify-content:center;margin-top:16px"><button type="button" class="btn btn-primary" onclick="location.reload()">' + t('close') + '</button></div>' +
    '</div>';
}
async function saveRotation() {
  const rotation = {
    strategy: document.getElementById('strategy').value,
    stickyLimit: parseInt(document.getElementById('stickyLimit').value),
    maxRetries: parseInt(document.getElementById('maxRetries').value),
    retryDelaySec: parseInt(document.getElementById('retryDelaySec').value),
    backoffMaxSec: parseInt(document.getElementById('backoffMaxSec').value),
  };
  try {
    await apiPatch('/settings', { rotation });
    toast(t('rotationSaved'), 'success');
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function saveServerTimeout() {
  const server = {
    readTimeoutSec: parseInt(document.getElementById('readTimeoutSec').value) || 300,
    writeTimeoutSec: parseInt(document.getElementById('writeTimeoutSec').value) || 300,
    idleTimeoutSec: parseInt(document.getElementById('idleTimeoutSec').value) || 120,
    upstreamTimeoutSec: parseInt(document.getElementById('upstreamTimeoutSec').value) || 300,
  };
  try {
    var resp = await apiPatch('/settings', { server });
    if (resp.restart) {
      showRestarting(resp.port);
      pollNewPort(resp.port);
    } else {
      toast(t('serverTimeoutSaved'), 'success');
    }
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function saveProxy() {
  const enabled = document.getElementById('proxy-toggle').checked;
  const host = document.getElementById('proxy-host').value;
  const port = document.getElementById('proxy-port').value;
  if (enabled) {
    if (!host || !host.trim()) {
      toast(t('proxyHostRequired') || 'Proxy host is required', 'error');
      return;
    }
    var portNum = parseInt(port, 10);
    if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      toast(t('invalidPort'), 'error');
      return;
    }
  }
  try {
    await apiPatch('/settings', { proxy: { enabled, host, port } });
    toast(t('proxySaved'), 'success');
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function togglePasswordProtection(enabled) {
  if (!enabled) {
    var ok = await confirmModal(t('confirmDisablePassword'));
    if (!ok) {
      var toggle = document.getElementById('password-toggle');
      if (toggle) toggle.checked = true;
      return;
    }
  }
  try {
    await apiPatch('/settings', { security: { passwordEnabled: enabled } });
    toast(enabled ? t('passwordEnabled') : t('passwordDisabled'), 'success');
    var pwSettings = document.getElementById('password-settings');
    if (pwSettings) pwSettings.style.display = enabled ? 'block' : 'none';
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
    var toggle = document.getElementById('password-toggle');
    if (toggle) toggle.checked = !enabled;
  }
}

async function savePassword() {
  var newPw = document.getElementById('new-password');
  if (!newPw || !newPw.value) {
    toast(t('enterPassword'), 'error');
    return;
  }
  try {
    await apiPatch('/settings', { security: { password: newPw.value } });
    toast(t('passwordSaved'), 'success');
    newPw.value = '';
    var settings = await apiGet('/settings');
    var curPw = document.getElementById('current-password');
    if (curPw && settings.security) curPw.value = settings.security.password || '';
    var toggle = document.getElementById('password-toggle');
    if (toggle) toggle.checked = true;
    var pwSettings = document.getElementById('password-settings');
    if (pwSettings) pwSettings.style.display = 'block';
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

// ===================== Settings Modal Functions =====================

function openSettingsModal(title, bodyHtml) {
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '\
    <div class="modal" style="min-width:400px;max-width:520px">\
      <div class="modal-title">' + escapeHtml(title) + '</div>\
      <div class="modal-body">' + bodyHtml + '</div>\
      <div class="modal-footer">\
        <button type="button" class="btn btn-ghost" onclick="closeModalOverlay()">' + t('cancel') + '</button>\
        <button type="button" class="btn btn-primary" id="settings-modal-save">' + t('save') + '</button>\
      </div>\
    </div>';
  requestAnimationFrame(function() { overlay.classList.add('show'); });
}

function openPortModal() {
  var s = window.__settings;
  openSettingsModal(t('listenPort'),
    '<p class="muted">' + escapeHtml(t('listenPortDesc')) + '</p>\
    <div class="form-group" style="margin-top:16px">\
      <input type="number" id="settings-modal-port" value="' + s.port + '" style="max-width:160px">\
    </div>'
  );
  document.getElementById('settings-modal-save').onclick = function() {
    withLoading(this, function() { return savePortModal(); });
  };
}

function openProxyModal() {
  var s = window.__settings;
  openSettingsModal(t('proxySettings'),
    '<p class="muted">' + escapeHtml(t('proxyDesc')) + '</p>\
    <div class="settings-form-grid" style="margin-top:12px">\
      <div class="form-group"><label>' + t('proxyHost') + '</label>\
        <input type="text" id="settings-modal-proxy-host" value="' + (s.proxy ? escapeHtml(s.proxy.host) : '') + '" placeholder="127.0.0.1">\
      </div>\
      <div class="form-group"><label>' + t('proxyPort') + '</label>\
        <input type="text" id="settings-modal-proxy-port" value="' + (s.proxy ? escapeHtml(s.proxy.port) : '') + '" placeholder="2080">\
      </div>\
    </div>'
  );
  document.getElementById('settings-modal-save').onclick = function() {
    withLoading(this, function() { return saveProxyModal(); });
  };
}

function openRotationModal() {
  var s = window.__settings;
  openSettingsModal(t('rotationSettings'),
    '<p class="muted">' + escapeHtml(t('rotationDesc')) + '</p>\
    <div class="settings-form-grid" style="margin-top:12px">\
      <div class="form-group"><label>' + t('strategy') + '</label>\
        <select id="settings-modal-strategy">\
          <option value="fill-first"' + (s.rotation && s.rotation.strategy === 'fill-first' ? ' selected' : '') + '>' + t('fillFirst') + '</option>\
          <option value="round-robin"' + (s.rotation && s.rotation.strategy === 'round-robin' ? ' selected' : '') + '>' + t('roundRobin') + '</option>\
          <option value="failover"' + (s.rotation && s.rotation.strategy === 'failover' ? ' selected' : '') + '>' + t('failover') + '</option>\
        </select>\
      </div>\
      <div class="form-group"><label>' + t('stickyLimit') + '</label>\
        <input type="number" id="settings-modal-stickyLimit" value="' + ((s.rotation && s.rotation.stickyLimit) || 3) + '">\
      </div>\
      <div class="form-group"><label>' + t('maxRetries') + '</label>\
        <input type="number" id="settings-modal-maxRetries" value="' + ((s.rotation && s.rotation.maxRetries) || 5) + '">\
      </div>\
      <div class="form-group"><label>' + t('retryDelay') + '</label>\
        <input type="number" id="settings-modal-retryDelaySec" value="' + ((s.rotation && s.rotation.retryDelaySec) || 5) + '">\
      </div>\
      <div class="form-group"><label>' + t('backoffMax') + '</label>\
        <input type="number" id="settings-modal-backoffMaxSec" value="' + ((s.rotation && s.rotation.backoffMaxSec) || 300) + '">\
      </div>\
    </div>'
  );
  document.getElementById('settings-modal-save').onclick = function() {
    withLoading(this, function() { return saveRotationModal(); });
  };
}

function openServerTimeoutModal() {
  var s = window.__settings;
  openSettingsModal(t('serverTimeoutSettings'),
    '<p class="muted">' + escapeHtml(t('serverTimeoutDesc')) + '</p>\
    <div class="settings-form-grid" style="margin-top:12px">\
      <div class="form-group"><label>' + t('readTimeout') + '</label>\
        <input type="number" id="settings-modal-readTimeoutSec" value="' + ((s.server && s.server.readTimeoutSec) || 300) + '">\
      </div>\
      <div class="form-group"><label>' + t('writeTimeout') + '</label>\
        <input type="number" id="settings-modal-writeTimeoutSec" value="' + ((s.server && s.server.writeTimeoutSec) || 300) + '">\
      </div>\
      <div class="form-group"><label>' + t('idleTimeout') + '</label>\
        <input type="number" id="settings-modal-idleTimeoutSec" value="' + ((s.server && s.server.idleTimeoutSec) || 120) + '">\
      </div>\
      <div class="form-group"><label>' + t('upstreamTimeout') + '</label>\
        <input type="number" id="settings-modal-upstreamTimeoutSec" value="' + ((s.server && s.server.upstreamTimeoutSec) || 300) + '">\
      </div>\
    </div>'
  );
  document.getElementById('settings-modal-save').onclick = function() {
    withLoading(this, function() { return saveServerTimeoutModal(); });
  };
}

function openPasswordModal() {
  var s = window.__settings;
  var pwEnabled = s.security && s.security.passwordEnabled;
  openSettingsModal(t('passwordProtection'),
    '<p class="muted">' + escapeHtml(t('passwordProtectionDesc')) + '</p>\
    <div class="form-group" style="margin-top:12px">\
      <label>' + t('currentPassword') + '</label>\
      <div style="display:flex;gap:8px;align-items:center">\
        <input type="text" id="settings-modal-current-password" value="' + escapeHtml(s.security ? s.security.password : '') + '" readonly style="flex:1">\
        <button type="button" class="btn btn-sm" onclick="copyToClipboard(document.getElementById(\'settings-modal-current-password\').value, t(\'password\'))">' + t('copy') + '</button>\
      </div>\
    </div>\
    <div class="form-group">\
      <label>' + t('newPassword') + '</label>\
      <input type="password" id="settings-modal-new-password" placeholder="' + t('newPasswordPlaceholder') + '">\
    </div>'
  );
  document.getElementById('settings-modal-save').onclick = function() {
    withLoading(this, function() { return savePasswordModal(); });
  };
}

function openDebugModal() {
  openInfoModal(t('debugMode'),
    '<p class="muted">' + escapeHtml(t('debugModeDesc')) + '</p>'
  );
}

// ===================== Modal Save Functions =====================

async function savePortModal() {
  var port = parseInt(document.getElementById('settings-modal-port').value);
  if (!port || port < 1 || port > 65535) {
    toast(t('invalidPort'), 'error');
    return;
  }
  var ok = await confirmModal(t('confirmRestart'));
  if (!ok) return;
  try {
    var resp = await apiPatch('/settings', { port: port });
    if (resp.error) {
      toast(resp.error, 'error', 5000);
      return;
    }
    closeModalOverlay();
    if (resp.restart) {
      showRestarting(port);
      pollNewPort(port);
    } else {
      toast(t('portSaved'), 'success');
    }
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function saveProxyModal() {
  var host = document.getElementById('settings-modal-proxy-host').value.trim();
  var port = document.getElementById('settings-modal-proxy-port').value.trim();
  var enabled = document.getElementById('proxy-toggle').checked;
  if (enabled) {
    if (!host) {
      toast(t('proxyHostRequired') || 'Proxy host is required', 'error');
      return;
    }
    var portNum = parseInt(port, 10);
    if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      toast(t('invalidPort'), 'error');
      return;
    }
  }
  try {
    await apiPatch('/settings', { proxy: { enabled: enabled, host: host, port: port } });
    toast(t('proxySaved'), 'success');
    closeModalOverlay();
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function saveRotationModal() {
  var rotation = {
    strategy: document.getElementById('settings-modal-strategy').value,
    stickyLimit: parseInt(document.getElementById('settings-modal-stickyLimit').value),
    maxRetries: parseInt(document.getElementById('settings-modal-maxRetries').value),
    retryDelaySec: parseInt(document.getElementById('settings-modal-retryDelaySec').value),
    backoffMaxSec: parseInt(document.getElementById('settings-modal-backoffMaxSec').value),
  };
  try {
    await apiPatch('/settings', { rotation: rotation });
    toast(t('rotationSaved'), 'success');
    closeModalOverlay();
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function saveServerTimeoutModal() {
  var server = {
    readTimeoutSec: parseInt(document.getElementById('settings-modal-readTimeoutSec').value) || 300,
    writeTimeoutSec: parseInt(document.getElementById('settings-modal-writeTimeoutSec').value) || 300,
    idleTimeoutSec: parseInt(document.getElementById('settings-modal-idleTimeoutSec').value) || 120,
    upstreamTimeoutSec: parseInt(document.getElementById('settings-modal-upstreamTimeoutSec').value) || 300,
  };
  try {
    var resp = await apiPatch('/settings', { server: server });
    closeModalOverlay();
    if (resp.restart) {
      showRestarting(resp.port);
      pollNewPort(resp.port);
    } else {
      toast(t('serverTimeoutSaved'), 'success');
    }
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
  }
}

async function savePasswordModal() {
  var enabled = document.getElementById('password-toggle').checked;
  try {
    await apiPatch('/settings', { security: { passwordEnabled: enabled } });
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
    return;
  }
  var newPw = document.getElementById('settings-modal-new-password');
  if (newPw && newPw.value) {
    try {
      await apiPatch('/settings', { security: { password: newPw.value } });
    } catch (e) {
      toast(t('failed', [e.message]), 'error');
      return;
    }
  }
  toast(enabled ? t('passwordEnabled') : t('passwordDisabled'), 'success');
  closeModalOverlay();
}

async function toggleProxy(enabled) {
  try {
    var s = window.__settings;
    var proxy = s.proxy || {};
    await apiPatch('/settings', { proxy: { enabled: enabled, host: proxy.host || '', port: proxy.port || '' } });
    s.proxy = Object.assign({}, proxy, { enabled: enabled });
  } catch (e) {
    toast(t('failed', [e.message]), 'error');
    var toggle = document.getElementById('proxy-toggle');
    if (toggle) toggle.checked = !enabled;
  }
}

function openInfoModal(title, bodyHtml) {
  var overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '\
    <div class="modal" style="min-width:400px;max-width:520px">\
      <div class="modal-title">' + escapeHtml(title) + '</div>\
      <div class="modal-body">' + bodyHtml + '</div>\
      <div class="modal-footer" style="justify-content:center">\
        <button type="button" class="btn btn-primary" onclick="closeModalOverlay()">' + t('close') + '</button>\
      </div>\
    </div>';
  requestAnimationFrame(function() { overlay.classList.add('show'); });
}