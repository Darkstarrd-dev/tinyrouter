// ===================== Endpoint Page (Settings) =====================

async function renderEndpoint(c) {
  showSkeleton(c, 2);
  const settings = await apiGet('/settings');
  const [provData, comboData] = await Promise.all([apiGet('/providers'), apiGet('/combos')]);
  providersCache = provData.providers || [];
  const combos = comboData.combos || [];
  c.innerHTML = '\
    <div class="settings-layout">\
      <div class="settings-panel-left">\
        <div class="settings-block">\
          <div class="form-group">\
            <label for="port">' + t('listenPort') + '</label>\
            <div class="flex">\
              <input type="number" id="port" value="' + settings.port + '" style="max-width:120px">\
              <button type="button" class="btn btn-primary" onclick="withLoading(this, () => savePort())">' + t('save') + '</button>\
            </div>\
          </div>\
          <p class="muted mt-12">' + t('apiEndpoint') + ' <span class="code copyable" data-copy="http://localhost:' + settings.port + '/v1" onclick="copyToClipboard(this.getAttribute(\'data-copy\'))" title="' + t('clickToCopy') + '">http://localhost:' + settings.port + '/v1</span></p>\
          <p class="muted mt-12">' + t('noKeyRequired') + '</p>\
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
          </div>\
          <button type="button" class="btn btn-primary mt-12" onclick="withLoading(this, () => saveRotation())">' + t('saveRotation') + '</button>\
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
        <div class="settings-panel-section">\
          <div class="settings-panel-header">\
            <span class="settings-panel-title">' + t('combos') + '</span>\
            <button type="button" class="btn btn-primary btn-sm" onclick="showAddCombo()">' + t('addCombo') + '</button>\
          </div>\
          <div class="settings-panel-body">\
            <div id="combo-list" class="settings-card-grid"></div>\
          </div>\
        </div>\
      </div>\
    </div>';
  renderProviderList();
  renderComboListInline(combos);
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
    <div class="card">\
      <div class="card-header">\
        <span class="card-title">' + escapeHtml(cb.name) + '</span>\
        <span class="badge badge-active">' + escapeHtml(cb.strategy) + '</span>\
      </div>\
      <p class="muted">' + t('models') + ' ' + (cb.models ? cb.models.join(', ') : 'none') + '</p>\
      <div class="mt-12" style="display:flex;gap:8px">\
        <button type="button" class="btn btn-sm" onclick="showEditCombo(\'' + cb.id + '\')">' + t('editCombo') + '</button>\
        <button type="button" class="btn btn-sm btn-danger" onclick="deleteCombo(\'' + cb.id + '\')">' + t('delete') + '</button>\
      </div>\
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
  await apiPatch('/settings', { rotation });
  toast(t('rotationSaved'), 'success');
}