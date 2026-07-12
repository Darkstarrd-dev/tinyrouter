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

// renderDownload renders the download page into the given container.
function renderDownload(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2>${escapeHtml(t('download'))}</h2>
    </div>
    <div class="card download-input-card">
      <div class="download-input-row">
        <input type="text" id="dl-url" class="input flex-1" placeholder="${escapeHtml(t('downloadUrlPlaceholder'))}" />
        <button class="btn btn-ghost" id="dl-parse-btn" type="button" onclick="parseDownloadUrl()">${escapeHtml(t('parse'))}</button>
        <button class="btn btn-primary" id="dl-start-btn" type="button" onclick="startDownload()">${escapeHtml(t('download'))}</button>
      </div>
      <div class="download-options-row">
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
        <label class="flex-1">${escapeHtml(t('downloadDir'))}
          <input type="text" id="dl-dir" class="input" placeholder="Downloads" />
        </label>
      </div>
      <div id="dl-info-preview" class="dl-info-preview" style="display:none;"></div>
    </div>
    <div class="card download-settings-card">
      <div class="download-options-row">
        <label class="flex-1">${escapeHtml(t('ytDlpPath'))}
          <input type="text" id="dl-ytdlp-path" class="input" placeholder="yt-dlp" />
        </label>
        <label class="flex-1">${escapeHtml(t('ffmpegPath'))}
          <input type="text" id="dl-ffmpeg-path" class="input" placeholder="ffmpeg" />
        </label>
        <label class="flex-1">${escapeHtml(t('defaultDir'))}
          <input type="text" id="dl-default-dir" class="input" placeholder="Downloads" />
        </label>
        <button class="btn btn-primary" id="dl-save-settings-btn" type="button" onclick="saveDownloadSettings()">${escapeHtml(t('save'))}</button>
      </div>
    </div>
    <div class="download-queue">
      <div class="download-queue-header">
        <h3>${escapeHtml(t('downloadQueue'))}</h3>
        <button class="btn btn-ghost btn-sm" type="button" onclick="clearCompletedDownloads()">${escapeHtml(t('clearCompleted'))}</button>
      </div>
      <div id="dl-tasks" class="dl-tasks"></div>
    </div>
  `;

  // Enter key in the URL field triggers parse.
  var urlInput = document.getElementById('dl-url');
  if (urlInput) {
    urlInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); parseDownloadUrl(); }
    });
  }

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
// from GET /api/settings and populates the inputs.
async function loadDownloadSettings() {
  var res = await apiGet('/settings');
  var dl = (res && res.download) || {};
  var ytInput = document.getElementById('dl-ytdlp-path');
  var ffInput = document.getElementById('dl-ffmpeg-path');
  var dirInput = document.getElementById('dl-default-dir');
  downloadDefaultDir = dl.defaultDir || '';
  if (ytInput) ytInput.value = dl.ytDlpPath || '';
  if (ffInput) ffInput.value = dl.ffmpegPath || '';
  if (dirInput) dirInput.value = dl.defaultDir || '';
}

// saveDownloadSettings persists the yt-dlp / ffmpeg paths and the default
// download directory via PATCH /api/settings.
async function saveDownloadSettings() {
  var ytInput = document.getElementById('dl-ytdlp-path');
  var ffInput = document.getElementById('dl-ffmpeg-path');
  var dirInput = document.getElementById('dl-default-dir');
  if (!ytInput || !ffInput || !dirInput) return;
  var body = {
    download: {
      ytDlpPath: ytInput.value || '',
      ffmpegPath: ffInput.value || '',
      defaultDir: dirInput.value || ''
    }
  };
  try {
    await apiPatch('/settings', body);
    toast(t('downloadSettingsSaved'), 'success');
  } catch (e) {
    toast(t('downloadSettingsSaveFailed', [e.message || String(e)]), 'error');
  }
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

// resolveDownloadDir returns the per-task dir if set, otherwise falls back to
// the persisted default dir input, then to the server default dir.
function resolveDownloadDir() {
  var dir = (document.getElementById('dl-dir') || {}).value || '';
  if (dir) return dir;
  dir = (document.getElementById('dl-default-dir') || {}).value || '';
  if (dir) return dir;
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
    return;
  }
  tasks.forEach(function(task) {
    downloadTasksMap[task.id] = task;
    renderDownloadTask(task, false);
  });
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

// renderDownloadTask creates (or replaces) the card for a task.
// If focusAfter is true the card is appended even when the list was empty.
function renderDownloadTask(task, _replaceEmpty) {
  var container = document.getElementById('dl-tasks');
  if (!container || !task || !task.id) return;
  // Clear the empty-state placeholder when the first task appears.
  if (container.querySelector('.empty')) container.innerHTML = '';
  downloadTasksMap[task.id] = task;
  var existing = downloadTaskEls[task.id];
  if (existing) {
    existing.outerHTML = taskCardHtml(task);
    downloadTaskEls[task.id] = document.querySelector('.dl-task-card[data-task-id="' + task.id + '"]');
    return;
  }
  var wrap = document.createElement('div');
  wrap.innerHTML = taskCardHtml(task);
  var card = wrap.firstElementChild;
  container.appendChild(card);
  downloadTaskEls[task.id] = card;
}

// updateDownloadTask reconciles an incoming task update from the SSE stream.
function updateDownloadTask(task) {
  if (!task || !task.id) return;
  var existing = downloadTaskEls[task.id];
  if (existing) {
    existing.outerHTML = taskCardHtml(task);
    downloadTaskEls[task.id] = document.querySelector('.dl-task-card[data-task-id="' + task.id + '"]');
  } else {
    renderDownloadTask(task, true);
  }
  downloadTasksMap[task.id] = task;
}

// taskCardHtml returns the outerHTML for a single task card.
function taskCardHtml(task) {
  var p = task.progress || {};
  var percent = typeof p.percent === 'number' ? p.percent : 0;
  if (percent < 0) percent = 0;
  if (percent > 1) percent = 1;
  var pctWidth = (percent * 100).toFixed(1) + '%';
  var pctText = formatProgress(percent);

  var status = task.status || 'pending';
  var statusKey = DL_STATUS_KEYS[status] || 'statusPending';
  var statusLabel = t(statusKey);

  var thumb = task.thumbnail ? '<img src="' + escapeHtml(task.thumbnail) + '" alt="" onerror="this.style.display=\'none\'">' : '';
  var title = task.title || task.url || task.id;

  var active = (status === 'pending' || status === 'downloading' || status === 'processing');
  var progressText = '';
  if (status === 'downloading' || status === 'processing') {
    var parts = [pctText];
    if (p.speedBytes) parts.push(formatSpeed(p.speedBytes));
    if (p.etaSeconds) parts.push('ETA ' + formatETA(p.etaSeconds));
    progressText = parts.join(' · ');
  }

  var actions = '';
  if (active) {
    actions = '<button class="btn btn-ghost btn-sm" type="button" onclick="cancelDownload(\'' + task.id + '\')">' + escapeHtml(t('cancelDownload')) + '</button>';
  } else {
    if (status === 'completed') {
      actions += '<button class="btn btn-ghost btn-sm" type="button" onclick="openDownloadDir(\'' + task.id + '\')">' + escapeHtml(t('openDir')) + '</button>';
    }
    actions += '<button class="btn btn-ghost btn-sm" type="button" onclick="removeDownload(\'' + task.id + '\')">' + escapeHtml(t('removeDownload')) + '</button>';
  }

  return '' +
    '<div class="dl-task-card" data-task-id="' + escapeAttr(task.id) + '">' +
      '<div class="dl-task-thumb">' + thumb + '</div>' +
      '<div class="dl-task-info">' +
        '<div class="dl-task-title">' + escapeHtml(title) + '</div>' +
        '<div class="dl-task-status">' +
          '<span class="dl-status-badge ' + escapeAttr('dl-status-' + status) + '">' + escapeHtml(statusLabel) + '</span>' +
          (progressText ? '<span class="dl-task-progress-text">' + escapeHtml(progressText) + '</span>' : '') +
          (task.error ? '<span class="dl-task-error">' + escapeHtml(task.error) + '</span>' : '') +
        '</div>' +
        '<div class="progress-bar"><div class="progress-bar-fill" style="width:' + pctWidth + '"></div></div>' +
        '<div class="dl-task-actions">' + actions + '</div>' +
      '</div>' +
    '</div>';
}

// cancelDownload cancels an in-progress task.
async function cancelDownload(taskId) {
  var res = await apiPost('/downloads/' + encodeURIComponent(taskId) + '/cancel', {});
  if (res && res.error) {
    toast(t('downloadFailed', [res.error]), 'error');
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
  var container = document.getElementById('dl-tasks');
  if (container && !Object.keys(downloadTaskEls).length) {
    container.innerHTML = emptyState(t('noDownloads'));
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
