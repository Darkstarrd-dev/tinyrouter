// web/static/download.js
// Video download page for TinyRouter.
// Uses the shared helpers from api.js (apiGet/apiPost/apiDelete) and
// app.js (t/escapeHtml/emptyState/toast/confirmModal).

var downloadEventSource = null;
// Map of task id -> task object, used to reconcile SSE updates and the REST list.
var downloadTasksMap = {};
// Map of task id -> rendered DOM element.
var downloadTaskEls = {};
// Persisted default download directory from the server settings.
var downloadDefaultDir = '';

// DL_STATUS_KEYS maps a raw TaskStatus to the i18n key for its label.
var DL_STATUS_KEYS = {
  pending: 'statusPending',
  downloading: 'statusDownloading',
  processing: 'statusProcessing',
  completed: 'statusCompleted',
  error: 'statusError',
  cancelled: 'statusCancelled'
};

// selectedTaskId tracks the task currently shown in the right-hand detail panel.
var selectedTaskId = '';

// renderDownload renders the download page into the given container.
function renderDownload(container) {
  container.innerHTML = `
    <div class="download-sections">
    <div class="card download-input-card">
      <div class="download-toolbar">
        <input type="text" id="dl-url" class="input" placeholder="${escapeHtml(t('downloadUrlPlaceholder'))}" />
        <button class="btn btn-ghost" id="dl-parse-btn" type="button" onclick="parseDownloadUrl()">${escapeHtml(t('parse'))}</button>
        <button class="btn btn-primary" id="dl-start-btn" type="button" onclick="startDownload()">${escapeHtml(t('download'))}</button>
        <label>${escapeHtml(t('type'))}
          <select id="dl-type" class="select">
            <option value="video">${escapeHtml(t('video'))}</option>
            <option value="audio">${escapeHtml(t('audio'))}</option>
          </select>
        </label>
        <label>${escapeHtml(t('quality'))}
          <select id="dl-quality" class="select">
            <option value="best">${escapeHtml(t('qualityBest'))}</option>
            <option value="good">1080p</option>
            <option value="normal">720p</option>
            <option value="bad">480p</option>
            <option value="worst">360p</option>
          </select>
        </label>
        <label>${escapeHtml(t('container'))}
          <select id="dl-container" class="select">
            <option value="auto">Auto (MP4/MKV)</option>
            <option value="mp4">MP4</option>
            <option value="mkv">MKV</option>
            <option value="webm">WebM</option>
            <option value="original">${escapeHtml(t('original'))}</option>
          </select>
        </label>
        <button class="btn btn-ghost btn-sm" type="button" onclick="openDownloadSettingsModal()">${escapeHtml(t('downloadSettings'))}</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="clearCompletedDownloads()">${escapeHtml(t('clearCompleted'))}</button>
      </div>
      <div id="dl-info-preview" class="dl-info-preview" style="display:none;"></div>
    </div>
    <div class="download-queue">
      <div id="dl-tasks" class="dl-tasks"></div>
    </div>
    </div>
  `;

  // Enter key in the URL field triggers parse.
  var urlInput = document.getElementById('dl-url');
  if (urlInput) {
    urlInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); parseDownloadUrl(); }
    });
  }

  selectedTaskId = '';
  loadDownloadTasks();
  connectDownloadSSE();
  loadDownloadSettings();
}

// parseDownloadUrl queries video/playlist info for the entered URL and
// renders a preview. For simplicity it tries both the single-video info
// endpoint and the playlist-info endpoint.
function parseDownloadUrl() {
  var url = (document.getElementById('dl-url') || {}).value;
  if (!url || !url.trim()) {
    toast(t('downloadUrlPlaceholder'), 'warning');
    return;
  }
  url = url.trim();
  var btn = document.getElementById('dl-parse-btn');
  return withLoading(btn, function() { return doParse(url); });
}

async function doParse(url) {
  showInfoPreview(null);
  var singleP = apiPost('/downloads/info', { url: url });
  var playlistP = apiPost('/downloads/playlist-info', { url: url });
  var results = await Promise.allSettled([singleP, playlistP]);
  var single = results[0].status === 'fulfilled' ? results[0].value : null;
  var playlist = results[1].status === 'fulfilled' ? results[1].value : null;

  // Prefer playlist view when the playlist endpoint returned entries.
  if (playlist && Array.isArray(playlist.entries) && playlist.entries.length > 0) {
    renderPlaylistPreview(url, playlist);
    return;
  }
  if (single && !single.error && (single.title || single.webpage_url || single.extractor_key)) {
    renderSinglePreview(url, single);
    return;
  }
  // Some servers return the single info nested under "info".
  if (single && !single.error && single.info) {
    renderSinglePreview(url, single.info);
    return;
  }
  var msg = (single && single.error) ? single.error : (playlist && playlist.error ? playlist.error : 'unknown');
  toast(t('parseFailed', [msg]), 'error');
}

