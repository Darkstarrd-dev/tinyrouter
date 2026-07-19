// gallery-tree.js — Gallery directory tree, navigation, thumbnails, and image render.

'use strict';

// ---------- directory tree & folder navigation helpers -------------
function getDirPath(itemPath) {
  if (!itemPath) return 'Root';
  var parts = itemPath.split('/');
  if (parts.length <= 1) return 'Root';
  parts.pop();
  return parts.join('/') || 'Root';
}

function updateDirStructure() {
  galleryState.dirMap = {};
  galleryState.dirPathList = [];
  for (var i = 0; i < galleryState.items.length; i++) {
    var item = galleryState.items[i];
    var dir = getDirPath(item.path);
    if (!galleryState.dirMap[dir]) {
      galleryState.dirMap[dir] = [];
      galleryState.dirPathList.push(dir);
    }
    galleryState.dirMap[dir].push(i);
  }
  renderTreePanel();
}

function toggleTreePanel() {
  galleryState.treeOpen = !galleryState.treeOpen;
  var isVidActive = (galleryState.viewMode === 'split') ? (galleryState.focus === 'video') : (galleryState.mediaType === 'video');
  var activeTreeId = isVidActive ? 'gallery-video-tree-panel' : 'gallery-tree-panel';
  var activeBtnId = isVidActive ? 'gallery-vid-tree-btn' : 'gallery-tree-btn';

  var panel = document.getElementById(activeTreeId);
  var btn = document.getElementById(activeBtnId);

  if (panel) panel.classList.toggle('hidden', !galleryState.treeOpen);
  if (btn) btn.classList.toggle('active', galleryState.treeOpen);
  renderTreePanel();
}

function renderTreePanel() {
  var isVidActive = (galleryState.viewMode === 'split') ? (galleryState.focus === 'video') : (galleryState.mediaType === 'video');
  var panel = document.getElementById(isVidActive ? 'gallery-video-tree-panel' : 'gallery-tree-panel');
  if (!panel) panel = document.getElementById('gallery-tree-panel');
  if (!panel) return;

  if (isVidActive) {
    if (!galleryState.videoItems || !galleryState.videoItems.length) {
      panel.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted)">No Videos</div>';
      return;
    }

    // Check if all videos are in root
    var hasDirs = false;
    for (var v = 0; v < galleryState.videoItems.length; v++) {
      if ((galleryState.videoItems[v].path || '').indexOf('/') !== -1) {
        hasDirs = true;
        break;
      }
    }

    var html = '';
    if (!hasDirs) {
      // Flat list of individual video files
      for (var i = 0; i < galleryState.videoItems.length; i++) {
        var item = galleryState.videoItems[i];
        var vName = item.name || item.path || ('Video ' + (i + 1));
        var isAct = (i === galleryState.videoIndex) ? ' active' : '';
        html += '<div class="gallery-tree-node' + isAct + '" data-vid-idx="' + i + '" style="padding-left:8px" title="' + escapeHtml(vName) + '">' +
                  '<span class="tree-icon">🎬</span>' +
                  '<span class="tree-name">' + escapeHtml(vName) + '</span>' +
                '</div>';
      }
    } else {
      // Grouped by directory with individual video items
      var vDirMap = {};
      var vDirList = [];
      for (var j = 0; j < galleryState.videoItems.length; j++) {
        var vp = galleryState.videoItems[j].path || '';
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
          var vItem = galleryState.videoItems[vIdx];
          var fName = vItem.name || (vItem.path ? vItem.path.split('/').pop() : ('Video ' + (vIdx + 1)));
          var vAct = (vIdx === galleryState.videoIndex) ? ' active' : '';
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
  if (!galleryState.items || !galleryState.items.length) {
    panel.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted)">No Images</div>';
    return;
  }

  // Build hierarchical tree structure for images & zips
  var treeMap = {};
  var treeOrder = [];

  for (var idx = 0; idx < galleryState.items.length; idx++) {
    var itemPath = galleryState.items[idx].path || '';
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
    var isActive = (tKey === galleryState.curDirPath) ? ' active' : '';
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
      if (typeof dir === 'string') galleryState.curDirPath = dir;
      if (!isNaN(fIdx)) setActive(fIdx);
    };
  });
}

