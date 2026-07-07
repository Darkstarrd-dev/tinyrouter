// pg-autochat.js
// =====================================================================
// Auto Chat (群聊) mode — multi-window independent-iteration conversation.
//
// Each window has its OWN reply counter. When a window finishes a reply,
// it immediately broadcasts to other windows' inboxes and checks its own
// inbox. If it has pending messages and hasn't hit the iteration limit,
// it starts a new reply right away — without waiting for slower windows.
//
// An optional random delay (base ± 50%) is applied before each reply
// so that fast and slow models stagger naturally, like real chat.
//
// The conversation ends when ALL windows are either done (hit iteration
// limit) or idle with empty inboxes.
// =====================================================================

// ----- Toggle / config setters --------------------------------------

function pgAutoChatToggle(enabled) {
  if (enabled && pgState.splitCount < 2) {
    pgToast(pgT('pgAutoChatNeedMinWindows'), 'warning');
    pgRenderSidebar();
    return;
  }
  var wasRunning = pgState.autoChat.isRunning;
  pgState.autoChat.enabled = enabled;
  pgRenderSidebar();
  if (!enabled && wasRunning) {
    pgAutoChatStop();
  }
}

function pgAutoChatSetIterations(v) {
  pgState.autoChat.iterations = Math.max(0, parseInt(v, 10) || 0);
  pgSaveAutoChat();
  pgUpdateAutoChatUI();
}

function pgAutoChatSetUserName(v) {
  pgState.autoChat.userName = (v && v.trim()) ? v.trim() : 'User';
  pgSaveAutoChat();
}

function pgAutoChatSetDelay(v) {
  pgState.autoChat.delaySeconds = Math.max(0, parseFloat(v) || 0);
  pgSaveAutoChat();
}

function pgOnAgentName(v) {
  var w = pgWin();
  if (w) {
    w.config.agentName = v || '';
    pgSave();
    pgRenderPanes();
  }
}

// ----- Helpers -------------------------------------------------------

function pgAutoChatGetAgentName(winIdx) {
  var w = pgWinAt(winIdx);
  var cfgName = w && w.config.agentName ? w.config.agentName : '';
  return cfgName || ('Agent ' + (winIdx + 1));
}

// Indices of windows that currently have a model selected.
function pgAutoChatModelWindows() {
  var idx = [];
  for (var i = 0; i < pgState.splitCount; i++) {
    if (pgWinAt(i).config.model) idx.push(i);
  }
  return idx;
}

// Can this window still reply in auto-chat?
function pgAutoChatCanReply(winIdx) {
  var w = pgWinAt(winIdx);
  if (!w || !w.config.model) return false;
  if (w.streaming) return false;
  if (w.autoChatPending) return false;
  if (w.autoChatDone) return false;
  var iters = pgState.autoChat.iterations;
  if (iters > 0 && w.replyCount >= iters) return false;
  return true;
}

// ----- Start ---------------------------------------------------------

function pgAutoChatStart(text) {
  var modelWins = pgAutoChatModelWindows();
  if (!modelWins.length) {
    pgToast(pgT('pgSelectModel'), 'warning');
    return;
  }
  pgState.autoChat.isRunning = true;
  pgState.autoChat.abortFlag = false;

  var now = Date.now();
  var userLine = '[' + (pgState.autoChat.userName || 'User') + ']: ' + text;

  // Inject user message into every model window's inbox, then process.
  modelWins.forEach(function(i) {
    var w = pgWinAt(i);
    w.replyCount = 0;
    w.autoChatDone = false;
    w.autoChatPending = false;
    if (w.autoChatDelayTimer) { clearTimeout(w.autoChatDelayTimer); w.autoChatDelayTimer = null; }
    w.inbox = [];
    w.inbox.push({ sender: pgState.autoChat.userName || 'User', content: text, timestamp: now });
  });

  pgSave();
  if (pgState.activeWin < pgState.splitCount) pgRenderSidebar();
  pgRenderInputBar();

  // Kick off all windows that can reply.
  modelWins.forEach(function(i) {
    pgAutoChatProcessWindowInbox(i);
  });
  pgUpdateAutoChatUI();
}