// renderSinglePreview shows the parsed video info.
function renderSinglePreview(url, info) {
  var thumb = info.thumbnail || '';
  var title = info.title || url;
  var sub = [];
  if (info.duration) sub.push(formatDuration(info.duration));
  if (info.uploader) sub.push(info.uploader);
  showInfoPreview(`
    <div class="dl-info-row">
      <div class="dl-info-thumb">${thumb ? '<img src="' + escapeHtml(thumb) + '" alt="" onerror="this.style.display=\'none\'">' : ''}</div>
      <div class="dl-info-meta">
        <div class="dl-info-title">${escapeHtml(title)}</div>
        <div class="dl-info-sub">${escapeHtml(sub.join(' · '))}</div>
      </div>
      <button class="btn btn-primary btn-sm" type="button" onclick="startDownload()">${escapeHtml(t('download'))}</button>
    </div>
  `);
}

// renderPlaylistPreview shows the detected playlist with a selectable list of
// entries, so users can pick which ones to download.
function renderPlaylistPreview(url, playlist) {
  var title = playlist.title || url;
  var entries = playlist.entries || [];
  var count = entries.length;
  var rows = entries.map(function(entry) {
    var thumb = entry.thumbnail ? '<img src="' + escapeHtml(entry.thumbnail) + '" alt="" onerror="this.style.display=\'none\'">' : '';
    var label = entry.title || (playlist.url || url);
    return '' +
      '<div class="dl-playlist-entry">' +
        '<input type="checkbox" name="dl-playlist-select" data-index="' + escapeAttr(entry.index) + '" checked onchange="updatePlaylistSelectionLabel()" />' +
        '<div class="dl-playlist-entry-thumb">' + thumb + '</div>' +
        '<div class="dl-playlist-entry-title">' +
          '<span class="dl-playlist-entry-index">' + escapeHtml(entry.index) + '.</span> ' +
          escapeHtml(label) +
        '</div>' +
      '</div>';
  }).join('');

  showInfoPreview(`
    <div class="dl-playlist-preview">
      <div class="dl-info-row">
        <div class="dl-info-thumb dl-info-thumb-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        </div>
        <div class="dl-info-meta">
          <div class="dl-info-title">${escapeHtml(title)}</div>
          <div class="dl-info-sub">${escapeHtml(t('playlistDetected', [count]))}</div>
        </div>
      </div>
      <div class="dl-playlist-actions">
        <button class="btn btn-ghost btn-sm" type="button" onclick="setAllPlaylistSelected(true)">${escapeHtml(t('selectAll'))}</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick="setAllPlaylistSelected(false)">${escapeHtml(t('deselectAll'))}</button>
        <span class="dl-playlist-count" id="dl-playlist-count">${escapeHtml(t('nSelected', [count]))}</span>
        <button class="btn btn-primary btn-sm" type="button" onclick="startPlaylistDownload('${escapeAttr(url)}')">${escapeHtml(t('downloadSelected'))}</button>
      </div>
      <div class="dl-playlist-entries-heading">${escapeHtml(t('playlistEntries'))}</div>
      <div class="dl-playlist-entries">${rows}</div>
    </div>
  `);
}

// getSelectedPlaylistIndices returns the array of selected 1-based playlist indices.
function getSelectedPlaylistIndices() {
  var boxes = document.querySelectorAll('input[name="dl-playlist-select"]:checked');
  var idx = [];
  boxes.forEach(function(b) {
    var n = parseInt(b.getAttribute('data-index'), 10);
    if (!isNaN(n)) idx.push(n);
  });
  return idx;
}

// setAllPlaylistSelected checks or unchecks every playlist entry checkbox.
function setAllPlaylistSelected(checked) {
  var boxes = document.querySelectorAll('input[name="dl-playlist-select"]');
  boxes.forEach(function(b) { b.checked = !!checked; });
  updatePlaylistSelectionLabel();
}

