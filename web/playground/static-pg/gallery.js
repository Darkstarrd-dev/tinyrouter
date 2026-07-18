// gallery.js — Gallery image viewer for TinyRouter (playground build only).

(function() {
  'use strict';

  // ---------- helpers ----------------------------------------------
  var SUPPORTED_EXTS = ['webp', 'png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif'];
  var AUTOPLAY_INTERVALS = [1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, 120000]; // ms
  var AUTOPLAY_LABELS = ['1s', '2s', '3s', '5s', '10s', '15s', '30s', '60s', '120s'];
  var THUMB_SIZE = 300;

  function isSupportedExt(name) {
    if (!name) return false;
    var dot = name.lastIndexOf('.');
    if (dot < 0) return false;
    var ext = name.slice(dot + 1).toLowerCase();
    return SUPPORTED_EXTS.indexOf(ext) >= 0;
  }

  function isZipName(name) {
    if (!name) return false;
    var lower = name.toLowerCase();
    return lower.endsWith('.zip');
  }

  function extOf(name) {
    if (!name) return '';
    var dot = name.lastIndexOf('.');
    if (dot < 0) return '';
    return name.slice(dot + 1).toLowerCase();
  }

  function isTiff(name) {
    var ext = extOf(name);
    return ext === 'tiff' || ext === 'tif';
  }

  function T(key) {
    return (typeof t === 'function') ? t(key) : key;
  }

  function prettySize(n) {
    if (!n && n !== 0) return '';
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var i = -1;
    do {
      n /= 1024;
      i++;
    } while (n >= 1024 && i < units.length - 1);
    return n.toFixed(n < 10 ? 1 : 0) + ' ' + units[i];
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function naturalComparePath(pathA, pathB) {
    var segsA = (pathA || '').split('/');
    var segsB = (pathB || '').split('/');
    var minLen = Math.min(segsA.length, segsB.length);

    for (var i = 0; i < minLen; i++) {
      var a = segsA[i];
      var b = segsB[i];
      if (a !== b) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      }
    }
    return segsA.length - segsB.length;
  }

  function sortItems(items) {
    items.sort(function(a, b) {
      return naturalComparePath(a.path, b.path);
    });
  }

  function showMsg(text) {
    var el = document.getElementById('gallery-toolbar-msg');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? '' : 'none';
    if (showMsg._timer) clearTimeout(showMsg._timer);
    if (text) {
      showMsg._timer = setTimeout(function() {
        el.textContent = '';
        el.style.display = 'none';
      }, 3000);
    }
  }

  // ---------- state ------------------------------------------------
  var state = {
    items: [],
    index: -1,
    autoplayTimer: null,
    autoplayOn: false,
    autoplayInterval: 3000, // ms, default 3rd gear
    mainURL: null,
    fullscreenEl: null,
    keyHandler: null,
    fsChangeHandler: null,
    contextMenuHandler: null,
    pasteHandler: null,
    pageKeyHandler: null,
    zipSessionId: null,
    zipEntriesCache: null,
    pendingZipQueue: [],
    loadingZip: false,
    objectURLs: [],
    thumbObserver: null,
    container: null,
    treeOpen: false,
    curDirPath: '',
    dirMap: {},
    dirPathList: [],
    currentFolderIndices: [],
    currentSubIndex: -1
  };

  function trackURL(url) {
    if (url) state.objectURLs.push(url);
    return url;
  }

  function clearObjectURLs() {
    for (var i = 0; i < state.objectURLs.length; i++) {
      try { URL.revokeObjectURL(state.objectURLs[i]); } catch (e) {}
    }
    state.objectURLs = [];
    state.mainURL = null;
  }

  // ---------- item accessors ---------------------------------------
  function getItemBlob(item) {
    if (!item) return Promise.resolve(null);
    if (typeof item.getBlob === 'function') return Promise.resolve(item.getBlob());
    try {
      if (item.kind === 'fs' && item.handle) {
        return item.handle.getFile();
      }
      if (item.kind === 'plain') {
        return Promise.resolve(item.file);
      }
      if (item.kind === 'zip') {
        var sid = item.sessionId || state.zipSessionId;
        var identifier = (typeof item.index === 'number' && item.index >= 0) ? String(item.index) : (item.path || '').split('/').map(encodeURIComponent).join('/');
        var url = '/api/gallery/zip/' + encodeURIComponent(sid) + '/' + identifier;
        return fetch(url).then(function(r) {
          if (!r.ok) throw new Error('zip entry http ' + r.status);
          return r.blob();
        });
      }
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(null);
  }

  async function ensureMainSrc(item) {
    if (!item) return;
    try {
      if (item.mainURL) return;
      var blob;
      if (isTiff(item.name)) {
        blob = await getItemBlob(item);
        if (!blob) return;
        var conv = await fetch('/api/gallery/tiff', {
          method: 'POST',
          body: blob
        });
        if (!conv.ok) throw new Error('tiff http ' + conv.status);
        blob = await conv.blob();
      } else {
        blob = await getItemBlob(item);
      }
      if (!blob) return;
      item.mainURL = trackURL(URL.createObjectURL(blob));
    } catch (e) {
      console.warn('ensureMainSrc failed:', e);
    }
  }

  async function ensureThumb(item) {
    if (!item || item.thumbReady) return;
    try {
      var blob = await getItemBlob(item);
      if (!blob) return;
      var url;
      try {
        var bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        var maxDim = THUMB_SIZE;
        var scale = Math.min(maxDim / bitmap.width, maxDim / bitmap.height);
        var w = Math.round(bitmap.width * scale);
        var h = Math.round(bitmap.height * scale);
        var canvas = new OffscreenCanvas(w, h);
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close && bitmap.close();
        var tblob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        url = trackURL(URL.createObjectURL(tblob));
      } catch (e) {
        url = trackURL(URL.createObjectURL(blob));
      }
      item.thumbURL = url;
      item.thumbReady = true;
      var imgEl = item.thumbImgEl;
      if (imgEl) imgEl.src = url;
    } catch (e) {
      console.warn('ensureThumb failed:', e);
    }
  }

  // ---------- filesystem traversal ---------------------------------
  async function walkDir(dirHandle, prefix, out) {
    var queue = [];
    queue.push({ handle: dirHandle, prefix: prefix });
    while (queue.length) {
      var cur = queue.shift();
      var entries = [];
      try {
        for await (var entry of cur.handle.values()) {
          entries.push(entry);
        }
      } catch (e) {
        console.warn('walkDir values failed:', e);
        continue;
      }
      for (var i = 0; i < entries.length; i++) {
        var ent = entries[i];
        var rel = cur.prefix ? cur.prefix + '/' + ent.name : ent.name;
        if (ent.kind === 'directory') {
          queue.push({ handle: ent, prefix: rel });
        } else if (ent.kind === 'file') {
          if (isSupportedExt(ent.name) || isZipName(ent.name)) {
            out.push({
              name: ent.name,
              path: rel,
              kind: 'fs',
              handle: ent,
              getBlob: function(h) { return function() { return h.getFile(); }; }(ent),
              size: 0
            });
          }
        }
      }
    }
  }

  // ---------- render ----------------------------------------------
  function renderInitial(container) {
    state.container = container;
    container.classList.add('gallery-page');
    container.innerHTML =
      '<div class="gallery-layout" id="gallery-layout">' +
        '<div class="gallery-tree-panel hidden" id="gallery-tree-panel"></div>' +
        '<div class="gallery-main-area" id="gallery-main-area">' +
          '<div class="gallery-main" id="gallery-main">' +
            '<img class="gallery-main-img" id="gallery-main-img" alt="">' +
            '<div class="gallery-empty" id="gallery-empty">' +
              '<div class="gallery-empty-icon">⬚</div>' +
              '<div class="gallery-empty-hint">' + escapeHtml(T('Drop/Paste/Open') || 'Drop / Paste / Open') + '</div>' +
              '<div class="gallery-empty-sub">' + escapeHtml(T('galleryEmpty') || '') + '</div>' +
            '</div>' +
            '<span class="gallery-main-msg" id="gallery-toolbar-msg" style="display:none"></span>' +
          '</div>' +
          '<div class="gallery-bottom">' +
            '<div class="gallery-thumbnails" id="gallery-thumbnails"></div>' +
            '<div class="gallery-controls">' +
              '<button class="gallery-btn gallery-btn-icon" id="gallery-tree-btn" type="button" title="Directory Tree (T)">☱</button>' +
              '<div class="gallery-path" id="gallery-path" title="">-</div>' +
              '<div class="gallery-ctrl-center">' +
                '<button class="gallery-btn" id="gallery-prev-folder-btn" type="button" title="Prev Folder (&lt;| / Up)">&lt;|</button>' +
                '<button class="gallery-btn" id="gallery-prev-btn" type="button" title="Prev (‹ / Left / PageUp)">‹</button>' +
                '<div class="gallery-auto-wrapper" id="gallery-auto-wrapper">' +
                  '<button class="gallery-btn" id="gallery-autoplay-btn" type="button" title="Autoplay (A / ▶)">▶</button>' +
                  '<div class="gallery-interval-dropdown" id="gallery-interval-dropdown">' +
                    AUTOPLAY_LABELS.map(function(l, i) {
                      var act = (AUTOPLAY_INTERVALS[i] === state.autoplayInterval) ? ' active' : '';
                      return '<div class="gallery-interval-item' + act + '" data-idx="' + i + '">' +
                               '<span>' + escapeHtml(l) + '</span>' +
                               '<span class="gallery-key-hint">' + (i + 1) + '</span>' +
                             '</div>';
                    }).join('') +
                  '</div>' +
                '</div>' +
                '<button class="gallery-btn" id="gallery-next-btn" type="button" title="Next (› / Right / PageDown / Space)">›</button>' +
                '<button class="gallery-btn" id="gallery-next-folder-btn" type="button" title="Next Folder (|&gt; / Down)">|&gt;</button>' +
              '</div>' +
              '<div class="gallery-ctrl-right">' +
                '<span class="gallery-info" id="gallery-info">0 / 0</span>' +
                '<button class="gallery-btn gallery-btn-icon" id="gallery-split-btn" type="button" title="Split / Single Mode (D)">▍▍</button>' +
                '<button class="gallery-btn gallery-btn-icon" id="gallery-mode-btn" type="button" title="Image / Video Mode (M)">🖼</button>' +
                '<button class="gallery-btn gallery-btn-icon" id="gallery-fs-btn" type="button" title="Fullscreen (F)">' +
                  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>' +
                  '</svg>' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // hidden fallback input
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,.zip';
    input.style.display = 'none';
    input.id = 'gallery-file-input';
    input.addEventListener('change', function(e) {
      var files = e.target.files;
      if (files && files.length) {
        processFiles(Array.prototype.slice.call(files));
      }
      input.value = '';
    });
    container.appendChild(input);

    var layout = document.getElementById('gallery-layout');

    layout.addEventListener('dragover', onDragOver);
    layout.addEventListener('dragenter', onDragEnter);
    layout.addEventListener('dragleave', onDragLeave);
    layout.addEventListener('drop', onDrop);

    document.getElementById('gallery-empty').addEventListener('click', onOpenClick);
    document.getElementById('gallery-tree-btn').addEventListener('click', toggleTreePanel);
    document.getElementById('gallery-prev-folder-btn').addEventListener('click', goPrevFolder);
    document.getElementById('gallery-prev-btn').addEventListener('click', goPrev);
    document.getElementById('gallery-next-btn').addEventListener('click', goNext);
    document.getElementById('gallery-next-folder-btn').addEventListener('click', goNextFolder);
    document.getElementById('gallery-autoplay-btn').addEventListener('click', toggleAutoplay);
    document.getElementById('gallery-split-btn').addEventListener('click', toggleSplitMode);
    document.getElementById('gallery-mode-btn').addEventListener('click', toggleMediaType);
    document.getElementById('gallery-fs-btn').addEventListener('click', toggleFullscreen);

    var treePanel = document.getElementById('gallery-tree-panel');
    if (treePanel) {
      treePanel.addEventListener('click', function(e) {
        var target = e.target.closest('.gallery-tree-node');
        if (!target) return;
        var dir = target.getAttribute('data-dir');
        var isVid = (state.viewMode === 'split') ? (state.focus === 'video') : (state.mediaType === 'video');
        var map = isVid ? state.videoDirMap : state.dirMap;
        if (dir && map[dir] && map[dir].length) {
          if (isVid) setVideoActive(map[dir][0]);
          else setActive(map[dir][0]);
        }
      });
    }

    var dropdown = document.getElementById('gallery-interval-dropdown');
    if (dropdown) {
      dropdown.addEventListener('click', function(e) {
        var item = e.target.closest('[data-idx]');
        if (!item) return;
        var idx = parseInt(item.dataset.idx, 10);
        if (!isNaN(idx)) setAutoplayInterval(idx);
      });
    }

    state.pasteHandler = onPaste;
    document.addEventListener('paste', state.pasteHandler);

    if (!state.pageKeyHandler) {
      state.pageKeyHandler = onGalleryKeyDown;
      document.addEventListener('keydown', state.pageKeyHandler);
    }
  }

  // ---------- split / media mode & focus handlers ---------------------
  function toggleSplitMode() {
    state.viewMode = (state.viewMode === 'single') ? 'split' : 'single';
    if (state.viewMode === 'split') state.focus = 'image';
    updateLayoutMode();
    flashFocusOverlay(state.focus);
  }

  function toggleMediaType() {
    state.mediaType = (state.mediaType === 'image') ? 'video' : 'image';
    if (state.viewMode === 'split') {
      state.focus = state.mediaType;
    }
    updateLayoutMode();
    flashFocusOverlay(state.focus);
  }

  function switchFocus() {
    if (state.viewMode !== 'split') return;
    state.focus = (state.focus === 'image') ? 'video' : 'image';
    updateLayoutMode();
    flashFocusOverlay(state.focus);
  }

  function flashFocusOverlay(targetFocus) {
    var paneId = (targetFocus === 'video') ? 'gallery-pane-video' : 'gallery-pane-image';
    var pane = document.getElementById(paneId);
    if (!pane) return;
    var flash = document.createElement('div');
    flash.className = 'gallery-focus-flash';
    pane.appendChild(flash);
    setTimeout(function() {
      if (flash.parentNode) flash.parentNode.removeChild(flash);
    }, 360);
  }

  function autoBalanceFullscreenSplitRatio() {
    var paneImg = document.getElementById('gallery-pane-image');
    var paneVid = document.getElementById('gallery-pane-video');
    if (!paneImg || !paneVid) return;

    if (!isFullscreen() || state.viewMode !== 'split') {
      paneImg.style.flex = '1 1 50%';
      paneVid.style.flex = '1 1 50%';
      return;
    }

    var imgEl = document.getElementById('gallery-main-img');
    var vidEl = document.getElementById('gallery-main-video');

    var rImg = (imgEl && imgEl.naturalWidth && imgEl.naturalHeight)
      ? (imgEl.naturalWidth / imgEl.naturalHeight) : 1.0;
    var rVid = (vidEl && vidEl.videoWidth && vidEl.videoHeight)
      ? (vidEl.videoWidth / vidEl.videoHeight) : 1.0;

    var ratioImg = rImg / (rImg + rVid);
    ratioImg = Math.max(0.20, Math.min(0.80, ratioImg));
    var ratioVid = 1 - ratioImg;

    paneImg.style.flex = (ratioImg * 100) + ' 1 0%';
    paneVid.style.flex = (ratioVid * 100) + ' 1 0%';
  }

  function updateLayoutMode() {
    var splitBtn = document.getElementById('gallery-split-btn');
    var modeBtn = document.getElementById('gallery-mode-btn');
    if (splitBtn) splitBtn.classList.toggle('active', state.viewMode === 'split');
    if (modeBtn) modeBtn.textContent = (state.mediaType === 'video') ? '🎬' : '🖼';

    var main = document.getElementById('gallery-main');
    if (!main) return;

    var activeMediaType = (state.viewMode === 'split') ? state.focus : state.mediaType;

    if (state.viewMode === 'split') {
      main.className = 'gallery-main gallery-main-split';
      main.innerHTML =
        '<div class="gallery-pane' + (state.focus === 'image' ? ' focused' : '') + '" id="gallery-pane-image">' +
          '<img class="gallery-main-img" id="gallery-main-img" alt="">' +
        '</div>' +
        '<div class="gallery-pane' + (state.focus === 'video' ? ' focused' : '') + '" id="gallery-pane-video">' +
          '<video class="gallery-main-video" id="gallery-main-video" autoplay loop></video>' +
          '<div class="gallery-video-hover-ctrl" id="gallery-video-ctrl">' +
            '<input type="range" class="gallery-video-seeker" id="gallery-video-seeker" value="0" min="0" max="100" step="0.1">' +
            '<div class="gallery-video-bar">' +
              '<div style="display:flex;align-items:center;gap:6px">' +
                '<button class="gallery-btn gallery-btn-icon" id="gallery-vid-play" type="button">▶</button>' +
                '<button class="gallery-btn gallery-btn-icon" id="gallery-vid-stop" type="button">■</button>' +
                '<span id="gallery-vid-time" style="font-family:monospace">00:00 / 00:00</span>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:6px">' +
                '<span>🔊</span>' +
                '<input type="range" class="gallery-vol-slider" id="gallery-vol-slider" value="80" min="0" max="100">' +
                '<span id="gallery-vid-info" style="font-family:monospace">-</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.getElementById('gallery-pane-image').addEventListener('click', function() {
        if (state.focus !== 'image') { state.focus = 'image'; updateLayoutMode(); flashFocusOverlay('image'); }
      });
      document.getElementById('gallery-pane-video').addEventListener('click', function() {
        if (state.focus !== 'video') { state.focus = 'video'; updateLayoutMode(); flashFocusOverlay('video'); }
      });
      bindVideoControls();
    } else {
      main.className = 'gallery-main';
      if (state.mediaType === 'image') {
        main.innerHTML =
          '<img class="gallery-main-img" id="gallery-main-img" alt="">' +
          '<div class="gallery-empty" id="gallery-empty" style="display:none">' +
            '<div class="gallery-empty-icon">⬚</div>' +
            '<div class="gallery-empty-hint">' + escapeHtml(T('Drop/Paste/Open') || 'Drop / Paste / Open') + '</div>' +
          '</div>';
      } else {
        main.innerHTML =
          '<video class="gallery-main-video" id="gallery-main-video" autoplay loop></video>' +
          '<div class="gallery-video-hover-ctrl" id="gallery-video-ctrl">' +
            '<input type="range" class="gallery-video-seeker" id="gallery-video-seeker" value="0" min="0" max="100" step="0.1">' +
            '<div class="gallery-video-bar">' +
              '<div style="display:flex;align-items:center;gap:6px">' +
                '<button class="gallery-btn gallery-btn-icon" id="gallery-vid-play" type="button">▶</button>' +
                '<button class="gallery-btn gallery-btn-icon" id="gallery-vid-stop" type="button">■</button>' +
                '<span id="gallery-vid-time" style="font-family:monospace">00:00 / 00:00</span>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:6px">' +
                '<span>🔊</span>' +
                '<input type="range" class="gallery-vol-slider" id="gallery-vol-slider" value="80" min="0" max="100">' +
                '<span id="gallery-vid-info" style="font-family:monospace">-</span>' +
              '</div>' +
            '</div>' +
          '</div>';
        bindVideoControls();
      }
    }

    renderTreePanel();
    renderThumbnails();
    if (state.index >= 0 && state.items.length) renderActive(state.index);
    if (state.videoIndex >= 0 && state.videoItems.length) renderActiveVideo(state.videoIndex);
    autoBalanceFullscreenSplitRatio();
  }

  // ---------- directory tree & folder navigation helpers -------------
  function getDirPath(itemPath) {
    if (!itemPath) return 'Root';
    var parts = itemPath.split('/');
    if (parts.length <= 1) return 'Root';
    parts.pop();
    return parts.join('/') || 'Root';
  }

  function updateDirStructure() {
    state.dirMap = {};
    state.dirPathList = [];
    for (var i = 0; i < state.items.length; i++) {
      var item = state.items[i];
      var dir = getDirPath(item.path);
      if (!state.dirMap[dir]) {
        state.dirMap[dir] = [];
        state.dirPathList.push(dir);
      }
      state.dirMap[dir].push(i);
    }
    renderTreePanel();
  }

  function toggleTreePanel() {
    state.treeOpen = !state.treeOpen;
    var panel = document.getElementById('gallery-tree-panel');
    var btn = document.getElementById('gallery-tree-btn');
    if (panel) panel.classList.toggle('hidden', !state.treeOpen);
    if (btn) btn.classList.toggle('active', state.treeOpen);
    if (state.treeOpen) renderTreePanel();
  }

  function renderTreePanel() {
    var panel = document.getElementById('gallery-tree-panel');
    if (!panel) return;
    if (!state.dirPathList.length) {
      panel.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted)">No Folder</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < state.dirPathList.length; i++) {
      var dir = state.dirPathList[i];
      var count = state.dirMap[dir] ? state.dirMap[dir].length : 0;
      var parts = dir.split('/');
      var name = parts[parts.length - 1] || dir;
      var level = Math.max(0, parts.length - 1);
      var indent = level * 10;
      var isActive = (dir === state.curDirPath) ? ' active' : '';
      var icon = isZipName(dir) ? '📦' : '📁';

      html += '<div class="gallery-tree-node' + isActive + '" data-dir="' + escapeHtml(dir) + '" style="padding-left:' + (indent + 8) + 'px" title="' + escapeHtml(dir) + '">' +
                '<span class="tree-icon">' + icon + '</span>' +
                '<span class="tree-name">' + escapeHtml(name) + '</span>' +
                '<span class="tree-count">' + count + '</span>' +
              '</div>';
    }
    panel.innerHTML = html;
  }

  function updateCurrentFolderItems(index) {
    if (index < 0 || index >= state.items.length) {
      state.curDirPath = '';
      state.currentFolderIndices = [];
      state.currentSubIndex = -1;
      return;
    }
    var item = state.items[index];
    var dir = getDirPath(item.path);
    var prevDir = state.curDirPath;
    state.curDirPath = dir;
    var indices = state.dirMap[dir] || [index];
    state.currentFolderIndices = indices;
    state.currentSubIndex = indices.indexOf(index);

    if (prevDir !== dir) {
      renderThumbnails();
    }

    var panel = document.getElementById('gallery-tree-panel');
    if (panel) {
      var nodes = panel.querySelectorAll('.gallery-tree-node');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var isAct = (n.getAttribute('data-dir') === dir);
        n.classList.toggle('active', isAct);
        if (isAct && state.treeOpen) {
          n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }
  }

  function goPrevFolder() {
    if (!state.dirPathList.length) return;
    var curIdx = state.dirPathList.indexOf(state.curDirPath);
    var targetIdx = (curIdx > 0) ? curIdx - 1 : state.dirPathList.length - 1;
    var targetDir = state.dirPathList[targetIdx];
    if (targetDir && state.dirMap[targetDir] && state.dirMap[targetDir].length) {
      setActive(state.dirMap[targetDir][0]);
    }
  }

  function goNextFolder() {
    if (!state.dirPathList.length) return;
    var curIdx = state.dirPathList.indexOf(state.curDirPath);
    var targetIdx = (curIdx >= 0) ? (curIdx + 1) % state.dirPathList.length : 0;
    var targetDir = state.dirPathList[targetIdx];
    if (targetDir && state.dirMap[targetDir] && state.dirMap[targetDir].length) {
      setActive(state.dirMap[targetDir][0]);
    }
  }

  function renderThumbnails() {
    var wrap = document.getElementById('gallery-thumbnails');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (state.thumbObserver) {
      state.thumbObserver.disconnect();
      state.thumbObserver = null;
    }
    if (!state.currentFolderIndices || !state.currentFolderIndices.length) return;

    state.thumbObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(en) {
        if (en.isIntersecting) {
          var idx = parseInt(en.target.dataset.idx, 10);
          var item = state.items[idx];
          if (item && !item.thumbReady) ensureThumb(item);
        }
      });
    }, { root: wrap, rootMargin: '120px' });

    for (var k = 0; k < state.currentFolderIndices.length; k++) {
      (function(idx) {
        var item = state.items[idx];
        var div = document.createElement('div');
        div.className = 'gallery-thumb' + (idx === state.index ? ' active' : '');
        div.dataset.idx = String(idx);
        var img = document.createElement('img');
        img.className = 'gallery-thumb-img';
        img.alt = '';
        item.thumbImgEl = img;
        div.appendChild(img);
        div.addEventListener('click', function() { setActive(idx); });
        wrap.appendChild(div);
        item.thumbDivEl = div;
        state.thumbObserver.observe(div);
        if (item.thumbURL) img.src = item.thumbURL;
      })(state.currentFolderIndices[k]);
    }
  }

  function renderActive(index) {
    var item = state.items[index];
    var imgEl = document.getElementById('gallery-main-img');
    var pathEl = document.getElementById('gallery-path');
    var info = document.getElementById('gallery-info');
    var empty = document.getElementById('gallery-empty');

    updateCurrentFolderItems(index);

    // highlight active thumb
    if (state.currentFolderIndices) {
      for (var i = 0; i < state.currentFolderIndices.length; i++) {
        var idx = state.currentFolderIndices[i];
        if (state.items[idx] && state.items[idx].thumbDivEl) {
          state.items[idx].thumbDivEl.classList.toggle('active', idx === index);
        }
      }
    }
    if (item && item.thumbDivEl) {
      item.thumbDivEl.scrollIntoView({ inline: 'center', block: 'nearest' });
    }

    if (!item) {
      if (imgEl) imgEl.removeAttribute('src');
      if (pathEl) { pathEl.textContent = '-'; pathEl.title = ''; }
      if (info) info.textContent = '0 / 0';
      if (empty) empty.style.display = '';
      return;
    }

    var displayPath = item.path || item.name || '';
    if (pathEl) {
      pathEl.textContent = displayPath;
      pathEl.title = displayPath;
    }

    ensureMainSrc(item).then(function() {
      if (imgEl && item.mainURL) {
        state.mainURL = item.mainURL;
        imgEl.onload = function() { autoBalanceFullscreenSplitRatio(); };
        imgEl.src = item.mainURL;
        if (empty) empty.style.display = 'none';
      }
      var subIdx = (state.currentSubIndex >= 0) ? (state.currentSubIndex + 1) : 0;
      var totalFolder = state.currentFolderIndices ? state.currentFolderIndices.length : 0;
      var countStr = subIdx + ' / ' + totalFolder;
      if (info) info.textContent = countStr + ' | Loading...';
      updateInfo(item, info, countStr);
      autoBalanceFullscreenSplitRatio();
    }).catch(function(e) { console.warn('renderActive failed:', e); });
  }

  function updateInfo(item, info, countStr) {
    getItemBlob(item).then(function(blob) {
      if (!blob) return;
      item.size = blob.size;
      var sizeStr = prettySize(blob.size);
      createImageBitmap(blob).then(function(bmp) {
        var dim = bmp.width + 'x' + bmp.height;
        bmp.close && bmp.close();
        if (info) info.textContent = countStr + ' | ' + dim + ' | ' + sizeStr;
      }).catch(function() {
        if (info) info.textContent = countStr + ' | ? | ' + sizeStr;
      });
    }).catch(function() {
      if (info) info.textContent = countStr;
    });
  }

  function setActive(index) {
    if (!state.items.length) return;
    if (index < 0) index = state.items.length - 1;
    if (index >= state.items.length) index = 0;
    state.index = index;
    renderActive(index);
  }

  // ---------- recursive directory reader for Drag & Drop / Paste -----------
  function readEntryRecursive(entry, prefix) {
    return new Promise(function(resolve) {
      if (!entry) return resolve([]);
      if (entry.isFile) {
        entry.file(function(file) {
          var name = file.name || entry.name || '';
          if (file && file.size > 0 && (isSupportedExt(name) || isZipName(name))) {
            var rel = prefix ? prefix + '/' + name : name;
            resolve([{ kind: isZipName(name) ? 'zipfile' : 'plain', file: file, path: rel }]);
          } else {
            resolve([]);
          }
        }, function() { resolve([]); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        var allEntries = [];
        var readBatch = function() {
          reader.readEntries(function(results) {
            if (!results || !results.length) {
              var dirPrefix = prefix ? prefix + '/' + entry.name : entry.name;
              var promises = allEntries.map(function(child) {
                return readEntryRecursive(child, dirPrefix);
              });
              Promise.all(promises).then(function(nested) {
                var flat = [];
                for (var i = 0; i < nested.length; i++) {
                  flat = flat.concat(nested[i]);
                }
                resolve(flat);
              });
            } else {
              allEntries = allEntries.concat(Array.prototype.slice.call(results));
              readBatch();
            }
          }, function() { resolve([]); });
        };
        readBatch();
      } else {
        resolve([]);
      }
    });
  }

  // ---------- event handlers ---------------------------------------
  function onDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onDragEnter(e) {
    e.preventDefault();
    var zone = document.getElementById('gallery-layout');
    if (zone) zone.classList.add('drag-active');
  }

  function onDragLeave(e) {
    var zone = document.getElementById('gallery-layout');
    if (zone) zone.classList.remove('drag-active');
  }

  function onDrop(e) {
    e.preventDefault();
    var zone = document.getElementById('gallery-layout');
    if (zone) zone.classList.remove('drag-active');
    var dt = e.dataTransfer;
    if (!dt || !dt.items) {
      if (dt && dt.files && dt.files.length) {
        processFiles(Array.prototype.slice.call(dt.files));
      }
      return;
    }

    var promises = [];
    for (var i = 0; i < dt.items.length; i++) {
      var item = dt.items[i];
      if (item.kind !== 'file') continue;
      if (typeof item.webkitGetAsEntry === 'function') {
        var entry = item.webkitGetAsEntry();
        if (entry) {
          promises.push(readEntryRecursive(entry, ''));
          continue;
        }
      }
      var f = item.getAsFile();
      if (f && f.size > 0) {
        if (isZipName(f.name)) promises.push(Promise.resolve([{ kind: 'zipfile', file: f, path: f.name }]));
        else if (isSupportedExt(f.name)) promises.push(Promise.resolve([{ kind: 'plain', file: f, path: f.name }]));
      }
    }

    if (promises.length) {
      Promise.all(promises).then(function(results) {
        var flat = [];
        for (var r = 0; r < results.length; r++) {
          flat = flat.concat(results[r]);
        }
        processCollectedEntries(flat);
      }).catch(function(err) { console.warn('drop parse failed:', err); });
    }
  }

  function onPaste(e) {
    var cd = e.clipboardData;
    if (!cd || !cd.items) return;
    var promises = [];
    for (var i = 0; i < cd.items.length; i++) {
      var it = cd.items[i];
      if (it.kind !== 'file') continue;
      if (typeof it.webkitGetAsEntry === 'function') {
        var entry = it.webkitGetAsEntry();
        if (entry) {
          promises.push(readEntryRecursive(entry, ''));
          continue;
        }
      }
      var blob = it.getAsFile();
      if (blob && blob.size > 0) {
        var nm = blob.name || '';
        if (isZipName(nm)) promises.push(Promise.resolve([{ kind: 'zipfile', file: blob, path: nm }]));
        else if (isSupportedExt(nm) || (blob.type && blob.type.startsWith('image/'))) {
          promises.push(Promise.resolve([{ kind: 'plain', file: blob, path: nm || ('paste' + extOf(blob.type)) }]));
        }
      }
    }
    if (!promises.length) return;
    e.preventDefault();
    Promise.all(promises).then(function(results) {
      var flat = [];
      for (var r = 0; r < results.length; r++) {
        flat = flat.concat(results[r]);
      }
      processCollectedEntries(flat);
    }).catch(function(err) { console.warn('paste parse failed:', err); });
  }

  function onOpenClick() {
    var input = document.getElementById('gallery-file-input');
    try {
      if (typeof window.showDirectoryPicker === 'function') {
        onOpenDir().catch(function(err) { console.warn('showDirectoryPicker failed:', err); });
        return;
      }
      if (typeof window.showOpenFilePicker === 'function') {
        onOpenFiles().catch(function(err) { console.warn('showOpenFilePicker failed:', err); });
        return;
      }
    } catch (err) {
      console.warn('picker unavailable:', err);
    }
    if (input) input.click();
  }

  async function onOpenDir() {
    var dirHandle = await window.showDirectoryPicker();
    var out = [];
    await walkDir(dirHandle, '', out);
    finalizeItems(out);
  }

  async function onOpenFiles() {
    var handles = await window.showOpenFilePicker({ multiple: true });
    var fsHandles = [];
    var blobs = [];
    for (var i = 0; i < handles.length; i++) {
      var h = handles[i];
      if (h.kind === 'directory') {
        await walkDir(h.handle, '', fsHandles);
      } else {
        if (isZipName(h.name)) blobs.push({ kind: 'ziphandle', handle: h });
        else fsHandles.push({ kind: 'file', handle: h });
      }
    }
    await processHandles(fsHandles, blobs);
  }

  // ---------- collectors & lazy zip loader ---------------------------
  async function loadNextZipChunk() {
    if (!state.pendingZipQueue.length || state.loadingZip) return;
    state.loadingZip = true;
    var nextZip = state.pendingZipQueue.shift();
    var newItems = [];
    await addZipBlob(nextZip, newItems);
    state.loadingZip = false;
    if (newItems.length) {
      appendNewItems(newItems);
    }
  }

  function appendNewItems(newItems) {
    sortItems(newItems);
    state.items = state.items.concat(newItems);
    updateDirStructure();
    renderThumbnails();
    if (state.index >= 0 && state.index < state.items.length) {
      renderActive(state.index);
    }
  }

  async function processCollectedEntries(collected) {
    state.pendingZipQueue = [];
    state.loadingZip = false;
    var outImg = [];
    var outVid = [];
    var zipFiles = [];
    for (var i = 0; i < collected.length; i++) {
      var item = collected[i];
      if (item.kind === 'zipfile') {
        zipFiles.push(item.file);
      } else if (item.kind === 'plain' && item.file && item.file.size > 0) {
        var plainObj = {
          name: item.file.name || item.path.split('/').pop(),
          path: item.path || item.file.name,
          kind: 'plain',
          file: item.file,
          size: item.file.size || 0
        };
        if (isVideoExt(plainObj.path)) {
          outVid.push(plainObj);
        } else {
          outImg.push(plainObj);
        }
      }
    }

    // Sort zip files by name
    zipFiles.sort(function(a, b) {
      return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
    });

    if (zipFiles.length > 0) {
      await addZipBlob(zipFiles[0], outImg);
      state.pendingZipQueue = zipFiles.slice(1);
    }

    if (outVid.length) {
      sortItems(outVid);
      state.videoItems = outVid;
      state.videoIndex = -1;
      updateVideoDirStructure();
      if (state.viewMode === 'single' && outImg.length === 0) {
        state.mediaType = 'video';
      }
      setVideoActive(0);
    }

    if (outImg.length || !outVid.length) {
      finalizeItems(outImg);
    }
  }

  async function processHandles(handles, leaves) {
    var collected = [];
    for (var i = 0; i < handles.length; i++) {
      var h = handles[i];
      if (h.kind === 'directory') {
        await walkDir(h.handle, '', collected);
      } else if (h.kind === 'file' && h.handle) {
        var name = h.handle.name;
        if (isZipName(name)) {
          try {
            var file = await h.handle.getFile();
            collected.push({ kind: 'zipfile', file: file });
          } catch (e) { console.warn('zip handle read failed:', e); }
        } else {
          try {
            var ff = await h.handle.getFile();
            collected.push({ kind: 'plain', file: ff, path: name });
          } catch (e) {}
        }
      }
    }
    if (leaves && leaves.length) {
      for (var j = 0; j < leaves.length; j++) {
        var lf = leaves[j];
        if (lf.kind === 'ziphandle') {
          try {
            var zf = await lf.handle.getFile();
            collected.push({ kind: 'zipfile', file: zf });
          } catch (e) {}
        } else if (lf.kind === 'file' && lf.handle) {
          try {
            var f2 = await lf.handle.getFile();
            collected.push({ kind: 'plain', file: f2, path: f2.name });
          } catch (e) {}
        } else if (lf.kind === 'blob' && lf.file) {
          collected.push({ kind: 'plain', file: lf.file, path: lf.file.name });
        }
      }
    }
    await processCollectedEntries(collected);
  }

  function processFiles(files) {
    var collected = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (isZipName(f.name)) collected.push({ kind: 'zipfile', file: f });
      else if (isSupportedExt(f.name) && f.size > 0) collected.push({ kind: 'plain', file: f, path: f.name });
    }
    processCollectedEntries(collected);
  }

  function processBlobs(blobs) {
    var collected = [];
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      if (b.type === 'application/zip' || isZipName(b.name)) collected.push({ kind: 'zipfile', file: b });
      else if (isSupportedExt(b.name) || (b.type && (b.type.startsWith('image/') || b.type.startsWith('video/')))) {
        if (b.size > 0) collected.push({ kind: 'plain', file: b, path: b.name || ('paste' + (b.type.startsWith('video/') ? '.mp4' : extOf(b.type))) });
      }
    }
    processCollectedEntries(collected);
  }

  function makePlainItem(file) {
    return {
      name: file.name || ('blob' + extOf(file.type)),
      path: file.name || ('blob' + extOf(file.type)),
      kind: 'plain',
      file: file,
      size: file.size
    };
  }

  async function addZipBlob(file, out) {
    try {
      var buf = await file.arrayBuffer();
      var res = await fetch('/api/gallery/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: buf
      });
      if (!res.ok) {
        showMsg('zip http ' + res.status);
        console.warn('zip upload failed:', res.status);
        return;
      }
      var data = await res.json();
      var sessionId = data.sessionId;
      state.zipSessionId = sessionId;
      state.zipEntriesCache = data.manifest;
      var entries = (data.manifest && data.manifest.entries) || [];
      var zipName = file.name || 'archive.zip';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var nm = e.path.split('/').pop();
        var displayPath = zipName + '/' + e.path;
        out.push({
          name: nm,
          path: displayPath,
          kind: 'zip',
          index: (typeof e.index === 'number' ? e.index : i),
          sessionId: sessionId,
          size: e.size || 0,
          getBlob: null
        });
      }
    } catch (e) {
      showMsg('zip error');
      console.warn('addZipBlob failed:', e);
    }
  }

  function finalizeItems(out) {
    clearObjectURLs();
    if (!out.length) {
      state.items = [];
      state.index = -1;
      updateDirStructure();
      renderThumbnails();
      renderActive(-1);
      return;
    }
    sortItems(out);
    state.items = out;
    state.index = -1;
    updateDirStructure();
    renderThumbnails();
    setActive(0);
  }

  // ---------- controls --------------------------------------------
  function goPrev() {
    if (!state.items.length) return;
    setActive(state.index - 1);
  }

  function goNext() {
    if (!state.items.length) return;
    setActive(state.index + 1);
  }

  function stopAutoplay() {
    if (state.autoplayTimer) {
      clearInterval(state.autoplayTimer);
      state.autoplayTimer = null;
    }
    state.autoplayOn = false;
    var btn = document.getElementById('gallery-autoplay-btn');
    if (btn) {
      btn.innerHTML = '▶';
      btn.setAttribute('title', 'Autoplay (A / ▶)');
    }
  }

  function startAutoplay() {
    stopAutoplay();
    if (!state.items.length) return;
    state.autoplayOn = true;
    state.autoplayTimer = setInterval(goNext, state.autoplayInterval);
    var btn = document.getElementById('gallery-autoplay-btn');
    if (btn) {
      btn.innerHTML = '■';
      btn.setAttribute('title', 'Stop (A / ■)');
    }
  }

  function toggleAutoplay() {
    if (state.autoplayOn) stopAutoplay();
    else startAutoplay();
  }

  function setAutoplayInterval(idx) {
    if (idx < 0) idx = 0;
    if (idx >= AUTOPLAY_INTERVALS.length) idx = AUTOPLAY_INTERVALS.length - 1;
    state.autoplayInterval = AUTOPLAY_INTERVALS[idx];
    var dropdown = document.getElementById('gallery-interval-dropdown');
    if (dropdown) {
      var items = dropdown.querySelectorAll('.gallery-interval-item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', i === idx);
      }
    }
    if (state.autoplayOn) startAutoplay();
  }

  function toggleFullscreen() {
    if (isFullscreen()) exitFullscreen();
    else enterFullscreen();
  }

  function enterFullscreen() {
    var main = document.getElementById('gallery-main');
    var target = main || document.documentElement;
    var p = target.requestFullscreen ? target.requestFullscreen() : Promise.resolve();
    p.catch(function(e) { console.warn('enterFullscreen failed:', e); });
    var layout = document.getElementById('gallery-layout');
    if (layout) layout.classList.add('gallery-layout-fullscreen');
    document.body.classList.add('gallery-fullscreen-active');
    state.fullscreenEl = target;
    bindFullscreen();

    if (typeof window.toggleNativeFullscreen === 'function') {
      try { window.toggleNativeFullscreen(true); } catch (e) {}
    }
    setTimeout(autoBalanceFullscreenSplitRatio, 50);
  }

  function exitFullscreen() {
    document.body.classList.remove('gallery-fullscreen-active');
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function(e) { console.warn('exitFullscreen failed:', e); });
    }
    unbindFullscreen();
    var layout = document.getElementById('gallery-layout');
    if (layout) layout.classList.remove('gallery-layout-fullscreen');

    if (typeof window.toggleNativeFullscreen === 'function') {
      try { window.toggleNativeFullscreen(false); } catch (e) {}
    }
    setTimeout(autoBalanceFullscreenSplitRatio, 50);
  }

  function isFullscreen() {
    return !!document.fullscreenElement || document.body.classList.contains('gallery-fullscreen-active');
  }

  function onContextMenu(e) {
    if (isFullscreen()) {
      e.preventDefault();
      e.stopPropagation();
      exitFullscreen();
    }
  }

  function bindFullscreen() {
    if (!state.fsChangeHandler) {
      state.fsChangeHandler = function() {
        if (!document.fullscreenElement) {
          document.body.classList.remove('gallery-fullscreen-active');
          var layout = document.getElementById('gallery-layout');
          if (layout) layout.classList.remove('gallery-layout-fullscreen');
          unbindFullscreen();
        }
        autoBalanceFullscreenSplitRatio();
      };
      document.addEventListener('fullscreenchange', state.fsChangeHandler);
    }
    if (!state.keyHandler) {
      state.keyHandler = onFullscreenKey;
      document.addEventListener('keydown', state.keyHandler, true);
    }
    if (!state.contextMenuHandler) {
      state.contextMenuHandler = onContextMenu;
      document.addEventListener('contextmenu', state.contextMenuHandler, true);
    }
  }

  function unbindFullscreen() {
    if (state.keyHandler) {
      document.removeEventListener('keydown', state.keyHandler, true);
      state.keyHandler = null;
    }
    if (state.fsChangeHandler) {
      document.removeEventListener('fullscreenchange', state.fsChangeHandler);
      state.fsChangeHandler = null;
    }
    if (state.contextMenuHandler) {
      document.removeEventListener('contextmenu', state.contextMenuHandler, true);
      state.contextMenuHandler = null;
    }
  }

  function updateVideoDirStructure() {
    state.videoDirMap = {};
    state.videoDirPathList = [];
    for (var i = 0; i < state.videoItems.length; i++) {
      var item = state.videoItems[i];
      var dir = getDirPath(item.path);
      if (!state.videoDirMap[dir]) {
        state.videoDirMap[dir] = [];
        state.videoDirPathList.push(dir);
      }
      state.videoDirMap[dir].push(i);
    }
  }

  function setVideoActive(index) {
    if (!state.videoItems.length) return;
    if (index < 0) index = state.videoItems.length - 1;
    if (index >= state.videoItems.length) index = 0;
    state.videoIndex = index;
    renderActiveVideo(index);
  }

  function renderActiveVideo(index) {
    var item = state.videoItems[index];
    var vidEl = document.getElementById('gallery-main-video');
    var pathEl = document.getElementById('gallery-path');
    var info = document.getElementById('gallery-info');

    if (!item) {
      if (vidEl) vidEl.removeAttribute('src');
      return;
    }

    var isVidActive = (state.viewMode === 'split') ? (state.focus === 'video') : (state.mediaType === 'video');
    if (isVidActive && pathEl) {
      var displayPath = item.path || item.name || '';
      pathEl.textContent = displayPath;
      pathEl.title = displayPath;
    }

    ensureMainSrc(item).then(function() {
      if (vidEl && item.mainURL) {
        state.videoURL = item.mainURL;
        vidEl.src = item.mainURL;
      }
      if (isVidActive && info) {
        var countStr = (index + 1) + ' / ' + state.videoItems.length;
        info.textContent = countStr + ' | Video';
      }
    }).catch(function(e) { console.warn('renderActiveVideo failed:', e); });
  }

  function bindVideoControls() {
    var vidEl = document.getElementById('gallery-main-video');
    var seeker = document.getElementById('gallery-video-seeker');
    var playBtn = document.getElementById('gallery-vid-play');
    var stopBtn = document.getElementById('gallery-vid-stop');
    var volSlider = document.getElementById('gallery-vol-slider');
    var timeTxt = document.getElementById('gallery-vid-time');
    var infoTxt = document.getElementById('gallery-vid-info');

    if (!vidEl) return;

    if (playBtn) {
      playBtn.onclick = function() {
        if (vidEl.paused) vidEl.play();
        else vidEl.pause();
      };
    }
    if (stopBtn) {
      stopBtn.onclick = function() {
        vidEl.pause();
        vidEl.currentTime = 0;
      };
    }
    vidEl.onplay = function() { if (playBtn) playBtn.textContent = '⏸'; };
    vidEl.onpause = function() { if (playBtn) playBtn.textContent = '▶'; };

    vidEl.ontimeupdate = function() {
      if (seeker && vidEl.duration) {
        seeker.value = (vidEl.currentTime / vidEl.duration) * 100;
      }
      if (timeTxt) {
        timeTxt.textContent = formatTime(vidEl.currentTime) + ' / ' + formatTime(vidEl.duration);
      }
    };

    vidEl.onloadedmetadata = function() {
      if (infoTxt) {
        infoTxt.textContent = vidEl.videoWidth + 'x' + vidEl.videoHeight;
      }
      if (timeTxt) {
        timeTxt.textContent = formatTime(vidEl.currentTime) + ' / ' + formatTime(vidEl.duration);
      }
      autoBalanceFullscreenSplitRatio();
    };

    if (seeker) {
      seeker.oninput = function() {
        if (vidEl.duration) {
          vidEl.currentTime = (seeker.value / 100) * vidEl.duration;
        }
      };
    }

    if (volSlider) {
      volSlider.oninput = function() {
        vidEl.volume = volSlider.value / 100;
      };
    }
  }

  function onFullscreenKey(e) {
    if (!isFullscreen()) {
      unbindFullscreen();
      return;
    }
    var k = e.key;
    if (k === 'Tab') {
      if (state.viewMode === 'split') {
        e.preventDefault(); e.stopPropagation(); switchFocus(); return;
      }
    }
    if (k === 'd' || k === 'D') {
      e.preventDefault(); e.stopPropagation(); toggleSplitMode(); return;
    }
    if (k === 'm' || k === 'M') {
      e.preventDefault(); e.stopPropagation(); toggleMediaType(); return;
    }

    var isVidActive = (state.viewMode === 'split') ? (state.focus === 'video') : (state.mediaType === 'video');

    if (isVidActive) {
      var vidEl = document.getElementById('gallery-main-video');
      if (k >= '1' && k <= '9') {
        e.preventDefault(); e.stopPropagation();
        var num = parseInt(k, 10);
        var volPct = num * 11;
        if (volPct > 100) volPct = 100;
        if (vidEl) vidEl.volume = volPct / 100;
        var volSlider = document.getElementById('gallery-vol-slider');
        if (volSlider) volSlider.value = volPct;
        showMsg('Volume: ' + volPct + '%');
        return;
      }
      if (k === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation(); setVideoActive(state.videoIndex - 1); return;
      }
      if (k === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation(); setVideoActive(state.videoIndex + 1); return;
      }
      if (k === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation();
        if (vidEl) vidEl.currentTime = Math.max(0, vidEl.currentTime - 10);
        return;
      }
      if (k === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        if (vidEl) vidEl.currentTime = Math.min(vidEl.duration || 0, vidEl.currentTime + 10);
        return;
      }
      if (k === ' ' || k === 'Spacebar') {
        e.preventDefault(); e.stopPropagation();
        if (vidEl) {
          if (vidEl.paused) vidEl.play();
          else vidEl.pause();
        }
        return;
      }
    }

    if (k === 'ArrowLeft' || k === 'PageUp') {
      e.preventDefault(); e.stopPropagation(); goPrev();
    } else if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Spacebar') {
      e.preventDefault(); e.stopPropagation(); goNext();
    } else if (k === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation(); goPrevFolder();
    } else if (k === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation(); goNextFolder();
    } else if (k === 'Escape' || k === 'Enter') {
      e.preventDefault(); e.stopPropagation(); exitFullscreen();
    } else if (k === 'a' || k === 'A') {
      e.preventDefault(); e.stopPropagation(); toggleAutoplay();
    } else if (k === 'f' || k === 'F') {
      e.preventDefault(); e.stopPropagation(); toggleFullscreen();
    } else if (k === 't' || k === 'T') {
      e.preventDefault(); e.stopPropagation(); toggleTreePanel();
    } else if (k >= '1' && k <= '9') {
      e.preventDefault(); e.stopPropagation();
      setAutoplayInterval(parseInt(k, 10) - 1);
    } else {
      if (k === 'F1' || k === 'F2' || k === 'F3' || k === 'F4' || k === 'F5' || k === 'F6') {
        e.preventDefault(); e.stopPropagation();
      }
    }
  }

  function onGalleryKeyDown(e) {
    if (typeof currentPage !== 'undefined' && currentPage !== 'gallery') return;
    if (isFullscreen()) return; // handled by onFullscreenKey

    var tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable)) {
      return;
    }

    var k = e.key;
    if (k === 'Tab') {
      if (state.viewMode === 'split') {
        e.preventDefault();
        e.stopPropagation();
        switchFocus();
        return;
      }
    }
    if (k === 'd' || k === 'D') {
      e.preventDefault();
      toggleSplitMode();
      return;
    }
    if (k === 'm' || k === 'M') {
      e.preventDefault();
      toggleMediaType();
      return;
    }

    var isVidActive = (state.viewMode === 'split') ? (state.focus === 'video') : (state.mediaType === 'video');

    if (isVidActive) {
      var vidEl = document.getElementById('gallery-main-video');
      if (k >= '1' && k <= '9') {
        e.preventDefault();
        var num = parseInt(k, 10);
        var volPct = num * 11;
        if (volPct > 100) volPct = 100;
        if (vidEl) vidEl.volume = volPct / 100;
        var volSlider = document.getElementById('gallery-vol-slider');
        if (volSlider) volSlider.value = volPct;
        showMsg('Volume: ' + volPct + '%');
        return;
      }
      if (k === 'ArrowUp') {
        e.preventDefault();
        setVideoActive(state.videoIndex - 1);
        return;
      }
      if (k === 'ArrowDown') {
        e.preventDefault();
        setVideoActive(state.videoIndex + 1);
        return;
      }
      if (k === 'ArrowLeft') {
        e.preventDefault();
        if (vidEl) vidEl.currentTime = Math.max(0, vidEl.currentTime - 10);
        return;
      }
      if (k === 'ArrowRight') {
        e.preventDefault();
        if (vidEl) vidEl.currentTime = Math.min(vidEl.duration || 0, vidEl.currentTime + 10);
        return;
      }
      if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (vidEl) {
          if (vidEl.paused) vidEl.play();
          else vidEl.pause();
        }
        return;
      }
    }

    if (k === 'ArrowLeft' || k === 'PageUp') {
      e.preventDefault(); goPrev();
    } else if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Spacebar') {
      e.preventDefault(); goNext();
    } else if (k === 'ArrowUp') {
      e.preventDefault(); goPrevFolder();
    } else if (k === 'ArrowDown') {
      e.preventDefault(); goNextFolder();
    } else if (k === 'a' || k === 'A') {
      e.preventDefault(); toggleAutoplay();
    } else if (k === 'f' || k === 'F') {
      e.preventDefault(); toggleFullscreen();
    } else if (k === 't' || k === 'T') {
      e.preventDefault(); toggleTreePanel();
    } else if (k >= '1' && k <= '9') {
      e.preventDefault();
      setAutoplayInterval(parseInt(k, 10) - 1);
    }
  }

  // ---------- entry & cleanup -------------------------------------
  /**
   * Entry: inject the Gallery layout into the given container and initialize
   * event bindings. Called by app.js when navigating to the gallery page.
   * @param {HTMLElement} container
   */
  window.renderGallery = function(container) {
    try {
      renderInitial(container);

      // Restore tree panel UI state if tree was open
      var panel = document.getElementById('gallery-tree-panel');
      var btn = document.getElementById('gallery-tree-btn');
      if (panel) panel.classList.toggle('hidden', !state.treeOpen);
      if (btn) btn.classList.toggle('active', state.treeOpen);

      if (state.items && state.items.length) {
        // Tab-switching back from another page: restore current session and index
        updateDirStructure();
        var targetIndex = (state.index >= 0 && state.index < state.items.length) ? state.index : 0;
        setActive(targetIndex);
      }
    } catch (e) {
      console.warn('renderGallery failed:', e);
    }
  };

  /**
   * Cleanup: suspend gallery state, stop timers, remove document-level
   * listeners when leaving the page without destroying loaded items.
   */
  window.cleanupGallery = function() {
    stopAutoplay();
    unbindFullscreen();
    document.body.classList.remove('gallery-fullscreen-active');
    if (typeof window.toggleNativeFullscreen === 'function') {
      try { window.toggleNativeFullscreen(false); } catch (e) {}
    }
    if (state.pageKeyHandler) {
      document.removeEventListener('keydown', state.pageKeyHandler);
      state.pageKeyHandler = null;
    }
    if (state.pasteHandler) {
      document.removeEventListener('paste', state.pasteHandler);
      state.pasteHandler = null;
    }
    if (state.thumbObserver) {
      state.thumbObserver.disconnect();
      state.thumbObserver = null;
    }
    var layout = document.getElementById('gallery-layout');
    if (layout) layout.classList.remove('gallery-layout-fullscreen');
    var c = state.container;
    state.container = null;
    if (c) c.classList.remove('gallery-page');
  };
})();