// Schedule a reply for a single window. If a delay is configured, the
// actual send is deferred by a random duration (base ± 50%). Messages
// arriving during the delay accumulate in the inbox and are merged when
// the timer fires.
function pgAutoChatProcessWindowInbox(winIdx) {
  if (!pgAutoChatCanReply(winIdx)) return;
  var w = pgWinAt(winIdx);
  if (!w.inbox.length) return;

  var baseDelay = pgState.autoChat.delaySeconds || 0;
  if (baseDelay <= 0) {
    pgAutoChatDoSend(winIdx);
    return;
  }

  // Random delay: base * [0.5, 1.5] in milliseconds.
  var minMs = baseDelay * 500;
  var maxMs = baseDelay * 1500;
  var delay = minMs + Math.random() * (maxMs - minMs);

  w.autoChatPending = true;
  pgUpdateAutoChatUI();

  w.autoChatDelayTimer = setTimeout(function() {
    w.autoChatDelayTimer = null;
    w.autoChatPending = false;
    if (pgState.autoChat.abortFlag || !pgState.autoChat.isRunning) return;
    pgAutoChatDoSend(winIdx);
  }, delay);
}

// Actually merge inbox, push messages, and send (no delay).
function pgAutoChatDoSend(winIdx) {
  if (!pgAutoChatCanReply(winIdx)) return;
  var w = pgWinAt(winIdx);
  if (!w.inbox.length) {
    pgAutoChatCheckAllDone();
    return;
  }
  // Use the latest inbox timestamp so the same message injected into
  // multiple windows gets an identical createdAt (for dedup in group chat).
  var now = w.inbox.reduce(function(max, m) { return Math.max(max, m.timestamp); }, 0) || Date.now();
  var merged = w.inbox.map(function(m) {
    return '[' + m.sender + ']: ' + m.content;
  }).join('\n\n');
  w.inbox = [];
  w.messages.push({ role: 'user', content: merged, createdAt: now });
  w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: now });
  var lastIdx = w.messages.length - 1;
  pgRenderMessages(winIdx);
  pgSend(winIdx, lastIdx);
}

// ----- Finish hook (called from pgFinish / pgFail) -------------------

function pgAutoChatOnFinish(winIdx) {
  if (!pgState.autoChat || !pgState.autoChat.isRunning) return;
  if (pgState.autoChat.abortFlag) return;
  var w = pgWinAt(winIdx);
  if (!w) return;

  // Count this reply (completed = success or failure).
  w.replyCount++;

  // Check iteration limit.
  var iters = pgState.autoChat.iterations;
  if (iters > 0 && w.replyCount >= iters) {
    w.autoChatDone = true;
  }

  // Broadcast this window's reply to other windows that can still reply.
  var content = pgTextContent(w.messages[w.messages.length - 1].content);
  if (content && content.trim()) {
    var sender = pgAutoChatGetAgentName(winIdx);
    var ts = Date.now();
    for (var j = 0; j < pgState.splitCount; j++) {
      if (j === winIdx) continue;
      var other = pgWinAt(j);
      if (!other.config.model) continue;
      if (other.autoChatDone) continue;
      other.inbox.push({ sender: sender, content: content, timestamp: ts });
    }
  }

  pgUpdateAutoChatUI();
  pgRefreshGroupChatModal();

  // Try to process this window's own inbox (it may have received messages
  // while it was busy replying).
  pgAutoChatProcessWindowInbox(winIdx);

  // Try to process other idle windows' inboxes (they just received our broadcast).
  for (var k = 0; k < pgState.splitCount; k++) {
    if (k === winIdx) continue;
    pgAutoChatProcessWindowInbox(k);
  }

  // Check if the entire auto-chat should end.
  pgAutoChatCheckAllDone();
}

// Check if all windows are done (hit limit) or idle with empty inbox.
function pgAutoChatCheckAllDone() {
  var modelWins = pgAutoChatModelWindows();
  var allDone = modelWins.every(function(i) {
    var w = pgWinAt(i);
    // Still replying — not done.
    if (w.streaming) return false;
    // Reply scheduled (waiting for delay) — not done.
    if (w.autoChatPending) return false;
    // Hit iteration limit.
    if (w.autoChatDone) return true;
    // Idle but has pending inbox messages — will trigger soon.
    if (w.inbox.length > 0) return false;
    // Idle, no inbox, but can still reply (under limit) — waiting for
    // someone to say something. If EVERY window is in this state, nobody
    // will speak → conversation ends.
    return true;
  });
  if (allDone) {
    pgAutoChatFinish();
  }
}