// updatePlaylistSelectionLabel refreshes the "N selected" counter text.
function updatePlaylistSelectionLabel() {
  var el = document.getElementById('dl-playlist-count');
  if (!el) return;
  var n = getSelectedPlaylistIndices().length;
  el.textContent = t('nSelected', [n]);
}

// showInfoPreview fills the info preview area and reveals it.
function showInfoPreview(html) {
  var el = document.getElementById('dl-info-preview');
  if (!el) return;
  if (html === null) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.innerHTML = html;
  el.style.display = 'block';
}

// loadDownloadSettings fetches the download settings (yt-dlp / ffmpeg paths)
// and persists the default download directory used by resolveDownloadDir.
async function loadDownloadSettings() {
  var res = await apiGet('/settings');
  var dl = (res && res.download) || {};
  downloadDefaultDir = dl.defaultDir || '';
}

// fasBrowsePicker opens the system file/directory picker via the File System
// Access API and writes the selected name into the given input. The FAS API
// does not expose absolute paths, so only handle.name is stored (the backend
// resolves bare binary names via PATH lookup). User cancellations (AbortError)
// are ignored silently; other errors are surfaced via toast.
//   mode: 'file' -> showOpenFilePicker, 'directory' -> showDirectoryPicker
function fasBrowsePicker(inputEl, mode) {
  if (!inputEl) return;
  if (typeof window.showOpenFilePicker !== 'function' && typeof window.showDirectoryPicker !== 'function') {
    return;
  }
  var pick;
  if (mode === 'directory') {
    if (typeof window.showDirectoryPicker !== 'function') return;
    pick = window.showDirectoryPicker();
  } else {
    if (typeof window.showOpenFilePicker !== 'function') return;
    pick = window.showOpenFilePicker({ multiple: false });
  }
  pick.then(function(handle) {
    var single = Array.isArray(handle) ? handle[0] : handle;
    if (single && single.name) {
      inputEl.value = single.name;
    }
  }).catch(function(err) {
    if (err && err.name === 'AbortError') return; // user cancelled, ignore
    toast(t('downloadSettingsSaveFailed', [err && err.message ? err.message : String(err)]), 'error');
  });
}

