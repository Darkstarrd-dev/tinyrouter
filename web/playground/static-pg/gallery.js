// gallery.js — Gallery entry point and cleanup. Loaded last.

'use strict';

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
    if (panel) panel.classList.toggle('hidden', !galleryState.treeOpen);
    if (btn) btn.classList.toggle('active', galleryState.treeOpen);

    if (galleryState.items && galleryState.items.length) {
      // Tab-switching back from another page: restore current session and index
      updateDirStructure();
      var targetIndex = (galleryState.index >= 0 && galleryState.index < galleryState.items.length) ? galleryState.index : 0;
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
  if (galleryState.pageKeyHandler) {
    document.removeEventListener('keydown', galleryState.pageKeyHandler);
    galleryState.pageKeyHandler = null;
  }
  if (galleryState.pasteHandler) {
    document.removeEventListener('paste', galleryState.pasteHandler);
    galleryState.pasteHandler = null;
  }
  if (galleryState.thumbObserver) {
    galleryState.thumbObserver.disconnect();
    galleryState.thumbObserver = null;
  }
  var layout = document.getElementById('gallery-layout');
  if (layout) layout.classList.remove('gallery-layout-fullscreen');
  var c = galleryState.container;
  galleryState.container = null;
  if (c) c.classList.remove('gallery-page');
};