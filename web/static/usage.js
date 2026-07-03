// ===================== Usage Page =====================

var lastUsageSig = '';
var lastUsageEntries = [];
var modelColorMap = {};

var TREND_PALETTE = [
  '#4fc3f7', '#10a37f', '#d97706', '#4285f4', '#a855f7', '#ff6a00',
  '#ec4899', '#14b8a6', '#f59e0b', '#84cc16', '#7c3aed', '#06b6d4',
  '#f97316', '#ef4444'
];

var TREND_BUCKETS = 24;
var TREND_BUCKET_MS = 15 * 60 * 1000;
var TREND_WINDOW_MS = TREND_BUCKETS * TREND_BUCKET_MS;

function getModelColor(provider, model) {
  var key = provider + '/' + model;
  if (modelColorMap[key]) return modelColorMap[key];
  var hash = 0;
  for (var i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  var color = TREND_PALETTE[Math.abs(hash) % TREND_PALETTE.length];
  modelColorMap[key] = color;
  return color;
}

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

function buildTrendData(entries) {
  var now = Date.now();
  var windowStart = now - TREND_WINDOW_MS;
  var groups = {};
  (entries || []).forEach(function(e) {
    var ts = new Date(e.timestamp).getTime();
    if (ts < windowStart) return;
    var key = e.provider + '/' + e.model;
    if (!groups[key]) {
      groups[key] = { provider: e.provider, model: e.model, buckets: new Array(TREND_BUCKETS).fill(0) };
    }
    var age = now - ts;
    var bucketIdx = TREND_BUCKETS - 1 - Math.floor(age / TREND_BUCKET_MS);
    if (bucketIdx >= 0 && bucketIdx < TREND_BUCKETS) {
      groups[key].buckets[bucketIdx]++;
    }
  });
  var groupList = Object.keys(groups).map(function(k) { return groups[k]; });
  groupList.sort(function(a, b) {
    var sa = b.buckets.reduce(function(s, v) { return s + v; }, 0);
    var sb = a.buckets.reduce(function(s, v) { return s + v; }, 0);
    return sa - sb;
  });
  var globalMax = 1;
  groupList.forEach(function(g) {
    g.buckets.forEach(function(v) { if (v > globalMax) globalMax = v; });
  });
  return { groups: groupList, max: globalMax, now: now };
}

function buildTrendChartSVG(entries) {
  var data = buildTrendData(entries);
  var groups = data.groups;
  var maxVal = data.max;
  var now = data.now;

  var w = 680, h = 260;
  var leftPad = 35, rightPad = 15, topPad = 12, bottomPad = 30, legendH = 28;
  var chartX0 = leftPad, chartX1 = w - rightPad;
  var chartY0 = topPad, chartY1 = h - bottomPad - legendH;
  var chartW = chartX1 - chartX0;
  var chartH = chartY1 - chartY0;

  var bucketW = chartW / TREND_BUCKETS;

  var svg = '<svg class="trend-chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">';

  // Y-axis gridlines + labels (5 ticks)
  for (var yi = 0; yi <= 4; yi++) {
    var yVal = Math.round(maxVal * yi / 4);
    var yPos = chartY1 - (yi / 4) * chartH;
    svg += '<line x1="' + chartX0 + '" y1="' + yPos.toFixed(1) + '" x2="' + chartX1 + '" y2="' + yPos.toFixed(1) + '" stroke="var(--glass-border)" stroke-width="0.5" opacity="0.4"/>';
    svg += '<text x="' + (chartX0 - 6) + '" y="' + (yPos + 3).toFixed(1) + '" text-anchor="end" fill="var(--text-muted)" font-size="10">' + yVal + '</text>';
  }

  // X-axis labels (every 4 buckets = 1 hour)
  for (var xi = 0; xi < TREND_BUCKETS; xi += 4) {
    var xPos = chartX0 + xi * bucketW;
    var hoursAgo = (TREND_BUCKETS - xi) * 15 / 60;
    var label = hoursAgo === 0 ? 'now' : '-' + hoursAgo + 'h';
    svg += '<text x="' + xPos.toFixed(1) + '" y="' + (chartY1 + 16) + '" text-anchor="middle" fill="var(--text-muted)" font-size="10">' + label + '</text>';
    // vertical gridline
    if (xi > 0) {
      svg += '<line x1="' + xPos.toFixed(1) + '" y1="' + chartY0 + '" x2="' + xPos.toFixed(1) + '" y2="' + chartY1 + '" stroke="var(--glass-border)" stroke-width="0.5" opacity="0.3"/>';
    }
  }

  // Polylines per model group
  groups.forEach(function(g) {
    var color = getModelColor(g.provider, g.model);
    var pts = [];
    for (var i = 0; i < TREND_BUCKETS; i++) {
      var x = chartX0 + (i + 0.5) * bucketW;
      var y = chartY1 - (g.buckets[i] / maxVal) * chartH;
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    svg += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
  });

  // Hover interaction elements (hidden by default)
  svg += '<line id="trend-hover-line" x1="0" y1="' + chartY0 + '" x2="0" y2="' + chartY1 + '" stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>';
  svg += '<circle id="trend-hover-dot" cx="0" cy="0" r="3" fill="var(--accent)" opacity="0"/>';

  // Axis lines
  svg += '<line x1="' + chartX0 + '" y1="' + chartY1 + '" x2="' + chartX1 + '" y2="' + chartY1 + '" stroke="var(--glass-border)" stroke-width="1"/>';
  svg += '<line x1="' + chartX0 + '" y1="' + chartY0 + '" x2="' + chartX0 + '" y2="' + chartY1 + '" stroke="var(--glass-border)" stroke-width="1"/>';

  svg += '</svg>';

  // Legend
  var legend = '<div class="trend-legend">';
  groups.forEach(function(g) {
    var color = getModelColor(g.provider, g.model);
    legend += '<span class="trend-legend-item"><span class="trend-legend-dot" style="background:' + color + '"></span>' + escapeHtml(g.provider) + '/' + escapeHtml(g.model) + '</span>';
  });
  legend += '</div>';

  return '<div class="trend-chart-wrap" id="trend-chart-wrap">' + svg + legend + '</div>';
}

function renderTrendChart(entries) {
  return '<div class="card" id="trend-chart-card"><div class="card-title">' + t('trendChart') + '</div>' + buildTrendChartSVG(entries) + '</div>';
}

function updateTrendChart(entries) {
  var card = document.getElementById('trend-chart-card');
  if (!card) return;
  card.innerHTML = '<div class="card-title">' + t('trendChart') + '</div>' + buildTrendChartSVG(entries);
  attachTrendHover(entries);
}

function attachTrendHover(entries) {
  var wrap = document.getElementById('trend-chart-wrap');
  if (!wrap) return;
  var svg = wrap.querySelector('svg');
  if (!svg) return;

  var data = buildTrendData(entries);
  var maxVal = data.max;

  var w = 680, h = 260;
  var leftPad = 35, rightPad = 15, topPad = 12, bottomPad = 30, legendH = 28;
  var chartX0 = leftPad, chartX1 = w - rightPad;
  var chartY0 = topPad, chartY1 = h - bottomPad - legendH;
  var chartW = chartX1 - chartX0;
  var bucketW = chartW / TREND_BUCKETS;

  var hoverLine = svg.querySelector('#trend-hover-line');
  var hoverDot = svg.querySelector('#trend-hover-dot');

  // Remove any existing tooltip
  var existingTooltip = wrap.querySelector('.trend-tooltip');
  if (existingTooltip) existingTooltip.remove();

  var tooltip = document.createElement('div');
  tooltip.className = 'trend-tooltip';
  tooltip.style.display = 'none';
  wrap.appendChild(tooltip);

  wrap.onmousemove = function(ev) {
    var rect = svg.getBoundingClientRect();
    var scaleX = 680 / rect.width;
    var svgX = (ev.clientX - rect.left) * scaleX;
    var scaleH = 260 / rect.height;
    var svgY = (ev.clientY - rect.top) * scaleH;

    if (svgX < chartX0 || svgX > chartX1) {
      hoverLine.setAttribute('opacity', '0');
      hoverDot.setAttribute('opacity', '0');
      tooltip.style.display = 'none';
      return;
    }

    var bucketIdx = Math.floor((svgX - chartX0) / bucketW);
    if (bucketIdx < 0) bucketIdx = 0;
    if (bucketIdx >= TREND_BUCKETS) bucketIdx = TREND_BUCKETS - 1;

    var lineX = chartX0 + (bucketIdx + 0.5) * bucketW;
    hoverLine.setAttribute('x1', lineX);
    hoverLine.setAttribute('x2', lineX);
    hoverLine.setAttribute('opacity', '1');
    hoverDot.setAttribute('opacity', '0');

    // Compute bucket time range
    var bucketEnd = data.now - (TREND_BUCKETS - 1 - bucketIdx) * TREND_BUCKET_MS;
    var bucketStart = bucketEnd - TREND_BUCKET_MS;
    var fmtTime = function(ts) {
      var d = new Date(ts);
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    };

    // Build tooltip rows
    var rows = '';
    var totalReq = 0;
    data.groups.forEach(function(g) {
      var count = g.buckets[bucketIdx];
      if (count > 0) {
        var color = getModelColor(g.provider, g.model);
        rows += '<div class="trend-tooltip-row"><span class="trend-tooltip-dot" style="background:' + color + '"></span>' + escapeHtml(g.provider) + '/' + escapeHtml(g.model) + '<span class="trend-tooltip-count">' + count + ' ' + t('requests') + '</span></div>';
        totalReq += count;
      }
    });
    if (rows === '') {
      rows = '<div class="trend-tooltip-row" style="color:var(--text-muted)">' + escapeHtml(t('noUsage')) + '</div>';
    }

    tooltip.innerHTML = '<div class="trend-tooltip-hour">' + fmtTime(bucketStart) + ' - ' + fmtTime(bucketEnd) + '</div>' + rows + '<div class="trend-tooltip-total">' + t('total') + ': ' + totalReq + '</div>';
    tooltip.style.display = 'block';

    // Position tooltip
    var wrapRect = wrap.getBoundingClientRect();
    var tipW = tooltip.offsetWidth;
    var tipH = tooltip.offsetHeight;
    var leftPx = ev.clientX - wrapRect.left + 12;
    if (leftPx + tipW > wrapRect.width) {
      leftPx = ev.clientX - wrapRect.left - tipW - 12;
    }
    var topPx = ev.clientY - wrapRect.top + 12;
    if (topPx + tipH > wrapRect.height) {
      topPx = ev.clientY - wrapRect.top - tipH - 12;
    }
    tooltip.style.left = leftPx + 'px';
    tooltip.style.top = topPx + 'px';
  };

  wrap.onmouseleave = function() {
    hoverLine.setAttribute('opacity', '0');
    hoverDot.setAttribute('opacity', '0');
    tooltip.style.display = 'none';
  };
}

async function renderUsage(c) {
  showSkeleton(c, 4);
  const [summary, usage, quotas] = await Promise.all([
    apiGet('/usage/summary'),
    apiGet('/usage?limit=500'),
    apiGet('/usage/quotas')
  ]);
  lastUsageEntries = usage.entries || [];
  const quotaBars = quotas.quotas || [];
  c.innerHTML = '\
    <div class="usage-header">\
      <div class="usage-header-top">\
        <h2>' + t('usage') + '</h2>\
        <button class="btn btn-primary btn-sm" onclick="openRecentRequests()">' + t('recentRequestsBtn') + '</button>\
      </div>\
      <div class="stat-grid">\
        <div class="stat-card"><div class="stat-value">' + summary.total + '</div><div class="stat-label">' + t('totalRequests') + '</div></div>\
        <div class="stat-card"><div class="stat-value" style="color:var(--accent2)">' + summary.success + '</div><div class="stat-label">' + t('success') + '</div></div>\
        <div class="stat-card"><div class="stat-value" style="color:var(--danger)">' + summary.error + '</div><div class="stat-label">' + t('errors') + '</div></div>\
        <div class="stat-card"><div class="stat-value">' + summary.avgLatencyMs + 'ms</div><div class="stat-label">' + t('avgLatency') + '</div></div>\
        <div class="stat-card"><div class="stat-value">' + formatMillionTokens(summary.totalInputTokens) + '</div><div class="stat-label">' + t('totalInput') + '</div></div>\
        <div class="stat-card"><div class="stat-value">' + formatMillionTokens(summary.totalOutputTokens) + '</div><div class="stat-label">' + t('totalOutput') + '</div></div>\
      </div>\
      ' + renderTrendChart(lastUsageEntries) + '\
      ' + renderQuotaBars(quotaBars) + '\
    </div>';
  c.classList.remove('usage-page');
  attachTrendHover(lastUsageEntries);
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
        lastUsageEntries = usage.entries || [];
        updateUsageSummary(summary);
        updateTrendChart(lastUsageEntries);
        updateQuotaBars(quotas.quotas || []);
        updateRecentRequestsModal();
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

async function clearUsage() {
  await apiDelete('/usage');
  toast(t('usageCleared'), 'info');
  renderUsage(document.getElementById('page-content'));
}

function renderQuotaBars(bars) {
  if (!bars || bars.length === 0) return '';
  var html = '<div class="quota-section"><h3>Quota Monitor</h3>';
  bars.forEach(function(bar) {
    var color = getModelColor(bar.provider, bar.model);
    var tokenInfo = ' <span class="quota-bar-tokens">' +
      '<span style="color:var(--accent2);font-weight:700">' + bar.successCount + '</span>' +
      '<span style="color:var(--text-muted);font-weight:400"> / </span>' +
      '<span style="color:var(--danger);font-weight:700">' + bar.errorCount + '</span>' +
      '</span>';
    if (bar.hasQuota) {
      var pct = bar.totalCapacity > 0 ? (bar.totalUsed / bar.totalCapacity * 100) : 0;
      var fillColor = pct < 50 ? 'var(--accent2)' : (pct < 80 ? 'var(--warn)' : 'var(--danger)');
      html += '<div class="quota-bar-item">' +
        '<div class="quota-bar-header">' +
          '<span class="quota-bar-model"><span class="model-color-dot" style="background:' + color + '"></span>' + escapeHtml(bar.provider) + ' / ' + escapeHtml(bar.model) + ' (' + bar.perKeyLimit + ' per/day)' + tokenInfo + '</span>' +
          '<span class="quota-bar-numbers">' + bar.totalUsed + '/' + bar.totalCapacity + '</span>' +
        '</div>' +
        '<div class="quota-bar-track">' +
          '<div class="quota-bar-fill" style="width:' + pct + '%;background:' + fillColor + '"></div>' +
        '</div>' +
      '</div>';
    } else {
      html += '<div class="quota-bar-item">' +
        '<div class="quota-bar-header">' +
          '<span class="quota-bar-model"><span class="model-color-dot" style="background:' + color + '"></span>' + escapeHtml(bar.provider) + ' / ' + escapeHtml(bar.model) + tokenInfo + '</span>' +
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

// --- Recent Requests Modal ---

function openRecentRequests() {
  var overlay = document.getElementById('modal-overlay');
  if (overlay.classList.contains('show')) return;

  var entries = lastUsageEntries;
  var tableHtml = entries.length === 0 ? emptyState(t('noUsage')) :
    '<div class="recent-requests-scroll">' +
    '<table>' +
      '<thead><tr><th>' + t('time') + '</th><th>' + t('provider') + '</th><th>' + t('model') + '</th><th>Key</th><th>' + t('status') + '</th><th>' + t('latency') + '</th><th>' + t('tokens') + '</th></tr></thead>' +
      '<tbody>' + entries.map(renderUsageRow).join('') + '</tbody>' +
    '</table>' +
    '</div>';

  overlay.innerHTML = '<div class="modal" id="recent-requests-modal" style="max-width:900px;width:90vw">' +
    '<div class="modal-title">' + t('recentRequests') + '</div>' +
    '<div class="modal-body" style="max-height:60vh;overflow-y:auto;padding:0 0 8px 0">' + tableHtml + '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-danger btn-sm" onclick="clearUsageFromModal()">' + t('clear') + '</button>' +
      '<button class="btn btn-ghost" onclick="closeRecentRequests()">' + t('close') + '</button>' +
    '</div>' +
  '</div>';

  requestAnimationFrame(function() { overlay.classList.add('show'); });
  overlay.onclick = function(e) { if (e.target === overlay) closeRecentRequests(); };
}

function closeRecentRequests() {
  var overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('show');
  overlay.addEventListener('transitionend', function() { overlay.innerHTML = ''; }, { once: true });
}

function updateRecentRequestsModal() {
  var modal = document.getElementById('recent-requests-modal');
  if (!modal) return;
  var tbody = modal.querySelector('tbody');
  if (!tbody) return;
  var entries = lastUsageEntries;
  if (entries.length === 0) {
    var body = modal.querySelector('.modal-body');
    if (body) body.innerHTML = emptyState(t('noUsage'));
  } else {
    tbody.innerHTML = entries.map(renderUsageRow).join('');
  }
}

async function clearUsageFromModal() {
  await apiDelete('/usage');
  toast(t('usageCleared'), 'info');
  closeRecentRequests();
  renderUsage(document.getElementById('page-content'));
}