// openDownloadSettingsModal shows a modal with the four download tool settings
// (yt-dlp / ffmpeg paths, default dir, proxy). Values are pre-populated from
// GET /settings and persisted via PATCH /settings on Save. The modal can be
// closed via the Cancel button, clicking the overlay, or pressing Escape.
// The yt-dlp / ffmpeg / default-dir rows additionally offer a "Browse" button
// backed by the File System Access API (when available).
async function openDownloadSettingsModal() {
  if (document.getElementById('dl-settings-overlay')) return;

  var dl = {};
  try {
    var res = await apiGet('/settings');
    dl = (res && res.download) || {};
  } catch (e) {
    dl = {};
  }

  var fasAvailable = typeof window.showOpenFilePicker === 'function' || typeof window.showDirectoryPicker === 'function';

  var overlay = document.createElement('div');
  overlay.className = 'dl-settings-modal';
  overlay.id = 'dl-settings-overlay';

  function browseRow(labelKey, inputId, value, placeholder, mode) {
    var browseBtn = fasAvailable
      ? '<button class="btn btn-ghost btn-sm dl-browse-btn" type="button" data-input="' + inputId + '" data-mode="' + mode + '">' + escapeHtml(t('browse')) + '</button>'
      : '';
    return '<div class="dl-settings-row">' +
      '<label>' + escapeHtml(t(labelKey)) +
        '<input type="text" class="input" id="' + inputId + '" value="' + escapeAttr(value) + '" placeholder="' + escapeAttr(placeholder) + '" />' +
      '</label>' +
      browseBtn +
    '</div>';
  }

  overlay.innerHTML = '' +
    '<div class="dl-settings-card">' +
      '<div class="dl-settings-modal-title">' + escapeHtml(t('downloadSettings')) + '</div>' +
      '<form class="dl-settings-form" id="dl-settings-form" onsubmit="return false;">' +
        browseRow('ytDlpPath', 'modal-dl-ytdlp-path', dl.ytDlpPath || '', 'yt-dlp', 'file') +
        browseRow('ffmpegPath', 'modal-dl-ffmpeg-path', dl.ffmpegPath || '', 'ffmpeg', 'file') +
        browseRow('defaultDir', 'modal-dl-default-dir', dl.defaultDir || '', 'Downloads', 'directory') +
        '<div class="dl-settings-row">' +
          '<label>' + escapeHtml(t('downloadProxy')) +
            '<input type="text" class="input" id="modal-dl-proxy" value="' + escapeAttr(dl.proxy || '') + '" placeholder="http://host:port" />' +
          '</label>' +
        '</div>' +
      '</form>' +
      '<div class="dl-settings-modal-actions">' +
        '<button class="btn btn-ghost" type="button" id="dl-settings-cancel">' + escapeHtml(t('cancel')) + '</button>' +
        '<button class="btn btn-primary" type="button" id="dl-settings-save">' + escapeHtml(t('save')) + '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  requestAnimationFrame(function() { overlay.classList.add('show'); });

  var keyHandler = null;
  function closeModal() {
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    overlay.classList.remove('show');
    overlay.addEventListener('transitionend', function() { overlay.remove(); }, { once: true });
  }

  function save() {
    var ytDlpPath = (document.getElementById('modal-dl-ytdlp-path') || {}).value || '';
    var ffmpegPath = (document.getElementById('modal-dl-ffmpeg-path') || {}).value || '';
    var defaultDir = (document.getElementById('modal-dl-default-dir') || {}).value || '';
    var proxy = (document.getElementById('modal-dl-proxy') || {}).value || '';
    apiPatch('/settings', { download: { ytDlpPath: ytDlpPath, ffmpegPath: ffmpegPath, defaultDir: defaultDir, proxy: proxy } })
      .then(function() {
        downloadDefaultDir = defaultDir;
        toast(t('downloadSettingsSaved'), 'success');
        closeModal();
      })
      .catch(function(e) {
        toast(t('downloadSettingsSaveFailed', [e && e.message ? e.message : String(e)]), 'error');
      });
  }

  document.getElementById('dl-settings-cancel').onclick = closeModal;
  document.getElementById('dl-settings-save').onclick = save;

  Array.prototype.forEach.call(overlay.querySelectorAll('.dl-browse-btn'), function(btn) {
    btn.addEventListener('click', function() {
      var target = document.getElementById(btn.getAttribute('data-input'));
      fasBrowsePicker(target, btn.getAttribute('data-mode'));
    });
  });
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });
  keyHandler = function(e) {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', keyHandler);
}

// startDownload creates a single download task from the current options.
async function startDownload() {
  var url = (document.getElementById('dl-url') || {}).value;
  if (!url || !url.trim()) {
    toast(t('downloadUrlPlaceholder'), 'warning');
    return;
  }
  var body = {
    url: url.trim(),
    type: (document.getElementById('dl-type') || {}).value || 'video',
    quality: (document.getElementById('dl-quality') || {}).value || 'best',
    container: (document.getElementById('dl-container') || {}).value || 'auto',
    downloadDir: resolveDownloadDir()
  };
  var res = await apiPost('/downloads', body);
  if (res && res.error) {
    toast(t('downloadFailed', [res.error]), 'error');
    return;
  }
  showInfoPreview(null);
  toast(t('downloadStarted'), 'success');
  if (res && res.id) {
    downloadTasksMap[res.id] = res;
    renderDownloadTask(res, true);
  }
}

// startPlaylistDownload creates a playlist batch download.
async function startPlaylistDownload(url) {
  if (!url) url = (document.getElementById('dl-url') || {}).value;
  if (!url || !url.trim()) {
    toast(t('downloadUrlPlaceholder'), 'warning');
    return;
  }
  var indices = getSelectedPlaylistIndices();
  if (indices.length === 0) {
    toast(t('noSelection'), 'warning');
    return;
  }
  var body = {
    url: url.trim(),
    type: (document.getElementById('dl-type') || {}).value || 'video',
    quality: (document.getElementById('dl-quality') || {}).value || 'best',
    container: (document.getElementById('dl-container') || {}).value || 'auto',
    downloadDir: resolveDownloadDir(),
    selectedIndices: indices
  };
  var res = await apiPost('/downloads/playlist', body);
  if (res && res.error) {
    toast(t('downloadFailed', [res.error]), 'error');
    return;
  }
  showInfoPreview(null);
  toast(t('downloadStarted'), 'success');
  // The backend may return a single id, a list of ids, or a status object.
  var ids = res && res.ids ? res.ids : (res && res.id ? [res.id] : []);
  if (ids.length) {
    ids.forEach(function(id) {
      downloadTasksMap[id] = { id: id, status: 'pending', url: url.trim() };
      renderDownloadTask(downloadTasksMap[id], true);
    });
  }
}

