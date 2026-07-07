// pg-lifecycle.js
// ----- Entry: render the page --------------------------------------
function renderPlayground(container) {
  pgLoad();
  pgEnsureWindows();
  pgInitMarker();
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.innerHTML =
    '<div class="pg-layout">' +
      '<div class="pg-main">' +
        '<div class="pg-main-inner" id="pg-main-inner">' +
          '<div class="pg-panes" id="pg-panes"></div>' +
        '</div>' +
      '</div>' +
      '<div class="pg-input-bar" id="pg-inputbar"></div>' +
      '<div class="pg-side" id="pg-side"></div>' +
    '</div>';
  pgRenderSidebar();
  pgRenderPanes();
  pgRenderInputBar();
  pgLoadModels().then(function() { pgRenderSidebar(); pgRenderPanes(); });
}

function cleanupPlayground() {
  // Terminate auto chat loop before aborting requests.
  if (typeof pgAutoChatStop === 'function' && pgState.autoChat && pgState.autoChat.isRunning) {
    pgAutoChatStop();
  }
  for (var i = 0; i < pgState.windows.length; i++) {
    var w = pgWinAt(i);
    if (w.streaming) {
      if (w.abortCtrl) {
        try { w.abortCtrl.abort(); } catch (e) {}
        w.abortCtrl = null;
      }
      w.streaming = false;
    }
  }
}