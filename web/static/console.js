// ===================== Console Page =====================

var consoleEventSource = null;
async function renderConsole(c) {
  c.innerHTML = '\
    <h2>' + t('console') + '</h2>\
    <div class="flex-between mb-12">\
      <span class="muted" id="console-status">' + t('connecting') + '</span>\
      <button class="btn btn-danger btn-sm" onclick="clearConsole()">' + t('clear') + '</button>\
    </div>\
    <div class="log-container" id="log-container"></div>';
  startConsoleStream();
}

function startConsoleStream() {
  if (consoleEventSource) consoleEventSource.close();
  const container = document.getElementById('log-container');
  const status = document.getElementById('console-status');

  apiGet('/console-logs').then(function(data) {
    (data.lines || []).forEach(function(line) { appendLogLine(container, line); });
  });

  consoleEventSource = new EventSource('/api/console-logs/stream');
  consoleEventSource.onopen = function() { status.textContent = t('connected'); };
  consoleEventSource.onerror = function() { status.textContent = t('disconnected'); };
  consoleEventSource.onmessage = function(e) {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'line' && msg.line) {
        appendLogLine(container, msg.line);
      }
    } catch (err) {}
  };
}

function appendLogLine(container, line) {
  const div = document.createElement('div');
  div.className = 'log-line log-info';
  if (line.includes('[ERROR]')) div.className = 'log-line log-error';
  else if (line.includes('\u26A0')) div.className = 'log-line log-warn';
  else if (line.includes('[DEBUG]')) div.className = 'log-line log-debug';
  div.textContent = line;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function clearConsole() {
  await apiDelete('/console-logs');
  document.getElementById('log-container').innerHTML = '';
  toast(t('consoleCleared'), 'info');
}
