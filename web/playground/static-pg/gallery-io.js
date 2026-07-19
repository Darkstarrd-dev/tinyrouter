// gallery-io.js — Gallery item accessors, filesystem traversal, zip loading, and collectors.

'use strict';

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
      var sid = item.sessionId || galleryState.zipSessionId;
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
    setMainURL(item, trackURL(URL.createObjectURL(blob)));
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
    setThumbURL(item, url);
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

// ---------- collectors & lazy zip loader ---------------------------
async function loadNextZipChunk() {
  if (!galleryState.pendingZipQueue.length || galleryState.loadingZip) return;
  galleryState.loadingZip = true;
  var nextZip = galleryState.pendingZipQueue.shift();
  var newItems = [];
  await addZipBlob(nextZip, newItems);
  galleryState.loadingZip = false;
  if (newItems.length) {
    appendNewItems(newItems);
  }
}

function appendNewItems(newItems) {
  sortItems(newItems);
  galleryState.items = galleryState.items.concat(newItems);
  updateDirStructure();
  renderThumbnails();
  if (galleryState.index >= 0 && galleryState.index < galleryState.items.length) {
    renderActive(galleryState.index);
  }
}

async function processCollectedEntries(collected) {
  galleryState.pendingZipQueue = [];
  galleryState.loadingZip = false;
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

  // Append videos (preserve existing)
  if (outVid.length) {
    var hadNoVideos = (galleryState.videoItems.length === 0);
    sortItems(outVid);
    galleryState.videoItems = galleryState.videoItems.concat(outVid);
    updateVideoDirStructure();
    if (hadNoVideos) {
      galleryState.videoIndex = -1;
      if (galleryState.viewMode === 'single' && outImg.length === 0 && galleryState.items.length === 0) {
        galleryState.mediaType = 'video';
        updateLayoutMode();
      }
      setVideoActive(0);
    } else {
      renderTreePanel();
    }
  }

  // Append images (preserve existing)
  if (outImg.length) {
    appendItems(outImg);
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
    galleryState.zipSessionId = sessionId;
    galleryState.zipEntriesCache = data.manifest;
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
    galleryState.items = [];
    galleryState.index = -1;
    updateDirStructure();
    renderThumbnails();
    renderActive(-1);
    return;
  }
  sortItems(out);
  galleryState.items = out;
  galleryState.index = -1;
  updateDirStructure();
  renderThumbnails();
  setActive(0);
}

function appendItems(out) {
  if (!out.length) return;
  sortItems(out);
  galleryState.items = galleryState.items.concat(out);
  updateDirStructure();
  renderThumbnails();
  if (galleryState.index >= 0 && galleryState.index < galleryState.items.length) {
    renderActive(galleryState.index);
  } else if (galleryState.items.length) {
    setActive(0);
  }
  renderTreePanel();
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
  appendItems(out);
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