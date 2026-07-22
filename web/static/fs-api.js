// fs-api.js — Unified File System API
// Provides: BlobTracker (leak-safe URL management), file pickers, drag/drop
// collector, file save helper, and directory walker.
// Exposed as window.FsApi.
'use strict';

var FsApi = (function() {

  // ===== Blob URL Tracker =====
  // Drop-in replacement for URL.createObjectURL / revokeObjectURL with
  // leak detection. Returns the same URL string — no API change for callers.
  var BlobTracker = {
    _active: new Set(),

    create: function(blob) {
      var url = URL.createObjectURL(blob);
      this._active.add(url);
      return url;
    },

    revoke: function(url) {
      if (this._active.has(url)) {
        URL.revokeObjectURL(url);
        this._active.delete(url);
      }
    },

    revokeAll: function() {
      this._active.forEach(function(u) { URL.revokeObjectURL(u); });
      this._active.clear();
    },

    get count() { return this._active.size; }
  };

  // ===== File Pickers =====

  // pickFiles opens a file picker (File System Access API → <input> fallback).
  // options: { multiple?: boolean, accept?: object }
  // Returns array of { handle, kind:'fs' } or { file, kind:'plain' }.
  async function pickFiles(options) {
    options = options || {};
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        var opts = { multiple: !!options.multiple };
        if (options.accept) {
          opts.types = [{ accept: options.accept }];
        }
        var handles = await window.showOpenFilePicker(opts);
        return handles.map(function(h) { return { handle: h, kind: 'fs' }; });
      } catch (e) {
        if (e && e.name === 'AbortError') return [];
        throw e;
      }
    }
    // Fallback: hidden <input type="file">
    return new Promise(function(resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      if (options.multiple) input.multiple = true;
      if (options.accept) {
        // Convert accept object to input.accept string (extensions)
        var exts = [];
        Object.values(options.accept).forEach(function(arr) {
          exts = exts.concat(arr);
        });
        if (exts.length) input.accept = exts.join(',');
      }
      input.style.display = 'none';
      input.onchange = function() {
        var files = Array.prototype.slice.call(input.files || []);
        resolve(files.map(function(f) { return { file: f, kind: 'plain' }; }));
        input.remove();
      };
      input.oncancel = function() {
        resolve([]);
        input.remove();
      };
      document.body.appendChild(input);
      input.click();
    });
  }

  // pickDirectory opens a directory picker (File System Access API only).
  // Returns { handle, kind:'fs' } or null if unsupported/cancelled.
  async function pickDirectory() {
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        var handle = await window.showDirectoryPicker();
        return { handle: handle, kind: 'fs' };
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        throw e;
      }
    }
    return null;
  }

  // ===== File Save =====

  // saveFile saves content to disk via showSaveFilePicker → Blob download fallback.
  // Returns true if saved, false if user cancelled.
  async function saveFile(content, filename, mimeType) {
    mimeType = mimeType || 'text/plain';
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        var ext = (filename.split('.').pop() || 'txt');
        var handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: ext.toUpperCase() + ' File',
            accept: (function() { var o = {}; o[mimeType] = ['.' + ext]; return o; })()
          }]
        });
        var writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
        // Fall through to Blob download
      }
    }
    // Fallback: Blob download
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    return true;
  }

  // ===== Drag & Drop / Paste Collector =====

  // collectFilesFromDataTransfer processes a DataTransfer object through a
  // three-level fallback: getAsFileSystemHandle → webkitGetAsEntry → getAsFile.
  // Returns array of { handle, kind:'fs' } or { file, kind:'plain' }.
  async function collectFilesFromDataTransfer(dt) {
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    var files = dt.files ? Array.prototype.slice.call(dt.files) : [];

    // Level 1: Modern — getAsFileSystemHandle
    if (items.length && typeof DataTransferItem.prototype.getAsFileSystemHandle === 'function') {
      var handlePromises = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind !== 'file') continue;
        try {
          var p = items[i].getAsFileSystemHandle();
          if (p) handlePromises.push(p);
        } catch (e) { /* skip */ }
      }
      if (handlePromises.length) {
        var handles = await Promise.all(handlePromises);
        handles = handles.filter(function(h) { return h !== null; });
        if (handles.length) {
          return handles.map(function(h) { return { handle: h, kind: 'fs' }; });
        }
      }
    }

    // Level 2: Legacy — webkitGetAsEntry (supports directory recursion)
    if (items.length && typeof DataTransferItem.prototype.webkitGetAsEntry === 'function') {
      var entries = [];
      for (var j = 0; j < items.length; j++) {
        if (items[j].kind !== 'file') continue;
        var entry = items[j].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
      if (entries.length) {
        var collected = await _readEntriesRecursive(entries);
        if (collected.length) {
          return collected.map(function(f) { return { file: f, kind: 'plain' }; });
        }
      }
    }

    // Level 3: Oldest — getAsFile / dt.files
    var result = [];
    for (var k = 0; k < files.length; k++) {
      if (files[k].size > 0 || files[k].name) {
        result.push({ file: files[k], kind: 'plain' });
      }
    }
    return result;
  }

  // _readEntriesRecursive reads FileSystemEntry items recursively (handles
  // directories). Uses a proper pending counter that increments for each
  // discovered directory to avoid premature resolution.
  function _readEntriesRecursive(entries) {
    return new Promise(function(resolve) {
      var allFiles = [];
      var pending = 0;

      function processEntry(entry) {
        if (entry.isFile) {
          pending++;
          entry.file(function(file) {
            allFiles.push(file);
            pending--;
            if (pending === 0) resolve(allFiles);
          }, function() {
            pending--;
            if (pending === 0) resolve(allFiles);
          });
        } else if (entry.isDirectory) {
          pending++;
          var reader = entry.createReader();
          var readBatch = function() {
            reader.readEntries(function(results) {
              if (!results || results.length === 0) {
                pending--;
                if (pending === 0) resolve(allFiles);
                return;
              }
              // Process each result; readBatch again for more (API returns max 100)
              for (var i = 0; i < results.length; i++) {
                processEntry(results[i]);
              }
              readBatch();
            }, function() {
              pending--;
              if (pending === 0) resolve(allFiles);
            });
          };
          readBatch();
        }
      }

      if (entries.length === 0) { resolve([]); return; }
      for (var i = 0; i < entries.length; i++) {
        processEntry(entries[i]);
      }
      // Edge case: all entries were neither file nor directory
      if (pending === 0) resolve(allFiles);
    });
  }

  // ===== Directory Walker =====

  // walkDir traverses a FileSystemDirectoryHandle recursively (BFS).
  // Calls onFile(fileHandle, relativePath) and onDir(dirHandle, relativePath).
  async function walkDir(dirHandle, onFile, onDir) {
    var queue = [{ handle: dirHandle, prefix: '' }];
    while (queue.length) {
      var cur = queue.shift();
      try {
        for await (var entry of cur.handle.values()) {
          var rel = cur.prefix ? cur.prefix + '/' + entry.name : entry.name;
          if (entry.kind === 'directory') {
            if (onDir) onDir(entry, rel);
            queue.push({ handle: entry, prefix: rel });
          } else {
            if (onFile) onFile(entry, rel);
          }
        }
      } catch (e) { /* permission denied or similar — skip */ }
    }
  }

  // ===== Public API =====
  return {
    BlobTracker: BlobTracker,
    pickFiles: pickFiles,
    pickDirectory: pickDirectory,
    saveFile: saveFile,
    collectFilesFromDataTransfer: collectFilesFromDataTransfer,
    walkDir: walkDir
  };

})();

// Expose globally
window.FsApi = FsApi;