// resolveDownloadDir returns the persisted server default download dir.
// The per-task directory is no longer entered on the page; it is managed
// centrally in the Download Settings modal.
function resolveDownloadDir() {
  return downloadDefaultDir || '';
}

// loadDownloadTasks fetches the current task list from the REST API.
async function loadDownloadTasks() {
  var res = await apiGet('/downloads');
  var tasks = Array.isArray(res) ? res : (res && res.tasks ? res.tasks : []);
  var container = document.getElementById('dl-tasks');
  if (!container) return;
  container.innerHTML = '';
  downloadTasksMap = {};
  downloadTaskEls = {};
  if (!tasks.length) {
    container.innerHTML = emptyState(t('noDownloads'));
    selectedTaskId = '';
    return;
  }
  tasks.forEach(function(task) {
    downloadTasksMap[task.id] = task;
    renderDownloadTask(task, false);
  });
  // Default selection: first task (the one rendered first).
  if (!selectedTaskId && tasks.length) {
    selectTask(tasks[0].id);
  } else if (selectedTaskId) {
    renderTaskDetail();
  }
}

// connectDownloadSSE subscribes to the download event stream with auto-reconnect.
function connectDownloadSSE() {
  if (downloadEventSource) { downloadEventSource.close(); downloadEventSource = null; }
  try {
    downloadEventSource = new EventSource('/api/downloads/stream');
  } catch (e) {
    setTimeout(connectDownloadSSE, 3000);
    return;
  }
  downloadEventSource.onmessage = function(event) {
    if (!event || !event.data) return;
    var evt;
    try { evt = JSON.parse(event.data); } catch (e) { return; }
    if (evt && evt.type === 'task-updated' && evt.task) {
      updateDownloadTask(evt.task);
    }
  };
  downloadEventSource.onerror = function() {
    if (downloadEventSource) { downloadEventSource.close(); downloadEventSource = null; }
    setTimeout(connectDownloadSSE, 3000);
  };
}

// renderDownloadTask creates (or replaces) the left-side list item for a task
// and, if the task is the selected one, refreshes the detail panel. When the
// first task appears it also bootstraps the left/right split layout.
function renderDownloadTask(task, _replaceEmpty) {
  var container = document.getElementById('dl-tasks');
  if (!container || !task || !task.id) return;
  downloadTasksMap[task.id] = task;

  // Lazy-init the split layout (left list + right detail) on first task.
  if (!container.querySelector('.dl-task-split')) {
    container.innerHTML =
      '<div class="dl-task-split">' +
        '<div class="dl-task-list" id="dl-task-list"></div>' +
        '<div class="dl-task-detail" id="dl-task-detail"></div>' +
      '</div>';
  }

  var listEl = document.getElementById('dl-task-list');
  if (!listEl) return;

  var existing = downloadTaskEls[task.id];
  var itemHtml = taskListItemHtml(task);
  if (existing) {
    existing.outerHTML = itemHtml;
  } else {
    var tmp = document.createElement('div');
    tmp.innerHTML = itemHtml;
    var node = tmp.firstElementChild;
    // Keep list order aligned with insertion order (newest appended).
    listEl.appendChild(node);
  }
  downloadTaskEls[task.id] = document.getElementById('dl-task-item-' + task.id);

  // Default selection to the first task ever rendered.
  if (!selectedTaskId) {
    selectTask(task.id);
  } else if (task.id === selectedTaskId) {
    renderTaskDetail();
  }
}

// updateDownloadTask reconciles an incoming task update from the SSE stream.
function updateDownloadTask(task) {
  if (!task || !task.id) return;
  downloadTasksMap[task.id] = task;
  var existing = downloadTaskEls[task.id];
  if (!existing) {
    renderDownloadTask(task, true);
    return;
  }
  // Refresh the list item in place.
  existing.outerHTML = taskListItemHtml(task);
  downloadTaskEls[task.id] = document.getElementById('dl-task-item-' + task.id);
  // Refresh the detail panel if this is the selected task.
  if (task.id === selectedTaskId) {
    renderTaskDetail();
  }
}