// ----- Stop / finish -------------------------------------------------

function pgAutoChatClearWindowTimers() {
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    if (!w) continue;
    if (w.autoChatDelayTimer) { clearTimeout(w.autoChatDelayTimer); w.autoChatDelayTimer = null; }
    w.autoChatPending = false;
  }
}

function pgAutoChatStop() {
  pgState.autoChat.abortFlag = true;
  pgState.autoChat.isRunning = false;
  pgAutoChatClearWindowTimers();
  if (typeof pgStop === 'function') pgStop();
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    if (!w) continue;
    w.inbox = [];
    w.autoChatDone = false;
    w.replyCount = 0;
  }
  pgSave();
  pgRenderSidebar();
  pgRenderInputBar();
  pgUpdateAutoChatUI();
  pgToast(pgT('pgAutoChatStopped'), 'info');
}

function pgAutoChatFinish() {
  pgState.autoChat.isRunning = false;
  pgState.autoChat.abortFlag = false;
  pgAutoChatClearWindowTimers();
  var totalReplies = 0;
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    if (!w) continue;
    w.inbox = [];
    w.autoChatDone = false;
    totalReplies += w.replyCount;
    w.replyCount = 0;
  }
  pgSave();
  pgRenderSidebar();
  pgRenderInputBar();
  pgUpdateAutoChatUI();
  if (pgState.autoChat.iterations > 0) {
    pgToast(pgT('pgAutoChatFinished', [totalReplies]), 'success');
  } else {
    pgToast(pgT('pgAutoChatNoNewContent'), 'success');
  }
}

// ----- User send during auto chat -----------------------------------

function pgAutoChatUserSend(text) {
  if (pgState.autoChat.isRunning) {
    var now = Date.now();
    var modelWins = pgAutoChatModelWindows();
    modelWins.forEach(function(i) {
      var w = pgWinAt(i);
      if (w.autoChatDone) return;
      w.inbox.push({ sender: pgState.autoChat.userName || 'User', content: text, timestamp: now });
    });
    // Trigger any idle windows that can reply.
    modelWins.forEach(function(i) {
      pgAutoChatProcessWindowInbox(i);
    });
    pgUpdateAutoChatUI();
    pgRefreshGroupChatModal();
  } else {
    pgAutoChatStart(text);
  }
}

// ----- UI sync -------------------------------------------------------

function pgUpdateAutoChatUI() {
  var stopBtn = document.getElementById('pg-autochat-stop-btn');
  if (stopBtn) {
    if (pgState.autoChat.isRunning) stopBtn.classList.add('running');
    else stopBtn.classList.remove('running');
  }
  var hint = document.getElementById('pg-autochat-iterations-hint');
  if (hint) {
    if (!pgState.autoChat.isRunning) {
      hint.textContent = pgState.autoChat.iterations === 0
        ? pgT('pgAutoChatInfiniteWarn')
        : '';
    } else {
      // Build per-window progress string: "W1:3 W2:5 / 10"
      var parts = [];
      var modelWins = pgAutoChatModelWindows();
      var iters = pgState.autoChat.iterations;
      modelWins.forEach(function(i) {
        var w = pgWinAt(i);
        var suffix = w.autoChatPending ? '~' : (w.streaming ? '…' : '');
        parts.push('W' + (i + 1) + ':' + w.replyCount + suffix);
      });
      var limit = iters > 0 ? (' / ' + iters) : ' / ∞';
      hint.textContent = parts.join(' ') + limit;
    }
  }
}

// ----- Group chat modal (live-refreshing) ---------------------------

var pgGcRefreshTimer = null;

