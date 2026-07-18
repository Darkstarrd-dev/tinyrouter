// gallery.js — Gallery image viewer for TinyRouter (playground build only).

(function() {
  'use strict';

  // ---------- helpers ----------------------------------------------
  var SUPPORTED_EXTS = ['webp', 'png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif'];
  var AUTOPLAY_INTERVALS = [1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, 120000]; // ms
  var AUTOPLAY_LABELS = ['1s', '2s', '3s', '5s', '10s', '15s', '30s', '60s', '120s'];
  var THUMB_SIZE = 96;

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

  function sortItems(items) {
    items.sort(function(a, b) {
      var pa = a.path || '';
      var pb = b.path || '';
      return pa.localeCompare(pb, undefined, { numeric: true, sensitivity: 'base' });
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
    pasteHandler: null,
    zipSessionId: null,
    zipEntriesCache: null,
    objectURLs: [],
    thumbObserver: null,
    container: null
  };

  function trackURL(url) {
    if (url) state.objectURLs.push(url);
    return url;
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
        var url = '/api/gallery/zip/' + encodeURIComponent(state.zipSessionId) + '/' + encodeURIComponent(item.path);
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
        var canvas = new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
        var scale = Math.min(THUMB_SIZE / bitmap.width, THUMB_SIZE / bitmap.height);
        var w = Math.round(bitmap.width * scale);
        var h = Math.round(bitmap.height * scale);
        ctx.drawImage(bitmap, (THUMB_SIZE - w) / 2, (THUMB_SIZE - h) / 2, w, h);
        bitmap.close && bitmap.close();
        var tblob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
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
    // BFS: collect top-level entries first, then process directories in a queue.
    var queue = [];
    queue.push({ handle: dirHandle, prefix: prefix });
    while (queue.length) {
      var cur = queue.shift();
      var entries = [];
      try {
        // eslint-disable-next-line no-await-in-loop
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
        '<div class="gallery-toolbar">' +
          '<div class="gallery-drop-zone" id="gallery-drop-zone">' +
            '<span class="gallery-drop-hint">' + escapeHtml(T('Drop/Paste/Open') || 'Drop / Paste / Open') + '</span>' +
            '<button class="btn" id="gallery-open-btn" type="button">' + escapeHtml(T('Open') || 'Open') + '</button>' +
          '</div>' +
          '<span class="gallery-toolbar-msg" id="gallery-toolbar-msg" style="display:none"></span>' +
          '<div class="gallery-counter" id="gallery-counter">0 / 0</div>' +
          '<div class="gallery-info" id="gallery-info"></div>' +
        '</div>' +
        '<div class="gallery-main" id="gallery-main">' +
          '<img class="gallery-main-img" id="gallery-main-img" alt="">' +
        '</div>' +
        '<div class="gallery-bottom">' +
          '<div class="gallery-thumbnails" id="gallery-thumbnails"></div>' +
          '<div class="gallery-controls">' +
            '<button class="btn" id="gallery-prev-btn" type="button">' + escapeHtml(T('Prev') || 'Prev') + '</button>' +
            '<button class="btn" id="gallery-autoplay-btn" type="button">' + escapeHtml(T('Auto') || 'Auto') + '</button>' +
            '<select class="gallery-interval" id="gallery-interval">' +
              AUTOPLAY_LABELS.map(function(l, i) {
                return '<option value="' + i + '">' + escapeHtml(l) + ' ' + escapeHtml(T('IntervalSec') || 'sec') + '</option>';
              }).join('') +
            '</select>' +
            '<button class="btn" id="gallery-next-btn" type="button">' + escapeHtml(T('Next') || 'Next') + '</button>' +
            '<button class="btn" id="gallery-fs-btn" type="button">' + escapeHtml(T('Fullscreen') || 'Fullscreen') + '</button>' +
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

    var zone = document.getElementById('gallery-drop-zone');
    var layout = document.getElementById('gallery-layout');

    layout.addEventListener('dragover', onDragOver);
    layout.addEventListener('dragenter', onDragEnter);
    layout.addEventListener('dragleave', onDragLeave);
    layout.addEventListener('drop', onDrop);

    document.getElementById('gallery-open-btn').addEventListener('click', onOpenClick);
    document.getElementById('gallery-prev-btn').addEventListener('click', goPrev);
    document.getElementById('gallery-next-btn').addEventListener('click', goNext);
    document.getElementById('gallery-autoplay-btn').addEventListener('click', toggleAutoplay);
    document.getElementById('gallery-fs-btn').addEventListener('click', enterFullscreen);
    var sel = document.getElementById('gallery-interval');
    sel.value = String(AUTOPLAY_INTERVALS.indexOf(state.autoplayInterval));
    sel.addEventListener('change', function(e) {
      setAutoplayInterval(parseInt(e.target.value, 10) || 0);
    });

    state.pasteHandler = onPaste;
    document.addEventListener('paste', state.pasteHandler);
  }

  function renderThumbnails() {
    var wrap = document.getElementById('gallery-thumbnails');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (state.thumbObserver) {
      state.thumbObserver.disconnect();
      state.thumbObserver = null;
    }
    if (!state.items.length) return;

    state.thumbObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(en) {
        if (en.isIntersecting) {
          var idx = parseInt(en.target.dataset.idx, 10);
          var item = state.items[idx];
          if (item && !item.thumbReady) ensureThumb(item);
        }
      });
    }, { root: wrap, rootMargin: '120px' });

    for (var i = 0; i < state.items.length; i++) {
      (function(idx) {
        var item = state.items[idx];
        var div = document.createElement('div');
        div.className = 'gallery-thumb';
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
      })(i);
    }
  }

  function renderActive(index) {
    var item = state.items[index];
    var imgEl = document.getElementById('gallery-main-img');
    var counter = document.getElementById('gallery-counter');
    var info = document.getElementById('gallery-info');
    if (counter) counter.textContent = (state.items.length ? (index + 1) : 0) + ' / ' + state.items.length;

    // highlight active thumb
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].thumbDivEl) {
        state.items[i].thumbDivEl.classList.toggle('active', i === index);
      }
    }
    if (item && item.thumbDivEl) {
      item.thumbDivEl.scrollIntoView({ inline: 'center', block: 'nearest' });
    }

    if (!item) {
      if (imgEl) imgEl.removeAttribute('src');
      if (info) info.textContent = '';
      return;
    }

    ensureMainSrc(item).then(function() {
      if (imgEl && item.mainURL) {
        if (state.mainURL && state.mainURL !== item.mainURL) {
          URL.revokeObjectURL(state.mainURL);
          var pos = state.objectURLs.indexOf(state.mainURL);
          if (pos >= 0) state.objectURLs.splice(pos, 1);
        }
        state.mainURL = item.mainURL;
        imgEl.src = item.mainURL;
      }
      if (info) info.textContent = (escapeHtml(item.path) || escapeHtml(item.name)) + ' | ' + (T('Loading...') || 'Loading...');
      updateInfo(item, info);
    }).catch(function(e) { console.warn('renderActive failed:', e); });
  }

  function updateInfo(item, info) {
    getItemBlob(item).then(function(blob) {
      if (!blob) return;
      item.size = blob.size;
      var sizeStr = prettySize(blob.size);
      createImageBitmap(blob).then(function(bmp) {
        var dim = bmp.width + 'x' + bmp.height;
        bmp.close && bmp.close();
        if (info) info.textContent = (escapeHtml(item.path) || escapeHtml(item.name)) + ' | ' + dim + ' | ' + sizeStr;
      }).catch(function() {
        if (info) info.textContent = (escapeHtml(item.path) || escapeHtml(item.name)) + ' | ? | ' + sizeStr;
      });
    }).catch(function() {});
  }

  function setActive(index) {
    if (!state.items.length) return;
    if (index < 0) index = state.items.length - 1;
    if (index >= state.items.length) index = 0;
    state.index = index;
    renderActive(index);
  }

  // ---------- event handlers ---------------------------------------
  function onDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onDragEnter(e) {
    e.preventDefault();
    var zone = document.getElementById('gallery-drop-zone');
    if (zone) zone.classList.add('drag-active');
  }

  function onDragLeave(e) {
    var zone = document.getElementById('gallery-drop-zone');
    if (zone) zone.classList.remove('drag-active');
  }

  function onDrop(e) {
    e.preventDefault();
    var zone = document.getElementById('gallery-drop-zone');
    if (zone) zone.classList.remove('drag-active');
    var dt = e.dataTransfer;
    if (!dt) return;
    var items = dt.items;
    if (items && items.length && typeof items[0].getAsFileSystemHandle === 'function') {
      var handles = [];
      var files = [];
      var pending = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.kind !== 'file') continue;
        pending.push((async function(item) {
          try {
            var handle = await item.getAsFileSystemHandle();
            if (!handle) return;
            if (handle.kind === 'directory') handles.push({ kind: 'directory', handle: handle });
            else if (handle.kind === 'file') {
              if (isZipName(handle.name)) files.push({ kind: 'ziphandle', handle: handle });
              else handles.push({ kind: 'file', handle: handle });
            }
          } catch (err) {
            var f = item.getAsFile();
            if (f) files.push({ kind: 'blob', file: f });
          }
        })(it));
      }
      Promise.all(pending).then(function() {
        processHandles(handles, files);
      }).catch(function(err) { console.warn('drop handle failed:', err); });
    } else {
      var fileList = dt.files;
      if (fileList && fileList.length) {
        processFiles(Array.prototype.slice.call(fileList));
      }
    }
  }

  function onPaste(e) {
    var cd = e.clipboardData;
    if (!cd || !cd.items) return;
    var blobs = [];
    for (var i = 0; i < cd.items.length; i++) {
      var it = cd.items[i];
      if (it.kind !== 'file') continue;
      var blob = it.getAsFile();
      if (!blob) continue;
      blobs.push(blob);
    }
    if (!blobs.length) return;
    e.preventDefault();
    processBlobs(blobs);
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
        await walkDir(h, '', fsHandles);
      } else {
        if (isZipName(h.name)) blobs.push({ kind: 'ziphandle', handle: h });
        else fsHandles.push({ kind: 'file', handle: h });
      }
    }
    await processHandles(fsHandles, blobs);
  }

  // ---------- collectors -------------------------------------------
  async function processHandles(handles, leaves) {
    var out = [];
    for (var i = 0; i < handles.length; i++) {
      var h = handles[i];
      if (h.kind === 'directory') {
        await walkDir(h, '', out);
      } else if (h.kind === 'file' && h.handle) {
        var name = h.handle.name;
        if (isZipName(name)) {
          // read zip as blob
          try {
            var file = await h.handle.getFile();
            await addZipBlob(file, out);
          } catch (e) { console.warn('zip handle read failed:', e); }
        } else {
          out.push({
            name: name,
            path: name,
            kind: 'fs',
            handle: h.handle,
            getBlob: (function(hh) { return function() { return hh.getFile(); }; })(h.handle),
            size: 0
          });
        }
      }
    }
    if (leaves && leaves.length) {
      for (var j = 0; j < leaves.length; j++) {
        var lf = leaves[j];
        if (lf.kind === 'ziphandle') {
          try {
            var zf = await lf.handle.getFile();
            await addZipBlob(zf, out);
          } catch (e) { console.warn('zip leaf failed:', e); }
        } else if (lf.kind === 'file' && lf.handle) {
          try {
            var ff = await lf.handle.getFile();
            out.push({
              name: ff.name, path: ff.name, kind: 'fs',
              handle: lf.handle, getBlob: (function(hh) { return function() { return hh.getFile(); }; })(lf.handle), size: ff.size
            });
          } catch (e) { console.warn('leaf file failed:', e); }
        } else if (lf.kind === 'blob' && lf.file) {
          out.push(makePlainItem(lf.file));
        }
      }
    }
    finalizeItems(out);
  }

  function processFiles(files) {
    var plain = [];
    var zips = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (isZipName(f.name)) zips.push(f);
      else plain.push(f);
    }
    var out = [];
    for (var j = 0; j < plain.length; j++) out.push(makePlainItem(plain[j]));
    var seq = Promise.resolve();
    for (var k = 0; k < zips.length; k++) {
      seq = seq.then(function(zf) { return addZipBlob(zf, out); }.bind(null, zips[k]));
    }
    seq.then(function() { finalizeItems(out); }).catch(function(e) { console.warn('processFiles failed:', e); });
  }

  function processBlobs(blobs) {
    var out = [];
    var zips = [];
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      if (b.type === 'application/zip' || isZipName(b.name)) zips.push(b);
      else out.push(makePlainItem(b));
    }
    var seq = Promise.resolve();
    for (var k = 0; k < zips.length; k++) {
      seq = seq.then(function(zf) { return addZipBlob(zf, out); }.bind(null, zips[k]));
    }
    seq.then(function() { finalizeItems(out); }).catch(function(e) { console.warn('processBlobs failed:', e); });
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
      state.zipSessionId = data.sessionId;
      state.zipEntriesCache = data.manifest;
      var entries = (data.manifest && data.manifest.entries) || [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var nm = e.path.split('/').pop();
        out.push({
          name: nm,
          path: e.path,
          kind: 'zip',
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
    if (!out.length) {
      state.items = [];
      state.index = -1;
      renderThumbnails();
      renderActive(-1);
      return;
    }
    sortItems(out);
    state.items = out;
    state.index = -1;
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
    if (btn) btn.textContent = (T('Auto') || 'Auto');
  }

  function startAutoplay() {
    stopAutoplay();
    if (!state.items.length) return;
    state.autoplayOn = true;
    state.autoplayTimer = setInterval(goNext, state.autoplayInterval);
    var btn = document.getElementById('gallery-autoplay-btn');
    if (btn) btn.textContent = (T('Pause') || 'Pause');
  }

  function toggleAutoplay() {
    if (state.autoplayOn) stopAutoplay();
    else startAutoplay();
  }

  function setAutoplayInterval(idx) {
    if (idx < 0) idx = 0;
    if (idx >= AUTOPLAY_INTERVALS.length) idx = AUTOPLAY_INTERVALS.length - 1;
    state.autoplayInterval = AUTOPLAY_INTERVALS[idx];
    var sel = document.getElementById('gallery-interval');
    if (sel) sel.value = String(idx);
    if (state.autoplayOn) startAutoplay();
  }

  function enterFullscreen() {
    var main = document.getElementById('gallery-main');
    var target = main || document.documentElement;
    var p = target.requestFullscreen ? target.requestFullscreen() : Promise.reject(new Error('no fs'));
    p.then(function() {
      var layout = document.getElementById('gallery-layout');
      if (layout) layout.classList.add('gallery-layout-fullscreen');
      state.fullscreenEl = target;
      bindFullscreen();
    }).catch(function(e) { console.warn('enterFullscreen failed:', e); });
  }

  function exitFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function(e) { console.warn('exitFullscreen failed:', e); });
    } else {
      unbindFullscreen();
      var layout = document.getElementById('gallery-layout');
      if (layout) layout.classList.remove('gallery-layout-fullscreen');
    }
  }

  function isFullscreen() {
    return !!document.fullscreenElement;
  }

  function bindFullscreen() {
    if (!state.fsChangeHandler) {
      state.fsChangeHandler = function() {
        if (!document.fullscreenElement) {
          var layout = document.getElementById('gallery-layout');
          if (layout) layout.classList.remove('gallery-layout-fullscreen');
          unbindFullscreen();
        }
      };
      document.addEventListener('fullscreenchange', state.fsChangeHandler);
    }
    if (!state.keyHandler) {
      state.keyHandler = onFullscreenKey;
      document.addEventListener('keydown', state.keyHandler, true);
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
  }

  function onFullscreenKey(e) {
    if (!isFullscreen()) {
      unbindFullscreen();
      return;
    }
    var k = e.key;
    if (k === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation(); goPrev();
    } else if (k === 'ArrowRight' || k === ' ' || k === 'Spacebar') {
      e.preventDefault(); e.stopPropagation(); goNext();
    } else if (k === 'Escape' || k === 'Enter') {
      e.preventDefault(); e.stopPropagation(); exitFullscreen();
    } else if (k === 'a' || k === 'A') {
      e.preventDefault(); e.stopPropagation(); toggleAutoplay();
    } else if (k >= '1' && k <= '9') {
      e.preventDefault(); e.stopPropagation();
      setAutoplayInterval(parseInt(k, 10) - 1);
    } else {
      // block app.js global F1-F6 shortcuts while in gallery fullscreen
      if (k === 'F1' || k === 'F2' || k === 'F3' || k === 'F4' || k === 'F5' || k === 'F6') {
        e.preventDefault(); e.stopPropagation();
      }
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
    } catch (e) {
      console.warn('renderGallery failed:', e);
    }
  };

  /**
   * Cleanup: revoke all object URLs, stop timers, remove document-level
   * listeners and reset module state. Called by app.js when leaving the page.
   */
  window.cleanupGallery = function() {
    stopAutoplay();
    unbindFullscreen();
    if (state.pasteHandler) {
      document.removeEventListener('paste', state.pasteHandler);
      state.pasteHandler = null;
    }
    if (state.thumbObserver) {
      state.thumbObserver.disconnect();
      state.thumbObserver = null;
    }
    for (var i = 0; i < state.objectURLs.length; i++) {
      try { URL.revokeObjectURL(state.objectURLs[i]); } catch (e) {}
    }
    if (state.mainURL) {
      try { URL.revokeObjectURL(state.mainURL); } catch (e) {}
    }
    state.items = [];
    state.index = -1;
    state.mainURL = null;
    state.zipSessionId = null;
    state.zipEntriesCache = null;
    state.objectURLs = [];
    var layout = document.getElementById('gallery-layout');
    if (layout) layout.classList.remove('gallery-layout-fullscreen');
    var c = state.container;
    state.container = null;
    if (c) c.classList.remove('gallery-page');
  };
})();
