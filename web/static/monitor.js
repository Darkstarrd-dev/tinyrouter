// ===================== Monitor Sub-View =====================

var monitorEventSource = null;
var monitorRunning = false;

function renderMonitorView(container) {
  container.innerHTML = '<div class="monitor-output" id="monitor-output"></div>';
}

function getLastMonitorCommand() {
  return localStorage.getItem('monitor_last_command') || 'nvidia-smi';
}

function updateMonitorButtonState() {
  var runBtn = document.getElementById('monitor-run-btn');
  var stopBtn = document.getElementById('monitor-stop-btn');
  var input = document.getElementById('monitor-command');
  if (runBtn && stopBtn && input) {
    runBtn.style.display = monitorRunning ? 'none' : '';
    stopBtn.style.display = monitorRunning ? '' : 'none';
    input.disabled = monitorRunning;
  }
}

function startMonitorCommand() {
  var input = document.getElementById('monitor-command');
  if (!input || !input.value.trim()) return;

  var fullCommand = input.value.trim();
  var parts = fullCommand.split(/\s+/);
  var command = parts[0];
  var args = parts.slice(1);

  localStorage.setItem('monitor_last_command', command);
  localStorage.setItem('monitor_last_args', JSON.stringify(args));

  var output = document.getElementById('monitor-output');
  if (output) output.innerHTML = '';

  withLoading(document.getElementById('monitor-run-btn'), function() {
    return apiPost('/monitor/start', { command: command, args: args }).then(function() {
      monitorRunning = true;
      updateMonitorButtonState();
      startMonitorStream();
      toast(t('monitorStarted'), 'success');
    }).catch(function(err) {
      toast(t('monitorStartFailed') + ': ' + (err && err.error ? err.error : ''), 'error');
    });
  });
}

function stopMonitorCommand() {
  apiPost('/monitor/stop', {}).then(function() {
    monitorRunning = false;
    updateMonitorButtonState();
    stopMonitorStream();
    toast(t('monitorStopped'), 'info');
  }).catch(function() {
    toast(t('monitorStopFailed'), 'error');
  });
}

function startMonitorStream() {
  stopMonitorStream();
  var output = document.getElementById('monitor-output');
  if (!output) return;

  monitorEventSource = new EventSource('/api/monitor/stream');
  monitorEventSource.onopen = function() {
    var status = document.getElementById('console-status');
    if (status) status.textContent = t('connected') || 'Connected';
  };
  monitorEventSource.onerror = function() {
    var status = document.getElementById('console-status');
    if (status) status.textContent = t('disconnected') || 'Disconnected';
  };
  monitorEventSource.onmessage = function(e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.type === 'line' && msg.line) {
        appendMonitorLine(output, msg.line);
      }
    } catch (err) {}
  };
}

function stopMonitorStream() {
  if (monitorEventSource) {
    monitorEventSource.close();
    monitorEventSource = null;
  }
}

function appendMonitorLine(container, line) {
  var div = document.createElement('div');
  div.className = 'monitor-line';
  div.textContent = line;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function clearMonitorOutput() {
  var output = document.getElementById('monitor-output');
  if (output) output.innerHTML = '';
}

function closeMonitorStream() {
  stopMonitorStream();
}

function cleanupMonitor() {
  monitorRunning = false;
  stopMonitorStream();
}
