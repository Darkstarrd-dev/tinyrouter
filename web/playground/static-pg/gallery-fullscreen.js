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
  var target = layout || document.documentElement;

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
  var k = e.key;
  if (k === 'Tab') {
    if (galleryState.viewMode === 'split') {
      e.preventDefault(); e.stopPropagation(); switchFocus(); return;
    }
  }
  if (k === 'd' || k === 'D') {
    e.preventDefault(); e.stopPropagation(); toggleSplitMode(); return;
  }
  if (k === 'm' || k === 'M') {
    e.preventDefault(); e.stopPropagation(); toggleMediaType(); return;
  }

  var isVidActive = (galleryState.viewMode === 'split') ? (galleryState.focus === 'video') : (galleryState.mediaType === 'video');

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
    if (galleryState.viewMode === 'split') {
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

  var isVidActive = (galleryState.viewMode === 'split') ? (galleryState.focus === 'video') : (galleryState.mediaType === 'video');

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
      setVideoActive(galleryState.videoIndex - 1);
      return;
    }
    if (k === 'ArrowDown') {
      e.preventDefault();
      setVideoActive(galleryState.videoIndex + 1);
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