// selectTask updates the selected task id, highlights the left list item and
// refreshes the right-hand detail panel.
function selectTask(taskId) {
  selectedTaskId = taskId;
  var list = document.getElementById('dl-task-list');
  if (list) {
    Array.prototype.forEach.call(list.querySelectorAll('.dl-task-item'), function(el) {
      el.classList.toggle('selected', el.getAttribute('data-task-id') === taskId);
    });
  }
  renderTaskDetail();
}

// renderTaskDetail renders the right-hand detail panel for the selected task.
function renderTaskDetail() {
  var detail = document.getElementById('dl-task-detail');
  if (!detail) return;
  var task = selectedTaskId ? downloadTasksMap[selectedTaskId] : null;
  detail.innerHTML = taskDetailHtml(task);
}

// taskListItemHtml returns the compact left-side list row for a task.
function taskListItemHtml(task) {
  var p = task.progress || {};
  var percent = typeof p.percent === 'number' ? p.percent : 0;
  if (percent < 0) percent = 0;
  if (percent > 1) percent = 1;
  var pctText = formatProgress(percent);

  var status = task.status || 'pending';
  var statusKey = DL_STATUS_KEYS[status] || 'statusPending';
  var statusLabel = t(statusKey);
  var title = task.title || task.url || task.id;
  var tid = escapeAttr(task.id);
  var isSelected = task.id === selectedTaskId ? ' selected' : '';

  // Action buttons only on terminal (and error/cancelled) states, plus a
  // cancel control while active.
  var actions = '';
  if (status === 'pending' || status === 'downloading' || status === 'processing') {
    actions = '<button class="btn btn-ghost btn-sm" type="button" onclick="cancelDownload(\'' + tid + '\')">' + escapeHtml(t('cancelDownload')) + '</button>';
  } else if (status === 'error' || status === 'cancelled') {
    actions = '<button class="btn btn-ghost btn-sm" type="button" onclick="retryDownload(\'' + tid + '\')">' + escapeHtml(t('retry')) + '</button>';
    actions += '<button class="btn btn-ghost btn-sm" type="button" onclick="removeDownload(\'' + tid + '\')">' + escapeHtml(t('removeDownload')) + '</button>';
  } else if (status === 'completed') {
    actions = '<button class="btn btn-ghost btn-sm" type="button" onclick="removeDownload(\'' + tid + '\')">' + escapeHtml(t('removeDownload')) + '</button>';
  }

  return '' +
    '<div class="dl-task-item' + isSelected + '" id="dl-task-item-' + tid + '" data-task-id="' + tid + '" onclick="selectTask(\'' + tid + '\')">' +
      '<div class="dl-task-item-main">' +
        '<div class="dl-task-item-title">' + escapeHtml(title) + '</div>' +
        '<div class="dl-task-item-meta">' +
          '<span class="dl-status-dot ' + escapeAttr('dl-status-' + status) + '"></span>' +
          '<span class="dl-task-item-pct">' + escapeHtml(pctText) + '</span>' +
          '<span class="dl-status-badge ' + escapeAttr('dl-status-' + status) + '">' + escapeHtml(statusLabel) + '</span>' +
        '</div>' +
      '</div>' +
      (actions ? '<div class="dl-task-item-actions">' + actions + '</div>' : '') +
    '</div>';
}