function updateCurrentFolderItems(index) {
  if (index < 0 || index >= galleryState.items.length) {
    galleryState.curDirPath = '';
    galleryState.currentFolderIndices = [];
    galleryState.currentSubIndex = -1;
    return;
  }
  var item = galleryState.items[index];
  var dir = getDirPath(item.path);
  var prevDir = galleryState.curDirPath;
  galleryState.curDirPath = dir;
  var indices = galleryState.dirMap[dir] || [index];
  galleryState.currentFolderIndices = indices;
  galleryState.currentSubIndex = indices.indexOf(index);

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
      if (isAct && galleryState.treeOpen) {
        n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }
}

function goPrevFolder() {
  if (!galleryState.dirPathList.length) return;
  var curIdx = galleryState.dirPathList.indexOf(galleryState.curDirPath);
  var targetIdx = (curIdx > 0) ? curIdx - 1 : galleryState.dirPathList.length - 1;
  var targetDir = galleryState.dirPathList[targetIdx];
  if (targetDir && galleryState.dirMap[targetDir] && galleryState.dirMap[targetDir].length) {
    setActive(galleryState.dirMap[targetDir][0]);
  }
}

function goNextFolder() {
  if (!galleryState.dirPathList.length) return;
  var curIdx = galleryState.dirPathList.indexOf(galleryState.curDirPath);
  var targetIdx = (curIdx >= 0) ? (curIdx + 1) % galleryState.dirPathList.length : 0;
  var targetDir = galleryState.dirPathList[targetIdx];
  if (targetDir && galleryState.dirMap[targetDir] && galleryState.dirMap[targetDir].length) {
    setActive(galleryState.dirMap[targetDir][0]);
  }
}

function renderThumbnails() {
  var wrap = document.getElementById('gallery-thumbnails');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (galleryState.thumbObserver) {
    galleryState.thumbObserver.disconnect();
    galleryState.thumbObserver = null;
  }
  if (!galleryState.currentFolderIndices || !galleryState.currentFolderIndices.length) return;

  galleryState.thumbObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(en) {
      if (en.isIntersecting) {
        var idx = parseInt(en.target.dataset.idx, 10);
        var item = galleryState.items[idx];
        if (item && !item.thumbReady) ensureThumb(item);
      }
    });
  }, { root: wrap, rootMargin: '120px' });

  for (var k = 0; k < galleryState.currentFolderIndices.length; k++) {
    (function(idx) {
      var item = galleryState.items[idx];
      if (!item) return;
      var div = document.createElement('div');
      div.className = 'gallery-thumb' + (idx === galleryState.index ? ' active' : '');
      div.dataset.idx = String(idx);
      var img = document.createElement('img');
      img.className = 'gallery-thumb-img';
      img.alt = '';
      item.thumbImgEl = img;
      div.appendChild(img);
      div.addEventListener('click', function() { setActive(idx); });
      wrap.appendChild(div);
      item.thumbDivEl = div;
      galleryState.thumbObserver.observe(div);
      if (item.thumbURL) img.src = item.thumbURL;
    })(galleryState.currentFolderIndices[k]);
  }
}

function renderActive(index) {
  var item = galleryState.items[index];
  var imgEl = document.getElementById('gallery-main-img');
  var pathEl = document.getElementById('gallery-path');
  var info = document.getElementById('gallery-info');
  var empty = document.getElementById('gallery-empty');

  updateCurrentFolderItems(index);

  // highlight active thumb
  if (galleryState.currentFolderIndices) {
    for (var i = 0; i < galleryState.currentFolderIndices.length; i++) {
      var idx = galleryState.currentFolderIndices[i];
      if (galleryState.items[idx] && galleryState.items[idx].thumbDivEl) {
        galleryState.items[idx].thumbDivEl.classList.toggle('active', idx === index);
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
      galleryState.mainURL = item.mainURL;
      imgEl.onload = function() { autoBalanceFullscreenSplitRatio(); };
      imgEl.src = item.mainURL;
      if (empty) empty.style.display = 'none';
    }
    var subIdx = (galleryState.currentSubIndex >= 0) ? (galleryState.currentSubIndex + 1) : 0;
    var totalFolder = galleryState.currentFolderIndices ? galleryState.currentFolderIndices.length : 0;
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
  if (!galleryState.items.length) return;
  if (index < 0) index = galleryState.items.length - 1;
  if (index >= galleryState.items.length) index = 0;
  galleryState.index = index;
  renderActive(index);
}