function pgGetGroupChatMessages() {
  var seen = {};
  var allMsgs = [];
  for (var i = 0; i < pgState.splitCount; i++) {
    var w = pgWinAt(i);
    if (!w) continue;
    var agentName = pgAutoChatGetAgentName(i);
    for (var j = 0; j < w.messages.length; j++) {
      var msg = w.messages[j];
      if (msg.status === 'loading') continue;
      var content = pgTextContent(msg.content);
      if (!content) continue;

      var sender, displayContent, isUser;
      if (msg.role === 'assistant') {
        sender = agentName;
        displayContent = content;
        isUser = false;
      } else {
        var match = content.match(/^\[([^\]]+)\]:\s*([\s\S]*)$/);
        if (match) {
          sender = match[1];
          displayContent = match[2];
          isUser = (sender === (pgState.autoChat.userName || 'User'));
        } else {
          sender = pgState.autoChat.userName || 'User';
          displayContent = content;
          isUser = true;
        }
      }

      // Deduplicate: same sender + content + timestamp = same message
      // appearing in multiple windows' histories.
      var dedupeKey = sender + '\x00' + displayContent + '\x00' + (msg.createdAt || msg.startedAt || 0);
      if (seen[dedupeKey]) continue;
      seen[dedupeKey] = true;

      allMsgs.push({
        sender: sender,
        content: displayContent,
        reasoning: msg.reasoning || '',
        timestamp: msg.createdAt || msg.startedAt || 0,
        winIdx: i,
        isUser: isUser,
      });
    }
  }
  allMsgs.sort(function(a, b) { return a.timestamp - b.timestamp; });
  return allMsgs;
}

function pgRenderGroupChatMessagesHtml(msgs) {
  return msgs.map(function(m) {
    var timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
    var cls = m.isUser ? 'pg-gc-msg user' : 'pg-gc-msg agent';
    return '<div class="' + cls + '">' +
      '<div class="pg-gc-sender">' + pgEscapeHtml(m.sender) +
      '<span class="pg-gc-time">' + timeStr + '</span></div>' +
      '<div class="pg-gc-content">' + pgRenderMarkdown(m.content) + '</div>' +
    '</div>';
  }).join('');
}

// Refresh the messages div if the group chat modal is open.
function pgRefreshGroupChatModal() {
  var box = document.getElementById('pg-gc-messages');
  if (!box) return;
  var msgs = pgGetGroupChatMessages();
  box.innerHTML = pgRenderGroupChatMessagesHtml(msgs);
  box.scrollTop = box.scrollHeight;
}

function pgOpenGroupChatModal() {
  // Clear any existing refresh timer.
  if (pgGcRefreshTimer) { clearInterval(pgGcRefreshTimer); pgGcRefreshTimer = null; }

  var msgs = pgGetGroupChatMessages();
  var msgsHtml = pgRenderGroupChatMessagesHtml(msgs);

  var html = '<div class="pg-modal-header">' +
    '<span class="pg-modal-title">💬 ' + pgEscapeHtml(pgT('pgGroupChatTitle')) + '</span>' +
    '<button class="pg-modal-close" onclick="pgCloseGroupChatModal()">✕</button>' +
  '</div>' +
  '<div class="pg-modal-body pg-gc-body">' +
    '<div class="pg-gc-messages" id="pg-gc-messages">' + msgsHtml + '</div>' +
    '<div class="pg-gc-input-bar">' +
      '<textarea class="pg-gc-input" id="pg-gc-input" placeholder="' + pgEscapeHtml(pgT('pgEnterMessage')) + '" onkeydown="pgOnGroupChatInputKey(event)"></textarea>' +
      '<button class="pg-send" onclick="pgGroupChatSend()">' + pgEscapeHtml(pgT('pgSendMessage')) + '</button>' +
    '</div>' +
  '</div>';

  pgShowModal(html);

  var box = document.getElementById('pg-gc-messages');
  if (box) box.scrollTop = box.scrollHeight;

  // Start live-refresh interval (self-cleaning when modal closes).
  pgGcRefreshTimer = setInterval(function() {
    var overlay = document.getElementById('pg-modal-overlay');
    if (!overlay || !overlay.classList.contains('show')) {
      clearInterval(pgGcRefreshTimer);
      pgGcRefreshTimer = null;
      return;
    }
    pgRefreshGroupChatModal();
  }, 500);
}

function pgCloseGroupChatModal() {
  if (pgGcRefreshTimer) { clearInterval(pgGcRefreshTimer); pgGcRefreshTimer = null; }
  pgCloseModal();
}

function pgGroupChatSend() {
  var ta = document.getElementById('pg-gc-input');
  if (!ta) return;
  var text = ta.value.trim();
  if (!text) return;
  ta.value = '';
  var mainTa = document.getElementById('pg-input');
  if (mainTa) mainTa.value = text;
  pgUserSend();
  // Immediate refresh; interval will keep it updated.
  pgRefreshGroupChatModal();
}

function pgOnGroupChatInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    pgGroupChatSend();
  }
}