// taskDetailHtml returns the right-side detail panel HTML for a task.
function taskDetailHtml(task) {
  if (!task) {
    return '<div class="dl-detail-empty">' + escapeHtml(t('noDownloads')) + '</div>';
  }
  var p = task.progress || {};
  var percent = typeof p.percent === 'number' ? p.percent : 0;
  if (percent < 0) percent = 0;
  if (percent > 1) percent = 1;
  var pctText = formatProgress(percent);

  var status = task.status || 'pending';
  var statusKey = DL_STATUS_KEYS[status] || 'statusPending';
  var statusLabel = t(statusKey);
  var title = task.title || task.url || task.id;
  var thumb = task.thumbnail ? '<img src="' + escapeHtml(task.thumbnail) + '" alt="" onerror="this.style.display=\'none\'">' : '';
  var tid = escapeAttr(task.id);

  var statusDetail = '';
  if (status === 'pending') {
    statusDetail = t('statusPendingDetail');
  } else if (status === 'cancelled') {
    statusDetail = t('statusCancelledDetail');
  }

  var progressText = '';
  if (status === 'downloading' || status === 'processing') {
    var parts = [pctText];
    if (p.speedBytes) parts.push(formatSpeed(p.speedBytes));
    if (p.etaSeconds) parts.push('ETA ' + formatETA(p.etaSeconds));
    progressText = parts.join(' · ');
  }

  var actions = '';
  if (status === 'pending' || status === 'downloading' || status === 'processing') {
    actions = '<button class="btn btn-ghost btn-sm" type="button" onclick="cancelDownload(\'' + tid + '\')">' + escapeHtml(t('cancelDownload')) + '</button>';
    actions += '<button class="btn btn-ghost btn-sm" type="button" onclick="viewLog(\'' + tid + '\')">' + escapeHtml(t('viewLog')) + '</button>';
  } else if (status === 'error' || status === 'cancelled') {
    actions = '<button class="btn btn-ghost btn-sm" type="button" onclick="retryDownload(\'' + tid + '\')">' + escapeHtml(t('retry')) + '</button>';
    actions += '<button class="btn btn-ghost btn-sm" type="button" onclick="viewLog(\'' + tid + '\')">' + escapeHtml(t('viewLog')) + '</button>';
    actions += '<button class="btn btn-ghost btn-sm" type="button" onclick="removeDownload(\'' + tid + '\')">' + escapeHtml(t('removeDownload')) + '</button>';
  } else if (status === 'completed') {
    actions = '<button class="btn btn-ghost btn-sm" type="button" onclick="openDownloadDir(\'' + tid + '\')">' + escapeHtml(t('openDir')) + '</button>';
    actions += '<button class="btn btn-ghost btn-sm" type="button" onclick="viewLog(\'' + tid + '\')">' + escapeHtml(t('viewLog')) + '</button>';
    actions += '<button class="btn btn-ghost btn-sm" type="button" onclick="removeDownload(\'' + tid + '\')">' + escapeHtml(t('removeDownload')) + '</button>';
  }

  var urlRow = '<div class="dl-detail-url-label">' + escapeHtml(t('downloadUrlPlaceholder')) + '</div>' +
    '<div class="dl-detail-url" title="' + escapeAttr(task.url || '') + '">' + escapeHtml(task.url || '') + '</div>';

  var errorRow = task.error
    ? '<div class="dl-detail-error">' + escapeHtml(task.error) + '</div>'
    : '';

  var progressRow = progressText
    ? '<div class="dl-detail-progress">' + escapeHtml(progressText) + '</div>'
    : (statusDetail ? '<div class="dl-detail-status-detail">' + escapeHtml(statusDetail) + '</div>' : '');

  return '' +
    '<div class="dl-detail-card" data-task-id="' + tid + '">' +
      '<div class="dl-detail-thumb">' + thumb + '</div>' +
      '<div class="dl-detail-title">' + escapeHtml(title) + '</div>' +
      '<div class="dl-detail-status">' +
        '<span class="dl-status-badge ' + escapeAttr('dl-status-' + status) + '">' + escapeHtml(statusLabel) + '</span>' +
      '</div>' +
      progressRow +
      urlRow +
      errorRow +
      '<div class="dl-detail-actions">' + actions + '</div>' +
    '</div>';
}

// cancelDownload cancels an in-progress task.
async function cancelDownload(taskId) {
  var res = await apiPost('/downloads/' + encodeURIComponent(taskId) + '/cancel', {});
  if (res && res.error) {
    toast(t('downloadFailed', [res.error]), 'error');
  }
}

// retryDownload re-queues a failed or cancelled task using its original
// parameters. On success it toasts the same message as a fresh download.
async function retryDownload(taskId) {
  var task = downloadTasksMap[taskId];
  if (!task || !task.url) {
    toast(t('downloadFailed', ['task not found']), 'error');
    return;
  }
  var body = {
    url: task.url,
    type: task.type || 'video',
    quality: task.quality || 'best',
    container: task.container || 'auto',
    downloadDir: task.downloadDir || resolveDownloadDir()
  };
  try {
    var res = await apiPost('/downloads', body);
    if (res && res.error) {
      toast(t('downloadFailed', [res.error]), 'error');
      return;
    }
    toast(t('downloadStarted'), 'success');
  } catch (e) {
    toast(t('downloadFailed', [e && e.message ? e.message : String(e)]), 'error');
  }
}

