// gallery-fullscreen.js — Gallery image navigation, autoplay, fullscreen, and keyboard handlers.

'use strict';

// ---------- controls --------------------------------------------
function goPrev() {
  if (!galleryState.items.length) return;
  setActive(galleryState.index - 1);
}

function goNext() {
  if (!galleryState.items.length) return;
  setActive(galleryState.index + 1);
}

function stopAutoplay() {
  if (galleryState.autoplayTimer) {
    clearInterval(galleryState.autoplayTimer);
    galleryState.autoplayTimer = null;
  }
  galleryState.autoplayOn = false;
  var btn = document.getElementById('gallery-autoplay-btn');
  if (btn) {
    btn.innerHTML = GALLERY_ICONS.play;
    btn.setAttribute('title', 'Autoplay (A / ▶)');
  }
}

function startAutoplay() {
  stopAutoplay();
  if (!galleryState.items.length) return;
  galleryState.autoplayOn = true;
  galleryState.autoplayTimer = setInterval(goNext, galleryState.autoplayInterval);
  var btn = document.getElementById('gallery-autoplay-btn');
  if (btn) {
    btn.innerHTML = GALLERY_ICONS.stop;
    btn.setAttribute('title', 'Stop (A / ■)');
  }
}

function toggleAutoplay() {
  if (galleryState.autoplayOn) stopAutoplay();
  else startAutoplay();
}

function setAutoplayInterval(idx) {
  if (idx < 0) idx = 0;
  if (idx >= AUTOPLAY_INTERVALS.length) idx = AUTOPLAY_INTERVALS.length - 1;
  galleryState.autoplayInterval = AUTOPLAY_INTERVALS[idx];
  var dropdown = document.getElementById('gallery-interval-dropdown');
  if (dropdown) {
    var items = dropdown.querySelectorAll('.gallery-interval-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === idx);
    }
  }
  if (galleryState.autoplayOn) startAutoplay();
}

function toggleFullscreen() {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
}

function enterFullscreen() {
  var layout = document.getElementById('gallery-layout');
  var target = document.documentElement;

  var p = target.requestFullscreen ? target.requestFullscreen() : Promise.resolve();
  p.catch(function(e) { console.warn('enterFullscreen failed:', e); });
  if (layout) layout.classList.add('gallery-layout-fullscreen');
  document.body.classList.add('gallery-fullscreen-active');
  galleryState.fullscreenEl = target;
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
  if (!galleryState.fsChangeHandler) {
    galleryState.fsChangeHandler = function() {
      if (!document.fullscreenElement) {
        document.body.classList.remove('gallery-fullscreen-active');
        var layout = document.getElementById('gallery-layout');
        if (layout) layout.classList.remove('gallery-layout-fullscreen');
        unbindFullscreen();
      }
      autoBalanceFullscreenSplitRatio();
    };
    document.addEventListener('fullscreenchange', galleryState.fsChangeHandler);
  }
  if (!galleryState.keyHandler) {
    galleryState.keyHandler = onFullscreenKey;
    document.addEventListener('keydown', galleryState.keyHandler, true);
  }
  if (!galleryState.contextMenuHandler) {
    galleryState.contextMenuHandler = onContextMenu;
    document.addEventListener('contextmenu', galleryState.contextMenuHandler, true);
  }
}

function unbindFullscreen() {
  if (galleryState.keyHandler) {
    document.removeEventListener('keydown', galleryState.keyHandler, true);
    galleryState.keyHandler = null;
  }
  if (galleryState.fsChangeHandler) {
    document.removeEventListener('fullscreenchange', galleryState.fsChangeHandler);
    galleryState.fsChangeHandler = null;
  }
  if (galleryState.contextMenuHandler) {
    document.removeEventListener('contextmenu', galleryState.contextMenuHandler, true);
    galleryState.contextMenuHandler = null;
  }
}

