// gallery.js — Gallery image viewer for TinyRouter (playground build only).

(function() {
  'use strict';

  // ---------- helpers ----------------------------------------------
  var SUPPORTED_IMG_EXTS = ['webp', 'png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif', 'avif', 'gif'];
  var SUPPORTED_VIDEO_EXTS = ['mp4', 'webm', 'ogv'];
  var AUTOPLAY_INTERVALS = [1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, 120000]; // ms
  var AUTOPLAY_LABELS = ['1s', '2s', '3s', '5s', '10s', '15s', '30s', '60s', '120s'];
  var THUMB_SIZE = 300;

  function isVideoExt(name) {
    if (!name) return false;
    var dot = name.lastIndexOf('.');
    if (dot < 0) return false;
    var ext = name.slice(dot + 1).toLowerCase();
    return SUPPORTED_VIDEO_EXTS.indexOf(ext) >= 0;
  }

  function isSupportedExt(name) {
    if (!name) return false;
    var dot = name.lastIndexOf('.');
    if (dot < 0) return false;
    var ext = name.slice(dot + 1).toLowerCase();
    return SUPPORTED_IMG_EXTS.indexOf(ext) >= 0 || SUPPORTED_VIDEO_EXTS.indexOf(ext) >= 0;
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

  function formatTime(secs) {
    if (isNaN(secs) || secs < 0) return '00:00';
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
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

  function showMsg(text, targetPaneId) {
    var isVidActive = (state.viewMode === 'split') ? (state.focus === 'video') : (state.mediaType === 'video');
    var el;
    if (targetPaneId) {
      var pane = document.getElementById(targetPaneId);
      if (pane) el = pane.querySelector('#gallery-toolbar-msg');
    }
    if (!el && isVidActive) {
      var vidPane = document.getElementById('gallery-pane-video');
      if (vidPane) el = vidPane.querySelector('#gallery-toolbar-msg');
    }
    if (!el) el = document.getElementById('gallery-toolbar-msg');
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
    videoItems: [],
    videoIndex: -1,
    videoPlayingState: false,
    viewMode: 'single',
    mediaType: 'image',
    focus: 'image',
    videoURL: null,
    videoCurDirPath: '',
    videoDirMap: {},
    videoDirPathList: [],
    currentVideoFolderIndices: [],
    currentVideoSubIndex: -1,
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

  var SVG_ICONS = {
    tree: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.5" fill="currentColor"/><circle cx="4.5" cy="12" r="1.5" fill="currentColor"/><circle cx="4.5" cy="18" r="1.5" fill="currentColor"/></svg>',
    prevFolder: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/></svg>',
    prev: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    pause: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
    stop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    next: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    nextFolder: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/></svg>',
    volume: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    single: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
    dual: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/></svg>',
    picture: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    video: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    fullscreen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>'
  };

  function trackURL(url) {
    if (url) state.objectURLs.push(url);
    return url;
  }

  function clearObjectURLs() {
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
        var zPath = item.zipPath || item.path || '';
        var identifier = (typeof item.index === 'number' && item.index >= 0) ? String(item.index) : zPath.split('/').map(encodeURIComponent).join('/');
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
    updateLayoutMode();

    // hidden fallback input
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*,.zip';
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

    state.pasteHandler = onPaste;
    document.addEventListener('paste', state.pasteHandler);

    if (!state.pageKeyHandler) {
      state.pageKeyHandler = onGalleryKeyDown;
      document.addEventListener('keydown', state.pageKeyHandler);
    }
  }

  // ---------- split / media mode & focus handlers ---------------------
  function toggleSplitMode() {
    if (state.viewMode === 'split') {
      state.viewMode = 'single';
      state.mediaType = state.focus; // Inherit focus side mode on exit!
    } else {
      state.viewMode = 'split';
    }
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
    // Focus indicator handled by CSS border and fullscreen left accent border line
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

    var containerW = window.innerWidth || document.documentElement.clientWidth || 1920;
    var containerH = window.innerHeight || document.documentElement.clientHeight || 1080;

    var ratioImg, ratioVid;

    var isImgPortrait = rImg < 1.0;
    var isVidPortrait = rVid < 1.0;

    if (isImgPortrait && !isVidPortrait) {
      // 图片竖向，视频横向/方图：图片优先占满 100vh 高度，算出其所需宽度占比，剩余归视频
      var neededImgW = containerH * rImg;
      ratioImg = neededImgW / containerW;
      ratioImg = Math.max(0.20, Math.min(0.75, ratioImg));
      ratioVid = 1 - ratioImg;
    } else if (!isImgPortrait && isVidPortrait) {
      // 视频竖向，图片横向/方图：视频优先占满 100vh 高度，算出其所需宽度占比，剩余归图片
      var neededVidW = containerH * rVid;
      ratioVid = neededVidW / containerW;
      ratioVid = Math.max(0.20, Math.min(0.75, ratioVid));
      ratioImg = 1 - ratioVid;
    } else if (isImgPortrait && isVidPortrait) {
      // 两侧均为竖向：按各自 Aspect Ratio 的比例分配宽度
      ratioImg = rImg / (rImg + rVid);
      ratioImg = Math.max(0.25, Math.min(0.75, ratioImg));
      ratioVid = 1 - ratioImg;
    } else {
      // 两侧均为横向或 1:1：左右平分各 50%
      ratioImg = 0.5;
      ratioVid = 0.5;
    }

    paneImg.style.flex = (ratioImg * 100) + ' 1 0%';
    paneVid.style.flex = (ratioVid * 100) + ' 1 0%';
  }

  function buildPanelHTML(type, isSplit) {
    var isVid = (type === 'video');
    var panelId = isVid ? 'gallery-pane-video' : 'gallery-pane-image';
    var focused = (state.viewMode === 'split' && state.focus === type) ? ' focused' : '';
    var showTree = state.treeOpen && ((state.viewMode === 'split' && state.focus === type) || (state.viewMode === 'single'));
    var treeClass = showTree ? '' : ' hidden';

    var splitIcon = (state.viewMode === 'split') ? SVG_ICONS.single : SVG_ICONS.dual;
    var splitBtnTitle = (state.viewMode === 'split') ? 'Single View (D)' : 'Dual View (D)';

    var modeIcon = (state.mediaType === 'video') ? SVG_ICONS.picture : SVG_ICONS.video;
    var modeBtnTitle = (state.mediaType === 'video') ? 'Picture Mode (M)' : 'Video Mode (M)';

    // Mode button is hidden in split mode!
    var modeBtnHTML = isSplit ? '' : '<button class="gallery-btn gallery-btn-icon" id="gallery-mode-btn" type="button" title="' + modeBtnTitle + '">' + modeIcon + '</button>';

    var autoPlayIcon = state.autoplayOn ? SVG_ICONS.stop : SVG_ICONS.play;
    var autoPlayTitle = state.autoplayOn ? 'Stop (A / ■)' : 'Autoplay (A / ▶)';

    var ctrlCenter = isVid ?
      '<button class="gallery-btn gallery-btn-icon" id="gallery-vid-prev-btn" type="button" title="Prev Video (‹ / Up)">' + SVG_ICONS.prev + '</button>' +
      '<button class="gallery-btn gallery-btn-icon" id="gallery-vid-play" type="button" title="Play / Pause (Space)">' + SVG_ICONS.play + '</button>' +
      '<button class="gallery-btn gallery-btn-icon" id="gallery-vid-stop" type="button" title="Stop">' + SVG_ICONS.stop + '</button>' +
      '<button class="gallery-btn gallery-btn-icon" id="gallery-vid-next-btn" type="button" title="Next Video (› / Down)">' + SVG_ICONS.next + '</button>'
      :
      '<button class="gallery-btn gallery-btn-icon" id="gallery-prev-folder-btn" type="button" title="Prev Folder (&lt;| / Up)">' + SVG_ICONS.prevFolder + '</button>' +
      '<button class="gallery-btn gallery-btn-icon" id="gallery-prev-btn" type="button" title="Prev (‹ / Left / PageUp)">' + SVG_ICONS.prev + '</button>' +
      '<div class="gallery-auto-wrapper" id="gallery-auto-wrapper">' +
        '<button class="gallery-btn gallery-btn-icon" id="gallery-autoplay-btn" type="button" title="' + autoPlayTitle + '">' + autoPlayIcon + '</button>' +
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
      '<button class="gallery-btn gallery-btn-icon" id="gallery-next-btn" type="button" title="Next (› / Right / PageDown / Space)">' + SVG_ICONS.next + '</button>' +
      '<button class="gallery-btn gallery-btn-icon" id="gallery-next-folder-btn" type="button" title="Next Folder (|&gt; / Down)">' + SVG_ICONS.nextFolder + '</button>';

    var extraRight = isVid ?
      '<div class="gallery-vol-wrapper">' +
        '<button class="gallery-btn gallery-btn-icon" id="gallery-vol-btn" type="button" title="Volume">' + SVG_ICONS.volume + '</button>' +
        '<div class="gallery-vol-popover">' +
          '<input type="range" class="gallery-vol-slider-vert" id="gallery-vol-slider" value="80" min="0" max="100" title="Volume">' +
        '</div>' +
      '</div>'
      : '';

    var mainInner = isVid ?
      '<video class="gallery-main-video" id="gallery-main-video"></video>' +
      '<div class="gallery-video-hover-ctrl" id="gallery-video-ctrl">' +
        '<input type="range" class="gallery-video-seeker" id="gallery-video-seeker" value="0" min="0" max="100" step="0.1">' +
        '<div class="gallery-video-bar">' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span id="gallery-vid-time" style="font-family:monospace">00:00 / 00:00</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span>' + SVG_ICONS.volume + '</span>' +
            '<span id="gallery-vid-info" style="font-family:monospace">-</span>' +
          '</div>' +
        '</div>' +
      '</div>'
      :
      '<img class="gallery-main-img" id="gallery-main-img" alt="">' +
      '<div class="gallery-empty" id="gallery-empty" style="display:none">' +
        '<div class="gallery-empty-icon">⬚</div>' +
        '<div class="gallery-empty-hint">' + escapeHtml(T('Drop/Paste/Open') || 'Drop / Paste / Open') + '</div>' +
      '</div>';

    var treeId = isVid ? 'gallery-video-tree-panel' : 'gallery-tree-panel';
    var pathId = isVid ? 'gallery-video-path' : 'gallery-path';
    var infoId = isVid ? 'gallery-video-info' : 'gallery-info';
    var thumbsHTML = isVid ? '' : '<div class="gallery-thumbnails" id="gallery-thumbnails"></div>';

    return '<div class="gallery-pane' + focused + '" id="' + panelId + '">' +
             '<div class="gallery-tree-panel' + treeClass + '" id="' + treeId + '"></div>' +
             '<div class="gallery-main-area">' +
               '<div class="gallery-main" id="gallery-main">' +
                 mainInner +
                 '<span class="gallery-main-msg" id="gallery-toolbar-msg" style="display:none"></span>' +
               '</div>' +
               '<div class="gallery-bottom">' +
                 thumbsHTML +
                 '<div class="gallery-controls">' +
                   '<button class="gallery-btn gallery-btn-icon" id="' + (isVid ? 'gallery-vid-tree-btn' : 'gallery-tree-btn') + '" type="button" title="Directory Tree (T)">' + SVG_ICONS.tree + '</button>' +
                   '<div class="gallery-path" id="' + pathId + '" title="">-</div>' +
                   '<div class="gallery-ctrl-center">' + ctrlCenter + '</div>' +
                   '<div class="gallery-ctrl-right">' +
                     extraRight +
                     '<span class="gallery-info" id="' + infoId + '">0 / 0</span>' +
                     '<button class="gallery-btn gallery-btn-icon" id="gallery-split-btn" type="button" title="' + splitBtnTitle + '">' + splitIcon + '</button>' +
                     modeBtnHTML +
                     '<button class="gallery-btn gallery-btn-icon" id="gallery-fs-btn" type="button" title="Fullscreen (F)">' + SVG_ICONS.fullscreen + '</button>' +
                   '</div>' +
                 '</div>' +
               '</div>' +
             '</div>' +
           '</div>';
  }

  function updateLayoutMode() {
    var vidElBefore = document.getElementById('gallery-main-video');
    if (vidElBefore) {
      if (vidElBefore.currentTime > 0) state.videoCurrentTime = vidElBefore.currentTime;
      state.videoPaused = vidElBefore.paused;
    }

    var layout = document.getElementById('gallery-layout');
    if (!layout && state.container) {
      layout = document.createElement('div');
      layout.className = 'gallery-layout';
      layout.id = 'gallery-layout';
      state.container.appendChild(layout);
    }
    if (!layout) return;

    if (state.viewMode === 'split') {
      layout.className = 'gallery-layout gallery-main-split';
      layout.innerHTML = buildPanelHTML('image', true) + buildPanelHTML('video', true);
    } else {
      layout.className = 'gallery-layout';
      layout.innerHTML = buildPanelHTML(state.mediaType, false);
    }

    layout.addEventListener('dragover', onDragOver);
    layout.addEventListener('dragenter', onDragEnter);
    layout.addEventListener('dragleave', onDragLeave);
    layout.addEventListener('drop', onDrop);

    bindEventsForCurrentLayout();

    renderTreePanel();
    renderThumbnails();
    if (state.index >= 0 && state.items.length) renderActive(state.index);
    if (state.videoIndex >= 0 && state.videoItems.length) renderActiveVideo(state.videoIndex);
    autoBalanceFullscreenSplitRatio();
  }

  function updateFocusUIOnly() {
    var paneImg = document.getElementById('gallery-pane-image');
    var paneVid = document.getElementById('gallery-pane-video');
    if (paneImg) paneImg.classList.toggle('focused', state.focus === 'image');
    if (paneVid) paneVid.classList.toggle('focused', state.focus === 'video');

    if (state.treeOpen) renderTreePanel();
  }

  function switchFocus() {
    if (state.viewMode !== 'split') return;
    state.focus = (state.focus === 'image') ? 'video' : 'image';
    updateFocusUIOnly();
    flashFocusOverlay(state.focus);
  }

  function bindEventsForCurrentLayout() {
    var paneImg = document.getElementById('gallery-pane-image');
    var paneVid = document.getElementById('gallery-pane-video');

    if (paneImg) {
      paneImg.addEventListener('click', function(e) {
        if (state.viewMode === 'split' && state.focus !== 'image') {
          state.focus = 'image';
          updateFocusUIOnly();
          flashFocusOverlay('image');
        }
      });
    }
    if (paneVid) {
      paneVid.addEventListener('click', function(e) {
        if (state.viewMode === 'split' && state.focus !== 'video') {
          state.focus = 'video';
          updateFocusUIOnly();
          flashFocusOverlay('video');
        }
      });
    }

    var treeBtn = document.getElementById('gallery-tree-btn');
    if (treeBtn) treeBtn.onclick = toggleTreePanel;
    var vidTreeBtn = document.getElementById('gallery-vid-tree-btn');
    if (vidTreeBtn) vidTreeBtn.onclick = toggleTreePanel;

    var splitBtns = document.querySelectorAll('#gallery-split-btn');
    splitBtns.forEach(function(b) {
      b.onclick = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        toggleSplitMode();
      };
    });

    var modeBtns = document.querySelectorAll('#gallery-mode-btn');
    modeBtns.forEach(function(b) {
      b.onclick = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        toggleMediaType();
      };
    });

    var fsBtns = document.querySelectorAll('#gallery-fs-btn');
    fsBtns.forEach(function(b) {
      b.onclick = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        toggleFullscreen();
      };
    });

    var empty = document.getElementById('gallery-empty');
    if (empty) empty.onclick = onOpenClick;

    // image controls
    var prevFolderBtn = document.getElementById('gallery-prev-folder-btn');
    if (prevFolderBtn) prevFolderBtn.onclick = goPrevFolder;
    var prevBtn = document.getElementById('gallery-prev-btn');
    if (prevBtn) prevBtn.onclick = goPrev;
    var nextBtn = document.getElementById('gallery-next-btn');
    if (nextBtn) nextBtn.onclick = goNext;
    var nextFolderBtn = document.getElementById('gallery-next-folder-btn');
    if (nextFolderBtn) nextFolderBtn.onclick = goNextFolder;
    var autoBtn = document.getElementById('gallery-autoplay-btn');
    if (autoBtn) autoBtn.onclick = toggleAutoplay;

    var dropdown = document.getElementById('gallery-interval-dropdown');
    if (dropdown) {
      dropdown.onclick = function(e) {
        var item = e.target.closest('[data-idx]');
        if (!item) return;
        var idx = parseInt(item.dataset.idx, 10);
        if (!isNaN(idx)) setAutoplayInterval(idx);
      };
    }

    // video controls
    var vidPrevFolderBtn = document.getElementById('gallery-vid-prev-folder-btn');
    if (vidPrevFolderBtn) vidPrevFolderBtn.onclick = goPrevFolder;
    var vidPrevBtn = document.getElementById('gallery-vid-prev-btn');
    if (vidPrevBtn) vidPrevBtn.onclick = function() { setVideoActive(state.videoIndex - 1); };
    var vidNextBtn = document.getElementById('gallery-vid-next-btn');
    if (vidNextBtn) vidNextBtn.onclick = function() { setVideoActive(state.videoIndex + 1); };
    var vidNextFolderBtn = document.getElementById('gallery-vid-next-folder-btn');
    if (vidNextFolderBtn) vidNextFolderBtn.onclick = goNextFolder;

    bindVideoControls();

    var treePanels = document.querySelectorAll('#gallery-tree-panel, #gallery-video-tree-panel');
    treePanels.forEach(function(tp) {
      tp.onclick = function(e) {
        var target = e.target.closest('.gallery-tree-node');
        if (!target) return;
        var dir = target.getAttribute('data-dir');
        var isVid = (state.viewMode === 'split') ? (state.focus === 'video') : (state.mediaType === 'video');
        var map = isVid ? state.videoDirMap : state.dirMap;
        if (dir && map[dir] && map[dir].length) {
          if (isVid) setVideoActive(map[dir][0]);
          else setActive(map[dir][0]);
        }
      };
    });
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
    var isVidActive = (state.viewMode === 'split') ? (state.focus === 'video') : (state.mediaType === 'video');
    var activeTreeId = isVidActive ? 'gallery-video-tree-panel' : 'gallery-tree-panel';
    var activeBtnId = isVidActive ? 'gallery-vid-tree-btn' : 'gallery-tree-btn';

    var panel = document.getElementById(activeTreeId);
    var btn = document.getElementById(activeBtnId);

    if (panel) panel.classList.toggle('hidden', !state.treeOpen);
    if (btn) btn.classList.toggle('active', state.treeOpen);
    renderTreePanel();
  }

  function renderTreePanel() {
    var isVidActive = (state.viewMode === 'split') ? (state.focus === 'video') : (state.mediaType === 'video');
    var panel = document.getElementById(isVidActive ? 'gallery-video-tree-panel' : 'gallery-tree-panel');
    if (!panel) panel = document.getElementById('gallery-tree-panel');
    if (!panel) return;

    if (isVidActive) {
      if (!state.videoItems || !state.videoItems.length) {
        panel.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted)">No Videos</div>';
        return;
      }

      // Check if all videos are in root
      var hasDirs = false;
      for (var v = 0; v < state.videoItems.length; v++) {
        if ((state.videoItems[v].path || '').indexOf('/') !== -1) {
          hasDirs = true;
          break;
        }
      }

      var html = '';
      if (!hasDirs) {
        // Flat list of individual video files
        for (var i = 0; i < state.videoItems.length; i++) {
          var item = state.videoItems[i];
          var vName = item.name || item.path || ('Video ' + (i + 1));
          var isAct = (i === state.videoIndex) ? ' active' : '';
          html += '<div class="gallery-tree-node' + isAct + '" data-vid-idx="' + i + '" style="padding-left:8px" title="' + escapeHtml(vName) + '">' +
                    '<span class="tree-icon">🎬</span>' +
                    '<span class="tree-name">' + escapeHtml(vName) + '</span>' +
                  '</div>';
        }
      } else {
        // Grouped by directory with individual video items
        var vDirMap = {};
        var vDirList = [];
        for (var j = 0; j < state.videoItems.length; j++) {
          var vp = state.videoItems[j].path || '';
          var parts = vp.split('/');
          var dPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
          if (!vDirMap[dPath]) {
            vDirMap[dPath] = [];
            vDirList.push(dPath);
          }
          vDirMap[dPath].push(j);
        }

        for (var d = 0; d < vDirList.length; d++) {
          var dirKey = vDirList[d];
          var vIndices = vDirMap[dirKey];
          if (dirKey) {
            var dParts = dirKey.split('/');
            var dName = dParts[dParts.length - 1];
            var dIndent = (dParts.length - 1) * 12 + 8;
            html += '<div class="gallery-tree-node tree-folder-node" style="padding-left:' + dIndent + 'px;font-weight:600" title="' + escapeHtml(dirKey) + '">' +
                      '<span class="tree-icon">📁</span>' +
                      '<span class="tree-name">' + escapeHtml(dName) + '</span>' +
                      '<span class="tree-count">' + vIndices.length + '</span>' +
                    '</div>';
          }
          var fileIndent = (dirKey ? dirKey.split('/').length * 12 : 0) + 8;
          for (var k = 0; k < vIndices.length; k++) {
            var vIdx = vIndices[k];
            var vItem = state.videoItems[vIdx];
            var fName = vItem.name || (vItem.path ? vItem.path.split('/').pop() : ('Video ' + (vIdx + 1)));
            var vAct = (vIdx === state.videoIndex) ? ' active' : '';
            html += '<div class="gallery-tree-node' + vAct + '" data-vid-idx="' + vIdx + '" style="padding-left:' + fileIndent + 'px" title="' + escapeHtml(fName) + '">' +
                      '<span class="tree-icon">🎬</span>' +
                      '<span class="tree-name">' + escapeHtml(fName) + '</span>' +
                    '</div>';
          }
        }
      }
      panel.innerHTML = html;

      // Bind video item clicks
      var vNodes = panel.querySelectorAll('[data-vid-idx]');
      vNodes.forEach(function(node) {
        node.onclick = function(e) {
          if (e) { e.preventDefault(); e.stopPropagation(); }
          var idx = parseInt(node.getAttribute('data-vid-idx'), 10);
          if (!isNaN(idx)) setVideoActive(idx);
        };
      });
      return;
    }

    // Image & Zip Tree rendering
    if (!state.items || !state.items.length) {
      panel.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted)">No Images</div>';
      return;
    }

    // Build hierarchical tree structure for images & zips
    var treeMap = {};
    var treeOrder = [];

    for (var idx = 0; idx < state.items.length; idx++) {
      var itemPath = state.items[idx].path || '';
      var segs = itemPath.split('/');
      if (segs.length > 1) {
        segs.pop(); // Remove filename
        var fullDir = segs.join('/');
        var acc = '';
        for (var s = 0; s < segs.length; s++) {
          var seg = segs[s];
          acc = acc ? (acc + '/' + seg) : seg;
          if (!treeMap[acc]) {
            treeMap[acc] = { key: acc, name: seg, count: 0, firstIndex: idx, level: s };
            treeOrder.push(acc);
          }
        }
        if (treeMap[fullDir]) {
          treeMap[fullDir].count++;
        }
      } else {
        // Direct root images
        if (!treeMap['']) {
          treeMap[''] = { key: '', name: 'Root', count: 0, firstIndex: idx, level: 0 };
          treeOrder.unshift('');
        }
        treeMap[''].count++;
      }
    }

    var htmlImg = '';
    for (var t = 0; t < treeOrder.length; t++) {
      var tKey = treeOrder[t];
      var node = treeMap[tKey];
      var indent = node.level * 12 + 8;
      var isActive = (tKey === state.curDirPath) ? ' active' : '';
      var icon = '📁';
      if (isZipName(node.name) || tKey.indexOf('.zip/') !== -1 || isZipName(tKey)) {
        icon = '📦';
      } else if (tKey === '') {
        icon = '🖼';
      }

      htmlImg += '<div class="gallery-tree-node' + isActive + '" data-dir="' + escapeHtml(tKey) + '" data-first-idx="' + node.firstIndex + '" style="padding-left:' + indent + 'px" title="' + escapeHtml(tKey || 'Root') + '">' +
                   '<span class="tree-icon">' + icon + '</span>' +
                   '<span class="tree-name">' + escapeHtml(node.name) + '</span>' +
                   '<span class="tree-count">' + node.count + '</span>' +
                 '</div>';
    }
    panel.innerHTML = htmlImg;

    // Bind image tree node clicks
    var imgNodes = panel.querySelectorAll('[data-first-idx]');
    imgNodes.forEach(function(node) {
      node.onclick = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var fIdx = parseInt(node.getAttribute('data-first-idx'), 10);
        var dir = node.getAttribute('data-dir');
        if (typeof dir === 'string') state.curDirPath = dir;
        if (!isNaN(fIdx)) setActive(fIdx);
      };
    });
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
        if (!item) return;
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
    state.videoPlayingState = false;
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

    // Parallel process all zip files
    zipFiles.sort(function(a, b) {
      return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
    });

    if (zipFiles.length > 0) {
      var zipPromises = zipFiles.map(function(zf) {
        return addZipBlob(zf, outImg);
      });
      await Promise.all(zipPromises);
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
    renderTreePanel();
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
      var zipName = file.path || file.name || 'archive.zip';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var nm = e.path.split('/').pop();
        var displayPath = zipName + '/' + e.path;
        out.push({
          name: nm,
          path: displayPath,
          kind: 'zip',
          index: (typeof e.index === 'number' ? e.index : i),
          zipPath: e.path,
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
      btn.innerHTML = SVG_ICONS.play;
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
      btn.innerHTML = SVG_ICONS.stop;
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
    var layout = document.getElementById('gallery-layout');
    var target = layout || document.documentElement;

    var p = target.requestFullscreen ? target.requestFullscreen() : Promise.resolve();
    p.catch(function(e) { console.warn('enterFullscreen failed:', e); });
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
    renderTreePanel();
  }

  function renderActiveVideo(index) {
    var item = state.videoItems[index];
    var vidEl = document.getElementById('gallery-main-video');
    var pathEl = document.getElementById('gallery-video-path') || document.getElementById('gallery-path');
    var info = document.getElementById('gallery-video-info') || document.getElementById('gallery-info');

    if (!item) {
      if (vidEl) vidEl.removeAttribute('src');
      if (pathEl) { pathEl.textContent = '-'; pathEl.title = ''; }
      if (info) info.textContent = '0 / 0 | Video';
      return;
    }

    if (pathEl) {
      var displayPath = item.path || item.name || '';
      pathEl.textContent = displayPath;
      pathEl.title = displayPath;
    }

    ensureMainSrc(item).then(function() {
      if (vidEl && item.mainURL) {
        state.videoURL = item.mainURL;
        if (vidEl.src !== item.mainURL) {
          vidEl.src = item.mainURL;
        }
        var restoreVidState = function() {
          if (state.videoPlayingState === true) {
            try { vidEl.play().catch(function() {}); } catch (e) {}
          } else {
            try { vidEl.pause(); } catch (e) {}
          }
        };
        if (vidEl.readyState >= 1) {
          restoreVidState();
        } else {
          vidEl.onloadedmetadata = restoreVidState;
        }
      }
      if (info) {
        var countStr = (index + 1) + ' / ' + state.videoItems.length;
        info.textContent = countStr + ' | Video';
      }
      autoBalanceFullscreenSplitRatio();
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
        state.videoPlayingState = false;
      };
    }
    vidEl.onplay = function() {
      state.videoPlayingState = true;
      if (playBtn) playBtn.innerHTML = SVG_ICONS.pause;
    };
    vidEl.onpause = function() {
      state.videoPlayingState = false;
      if (playBtn) playBtn.innerHTML = SVG_ICONS.play;
    };
    vidEl.onended = function() {
      state.videoPlayingState = true;
      setVideoActive(state.videoIndex + 1);
    };

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
    var layout = document.getElementById('gallery-layout');
    if (!layout && typeof currentPage !== 'undefined' && currentPage !== 'gallery') return;
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
