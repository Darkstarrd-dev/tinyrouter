// ===================== Terminal Sub-View =====================

var terminalWebSocket = null;
var terminalSession = null;
var terminalFitAddon = null;

function renderTerminalView(container) {
  container.innerHTML = '<div id="terminal-container" class="xterm-container"><div id="terminal-xterm"></div></div>';
  setTimeout(initTerminal, 50);
}

function initTerminal() {
  var container = document.getElementById('terminal-xterm');
  if (!container) return;

  terminalSession = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
    theme: getTerminalTheme(),
    allowProposedApi: true
  });

  terminalFitAddon = new FitAddon.FitAddon();
  terminalSession.loadAddon(terminalFitAddon);

  terminalSession.open(container);
  try { terminalFitAddon.fit(); } catch(e) {}

  var wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  var wsUrl = wsProtocol + '//' + window.location.host + '/api/terminal/ws';

  terminalWebSocket = new WebSocket(wsUrl);

  terminalWebSocket.onopen = function() {
    terminalSession.writeln('\x1b[32mTerminal connected.\x1b[0m');
    sendTerminalResize();
  };

  terminalWebSocket.onmessage = function(event) {
    if (event.data instanceof Blob) {
      var reader = new FileReader();
      reader.onload = function() {
        terminalSession.write(new Uint8Array(reader.result));
      };
      reader.readAsArrayBuffer(event.data);
    } else if (typeof event.data === 'string') {
      terminalSession.write(event.data);
    }
  };

  terminalWebSocket.onerror = function() {
    terminalSession.writeln('\x1b[31mTerminal error.\x1b[0m');
  };

  terminalWebSocket.onclose = function() {
    terminalSession.writeln('\x1b[33mTerminal disconnected.\x1b[0m');
  };

  terminalSession.onData(function(data) {
    if (terminalWebSocket && terminalWebSocket.readyState === WebSocket.OPEN) {
      terminalWebSocket.send(data);
    }
  });

  window.addEventListener('resize', handleTerminalResize);
  terminalSession.onResize(function() {
    sendTerminalResize();
  });
}

function sendTerminalResize() {
  if (!terminalSession || !terminalFitAddon) return;
  if (!terminalWebSocket || terminalWebSocket.readyState !== WebSocket.OPEN) return;

  try { terminalFitAddon.fit(); } catch(e) {}
  var cols = terminalSession.cols;
  var rows = terminalSession.rows;

  var resizeMsg = new Uint8Array(5);
  resizeMsg[0] = 0x01;
  resizeMsg[1] = (rows >> 8) & 0xFF;
  resizeMsg[2] = rows & 0xFF;
  resizeMsg[3] = (cols >> 8) & 0xFF;
  resizeMsg[4] = cols & 0xFF;

  terminalWebSocket.send(resizeMsg);
}

var terminalResizeTimer = null;
function handleTerminalResize() {
  if (terminalResizeTimer) clearTimeout(terminalResizeTimer);
  terminalResizeTimer = setTimeout(function() {
    if (terminalFitAddon) {
      try { terminalFitAddon.fit(); } catch(e) {}
    }
  }, 100);
}

function getTerminalTheme() {
  var theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light') {
    return {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#333333',
      selection: 'rgba(0,0,255,0.2)'
    };
  }
  return {
    background: '#1a1a2e',
    foreground: '#e0e0e0',
    cursor: '#e0e0e0',
    selection: 'rgba(255,255,255,0.2)'
  };
}

function clearTerminalOutput() {
  if (terminalSession) {
    terminalSession.clear();
  }
}

function closeTerminalSession() {
  if (terminalWebSocket) {
    terminalWebSocket.close();
    terminalWebSocket = null;
  }
  if (terminalSession) {
    terminalSession.dispose();
    terminalSession = null;
  }
  terminalFitAddon = null;
  window.removeEventListener('resize', handleTerminalResize);
}

function cleanupTerminal() {
  closeTerminalSession();
}
