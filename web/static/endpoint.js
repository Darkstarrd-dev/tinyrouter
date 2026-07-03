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
          <button class="btn btn-primary" onclick="withLoading(this, () => savePort())">' + t('save') + '</button>\
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
          <option value="failover"' + (settings.rotation && settings.rotation.strategy === 'failover' ? ' selected' : '') + '>' + t('failover') + '</option>\
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
      <button class="btn btn-primary" onclick="withLoading(this, () => saveRotation())">' + t('saveRotation') + '</button>\
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
