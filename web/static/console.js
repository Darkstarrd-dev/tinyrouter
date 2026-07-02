// ===================== Console Page =====================

var consoleEventSource = null;
var consoleFilters = { error: true, warn: true, info: true, debug: true };
var consoleSearchQuery = '';
var consoleAutoScroll = true;
var consoleAllLines = [];

async function renderConsole(c) {
  consoleAllLines = [];
  consoleAutoScroll = true;
  c.innerHTML = '\
    <h2>' + t('console') + '</h2>\
    <div class="flex-between mb-12">\
      <div class="console-controls">\
        <button class="btn btn-sm btn-filter active" data-level="all" onclick="toggleConsoleFilter(this,\'all\')">' + t('all') + '</button>\
        <button class="btn btn-sm btn-filter active" data-level="error" onclick="toggleConsoleFilter(this,\'error\')">ERROR</button>\
        <button class="btn btn-sm btn-filter active" data-level="warn" onclick="toggleConsoleFilter(this,\'warn\')">WARN</button>\
        <button class="btn btn-sm btn-filter active" data-level="info" onclick="toggleConsoleFilter(this,\'info\')">INFO</button>\
        <button class="btn btn-sm btn-filter active" data-level="debug" onclick="toggleConsoleFilter(this,\'debug\')">DEBUG</button>\
        <input type="text" id="console-search" class="console-search" placeholder="' + t('searchLogs') + '" oninput="onConsoleSearch(this.value)">\
      </div>\
      <div class="flex" style="gap:8px">\
        <span class="muted" id="console-status">' + t('connecting') + '</span>\
        <button class="btn btn-danger btn-sm" onclick="clearConsole()">' + t('clear') + '</button>\
      </div>\
    </div>\
    <div class="log-container" id="log-container"></div>';
  var container = document.getElementById('log-container');
  container.addEventListener('scroll', function() {
    var atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;
    consoleAutoScroll = atBottom;
  });
  startConsoleStream();
}

function startConsoleStream() {
  if (consoleEventSource) consoleEventSource.close();
  var container = document.getElementById('log-container');
  var status = document.getElementById('console-status');

  apiGet('/console-logs').then(function(data) {
    (data.lines || []).forEach(function(line) { appendLogLine(container, line); });
  });

  consoleEventSource = new EventSource('/api/console-logs/stream');
  consoleEventSource.onopen = function() { status.textContent = t('connected'); };
  consoleEventSource.onerror = function() { status.textContent = t('disconnected'); };
  consoleEventSource.onmessage = function(e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.type === 'line' && msg.line) {
        appendLogLine(container, msg.line);
      }
    } catch (err) {}
  };
}

function getLogLevel(line) {
  if (line.includes('[ERROR]')) return 'error';
  if (line.includes('\u26A0')) return 'warn';
  if (line.includes('[DEBUG]')) return 'debug';
  return 'info';
}

function createLogLineDiv(line) {
  var div = document.createElement('div');
  div.className = 'log-line log-' + getLogLevel(line);
  div.textContent = line;
  return div;
}

function shouldShowLogLine(line) {
  var level = getLogLevel(line);
  if (!consoleFilters[level]) return false;
  if (consoleSearchQuery) {
    var q = consoleSearchQuery.toLowerCase();
    if (line.toLowerCase().indexOf(q) < 0) return false;
  }
  return true;
}

function appendLogLine(container, line) {
  consoleAllLines.push(line);
  if (shouldShowLogLine(line)) {
    container.appendChild(createLogLineDiv(line));
    if (consoleAutoScroll) container.scrollTop = container.scrollHeight;
  }
}

function renderConsoleLogs() {
  var container = document.getElementById('log-container');
  if (!container) return;
  container.innerHTML = '';
  var fragment = document.createDocumentFragment();
  consoleAllLines.forEach(function(line) {
    if (shouldShowLogLine(line)) fragment.appendChild(createLogLineDiv(line));
  });
  container.appendChild(fragment);
  if (consoleAutoScroll) container.scrollTop = container.scrollHeight;
}

function toggleConsoleFilter(btn, level) {
  if (level === 'all') {
    consoleFilters = { error: true, warn: true, info: true, debug: true };
  } else {
    consoleFilters[level] = !consoleFilters[level];
  }
  document.querySelectorAll('.btn-filter').forEach(function(b) {
    var lvl = b.dataset.level;
    if (lvl === 'all') {
      b.classList.toggle('active', consoleFilters.error && consoleFilters.warn && consoleFilters.info && consoleFilters.debug);
    } else {
      b.classList.toggle('active', consoleFilters[lvl]);
    }
  });
  renderConsoleLogs();
}

function onConsoleSearch(val) {
  consoleSearchQuery = val;
  renderConsoleLogs();
}

async function clearConsole() {
  await apiDelete('/console-logs');
  consoleAllLines = [];
  document.getElementById('log-container').innerHTML = '';
  toast(t('consoleCleared'), 'info');
}
