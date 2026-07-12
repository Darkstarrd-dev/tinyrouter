// ===================== Terminal Sub-View =====================

var terminalWebSocket = null;
var terminalSession = null;
var terminalFitAddon = null;
var terminalDetachedContainer = null;

function renderTerminalView(container) {
  if (terminalSession && terminalWebSocket && terminalWebSocket.readyState === WebSocket.OPEN) {
    var wrapper = document.createElement('div');
    wrapper.className = 'xterm-container';
    wrapper.id = 'terminal-container';
    wrapper.appendChild(terminalDetachedContainer);
    container.innerHTML = '';
    container.appendChild(wrapper);
    requestAnimationFrame(function() {
      try { terminalFitAddon.fit(); } catch(e) {}
      terminalSession.focus();
    });
    return;
  }
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
  requestAnimationFrame(function() {
    try { terminalFitAddon.fit(); } catch(e) {}
  });

  // Enable copy-to-clipboard for selected text via Ctrl+C / Ctrl+Shift+C.
  // xterm.js captures keyboard events, so the browser's native Ctrl+C
  // doesn't reach the clipboard. This handler intercepts it, copies the
  // current selection, and prevents the keypress from being sent to the
  // shell when there is an active selection.
  terminalSession.attachCustomKeyEventHandler(function(ev) {
    var isCopy = (ev.ctrlKey && (ev.key === 'c' || ev.key === 'C')) ||
                 (ev.ctrlKey && ev.shiftKey && (ev.key === 'c' || ev.key === 'C'));
    if (!isCopy) return true;
    var sel = terminalSession.getSelection();
    if (sel && sel.length > 0) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sel);
      } else {
        // Fallback for browsers without async clipboard API
        var ta = document.createElement('textarea');
        ta.value = sel;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch(e2) {}
        document.body.removeChild(ta);
      }
      return false; // don't send Ctrl+C to the shell
    }
    return true; // no selection → let Ctrl+C go to the shell as SIGINT
  });

  var wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  var wsUrl = wsProtocol + '//' + window.location.host + '/api/terminal/ws';

  terminalWebSocket = new WebSocket(wsUrl);

  terminalWebSocket.onopen = function() {
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
    if (terminalSession) terminalSession.writeln('\x1b[31mTerminal error.\x1b[0m');
  };

  terminalWebSocket.onclose = function() {
    if (terminalSession) terminalSession.writeln('\x1b[33mTerminal disconnected.\x1b[0m');
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

// getTerminalTheme returns opaque color values matching the project's
// console/monitor background and text colors.
//
// Previously this read the --log-bg CSS variable, but that value is
// semi-transparent (rgba(0,0,0,0.4) for dark, rgba(0,0,0,0.03) for light).
// xterm.js requires an opaque background color for its canvas renderer;
// semi-transparent values cause it to fall back to a default solid black,
// which is especially visible in light theme.
function getTerminalTheme() {
  var theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light') {
    return {
      background: '#f5f7fa',
      foreground: '#333333',
      cursor: '#333333',
      selection: 'rgba(0,0,255,0.2)'
    };
  }
  return {
    background: '#0d0d14',
    foreground: '#f0f0f0',
    cursor: '#f0f0f0',
    selection: 'rgba(255,255,255,0.2)'
  };
}

function clearTerminalOutput() {
  if (terminalSession) {
    terminalSession.clear();
  }
}

function detachTerminalView() {
  if (!terminalSession) return;
  var wrapper = document.getElementById('terminal-container');
  if (wrapper) {
    var xt = document.getElementById('terminal-xterm');
    if (xt) {
      terminalDetachedContainer = xt;
      if (xt.parentNode) xt.parentNode.removeChild(xt);
    }
  }
  if (terminalDetachedContainer && terminalDetachedContainer.parentNode) {
    terminalDetachedContainer.parentNode.removeChild(terminalDetachedContainer);
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
  terminalDetachedContainer = null;
  window.removeEventListener('resize', handleTerminalResize);
}

function stopTerminalSession() {
  apiPost('/terminal/stop', {}).then(function() {}).catch(function() {});
  closeTerminalSession();
  if (consoleSubView === 'terminal') {
    switchConsoleTab('logs');
  }
}

function cleanupTerminal() {
  detachTerminalView();
}
