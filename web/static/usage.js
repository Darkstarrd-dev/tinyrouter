// ===================== Usage Page =====================

var lastUsageSig = '';
var lastUsageEntries = [];
var modelColorMap = {};
var expandedModels = new Set();
var lockCountdownTimerStarted = false;
var quotaBarItems = {};
var lastQuotaSig = '';
var usageDebugMode = false;

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

function sanitizeId(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function renderUsageRow(e) {
  var statusCell;
  if (usageDebugMode && (e.reqPayload || e.respPayload || e.respStatus)) {
    var ts = new Date(e.timestamp).getTime();
    statusCell = '<td><button type="button" class="btn btn-sm btn-info" onclick="showUsageEntryInfo(\'' + ts + '\')"><span class="badge ' + (e.status === 'success' ? 'badge-active' : 'badge-locked') + '">' + e.status + '</span></button></td>';
  } else {
    statusCell = '<td><span class="badge ' + (e.status === 'success' ? 'badge-active' : 'badge-locked') + '">' + e.status + '</span></td>';
  }
  return '<tr>\
    <td>' + new Date(e.timestamp).toLocaleTimeString() + '</td>\
    <td>' + escapeHtml(e.provider) + '</td>\
    <td>' + escapeHtml(e.model) + '</td>\
    <td>' + escapeHtml(e.keyName) + '</td>\
    ' + statusCell + '\
    <td>' + e.latencyMs + 'ms</td>\
    <td>' + e.inputTokens + '/' + e.outputTokens + '</td>\
  </tr>';
}

function buildTrendData(entries) {
  var now = Date.now();
  var windowStart = now - TREND_WINDOW_MS;
  var groups = {};
  (entries || []).forEach(function(e) {
    if (e.status !== 'success') return;
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
    var scale = Math.min(rect.width / 680, rect.height / 260);
    var renderedW = 680 * scale;
    var renderedH = 260 * scale;
    var offsetX = (rect.width - renderedW) / 2;
    var offsetY = (rect.height - renderedH) / 2;
    var svgX = (ev.clientX - rect.left - offsetX) / scale;
    var svgY = (ev.clientY - rect.top - offsetY) / scale;

    if (svgX < 0 || svgX > 680 || svgY < 0 || svgY > 260) {
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
  const [summary, usage, quotas, settings] = await Promise.all([
    apiGet('/usage/summary'),
    apiGet('/usage?limit=500'),
    apiGet('/usage/quotas'),
    apiGet('/settings')
  ]);
  usageDebugMode = !!(settings && settings.debugMode);
  lastUsageEntries = usage.entries || [];
  const quotaBars = quotas.quotas || [];
  quotaBarItems = {};
  lastQuotaSig = '';
  var quotaCardHtml = '<div class="card"><div class="card-title">' + t('quotaMonitor') + '</div><div class="quota-section quota-section-scroll"></div></div>';
  c.innerHTML = '\
    <div class="usage-header usage-fullscreen">\
      <div class="charts-row usage-body-grid">\
        <div class="quota-monitor-card">' + quotaCardHtml + '\
        </div>\
        <div class="trend-card">' + renderTrendChart(lastUsageEntries) + '</div>\
        <div class="recent-requests-section">' + renderRecentRequestsInline(lastUsageEntries) + '</div>\
      </div>\
    </div>';
  c.classList.remove('usage-page');
  var mainEl = document.querySelector('.main');
  if (mainEl) mainEl.classList.add('main-no-scroll');
  var section = document.querySelector('.quota-monitor-card > .card > .quota-section');
  if (quotaBars.length === 0) {
    section.innerHTML = emptyState(t('noQuota'));
  } else {
    buildQuotaBarItems(quotaBars, section);
  }
  attachTrendHover(lastUsageEntries);
  startUsageRefresh();
}

function renderRecentRequestsInline(entries) {
  var limit = 50;
  var rows = entries.slice(0, limit);
  var header = '<div class="card-title">' + t('recentRequests') + '<span class="recent-count">' + entries.length + '</span></div>';
  var body;
  if (rows.length === 0) {
    body = emptyState(t('noUsage'));
  } else {
    body = '<div class="recent-requests-scroll card-scroll">' +
      '<table class="usage-table">' +
        '<thead><tr>' +
          '<th>' + t('thTime') + '</th>' +
          '<th>' + t('thProvider') + '</th>' +
          '<th>' + t('thModel') + '</th>' +
          '<th>' + t('thKey') + '</th>' +
          '<th>' + t('thStatus') + '</th>' +
          '<th>' + t('thLatency') + '</th>' +
          '<th>' + t('thTokens') + '</th>' +
        '</tr></thead>' +
        '<tbody id="recent-tbody">' + rows.map(renderUsageRow).join('') + '</tbody>' +
      '</table>' +
    '</div>';
  }
  return '<div class="card recent-requests-card">' + header + body + '</div>';
}

function updateRecentRequestsInline(entries) {
  var tbody = document.getElementById('recent-tbody');
  if (!tbody) return;
  var limit = 50;
  var rows = entries.slice(0, limit);
  tbody.innerHTML = rows.map(renderUsageRow).join('');
  var countEl = document.querySelector('.recent-requests-card .recent-count');
  if (countEl) countEl.textContent = String(entries.length);
}

// --- Quota refresh with debounce ---
var _quotaRefreshTimer = null;

function scheduleQuotaRefresh() {
  if (_quotaRefreshTimer) clearTimeout(_quotaRefreshTimer);
  _quotaRefreshTimer = setTimeout(function() {
    _quotaRefreshTimer = null;
    refreshQuotaData();
  }, 300);
}

async function refreshQuotaData() {
  try {
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
    updateRecentRequestsInline(lastUsageEntries);
  } catch(e) {}
}

function startUsageRefresh() {
  stopUsageRefresh();
  usageEventSource = new EventSource('/api/usage/events');
  usageEventSource.onmessage = function(ev) {
    try {
      var data = JSON.parse(ev.data);
      if (data.type === 'usage-updated' || data.type === 'key-inflight') {
        scheduleQuotaRefresh();
      }
    } catch(e) {}
  };
  usageEventSource.onerror = function() {
    var status = document.getElementById('console-status');
    if (status) status.textContent = t('disconnected');
  };
  usageEventSource.onopen = function() {
    var status = document.getElementById('console-status');
    if (status) status.textContent = t('connected');
  };
}

function stopUsageRefresh() {
  if (usageEventSource) {
    usageEventSource.close();
    usageEventSource = null;
  }
}

function computeQuotaSig(bars) {
  if (!bars) return '';
  try { return JSON.stringify(bars.map(function(b) { return b.provider + '|' + b.model + '|' + b.totalUsed + '|' + b.totalCapacity + '|' + (b.inFlightKeyNames ? b.inFlightKeyNames.join(',') : '') + '|' + (b.currentKeyName||'') + '|' + (b.currentKeyId||'') + '|' + b.successCount + '|' + b.errorCount + '|' + (b.hasQuota ? 1 : 0) + '|' + (b.perKeyLimit||''); })); } catch(e) { return ''; }
}

function setBarWidth(fillEl, pctStr) {
  fillEl.style.transition = 'none';
  fillEl.style.width = pctStr;
  void fillEl.offsetWidth;
  fillEl.style.transition = '';
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

var QUOTA_CHEVRON = '<svg class="quota-bar-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function renderQuotaBarItem(bar) {
  var color = getModelColor(bar.provider, bar.model);
  var barDotClass = 'model-color-dot';
  if (bar.inFlightKeyNames && bar.inFlightKeyNames.length > 0) {
    barDotClass += ' model-color-dot-calling';
  }
  var itemId = 'qbi-' + sanitizeId(bar.provider) + '-' + sanitizeId(bar.model);
  var toggleCall = "toggleModelDetail('" + escapeHtml(bar.provider).replace(/'/g, "\\'") + "','" + escapeHtml(bar.model).replace(/'/g, "\\'") + "')";
  var currentKeyHtml = '';
  if (bar.currentKeyName) {
    currentKeyHtml = '<span class="current-key-tag" title="' + escapeHtml(t('currentKey')) + '" data-current-key-id="' + escapeHtml(bar.currentKeyId || '') + '"><span class="current-key-dot"></span>' + escapeHtml(bar.currentKeyName) + '</span>';
  } else {
    currentKeyHtml = '<span class="current-key-tag current-key-tag-none">' + escapeHtml(t('noCurrentKey')) + '</span>';
  }
  var tokenInfo = ' <span class="quota-bar-tokens">' +
    '<span style="color:var(--accent2);font-weight:700">' + bar.successCount + '</span>' +
    '<span style="color:var(--text-muted);font-weight:400"> / </span>' +
    '<span style="color:var(--danger);font-weight:700">' + bar.errorCount + '</span>' +
    '</span>';
  if (bar.hasQuota) {
    var pct = bar.totalCapacity > 0 ? (bar.totalUsed / bar.totalCapacity * 100) : 0;
    var fillColor = pct < 50 ? 'var(--accent2)' : (pct < 80 ? 'var(--warn)' : 'var(--danger)');
    var remain = bar.totalCapacity - bar.totalUsed;
    return '<div class="quota-bar-item" id="' + itemId + '" onclick="' + toggleCall + '">' +
      '<div class="quota-bar-header">' +
        '<span class="quota-bar-model"><span class="' + barDotClass + '" style="background:' + color + '"></span>' + escapeHtml(bar.provider) + ' / ' + escapeHtml(bar.model) + ' (' + bar.perKeyLimit + ' per/day)' + currentKeyHtml + tokenInfo + '</span>' +
        '<span class="quota-bar-right">' + QUOTA_CHEVRON + '</span>' +
      '</div>' +
      '<div class="quota-bar-row">' +
        '<span class="quota-bar-numbers">' + bar.totalUsed + '/' + bar.totalCapacity + '</span>' +
        '<div class="quota-bar-track" data-used="' + bar.totalUsed + '" data-total="' + bar.totalCapacity + '" data-remain="' + remain + '" data-perkey="' + bar.perKeyLimit + '">' +
          '<div class="quota-bar-fill" style="width:' + pct + '%;background:' + fillColor + '"></div>' +
        '</div>' +
      '</div>' +
      '<div class="model-key-detail-wrap" id="detail-' + itemId + '"></div>' +
    '</div>';
  } else {
    return '<div class="quota-bar-item" id="' + itemId + '" onclick="' + toggleCall + '">' +
      '<div class="quota-bar-header">' +
        '<span class="quota-bar-model"><span class="' + barDotClass + '" style="background:' + color + '"></span>' + escapeHtml(bar.provider) + ' / ' + escapeHtml(bar.model) + currentKeyHtml + tokenInfo + '</span>' +
        '<span class="quota-bar-right">' + QUOTA_CHEVRON + '</span>' +
      '</div>' +
      '<div class="model-key-detail-wrap" id="detail-' + itemId + '"></div>' +
    '</div>';
  }
}

function buildQuotaBarItems(bars, section) {
  if (!bars) return;
  for (var i = 0; i < bars.length; i++) {
    var bar = bars[i];
    var key = bar.provider + '/' + bar.model;
    var html = renderQuotaBarItem(bar);
    var temp = document.createElement('div');
    temp.innerHTML = html;
    var el = temp.firstElementChild;
    section.appendChild(el);
    quotaBarItems[key] = el;
    el._hasQuota = !!bar.hasQuota;
    var setKey = JSON.stringify([bar.provider, bar.model]);
    if (expandedModels.has(setKey)) {
      toggleModelDetail(bar.provider, bar.model);
    }
  }
  attachQuotaBarHover();
}

function patchQuotaBarItem(el, bar) {
  if (!!el._hasQuota !== !!bar.hasQuota) {
    var key = bar.provider + '/' + bar.model;
    var temp = document.createElement('div');
    temp.innerHTML = renderQuotaBarItem(bar);
    var newEl = temp.firstElementChild;
    el.parentNode.replaceChild(newEl, el);
    quotaBarItems[key] = newEl;
    newEl._hasQuota = !!bar.hasQuota;
    attachQuotaBarHover();
    var setKey = JSON.stringify([bar.provider, bar.model]);
    if (expandedModels.has(setKey)) {
      toggleModelDetail(bar.provider, bar.model);
    }
    return;
  }
  var dot = el.querySelector('.model-color-dot');
  if (bar.inFlightKeyNames && bar.inFlightKeyNames.length > 0) {
    dot.classList.add('model-color-dot-calling');
  } else {
    dot.classList.remove('model-color-dot-calling');
  }
  var tokenInfo = ' <span class="quota-bar-tokens">' +
    '<span style="color:var(--accent2);font-weight:700">' + bar.successCount + '</span>' +
    '<span style="color:var(--text-muted);font-weight:400"> / </span>' +
    '<span style="color:var(--danger);font-weight:700">' + bar.errorCount + '</span>' +
    '</span>';
  var currentKeyHtml = '';
  if (bar.currentKeyName) {
    currentKeyHtml = '<span class="current-key-tag" title="' + escapeHtml(t('currentKey')) + '" data-current-key-id="' + escapeHtml(bar.currentKeyId || '') + '"><span class="current-key-dot"></span>' + escapeHtml(bar.currentKeyName) + '</span>';
  } else {
    currentKeyHtml = '<span class="current-key-tag current-key-tag-none">' + escapeHtml(t('noCurrentKey')) + '</span>';
  }
  var modelSpan = el.querySelector('.quota-bar-model');
  var modelPrefix = escapeHtml(bar.provider) + ' / ' + escapeHtml(bar.model);
  if (bar.hasQuota) {
    modelPrefix += ' (' + bar.perKeyLimit + ' per/day)';
  }
  modelSpan.innerHTML = '<span class="' + dot.className + '" style="background:' + getModelColor(bar.provider, bar.model) + '"></span>' + modelPrefix + currentKeyHtml + tokenInfo;
  var numSpan = el.querySelector('.quota-bar-numbers');
  var track = el.querySelector('.quota-bar-track');
  var fill = track ? track.querySelector('.quota-bar-fill') : null;
  if (bar.hasQuota) {
    var pct = bar.totalCapacity > 0 ? (bar.totalUsed / bar.totalCapacity * 100) : 0;
    var fillColor = pct < 50 ? 'var(--accent2)' : (pct < 80 ? 'var(--warn)' : 'var(--danger)');
    if (numSpan) numSpan.textContent = bar.totalUsed + '/' + bar.totalCapacity;
    if (track) {
      var remain = bar.totalCapacity - bar.totalUsed;
      track.setAttribute('data-used', bar.totalUsed);
      track.setAttribute('data-total', bar.totalCapacity);
      track.setAttribute('data-remain', remain);
      track.setAttribute('data-perkey', bar.perKeyLimit);
    }
    if (fill) {
      setBarWidth(fill, pct + '%');
      fill.style.background = fillColor;
    }
  } else {
    if (numSpan) numSpan.textContent = '';
  }
}

function renderQuotaBars(bars) {
  if (!bars || bars.length === 0) return '<div class="card"><div class="card-title">' + t('quotaMonitor') + '</div>' + emptyState(t('noQuota')) + '</div>';
  var html = '<div class="card"><div class="card-title">' + t('quotaMonitor') + '</div><div class="quota-section quota-section-scroll">';
  for (var i = 0; i < bars.length; i++) {
    html += renderQuotaBarItem(bars[i]);
  }
  html += '</div></div>';
  return html;
}

function formatRemaining(ms) {
  if (ms <= 0) return '0s';
  var totalSec = Math.floor(ms / 1000);
  var m = Math.floor(totalSec / 60);
  var s = totalSec % 60;
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function formatMinutes(ms) {
  if (ms < 0) ms = 0;
  if (ms < 60000) {
    var sec = Math.floor(ms / 1000);
    if (sec > 59) sec = 59;
    if (sec < 0) sec = 0;
    var s = String(sec);
    while (s.length < 2) s = '0' + s;
    return s;
  }
  var totalMin = Math.floor(ms / 60000);
  if (totalMin > 99) totalMin = 99;
  if (totalMin < 0) totalMin = 0;
  var m = String(totalMin);
  while (m.length < 2) m = '0' + m;
  return m;
}

function updateLockCountdowns() {
  var els = document.querySelectorAll('.model-key-countdown[data-unlock]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var unlock = el.getAttribute('data-unlock');
    if (!unlock) continue;
    var remaining = new Date(unlock).getTime() - Date.now();
    if (remaining <= 0) {
      el.textContent = '0s';
      el.classList.add('model-key-countdown-done');
    } else {
      el.textContent = formatRemaining(remaining);
    }
  }
}

function updateKeyTimers() {
  var els = document.querySelectorAll('.model-key-timer');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var type = el.getAttribute('data-type');
    if (type === 'cooldown') {
      var unlock = el.getAttribute('data-unlock');
      if (!unlock) continue;
      var remaining = new Date(unlock).getTime() - Date.now();
      if (remaining <= 0) {
        // cooldown 结束：切换到 idle 正向计时
        el.classList.remove('model-key-timer-cooldown');
        el.classList.add('model-key-timer-idle');
        el.setAttribute('data-type', 'idle');
        el.removeAttribute('data-unlock');
        var nowIso = new Date().toISOString();
        el.setAttribute('data-used-at', nowIso);
        el.textContent = '00';
        // 同行 status badge: cooldown/locked -> available
        var row = el.closest('.model-key-row');
        if (row) {
          var badge = row.querySelector('.key-status-badge');
          if (badge && (badge.classList.contains('key-status-cooldown') || badge.classList.contains('key-status-locked'))) {
            badge.classList.remove('key-status-cooldown', 'key-status-locked');
            badge.classList.add('key-status-available');
            badge.textContent = t('available');
          }
          // 同行 error 清除
          var errEl = row.querySelector('.model-key-error');
          if (errEl) {
            errEl.textContent = '';
            errEl.removeAttribute('title');
          }
        }
      } else {
        el.textContent = formatMinutes(remaining);
      }
    } else if (type === 'idle') {
      var usedAt = el.getAttribute('data-used-at');
      if (!usedAt) continue;
      var elapsed = Date.now() - new Date(usedAt).getTime();
      if (elapsed < 0) elapsed = 0;
      el.textContent = formatMinutes(elapsed);
    }
  }
}

function updateQuotaBars(bars) {
  var section = document.querySelector('.quota-monitor-card > .card > .quota-section');
  if (!section) return;
  var sig = computeQuotaSig(bars);
  if (sig === lastQuotaSig) return;
  lastQuotaSig = sig;
  if (!bars) bars = [];
  if (!lockCountdownTimerStarted) {
    lockCountdownTimerStarted = true;
    setInterval(function() {
      updateLockCountdowns();
      updateKeyTimers();
    }, 1000);
  }
  var seen = {};
  var keys = [];
  for (var i = 0; i < bars.length; i++) {
    var bar = bars[i];
    var key = bar.provider + '/' + bar.model;
    seen[key] = true;
    keys.push(key);
    var el = quotaBarItems[key];
    if (el) {
      patchQuotaBarItem(el, bar);
    } else {
      var temp = document.createElement('div');
      temp.innerHTML = renderQuotaBarItem(bar);
      var newEl = temp.firstElementChild;
      var refEl = null;
      for (var j = i + 1; j < bars.length; j++) {
        if (quotaBarItems[bars[j].provider + '/' + bars[j].model]) {
          refEl = quotaBarItems[bars[j].provider + '/' + bars[j].model];
          break;
        }
      }
      if (refEl) {
        section.insertBefore(newEl, refEl);
      } else {
        section.appendChild(newEl);
      }
      quotaBarItems[key] = newEl;
      newEl._hasQuota = !!bar.hasQuota;
      attachQuotaBarHover();
      var setKey = JSON.stringify([bar.provider, bar.model]);
      if (expandedModels.has(setKey)) {
        toggleModelDetail(bar.provider, bar.model);
      }
    }
  }
  for (var key in quotaBarItems) {
    if (!seen[key]) {
      var el = quotaBarItems[key];
      if (el && el.parentNode) el.parentNode.removeChild(el);
      delete quotaBarItems[key];
    }
  }
}

// (C) Hover a quota-bar track to see exact used/remain/total/per-key numbers.
function attachQuotaBarHover() {
  var tracks = document.querySelectorAll('.quota-bar-track');
  tracks.forEach(function(track) {
    if (track._ttBound) return;
    track._ttBound = true;
    track.addEventListener('mouseenter', function() {
      var used = track.getAttribute('data-used');
      var total = track.getAttribute('data-total');
      var remain = track.getAttribute('data-remain');
      var perkey = track.getAttribute('data-perkey');
      showQuotaTooltip(track, used, total, remain, perkey);
    });
    track.addEventListener('mouseleave', hideQuotaTooltip);
  });
}

function showQuotaTooltip(track, used, total, remain, perkey) {
  hideQuotaTooltip();
  var tip = document.createElement('div');
  tip.className = 'quota-tip';
  tip.id = 'quota-tip';
  tip.innerHTML =
    '<div><span class="quota-tip-k">' + escapeHtml(t('quotaUsed')) + '</span><span class="quota-tip-v">' + used + '</span></div>' +
    '<div><span class="quota-tip-k">' + escapeHtml(t('quotaRemain')) + '</span><span class="quota-tip-v">' + remain + '</span></div>' +
    '<div><span class="quota-tip-k">' + escapeHtml(t('quotaTotal')) + '</span><span class="quota-tip-v">' + total + '</span></div>' +
    '<div class="quota-tip-perkey">' + escapeHtml(t('perKeyLabel')) + ': ' + perkey + '</div>';
  document.body.appendChild(tip);
  var rect = track.getBoundingClientRect();
  tip.style.left = rect.left + 'px';
  tip.style.top = (rect.top - tip.offsetHeight - 6) + 'px';
  // Flip below if not enough space above.
  if (rect.top - tip.offsetHeight - 6 < 4) {
    tip.style.top = (rect.bottom + 6) + 'px';
  }
}

function hideQuotaTooltip() {
  var existing = document.getElementById('quota-tip');
  if (existing) existing.remove();
}

function toggleModelDetail(provider, model) {
  var itemId = 'qbi-' + sanitizeId(provider) + '-' + sanitizeId(model);
  var detailId = 'detail-' + itemId;
  var wrap = document.getElementById(detailId);
  if (!wrap) return;
  var key = provider + '/' + model;
  var item = document.getElementById(itemId);
  var chevron = item ? item.querySelector('.quota-bar-chevron') : null;

  var setKey = JSON.stringify([provider, model]);
  if (expandedModels.has(setKey)) {
    expandedModels.delete(setKey);
    wrap.classList.remove('expanded');
    if (chevron) chevron.style.transform = '';
    setTimeout(function() { if (!expandedModels.has(setKey)) wrap.innerHTML = ''; }, 300);
  } else {
    expandedModels.add(setKey);
    wrap.classList.add('expanded');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    wrap.innerHTML = '<div class="model-key-detail-loading">' + t('loading') + '...</div>';
    fetchModelKeyDetail(provider, model);
  }
}

async function fetchModelKeyDetail(provider, model) {
  try {
    var data = await apiGet('/usage/model-keys?provider=' + encodeURIComponent(provider) + '&model=' + encodeURIComponent(model));
    renderModelKeyDetail(provider, model, data);
  } catch(e) {
    var itemId = 'qbi-' + sanitizeId(provider) + '-' + sanitizeId(model);
    var wrap = document.getElementById('detail-' + itemId);
    if (wrap) wrap.innerHTML = '<div class="model-key-detail-error">' + escapeHtml(t('failed').replace('{0}', e.message || '')) + '</div>';
  }
}

function renderModelKeyDetail(provider, model, data) {
  var itemId = 'qbi-' + sanitizeId(provider) + '-' + sanitizeId(model);
  var wrap = document.getElementById('detail-' + itemId);
  if (!wrap) return;
  if (!data.keys || data.keys.length === 0) {
    wrap.innerHTML = '<div class="model-key-detail-empty">' + escapeHtml(t('noKeysConfigured')) + '</div>';
    return;
  }

  var html = '<div class="model-key-detail">';
  data.keys.forEach(function(k) {
    var color = getModelColor(provider, model);
    var statusBadge = '';
    var quotaBar = '<span class="model-key-quota-bar">';

    if (data.hasQuota) {
      if (k.hasQuota) {
        if (k.modelRemaining === 0) {
          statusBadge = '<span class="key-status-badge key-status-exhausted">' + t('exhausted') + '</span>';
        } else {
          statusBadge = '<span class="key-status-badge key-status-available">' + t('available') + '</span>';
        }
        var pct = k.modelLimit > 0 ? ((k.modelLimit - k.modelRemaining) / k.modelLimit * 100) : 0;
        var fillColor = pct < 50 ? 'var(--accent2)' : (pct < 80 ? 'var(--warn)' : 'var(--danger)');
        quotaBar += '<div class="model-key-quota-fill" style="width:' + pct + '%;background:' + fillColor + '"></div>';
      } else {
        statusBadge = '<span class="key-status-badge key-status-untested">' + t('untestedKey') + '</span>';
      }
    } else {
      if (k.modelLock) {
        if (k.status === 'locked') {
          statusBadge = '<span class="key-status-badge key-status-locked">' + t('dailyLocked') + '</span>';
        } else {
          statusBadge = '<span class="key-status-badge key-status-cooldown">' + t('cooldown') + '</span>';
        }
      } else if (!k.isActive) {
        statusBadge = '<span class="key-status-badge key-status-inactive">' + t('inactive') + '</span>';
      } else {
        statusBadge = '<span class="key-status-badge key-status-available">' + t('available') + '</span>';
      }
    }

    var errorInfo = '<span class="model-key-error"';
    if (k.lastError) {
      var errStr = k.lastError.length > 60 ? k.lastError.slice(0, 60) + '…' : k.lastError;
      errorInfo += ' title="' + escapeHtml(k.lastError) + '">' + escapeHtml(errStr);
    } else {
      errorInfo += '>';
    }
    errorInfo += '</span>';

    var quotaInfo = '<span class="model-key-quota-numbers">';
    if (data.hasQuota && k.hasQuota) {
      quotaInfo += (k.modelLimit - k.modelRemaining) + '/' + k.modelLimit;
    }
    quotaInfo += '</span>';

    // Dot state classes (calling + in-use are independent)
    var dotClass = 'model-color-dot';
    if (k.inFlight && k.inFlight > 0) {
      dotClass += ' model-color-dot-calling';
    }

    // "In Use" badge removed; row highlighting + dot size indicate predicted next key
    var rowClass = 'model-key-row';
    var usable = k.isActive && k.status === 'active' && !k.modelLock;
    if (usable && ((data.inUseKeyID && k.keyId === data.inUseKeyID) || (!data.inUseKeyID && data.inUseKeyName && k.keyName === data.inUseKeyName))) {
      dotClass += ' model-color-dot-in-use';
      rowClass = 'model-key-row model-key-row-in-use';
    } else if (!usable) {
      rowClass = 'model-key-row model-key-row-disabled';
    }

    // Timer: 2-digit circle left of dot; mutually exclusive display
    var timerHtml = '';
    if (k.modelLock || k.status === 'cooldown' || k.status === 'locked') {
      if (k.modelLock) {
        var unlockMs = new Date(k.modelLock).getTime() - Date.now();
        timerHtml = '<span class="model-key-timer model-key-timer-cooldown" data-type="cooldown" data-unlock="' + k.modelLock + '">' + formatMinutes(unlockMs) + '</span>';
      }
    } else if (k.lastUsedAt) {
      var isCurrentlyInUse = (data.inUseKeyID && k.keyId === data.inUseKeyID) ||
       (!data.inUseKeyID && data.inUseKeyName && k.keyName === data.inUseKeyName);
      var isCurrentlyCalling = k.inFlight && k.inFlight > 0;
      if (!isCurrentlyInUse && !isCurrentlyCalling) {
        var idleMs = Date.now() - new Date(k.lastUsedAt).getTime();
        timerHtml = '<span class="model-key-timer model-key-timer-idle" data-type="idle" data-used-at="' + k.lastUsedAt + '">' + formatMinutes(idleMs) + '</span>';
      }
    }

    var metricsHtml = '<span class="model-key-metrics">';
    var hasMetrics = (k.successCount != null && k.successCount > 0) || (k.errorCount != null && k.errorCount > 0) || (k.avgTtftMs != null && k.avgTtftMs > 0) || (k.avgSpeed != null && k.avgSpeed > 0) || (k.liveSpeed != null && k.liveSpeed > 0);
    if (hasMetrics) {
      var metricsParts = [];
      if (k.successCount != null || k.errorCount != null) {
        metricsParts.push('<span class="model-key-metric model-key-succ">' + (k.successCount || 0) + '/<span class="model-key-err">' + (k.errorCount || 0) + '</span></span>');
      }
      if (k.avgTtftMs != null && k.avgTtftMs > 0) {
        metricsParts.push('<span class="model-key-metric">TTFT ' + k.avgTtftMs + 'ms</span>');
      }
      if (k.inFlight && k.inFlight > 0 && k.liveSpeed != null && k.liveSpeed > 0) {
        metricsParts.push('<span class="model-key-metric metric-live">' + k.liveSpeed.toFixed(1) + ' tok/s</span>');
      } else if (k.avgSpeed != null && k.avgSpeed > 0) {
        metricsParts.push('<span class="model-key-metric">' + k.avgSpeed.toFixed(1) + ' tok/s</span>');
      }
      metricsHtml += metricsParts.join('');
    }
    metricsHtml += '</span>';

    quotaBar += '</span>';

    var leadHtml = timerHtml !== '' ? timerHtml : '<span class="' + dotClass + '" style="background:' + color + '"></span>';
    html += '<div class="' + rowClass + '">' +
      leadHtml +
      '<span class="model-key-name">' + escapeHtml(k.keyName) + '</span>' +
      quotaInfo +
      quotaBar +
      statusBadge +
      metricsHtml +
      errorInfo +
    '</div>';
  });
  html += '</div>';
  wrap.innerHTML = html;
}

function reexpandModelDetails() {
  expandedModels.forEach(function(setKey) {
    var parts = JSON.parse(setKey);
    var provider = parts[0];
    var model = parts[1];
    var itemId = 'qbi-' + sanitizeId(provider) + '-' + sanitizeId(model);
    var wrap = document.getElementById('detail-' + itemId);
    if (wrap) {
      wrap.classList.add('expanded');
      var chevron = document.querySelector('#' + itemId + ' .quota-bar-chevron');
      if (chevron) chevron.style.transform = 'rotate(180deg)';
      fetchModelKeyDetail(provider, model);
    }
  });
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
      '<button type="button" class="btn btn-danger btn-sm" onclick="clearUsageFromModal()">' + t('clear') + '</button>' +
      '<button type="button" class="btn btn-ghost" onclick="closeRecentRequests()">' + t('close') + '</button>' +
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

// ===================== Usage Entry Info Modal (Debug Mode) =====================

function showUsageEntryInfo(ts) {
  var e = lastUsageEntries.find(function(x) { return String(new Date(x.timestamp).getTime()) === ts; });
  if (!e) return;
  var overlay = document.getElementById('info-modal-overlay');
  var titleEl = document.getElementById('info-modal-title');
  var bodyEl = document.getElementById('info-modal-body');
  titleEl.textContent = e.provider + ' / ' + e.model + ' \u2014 ' + e.status + ' (' + e.latencyMs + 'ms)';
  __infoModalSections = [];
  var html = '';
  if (e.reqPayload) {
    html += renderInfoSection('Request', e.reqPayload);
  }
  if (e.respHeaders) {
    html += renderInfoSection('Response Headers', e.respHeaders);
  }
  if (e.respStatus) {
    html += '<div class="info-section"><div class="info-section-title">Status: ' + e.respStatus + '</div></div>';
  }
  if (e.respPayload) {
    html += renderInfoSection('Response Body', e.respPayload);
  }
  bodyEl.innerHTML = html || '<div class="info-section">' + t('noData') + '</div>';
  overlay.classList.add('show');
  document.addEventListener('keydown', usageInfoModalEscapeHandler);
}

function usageInfoModalEscapeHandler(e) {
  if (e.key === 'Escape') { closeUsageEntryInfo(); }
}

function closeUsageEntryInfo() {
  var overlay = document.getElementById('info-modal-overlay');
  overlay.classList.remove('show');
  document.removeEventListener('keydown', usageInfoModalEscapeHandler);
}
