// ===================== Usage Page =====================

var lastUsageSig = '';

function renderUsageRow(e) {
  return '<tr>\
    <td>' + new Date(e.timestamp).toLocaleTimeString() + '</td>\
    <td>' + escapeHtml(e.provider) + '</td>\
    <td>' + escapeHtml(e.model) + '</td>\
    <td>' + escapeHtml(e.keyName) + '</td>\
    <td><span class="badge ' + (e.status === 'success' ? 'badge-active' : 'badge-locked') + '">' + e.status + '</span></td>\
    <td>' + e.latencyMs + 'ms</td>\
    <td>' + e.inputTokens + '/' + e.outputTokens + '</td>\
  </tr>';
}

function buildTrendChartSVG(entries) {
  var buckets = new Array(24).fill(0);
  var now = Date.now();
  (entries || []).forEach(function(e) {
    var age = now - new Date(e.timestamp).getTime();
    var hourAgo = Math.floor(age / 3600000);
    if (hourAgo >= 0 && hourAgo < 24) buckets[23 - hourAgo]++;
  });
  var max = Math.max.apply(null, buckets);
  if (max === 0) max = 1;
  var w = 600, h = 80, pad = 8;
  var pts = buckets.map(function(v, i) {
    var x = pad + (i / 23) * (w - 2 * pad);
    var y = h - pad - (v / max) * (h - 2 * pad);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  var areaPts = pts.join(' ') + ' ' + (w - pad).toFixed(1) + ',' + (h - pad) + ' ' + pad.toFixed(1) + ',' + (h - pad);
  return '<svg class="trend-chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><polygon points="' + areaPts + '" fill="var(--accent)" opacity="0.08"/><polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/></svg>';
}

function renderTrendChart(entries) {
  return '<div class="card" id="trend-chart-card"><div class="card-title">' + t('trendChart') + '</div>' + buildTrendChartSVG(entries) + '</div>';
}

function updateTrendChart(entries) {
  var card = document.getElementById('trend-chart-card');
  if (!card) return;
  card.innerHTML = '<div class="card-title">' + t('trendChart') + '</div>' + buildTrendChartSVG(entries);
}

async function renderUsage(c) {
  showSkeleton(c, 4);
  const [summary, usage, quotas] = await Promise.all([
    apiGet('/usage/summary'),
    apiGet('/usage?limit=500'),
    apiGet('/usage/quotas')
  ]);
  const entries = usage.entries || [];
  const quotaBars = quotas.quotas || [];
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
      ' + renderTrendChart(entries) + '\
      ' + renderQuotaBars(quotaBars) + '\
      <div class="flex-between mb-12">\
        <h3>' + t('recentRequests') + '</h3>\
        <button class="btn btn-danger btn-sm" onclick="clearUsage()">' + t('clear') + '</button>\
      </div>\
    </div>' +
    (entries.length === 0 ? emptyState(t('noUsage')) : '\
    <div class="usage-scroll">\
    <table>\
      <thead><tr><th>' + t('time') + '</th><th>' + t('provider') + '</th><th>' + t('model') + '</th><th>Key</th><th>' + t('status') + '</th><th>' + t('latency') + '</th><th>' + t('tokens') + '</th></tr></thead>\
      <tbody>' +
        entries.map(renderUsageRow).join('') + '\
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
        const [summary, usage, quotas] = await Promise.all([
          apiGet('/usage/summary'),
          apiGet('/usage?limit=500'),
          apiGet('/usage/quotas')
        ]);
        updateUsageSummary(summary);
        updateUsageTable(usage.entries || []);
        updateTrendChart(usage.entries || []);
        updateQuotaBars(quotas.quotas || []);
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
  var sig = entries.length + ':' + (entries[0] ? entries[0].timestamp : '');
  if (sig === lastUsageSig) return;
  lastUsageSig = sig;
  tbody.innerHTML = entries.map(renderUsageRow).join('');
}

async function clearUsage() {
  await apiDelete('/usage');
  toast(t('usageCleared'), 'info');
  renderUsage(document.getElementById('page-content'));
}

function renderQuotaBars(bars) {
  if (!bars || bars.length === 0) return '';
  var html = '<div class="quota-section"><h3>Quota Monitor</h3>';
  bars.forEach(function(bar) {
    var tokenInfo = ' <span class="quota-bar-tokens">' + bar.successCount + ' ok &middot; in:' + formatMillionTokens(bar.inputTokens) + ' out:' + formatMillionTokens(bar.outputTokens) + '</span>';
    if (bar.hasQuota) {
      var pct = bar.totalCapacity > 0 ? (bar.totalUsed / bar.totalCapacity * 100) : 0;
      var color = pct < 50 ? 'var(--accent2)' : (pct < 80 ? 'var(--warn)' : 'var(--danger)');
      html += '<div class="quota-bar-item">' +
        '<div class="quota-bar-header">' +
          '<span class="quota-bar-model">' + escapeHtml(bar.provider) + ' / ' + escapeHtml(bar.model) + ' (' + bar.perKeyLimit + ' per/day)' + tokenInfo + '</span>' +
          '<span class="quota-bar-numbers">' + bar.totalUsed + '/' + bar.totalCapacity + '</span>' +
        '</div>' +
        '<div class="quota-bar-track">' +
          '<div class="quota-bar-fill" style="width:' + pct + '%;background:' + color + '"></div>' +
        '</div>' +
      '</div>';
    } else {
      html += '<div class="quota-bar-item">' +
        '<div class="quota-bar-header">' +
          '<span class="quota-bar-model">' + escapeHtml(bar.provider) + ' / ' + escapeHtml(bar.model) + tokenInfo + '</span>' +
        '</div>' +
      '</div>';
    }
  });
  html += '</div>';
  return html;
}

function updateQuotaBars(bars) {
  var container = document.querySelector('.quota-section');
  if (!container) return;
  container.outerHTML = renderQuotaBars(bars);
}
