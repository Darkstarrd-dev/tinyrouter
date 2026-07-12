// ===================== Endpoint Page (Settings) =====================

async function renderEndpoint(c) {
  showSkeleton(c, 2);
  const settings = await apiGet('/settings');
  const [provData, comboData, qsData] = await Promise.all([apiGet('/providers'), apiGet('/combos'), apiGet('/quickslots')]);
  providersCache = provData.providers || [];
  const combos = comboData.combos || [];
  const quickslots = qsData.quickslots || [];
  c.innerHTML = '\
    <div class="settings-layout">\
      <div class="settings-panel-left">\
          <div class="settings-block">\
          <div class="settings-port-row">\
            <span class="settings-port-label">' + t('listenPort') + '</span>\
            <input type="number" id="port" value="' + settings.port + '" class="settings-port-input">\
            <button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this, () => savePort())">' + t('save') + '</button>\
          </div>\
          <p class="muted mt-12">' + t('apiEndpoint') + ' <span class="code copyable" data-copy="http://localhost:' + settings.port + '/v1" onclick="copyToClipboard(this.getAttribute(\'data-copy\'))" title="' + t('clickToCopy') + '">http://localhost:' + settings.port + '/v1</span></p>\
          <p class="muted mt-12">' + t('noKeyRequired') + '</p>\
        </div>\
        <div class="settings-block">\
          <div class="settings-block-header">\
            <span class="settings-block-title">' + t('proxySettings') + '</span>\
            <label class="toggle-switch" for="proxy-toggle">\
              <input type="checkbox" id="proxy-toggle" ' + (settings.proxy && settings.proxy.enabled ? 'checked' : '') + '>\
              <span class="toggle-slider"></span>\
            </label>\
          </div>\
          <p class="muted mt-12">' + t('proxyDesc') + '</p>\
          <div class="settings-form-grid mt-12">\
            <div class="form-group"><label for="proxy-host">' + t('proxyHost') + '</label>\
              <input type="text" id="proxy-host" value="' + (settings.proxy ? escapeHtml(settings.proxy.host) : '') + '" placeholder="127.0.0.1">\
            </div>\
            <div class="form-group"><label for="proxy-port">' + t('proxyPort') + '</label>\
              <input type="text" id="proxy-port" value="' + (settings.proxy ? escapeHtml(settings.proxy.port) : '') + '" placeholder="2080">\
            </div>\
          </div>\
          <button type="button" class="btn btn-primary mt-12" onclick="withLoading(this, () => saveProxy())">' + t('save') + '</button>\
        </div>\
        <div class="settings-block">\
          <div class="settings-block-title">' + t('rotationSettings') + '</div>\
          <div class="settings-form-grid mt-12">\
            <div class="form-group"><label for="strategy">' + t('strategy') + '</label>\
              <select id="strategy">\
                <option value="fill-first"' + (settings.rotation && settings.rotation.strategy === 'fill-first' ? ' selected' : '') + '>' + t('fillFirst') + '</option>\
                <option value="round-robin"' + (settings.rotation && settings.rotation.strategy === 'round-robin' ? ' selected' : '') + '>' + t('roundRobin') + '</option>\
                <option value="failover"' + (settings.rotation && settings.rotation.strategy === 'failover' ? ' selected' : '') + '>' + t('failover') + '</option>\
              </select>\
            </div>\
            <div class="form-group"><label for="stickyLimit">' + t('stickyLimit') + '</label>\
              <input type="number" id="stickyLimit" value="' + ((settings.rotation && settings.rotation.stickyLimit) || 3) + '">\
            </div>\
            <div class="form-group"><label for="maxRetries">' + t('maxRetries') + '</label>\
              <input type="number" id="maxRetries" value="' + ((settings.rotation && settings.rotation.maxRetries) || 5) + '">\
            </div>\
            <div class="form-group"><label for="retryDelaySec">' + t('retryDelay') + '</label>\
              <input type="number" id="retryDelaySec" value="' + ((settings.rotation && settings.rotation.retryDelaySec) || 5) + '">\
            </div>\
            <div class="form-group"><label for="backoffMaxSec">' + t('backoffMax') + '</label>\
              <input type="number" id="backoffMaxSec" value="' + ((settings.rotation && settings.rotation.backoffMaxSec) || 300) + '">\
            </div>\
            <div class="form-group">\
              <label>&nbsp;</label>\
              <button type="button" class="btn btn-primary" style="width:100%" onclick="withLoading(this, () => saveRotation())">' + t('saveRotation') + '</button>\
</div>\
        <div class="settings-block">\
          <div class="settings-block-title">' + t('serverTimeoutSettings') + '</div>\
          <p class="muted mt-12">' + t('serverTimeoutDesc') + '</p>\
          <div class="settings-form-grid mt-12">\
            <div class="form-group"><label for="readTimeoutSec">' + t('readTimeout') + '</label>\
              <input type="number" id="readTimeoutSec" value="' + ((settings.server && settings.server.readTimeoutSec) || 300) + '">\
            </div>\
            <div class="form-group"><label for="writeTimeoutSec">' + t('writeTimeout') + '</label>\
              <input type="number" id="writeTimeoutSec" value="' + ((settings.server && settings.server.writeTimeoutSec) || 300) + '">\
            </div>\
            <div class="form-group"><label for="idleTimeoutSec">' + t('idleTimeout') + '</label>\
              <input type="number" id="idleTimeoutSec" value="' + ((settings.server && settings.server.idleTimeoutSec) || 120) + '">\
            </div>\
            <div class="form-group"><label for="upstreamTimeoutSec">' + t('upstreamTimeout') + '</label>\
              <input type="number" id="upstreamTimeoutSec" value="' + ((settings.server && settings.server.upstreamTimeoutSec) || 300) + '">\
            </div>\
          </div>\
          <button type="button" class="btn btn-primary mt-12" onclick="withLoading(this, () => saveServerTimeout())">' + t('save') + '</button>\
        </div>\
        <div class="settings-block">\
          <div class="settings-block-header">\
            <span class="settings-block-title">' + t('passwordProtection') + '</span>\
            <label class="toggle-switch" for="password-toggle">\
              <input type="checkbox" id="password-toggle" ' + (settings.security && settings.security.passwordEnabled ? 'checked' : '') + ' onchange="togglePasswordProtection(this.checked)">\
              <span class="toggle-slider"></span>\
            </label>\
          </div>\
          <p class="muted mt-12">' + t('passwordProtectionDesc') + '</p>\
          <div id="password-settings" style="display:' + (settings.security && settings.security.passwordEnabled ? 'block' : 'none') + ';margin-top:12px">\
            <div class="form-group">\
              <label>' + t('currentPassword') + '</label>\
              <div style="display:flex;gap:8px;align-items:center">\
                <input type="text" id="current-password" value="' + escapeHtml(settings.security ? settings.security.password : '') + '" readonly style="flex:1">\
                <button type="button" class="btn btn-sm" onclick="copyToClipboard(document.getElementById(\'current-password\').value, t(\'password\'))">' + t('copy') + '</button>\
              </div>\
            </div>\
            <div class="form-group">\
              <label>' + t('newPassword') + '</label>\
              <input type="password" id="new-password" placeholder="' + t('newPasswordPlaceholder') + '">\
            </div>\
            <button type="button" class="btn btn-primary" style="width:100%" onclick="withLoading(this, function() { return savePassword() })">' + t('savePassword') + '</button>\
          </div>\
        </div>\
      </div>\
        </div>\
        <div class="settings-block">\
          <div class="settings-block-header">\
            <span class="settings-block-title">' + t('debugMode') + '</span>\
            <label class="toggle-switch" for="debug-mode-toggle">\
              <input type="checkbox" id="debug-mode-toggle" ' + (settings.debugMode ? 'checked' : '') + ' onchange="toggleDebugMode(this.checked)">\
              <span class="toggle-slider"></span>\
            </label>\
          </div>\
          <p class="muted mt-12">' + t('debugModeDesc') + '</p>\
        </div>\
      </div>\
      <div class="settings-panel-right">\
        <div class="settings-panel-section">\
          <div class="settings-panel-header">\
            <span class="settings-panel-title">' + t('providers') + '</span>\
            <button type="button" class="btn btn-primary btn-sm" onclick="showAddProvider()">' + t('addProvider') + '</button>\
          </div>\
          <div class="settings-panel-body">\
            <div id="provider-list" class="settings-card-grid"></div>\
          </div>\
        </div>\
        <div class="settings-panel-section settings-panel-split">\
          <div class="settings-panel-half">\
            <div class="settings-panel-header">\
              <span class="settings-panel-title">' + t('combos') + '</span>\
              <button type="button" class="btn btn-primary btn-sm" onclick="showAddCombo()">' + t('addCombo') + '</button>\
            </div>\
            <div class="settings-panel-body">\
              <div id="combo-list" class="settings-card-grid"></div>\
            </div>\
          </div>\
          <div class="settings-panel-half">\
            <div class="settings-panel-header">\
              <span class="settings-panel-title">' + t('quickSlots') + '</span>\
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