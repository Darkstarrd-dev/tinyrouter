// pg-autochat.js
// =====================================================================
// Auto Chat (群聊) mode — multi-window conversational loop.
// A user message is broadcast to every window that has a model; each
// window replies concurrently. The first finishers broadcast their reply
// into the inboxes of the other windows. A round completes when every
// window has replied; if there was new inbox content it triggers another
// round, until the iteration limit is reached or no new content exists.
// =====================================================================

// ----- Toggle / config setters --------------------------------------

function pgAutoChatToggle(enabled) {
  if (enabled && pgState.splitCount < 2) {
    pgToast(pgT('pgAutoChatNeedMinWindows'), 'warning');
    // revert checkbox visually on next sidebar render
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
  var hint = document.getElementById('pg-autochat-iterations-hint');
  if (hint) {
    if (pgState.autoChat.iterations === 0) {
      hint.textContent = pgT('pgAutoChatInfiniteWarn');
    } else {
      hint.textContent = pgT('pgAutoChatRound', ['0', pgState.autoChat.iterations]);
    }
  }
}

function pgAutoChatSetUserName(v) {
  pgState.autoChat.userName = (v && v.trim()) ? v.trim() : 'User';
  pgSaveAutoChat();
}

function pgOnAgentName(v) {
  var w = pgWin();
  if (w) {
    w.config.agentName = v || '';
    pgSave();
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

// ----- Start / round orchestration ----------------------------------

function pgAutoChatStart(text) {
  var modelWins = pgAutoChatModelWindows();
  if (!modelWins.length) {
    pgToast(pgT('pgSelectModel'), 'warning');
    return;
  }
  pgState.autoChat.isRunning = true;
  pgState.autoChat.abortFlag = false;
  pgState.autoChat.currentRound = 0;

  var now = Date.now();
  var userLine = '[' + (pgState.autoChat.userName || 'User') + ']: ' + text;

  modelWins.forEach(function(i) {
    var w = pgWinAt(i);
    w.messages.push({ role: 'user', content: userLine, createdAt: now });
    w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: now });
  });

  pgSave();
  if (pgState.activeWin < pgState.splitCount) pgRenderSidebar();
  pgRenderInputBar();

  modelWins.forEach(function(i) {
    var w = pgWinAt(i);
    var lastIdx = w.messages.length - 1;
    pgRenderMessages(i);
    w.autoChatReplied = false;
    pgSend(i, lastIdx);
  });
  pgUpdateAutoChatUI();
}

function pgAutoChatOnFinish(winIdx) {
  var w = pgWinAt(winIdx);
  if (!w) return;
  if (w.autoChatReplied) return; // guard double-call
  w.autoChatReplied = true;

  // Broadcast this window's reply into other windows' inboxes.
  var content = pgTextContent(w.messages[w.messages.length - 1].content);
  if (content && content.trim()) {
    var sender = pgAutoChatGetAgentName(winIdx);
    var ts = Date.now();
    for (var j = 0; j < pgState.splitCount; j++) {
      if (j === winIdx) continue;
      if (!pgWinAt(j).config.model) continue;
      pgWinAt(j).inbox.push({ sender: sender, content: content, timestamp: ts });
    }
  }
  pgAutoChatCheckRoundComplete();
}

function pgAutoChatCheckRoundComplete() {
  var modelWins = pgAutoChatModelWindows();
  var allDone = modelWins.every(function(i) { return pgWinAt(i).autoChatReplied; });
  if (!allDone) return;

  pgState.autoChat.currentRound++;
  pgUpdateAutoChatUI();

  var iters = pgState.autoChat.iterations;
  if (iters > 0 && pgState.autoChat.currentRound >= iters) {
    pgAutoChatFinish();
    return;
  }
  pgAutoChatProcessInboxes();
}

function pgAutoChatProcessInboxes() {
  var modelWins = pgAutoChatModelWindows();
  var anyNew = false;
  var now = Date.now();

  modelWins.forEach(function(i) {
    var w = pgWinAt(i);
    w.autoChatReplied = false;
    if (w.inbox.length) {
      anyNew = true;
      var merged = w.inbox.map(function(m) {
        return '[' + m.sender + ']: ' + m.content;
      }).join('\n\n');
      w.messages.push({ role: 'user', content: merged, createdAt: now });
      w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: now });
      w.inbox = [];
      var lastIdx = w.messages.length - 1;
      pgRenderMessages(i);
      pgSend(i, lastIdx);
    }
  });

  if (!anyNew) {
    pgAutoChatFinish();
  }
}

// ----- Stop / finish -------------------------------------------------