// removeDownload removes a terminal task from the list.
async function removeDownload(taskId) {
  var res = await apiDelete('/downloads/' + encodeURIComponent(taskId));
  if (res && res.error) {
    toast(t('downloadFailed', [res.error]), 'error');
    return;
  }
  if (downloadTaskEls[taskId]) { downloadTaskEls[taskId].remove(); delete downloadTaskEls[taskId]; }
  delete downloadTasksMap[taskId];
  if (selectedTaskId === taskId) selectedTaskId = '';
  var container = document.getElementById('dl-tasks');
  if (container && !Object.keys(downloadTaskEls).length) {
    container.innerHTML = emptyState(t('noDownloads'));
    selectedTaskId = '';
    return;
  }
  // Pick a new selection if the removed one was selected.
  if (!selectedTaskId) {
    var firstId = Object.keys(downloadTaskEls)[0];
    selectTask(firstId);
  } else {
    renderTaskDetail();
  }
}

// clearCompletedDownloads removes all terminal tasks.
async function clearCompletedDownloads() {
  var res = await apiPost('/downloads/clear-completed', {});
  if (res && res.error) {
    toast(t('downloadFailed', [res.error]), 'error');
    return;
  }
  loadDownloadTasks();
}

// openDownloadDir copies the task's output path to the clipboard as a hint,
// since the browser cannot open a server-side folder directly.
function openDownloadDir(taskId) {
  var task = downloadTasksMap[taskId];
  var path = task && (task.filePath || task.savedFile || task.downloadDir);
  if (!path) { toast(t('downloadFailed', ['no path']), 'error'); return; }
  if (typeof copyToClipboard === 'function') {
    copyToClipboard(path, t('openDir'));
  } else {
    toast(path, 'info');
  }
}

// viewLog opens a modal displaying the yt-dlp log output for a task.
function viewLog(taskId) {
  if (document.getElementById('dl-log-overlay')) return;

  var overlay = document.createElement('div');
  overlay.className = 'dl-log-modal';
  overlay.id = 'dl-log-overlay';
  overlay.innerHTML = '' +
    '<div class="dl-log-card">' +
      '<div class="dl-log-modal-title">' +
        escapeHtml(t('viewLog')) +
        '<button class="dl-log-modal-close" id="dl-log-close" type="button">&times;</button>' +
      '</div>' +
      '<pre class="dl-log-content" id="dl-log-content">' + escapeHtml(t('loading')) + '...</pre>' +
    '</div>';

  document.body.appendChild(overlay);
  requestAnimationFrame(function() { overlay.classList.add('show'); });

  var keyHandler = null;
  function closeModal() {
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    overlay.classList.remove('show');
    overlay.addEventListener('transitionend', function() { overlay.remove(); }, { once: true });
  }

  document.getElementById('dl-log-close').onclick = closeModal;
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });
  keyHandler = function(e) {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', keyHandler);

  // Fetch the log content.
  fetch('/api/downloads/' + encodeURIComponent(taskId) + '/log')
    .then(function(resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.text();
    })
    .then(function(text) {
      var el = document.getElementById('dl-log-content');
      if (!el) return;
      if (!text || !text.trim()) {
        el.textContent = t('logEmpty');
      } else {
        el.textContent = text;
      }
    })
    .catch(function(err) {
      var el = document.getElementById('dl-log-content');
      if (el) el.textContent = t('downloadFailed', [err && err.message ? err.message : String(err)]);
    });
}

// formatBytes formats a byte count into a human-readable string.
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  if (i < 0) i = 0;
  if (i >= units.length) i = units.length - 1;
  var value = bytes / Math.pow(1024, i);
  return (i === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[i];
}

// formatSpeed formats a bytes/sec rate.
function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  return formatBytes(bytesPerSec) + '/s';
}

// formatETA formats a seconds count as HH:MM:SS or MM:SS.
function formatETA(seconds) {
  if (!seconds || seconds <= 0) return '';
  seconds = Math.round(seconds);
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s);
  return pad(m) + ':' + pad(s);
}

// formatDuration formats a seconds count as a media duration (H:MM:SS / M:SS).
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  seconds = Math.round(seconds);
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
  return m + ':' + pad(s);
}

// formatProgress formats a 0..1 fraction as a percentage string.
function formatProgress(percent) {
  var pct = (percent || 0) * 100;
  return pct.toFixed(1) + '%';
}

// escapeAttr escapes a value for safe inclusion in a double-quoted attribute.
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
