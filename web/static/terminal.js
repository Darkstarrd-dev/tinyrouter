// ===================== Terminal Sub-View =====================

var terminalWebSocket = null;
var terminalSession = null;
var terminalDetachedContainer = null;

function renderTerminalView(container) {
  if (terminalSession && terminalWebSocket && terminalWebSocket.readyState === WebSocket.OPEN) {
    var wrapper = document.createElement('div');
    wrapper.className = 'xterm-container';
    wrapper.id = 'terminal-container';
    wrapper.appendChild(terminalDetachedContainer);
    container.innerHTML = '';
    container.appendChild(wrapper);
    setTimeout(function() {
      doFit();
      terminalSession.focus();
    }, 100);
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

  terminalSession.open(container);
  setTimeout(doFit, 100);

  terminalSession.attachCustomKeyEventHandler(function(ev) {
    var isCopy = (ev.ctrlKey && (ev.key === 'c' || ev.key === 'C')) ||
                 (ev.ctrlKey && ev.shiftKey && (ev.key === 'c' || ev.key === 'C'));
    if (!isCopy) return true;
    var sel = terminalSession.getSelection();
    if (sel && sel.length > 0) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sel);
      } else {
        var ta = document.createElement('textarea');
        ta.value = sel;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch(e2) {}
        document.body.removeChild(ta);
      }
      return false;
    }
    return true;
  });

  var wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  var wsUrl = wsProtocol + '//' + window.location.host + '/api/terminal/ws';

  terminalWebSocket = new WebSocket(wsUrl);

  terminalWebSocket.onopen = function() {
    setTimeout(function() {
      doFit();
      sendTerminalResize();
      terminalSession.focus();
    }, 50);
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

// doFit manually calculates cols/rows from the container dimensions and
// the current cell size, then calls terminal.resize().
//
// This replaces the FitAddon which uses _core._renderService.dimensions —
// an internal API that changed in xterm.js 6.0, causing fit() to silently
// fail and leaving the terminal at its default 80×24 size.
//
// Cell size is derived from the rendered .xterm-screen element:
//   cellWidth = screenWidth  / terminal.cols
//   cellHeight = screenHeight / terminal.rows
// Then:
//   cols = floor((containerWidth  - scrollbarW) / cellWidth)
//   rows = floor(containerHeight / cellHeight)
function doFit() {
  if (!terminalSession) return;
  var container = document.getElementById('terminal-xterm');
  if (!container) return;

  var screenEl = container.querySelector('.xterm-screen');
  if (!screenEl) return;
  var sRect = screenEl.getBoundingClientRect();
  var cellW = terminalSession.cols > 0 ? sRect.width / terminalSession.cols : 0;
  var cellH = terminalSession.rows > 0 ? sRect.height / terminalSession.rows : 0;
  if (cellW <= 0 || cellH <= 0) return;

  var cRect = container.getBoundingClientRect();
  var xtermEl = container.querySelector('.xterm');
  var padX = 0, padY = 0;
  if (xtermEl) {
    var xs = window.getComputedStyle(xtermEl);
    padX = (parseFloat(xs.paddingLeft) || 0) + (parseFloat(xs.paddingRight) || 0);
    padY = (parseFloat(xs.paddingTop) || 0) + (parseFloat(xs.paddingBottom) || 0);
  }

  var availW = cRect.width - padX;
  var availH = cRect.height - padY;

  var viewport = container.querySelector('.xterm-viewport');
  var scrollbarW = 0;
  if (viewport) {
    scrollbarW = viewport.offsetWidth - viewport.clientWidth;
    if (scrollbarW <= 0) scrollbarW = 15;
  }

  var cols = Math.max(2, Math.floor((availW - scrollbarW) / cellW));
  var rows = Math.max(1, Math.floor(availH / cellH));

  if (cols !== terminalSession.cols || rows !== terminalSession.rows) {
    terminalSession.resize(cols, rows);
  }
}

function sendTerminalResize() {
  if (!terminalSession) return;
  if (!terminalWebSocket || terminalWebSocket.readyState !== WebSocket.OPEN) return;

  doFit();
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
    doFit();
  }, 100);
}

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
