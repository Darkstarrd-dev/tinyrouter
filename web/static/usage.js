// ===================== Usage Page =====================

async function renderUsage(c) {
  showSkeleton(c, 4);
  const [summary, usage] = await Promise.all([
    apiGet('/usage/summary'),
    apiGet('/usage?limit=500')
  ]);
  const entries = usage.entries || [];
  c.innerHTML = '\
    <div class="usage-header">\
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
      </div>\
    </div>' +
    (entries.length === 0 ? '<div class="empty">' + t('noUsage') + '</div>' : '\
    <div class="usage-scroll">\
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
    </table>\
    </div>');
  c.classList.add('usage-page');
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