function onFullscreenKey(e) {
  if (!isFullscreen()) {
    unbindFullscreen();
    return;
  }

  // Allow global page navigation shortcuts (F1-F6 by default) to pass through seamlessly to app.js
  if (
    Shortcuts.matchEvent('global.goto-usage', e) ||
    Shortcuts.matchEvent('global.goto-endpoint', e) ||
    Shortcuts.matchEvent('global.goto-console', e) ||
    Shortcuts.matchEvent('global.goto-playground', e) ||
    Shortcuts.matchEvent('global.goto-download', e) ||
    Shortcuts.matchEvent('global.goto-gallery', e)
  ) {
    return;
  }

  var tag = document.activeElement ? document.activeElement.tagName : '';
  var isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
  if (isInput) {
    if (Shortcuts.matchEvent('gallery.toggle-fullscreen', e) || Shortcuts.matchEvent('global.toggle-fullscreen', e)) {
      return;
    }
  }
  var k = e.key;
  if (Shortcuts.matchEvent('gallery.switch-focus', e) && galleryState.viewMode === 'split') {
    e.preventDefault(); e.stopPropagation(); switchFocus(); return;
  }
  if (Shortcuts.matchEvent('gallery.toggle-split', e)) {
    e.preventDefault(); e.stopPropagation(); toggleSplitMode(); return;
  }
  if (Shortcuts.matchEvent('gallery.toggle-media', e)) {
    e.preventDefault(); e.stopPropagation(); toggleMediaType(); return;
  }

  // Delete key family: deletion interactions (mark / prompt item / prompt zip)
  if (k === 'Delete') {
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey) {
      if (typeof window.deleteZipPrompt === 'function') window.deleteZipPrompt();
    } else if (e.ctrlKey) {
      if (typeof window.deleteItemPrompt === 'function') window.deleteItemPrompt();
    } else {
      // 在 review 模式下：切换删除/保留状态（toggle）
      if (galleryState.reviewState.reviewMode) {
        toggleReviewItemMark();
      } else {
        deleteItemMark();
      }
    }
    return;
  }

  var isVidActive = (galleryState.viewMode === 'split') ? (galleryState.focus === 'video') : (galleryState.mediaType === 'video');

  if (isVidActive) {
    var vidEl = document.getElementById('gallery-main-video');
    // 1-9 media volume control — intentionally NOT customizable to avoid
    // conflicting with the global quickslot-cycle 1-9 mappings.
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
    // Per-video scrubbing / volume controls below are intentionally NOT
    // customizable: they share key space with gallery navigation and
    // would conflict if rebound independently.
    if (k === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      if (vidEl) vidEl.currentTime = Math.max(0, vidEl.currentTime - 5);
      return;
    }
    if (k === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      if (vidEl) vidEl.currentTime = Math.min(vidEl.duration || 0, vidEl.currentTime + 5);
      return;
    }
    if (k === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (vidEl) {
        vidEl.volume = Math.min(1, vidEl.volume + 0.1);
        var vs1 = document.getElementById('gallery-vol-slider');
        if (vs1) vs1.value = Math.round(vidEl.volume * 100);
        showMsg('Volume: ' + Math.round(vidEl.volume * 100) + '%');
      }
      return;
    }
    if (k === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      if (vidEl) {
        vidEl.volume = Math.max(0, vidEl.volume - 0.1);
        var vs2 = document.getElementById('gallery-vol-slider');
        if (vs2) vs2.value = Math.round(vidEl.volume * 100);
        showMsg('Volume: ' + Math.round(vidEl.volume * 100) + '%');
      }
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

  if (Shortcuts.matchEvent('gallery.prev', e) || k === 'PageUp') {
    e.preventDefault(); e.stopPropagation(); goPrev();
  } else if (Shortcuts.matchEvent('gallery.next', e) || k === 'PageDown' || k === ' ' || k === 'Spacebar') {
    e.preventDefault(); e.stopPropagation(); goNext();
  } else if (Shortcuts.matchEvent('gallery.prev-folder', e)) {
    e.preventDefault(); e.stopPropagation(); goPrevFolder();
  } else if (Shortcuts.matchEvent('gallery.next-folder', e)) {
    e.preventDefault(); e.stopPropagation(); goNextFolder();
  } else if (Shortcuts.matchEvent('gallery.exit-fullscreen', e) || k === 'Enter') {
    e.preventDefault(); e.stopPropagation(); exitFullscreen();
  } else if (Shortcuts.matchEvent('gallery.toggle-autoplay', e)) {
    e.preventDefault(); e.stopPropagation(); toggleAutoplay();
  } else if (Shortcuts.matchEvent('gallery.toggle-fullscreen', e)) {
    e.preventDefault(); e.stopPropagation(); toggleFullscreen();
  } else if (Shortcuts.matchEvent('gallery.toggle-tree', e)) {
    e.preventDefault(); e.stopPropagation(); toggleTreePanel();
  } else if (galleryState.treeOpen && Shortcuts.matchEvent('gallery.clear-tree', e)) {
    e.preventDefault(); e.stopPropagation(); clearActiveSideTree(); return;
  } else if (k >= '1' && k <= '9') {
    e.preventDefault(); e.stopPropagation();
    setAutoplayInterval(parseInt(k, 10) - 1);
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
  if (Shortcuts.matchEvent('gallery.switch-focus', e) && galleryState.viewMode === 'split') {
    e.preventDefault();
    e.stopPropagation();
    switchFocus();
    return;
  }
  if (Shortcuts.matchEvent('gallery.toggle-split', e)) {
    e.preventDefault(); e.stopPropagation(); toggleSplitMode(); return;
  }
  if (Shortcuts.matchEvent('gallery.toggle-media', e)) {
    e.preventDefault(); e.stopPropagation(); toggleMediaType(); return;
  }

  // Delete key family: deletion interactions (mark / prompt item / prompt zip)
  if (k === 'Delete') {
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey) {
      if (typeof window.deleteZipPrompt === 'function') window.deleteZipPrompt();
    } else if (e.ctrlKey) {
      if (typeof window.deleteItemPrompt === 'function') window.deleteItemPrompt();
    } else {
      // 在 review 模式下：切换删除/保留状态（toggle）
      if (galleryState.reviewState.reviewMode) {
        toggleReviewItemMark();
      } else {
        deleteItemMark();
      }
    }
    return;
  }

  var isVidActive = (galleryState.viewMode === 'split') ? (galleryState.focus === 'video') : (galleryState.mediaType === 'video');

  if (isVidActive) {
    var vidEl = document.getElementById('gallery-main-video');
    // 1-9 media volume — intentionally NOT customizable (shared with quickslot).
    if (k >= '1' && k <= '9') {
      e.preventDefault();
      e.stopPropagation();
      var num = parseInt(k, 10);
      var volPct = num * 11;
      if (volPct > 100) volPct = 100;
      if (vidEl) vidEl.volume = volPct / 100;
      var volSlider = document.getElementById('gallery-vol-slider');
      if (volSlider) volSlider.value = volPct;
      showMsg('Volume: ' + volPct + '%');
      return;
    }
    // Per-video scrubbing controls below are NOT customizable (shared with
    // gallery navigation keys).
    if (k === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation(); setVideoActive(galleryState.videoIndex - 1); return;
    }
    if (k === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation(); setVideoActive(galleryState.videoIndex + 1); return;
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

  if (Shortcuts.matchEvent('gallery.prev', e) || k === 'PageUp') {
    e.preventDefault(); e.stopPropagation(); goPrev();
  } else if (Shortcuts.matchEvent('gallery.next', e) || k === 'PageDown' || k === ' ' || k === 'Spacebar') {
    e.preventDefault(); e.stopPropagation(); goNext();
  } else if (Shortcuts.matchEvent('gallery.prev-folder', e)) {
    e.preventDefault(); e.stopPropagation(); goPrevFolder();
  } else if (Shortcuts.matchEvent('gallery.next-folder', e)) {
    e.preventDefault(); e.stopPropagation(); goNextFolder();
  } else if (Shortcuts.matchEvent('gallery.toggle-autoplay', e)) {
    e.preventDefault(); e.stopPropagation(); toggleAutoplay();
  } else if (Shortcuts.matchEvent('gallery.toggle-fullscreen', e)) {
    e.preventDefault(); e.stopPropagation(); toggleFullscreen();
  } else if (Shortcuts.matchEvent('gallery.toggle-tree', e)) {
    e.preventDefault(); e.stopPropagation(); toggleTreePanel();
  } else if (galleryState.treeOpen && Shortcuts.matchEvent('gallery.clear-tree', e)) {
    e.preventDefault(); e.stopPropagation(); clearActiveSideTree(); return;
  } else if (k >= '1' && k <= '9') {
    e.preventDefault(); e.stopPropagation();
    setAutoplayInterval(parseInt(k, 10) - 1);
  }
}

// ---------- deletion: batch prompt & disk delete (Ctrl+Del) ----------
window.deleteItemPrompt = function() {
  // Ctrl+Del 对视频无效
  var isVidActive = (galleryState.viewMode === 'split') ? (galleryState.focus === 'video') : (galleryState.mediaType === 'video');
  if (isVidActive) return;
  // 枚举所有标注图片
  var marked = galleryState.items.filter(function(it) { return it.markedForDeletion; });
  if (marked.length === 0) return;  // 无标注，不响应
  // 判断是否有"从磁盘移除"能力：任一标注图片可删磁盘则显示该选项
  var anyDiskCapable = marked.some(function(it) {
    return (it.kind === 'zip' && it.zipFileHandle) || (it.kind === 'fs' && it.handle);
  });
  var html = '<div style="text-align:center;padding:8px">' +
    '<div style="font-size:15px;margin-bottom:8px">删除 ' + marked.length + ' 张标注图片？</div>' +
    '<div style="font-size:12px;color:#888;margin-bottom:14px">来自 ' + marked.length + ' 个文件</div>' +
    '<button class="pg-btn" id="del-from-list" style="margin:4px">从列表中移除</button>';
  if (anyDiskCapable) {
    html += '<button class="pg-btn" id="del-from-disk" style="margin:4px">从磁盘移除</button>';
  }
  html += '<button class="pg-btn" id="del-cancel" style="margin:4px">取消</button></div>';
  pgShowModal(html);
  document.getElementById('del-from-list').onclick = function() {
    pgCloseModal();
    removeItemsByFilter(function(it) { return it.markedForDeletion; });
  };
  document.getElementById('del-cancel').onclick = function() { pgCloseModal(); };
  if (anyDiskCapable) {
    document.getElementById('del-from-disk').onclick = function() {
      pgCloseModal();
      deleteMarkedFromDisk(marked);
    };
  }
};

// deleteMarkedFromDisk removes all marked items from the backend (zip entries
// via DELETE API, fs files via handle.remove()), writes back the updated zip
// bytes, and removes all marked items from the in-memory list.
// Same zip session: entries are deleted one by one, and the final zip bytes
// are written back only once (single createWritable).
async function deleteMarkedFromDisk(marked) {
  // 分组：zip 按 sessionId 分组；fs 单独处理；plain 无磁盘能力跳过
  var zipGroups = {};  // sessionId -> { items: [], handle: FileSystemFileHandle }
  var fsItems = [];
  var plainCount = 0;
  for (var i = 0; i < marked.length; i++) {
    var it = marked[i];
    if (it.kind === 'zip' && it.zipFileHandle) {
      if (!zipGroups[it.sessionId]) zipGroups[it.sessionId] = { items: [], handle: it.zipFileHandle };
      zipGroups[it.sessionId].items.push(it);
    } else if (it.kind === 'fs' && it.handle) {
      fsItems.push(it);
    } else {
      plainCount++;  // 无磁盘能力
    }
  }
  var errors = [];
  // 处理每个 zip session：逐个 DELETE，最后一次性 createWritable 写回
  for (var sid in zipGroups) {
    if (!zipGroups.hasOwnProperty(sid)) continue;
    var grp = zipGroups[sid];
    var lastBytes = null;
    var allOk = true;
    for (var j = 0; j < grp.items.length; j++) {
      var zItem = grp.items[j];
      var zPath = zItem.zipPath || '';
      var identifier = zPath.split('/').map(encodeURIComponent).join('/');
      var url = '/api/gallery/zip/' + encodeURIComponent(sid) + '/' + identifier;
      try {
        var res = await fetch(url, { method: 'DELETE' });
        if (!res.ok) { errors.push('zip ' + sid + ' entry ' + zPath + ': HTTP ' + res.status); allOk = false; break; }
        lastBytes = await res.arrayBuffer();
      } catch (e) {
        errors.push('zip ' + sid + ': ' + e.message); allOk = false; break;
      }
    }
    if (allOk && lastBytes) {
      try {
        var writable = await grp.handle.createWritable();
        await writable.write(lastBytes);
        await writable.close();
      } catch (e) {
        errors.push('writeback zip ' + sid + ': ' + e.message);
        // 后端 session 已更新，磁盘写失败，仍会移除列表
      }
    }
  }
  // 处理 fs items：逐个 handle.remove()
  for (var k = 0; k < fsItems.length; k++) {
    try {
      await fsItems[k].handle.remove();
    } catch (e) {
      errors.push('fs ' + (fsItems[k].path||'') + ': ' + e.message);
    }
  }
  // 所有标注图片从列表移除（无论磁盘是否成功，后端 session 已更新或磁盘已删，前端需同步）
  removeItemsByFilter(function(it) { return it.markedForDeletion; });
  // 提示
  if (errors.length) {
    showMsg('部分删除失败（' + errors.length + '项），已从列表移除');
    console.warn('deleteMarkedFromDisk errors:', errors);
  } else if (plainCount > 0) {
    showMsg('已处理（' + plainCount + ' 张无法从磁盘移除，仅移除列表）');
  } else {
    showMsg('已从磁盘移除 ' + marked.length + ' 张');
  }
}

// toggleReviewItemMark toggles the deletion mark for the current item and
// advances to the next item (used in review mode with IsMatch results, where
// Delete toggles rather than merely marks). 用户预期：在 review 模式下流畅地"切换并前进"。
function toggleReviewItemMark() {
  if (!galleryState.items.length) return;
  var idx = galleryState.index;
  var item = galleryState.items[idx];
  if (!item) return;
  item.markedForDeletion = !item.markedForDeletion;
  updateDeleteOverlay(item);
  if (item.thumbDivEl) {
    item.thumbDivEl.classList.toggle('thumb-marked-for-deletion', item.markedForDeletion);
  }
  // 切换后自动前进到过滤后的下一张（与 deleteItemMark 一致的行为）。
  // getAllowedNextIndex 只在 currentFolderIndices 内前进，避免跳到非疑似项。
  var folderIndices = galleryState.currentFolderIndices || [];
  var curPos = folderIndices.indexOf(idx);
  if (curPos >= 0 && curPos < folderIndices.length - 1) {
    setActive(folderIndices[curPos + 1]);
  }
}

// ---------- helper functions for node-level deletion ----------------

// isParentNode checks whether curDir contains subdirectories (i.e. it is a
// parent node whose deletion would remove child items as well).
function isParentNode(curDir) {
  var dirList = galleryState.dirPathList || [];
  if (curDir === 'Root') {
    return dirList.some(function(p) { return p !== 'Root' && p.indexOf('/') < 0 && !isZipName(p); });
  }
  return dirList.some(function(p) { return p !== curDir && p.startsWith(curDir + '/'); });
}

// itemsInNode returns all items in galleryState.items that belong to the
// given node (zip root, zip subdirectory, disk root, or disk subdirectory).
function itemsInNode(curDir, item, nodeType, sessionId, rootHandle) {
  var items = galleryState.items;
  if (nodeType === 'zip-root') {
    return items.filter(function(it) { return it.kind === 'zip' && it.sessionId === sessionId; });
  }
  if (nodeType === 'zip-subdir') {
    return items.filter(function(it) { return it.kind === 'zip' && it.sessionId === sessionId && it.path.startsWith(curDir + '/'); });
  }
  if (nodeType === 'disk-root') {
    return items.filter(function(it) { return it.kind === 'fs' && it.rootDirHandle === rootHandle; });
  }
  if (nodeType === 'disk-subdir') {
    return items.filter(function(it) { return it.kind === 'fs' && it.rootDirHandle === rootHandle && (getDirPath(it.path) === curDir || it.path.startsWith(curDir + '/')); });
  }
  return [];
}

// canNodeDiskDelete checks whether the given node type can be deleted from
// disk (has a zipFileHandle or rootDirHandle with remove capability).
function canNodeDiskDelete(nodeType, item, rootHandle) {
  if (nodeType === 'zip-root' || nodeType === 'zip-subdir') {
    return !!item.zipFileHandle;
  }
  if (nodeType === 'disk-root' || nodeType === 'disk-subdir') {
    return !!rootHandle && typeof rootHandle.remove === 'function';
  }
  return false;
}

// ---------- Shift+Del: node-level deletion (parent node or current video) ---

// deleteCurrentVideo shows a modal to delete the current video from the list
// and/or disk. Works for both kind:plain (in videoItems) and kind:fs (in items).
function deleteCurrentVideo() {
  var vi = galleryState.videoIndex;
  var vItem = (vi >= 0 && vi < galleryState.videoItems.length) ? galleryState.videoItems[vi] : null;
  var inItems = false;
  var itemIdx = -1;
  var item = null;

  if (!vItem && galleryState.items.length > 0) {
    // Check if the current item in galleryState.items is a video (kind:fs)
    var curIdx = galleryState.index;
    if (curIdx >= 0 && curIdx < galleryState.items.length) {
      var curItem = galleryState.items[curIdx];
      if (curItem && (curItem.kind === 'fs' || curItem.kind === 'plain')) {
        var nm = curItem.name || curItem.path || '';
        if (isVideoExt(nm)) {
          inItems = true;
          itemIdx = curIdx;
          item = curItem;
        }
      }
    }
  }

  var targetVItem = vItem || item;
  if (!targetVItem) return;

  var hasHandle = false;
  if (inItems && item) {
    hasHandle = !!item.handle && typeof item.handle.remove === 'function';
  } else if (vItem) {
    hasHandle = !!vItem.handle && typeof vItem.handle.remove === 'function';
  }

  var label = targetVItem.name || targetVItem.path || 'Video';
  var html = '<div style="text-align:center;padding:8px">' +
    '<div style="font-size:15px;margin-bottom:8px">删除视频？</div>' +
    '<div style="font-size:12px;color:#888;margin-bottom:14px;word-break:break-all">' + escapeHtml(label) + '</div>' +
    '<button class="pg-btn" id="zip-del-list" style="margin:4px">从列表中移除</button>';
  if (hasHandle) {
    html += '<button class="pg-btn" id="zip-del-disk" style="margin:4px">从磁盘移除</button>';
  }
  html += '<button class="pg-btn" id="zip-del-cancel" style="margin:4px">取消</button></div>';
  pgShowModal(html);

  document.getElementById('zip-del-list').onclick = function() {
    pgCloseModal();
    if (inItems && itemIdx >= 0) {
      removeItem(itemIdx);
    } else if (vItem) {
      removeVideoItem(vi);
    }
    showMsg('已从列表移除');
  };
  document.getElementById('zip-del-cancel').onclick = function() { pgCloseModal(); };
  if (hasHandle) {
    document.getElementById('zip-del-disk').onclick = function() {
      pgCloseModal();
      (async function() {
        try {
          if (inItems && item) {
            await item.handle.remove();
            removeItem(itemIdx);
          } else if (vItem && vItem.handle) {
            await vItem.handle.remove();
            removeVideoItem(vi);
          }
          showMsg('已从磁盘移除');
        } catch (e) {
          console.warn('deleteCurrentVideo disk failed:', e);
          showMsg('删除失败: ' + (e && e.message ? e.message : e));
          // Fallback: still remove from list
          if (inItems && itemIdx >= 0) removeItem(itemIdx);
          else if (vItem) removeVideoItem(vi);
        }
      })();
    };
  }
}

// Shift+Del: node-level delete — delete the parent directory node of the
// current image, or the current video itself.
window.deleteZipPrompt = function() {
  var isVidActive = (galleryState.viewMode === 'split') ? (galleryState.focus === 'video') : (galleryState.mediaType === 'video');
  if (isVidActive) {
    deleteCurrentVideo();
    return;
  }
  if (!galleryState.items.length) return;
  var idx = galleryState.index;
  var item = galleryState.items[idx];
  if (!item) return;
  var curDir = galleryState.curDirPath || getDirPath(item.path);

  // Determine node type
  var nodeType, sessionId = null, zipSubPrefix = null, rootHandle = null;
  if (isZipName(curDir)) {
    nodeType = 'zip-root';
    sessionId = item.sessionId;
  } else if (curDir === 'Root') {
    nodeType = 'disk-root';
    rootHandle = item.rootDirHandle || null;
  } else if (item.kind === 'zip') {
    nodeType = 'zip-subdir';
    sessionId = item.sessionId;
    zipSubPrefix = curDir;
  } else {
    nodeType = 'disk-subdir';
    rootHandle = item.rootDirHandle || null;
  }

  // Check if this node has subdirectories (parent node)
  var isParent = isParentNode(curDir);

  // Enumerate items in this node
  var nodeItems = itemsInNode(curDir, item, nodeType, sessionId, rootHandle);
  var fileCount = nodeItems.length;

  // Show modal
  var warn = isParent ? '<div style="font-size:13px;color:#c0392b;margin-bottom:8px">⚠ 警告：此节点含子目录，删除将移除所有下属内容</div>' : '';
  var label = nodeType === 'zip-root' ? '此压缩包' : (nodeType === 'disk-root' ? '此文件夹' : '此节点');
  var html = '<div style="text-align:center;padding:8px">' +
    warn +
    '<div style="font-size:15px;margin-bottom:8px">删除' + label + '（' + fileCount + ' 个文件）？</div>' +
    '<div style="font-size:12px;color:#888;margin-bottom:14px;word-break:break-all">' + curDir + '</div>' +
    '<button class="pg-btn" id="zip-del-list" style="margin:4px">从列表中移除</button>';
  var canDisk = canNodeDiskDelete(nodeType, item, rootHandle);
  if (canDisk) html += '<button class="pg-btn" id="zip-del-disk" style="margin:4px">从磁盘移除</button>';
  html += '<button class="pg-btn" id="zip-del-cancel" style="margin:4px">取消</button></div>';
  pgShowModal(html);
  document.getElementById('zip-del-list').onclick = function() {
    pgCloseModal();
    // Remove this node's items from the list
    removeItemsByFilter(function(it) { return nodeItems.indexOf(it) >= 0; });
  };
  document.getElementById('zip-del-cancel').onclick = function() { pgCloseModal(); };
  if (canDisk) {
    document.getElementById('zip-del-disk').onclick = function() {
      pgCloseModal();
      deleteNodeFromDisk(nodeType, item, curDir, sessionId, rootHandle, nodeItems);
    };
  }
};

// deleteNodeFromDisk removes the given node from disk based on its type.
// For zip-root: removes the entire zip file via zipFileHandle.remove().
// For zip-subdir: deletes each entry in the subdirectory via the DELETE API,
//   then writes back the final zip bytes once via createWritable.
// For disk-root: removes the top-level directory recursively.
// For disk-subdir: resolves the subdirectory handle from rootDirHandle and
//   removes it recursively.
async function deleteNodeFromDisk(nodeType, item, curDir, sessionId, rootHandle, nodeItems) {
  var errors = [];
  try {
    if (nodeType === 'zip-root' && item.zipFileHandle) {
      // Delete the entire zip file from disk
      await item.zipFileHandle.remove();
    } else if (nodeType === 'zip-subdir' && item.zipFileHandle) {
      // Delete zip entries in this subdirectory one by one via the DELETE API,
      // then write back the final zip bytes once
      var subItems = nodeItems.filter(function(it) { return it.kind === 'zip'; });
      var lastBytes = null;
      var ok = true;
      for (var i = 0; i < subItems.length; i++) {
        var zPath = subItems[i].zipPath || '';
        var identifier = zPath.split('/').map(encodeURIComponent).join('/');
        var url = '/api/gallery/zip/' + encodeURIComponent(sessionId) + '/' + identifier;
        try {
          var res = await fetch(url, { method: 'DELETE' });
          if (!res.ok) { errors.push('entry ' + zPath + ': HTTP ' + res.status); ok = false; break; }
          lastBytes = await res.arrayBuffer();
        } catch (e) { errors.push('entry ' + zPath + ': ' + e.message); ok = false; break; }
      }
      if (ok && lastBytes) {
        try {
          var writable = await item.zipFileHandle.createWritable();
          await writable.write(lastBytes);
          await writable.close();
        } catch (e) { errors.push('writeback: ' + e.message); }
      }
    } else if (nodeType === 'disk-root' && rootHandle) {
      // Delete the entire top-level directory recursively
      await rootHandle.remove({ recursive: true });
    } else if (nodeType === 'disk-subdir' && rootHandle) {
      // Resolve the subdirectory handle from rootDirHandle, then remove recursively
      var parts = curDir.split('/');
      var dirHandle = rootHandle;
      for (var j = 0; j < parts.length; j++) {
        dirHandle = await dirHandle.getDirectoryHandle(parts[j]);
      }
      await dirHandle.remove({ recursive: true });
    } else {
      showMsg('此节点无法从磁盘移除');
      return;
    }
  } catch (e) {
    errors.push(e.message || String(e));
  }
  // Remove this node's items from the list (regardless of disk success)
  removeItemsByFilter(function(it) { return nodeItems.indexOf(it) >= 0; });
  if (errors.length) {
    showMsg('部分删除失败，已从列表移除');
    console.warn('deleteNodeFromDisk errors:', errors);
  } else {
    showMsg('已从磁盘移除');
  }
}