function pgAutoChatStop() {
  pgState.autoChat.abortFlag = true;
  pgState.autoChat.isRunning = false;
  // abort in-flight requests
  if (typeof pgStop === 'function') pgStop();
  for (var i = 0; i < pgState.splitCount; i++) {
    pgWinAt(i).inbox = [];
    pgWinAt(i).autoChatReplied = false;
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
  for (var i = 0; i < pgState.splitCount; i++) {
    pgWinAt(i).inbox = [];
    pgWinAt(i).autoChatReplied = false;
  }
  pgSave();
  pgRenderSidebar();
  pgRenderInputBar();
  pgUpdateAutoChatUI();
  if (pgState.autoChat.iterations > 0) {
    pgToast(pgT('pgAutoChatFinished', [pgState.autoChat.currentRound]), 'success');
  } else {
    pgToast(pgT('pgAutoChatNoNewContent'), 'success');
  }
}

// ----- User send during auto chat -----------------------------------

function pgAutoChatUserSend(text) {
  if (pgState.autoChat.isRunning) {
    var userLine = '[' + (pgState.autoChat.userName || 'User') + ']: ' + text;
    var anyIdle = false;
    for (var i = 0; i < pgState.splitCount; i++) {
      var w = pgWinAt(i);
      if (!w.config.model) continue;
      if (w.streaming) {
        w.inbox.push({ sender: pgState.autoChat.userName || 'User', content: text, timestamp: Date.now() });
      } else {
        anyIdle = true;
      }
    }
    if (anyIdle) {
      // merge immediate user message into idle windows and kick a round
      pgAutoChatProcessUserImmediate(userLine);
    }
  } else {
    pgAutoChatStart(text);
  }
}

// Inject a user line directly into idle windows (no inbox delay) and
// trigger a new round. Windows currently streaming keep the message in inbox.
function pgAutoChatProcessUserImmediate(userLine) {
  var now = Date.now();
  var modelWins = pgAutoChatModelWindows();
  var anyNew = false;
  modelWins.forEach(function(i) {
    var w = pgWinAt(i);
    if (w.streaming) return;
    w.autoChatReplied = false;
    w.messages.push({ role: 'user', content: userLine, createdAt: now });
    w.messages.push({ role: 'assistant', content: '', reasoning: '', status: 'loading', startedAt: now });
    w.inbox = [];
    var lastIdx = w.messages.length - 1;
    pgRenderMessages(i);
    anyNew = true;
    pgSend(i, lastIdx);
  });
  if (!anyNew) {
    // all busy; wait for finish hooks to process inbox
    return;
  }
  pgState.autoChat.isRunning = true;
  if (pgState.autoChat.currentRound === 0) pgState.autoChat.currentRound = 1;
  pgUpdateAutoChatUI();
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
    if (pgState.autoChat.iterations === 0) {
      hint.textContent = pgT('pgAutoChatInfiniteWarn');
    } else {
      hint.textContent = pgT('pgAutoChatRound', [pgState.autoChat.currentRound, pgState.autoChat.iterations]);
    }
  }
}

// ----- Group chat modal ---------------------------------------------

function pgOpenGroupChatModal() {
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

      var sender, displayContent;
      if (msg.role === 'assistant') {
        sender = agentName;
        displayContent = content;
      } else {
        var match = content.match(/^\[([^\]]+)\]:\s*([\s\S]*)$/);
        if (match) {
          sender = match[1];
          displayContent = match[2];
        } else {
          sender = pgState.autoChat.userName || 'User';
          displayContent = content;
        }
      }

      var isUser = msg.role === 'user' && !content.match(/^\[([^\]]+)\]:/);
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

  var msgsHtml = allMsgs.map(function(m) {
    var timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
    var cls = m.isUser ? 'pg-gc-msg user' : 'pg-gc-msg agent';
    return '<div class="' + cls + '">' +
      '<div class="pg-gc-sender">' + pgEscapeHtml(m.sender) +
      '<span class="pg-gc-time">' + timeStr + '</span></div>' +
      '<div class="pg-gc-content">' + pgRenderMarkdown(m.content) + '</div>' +
    '</div>';
  }).join('');

  var html = '<div class="pg-modal-header">' +
    '<span class="pg-modal-title">💬 ' + pgEscapeHtml(pgT('pgGroupChatTitle')) + '</span>' +
    '<button class="pg-modal-close" onclick="pgCloseModal()">✕</button>' +
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
  pgOpenGroupChatModal();
}

function pgOnGroupChatInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    pgGroupChatSend();
  }
}
