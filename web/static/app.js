// --- State ---
let currentPage = 'endpoint';
let currentProviderId = null;
let providersCache = [];
let providerDetailCache = null;
let modelTestStatus = {};
let importTarget = 'models';
var usageEventSource = null;

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initFontSize();
  initLang();
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const page = el.dataset.page;
      if (page) navigateTo(page);
    });
  });
  navigateTo('endpoint');
});

function navigateTo(page) {
  currentPage = page;
  currentProviderId = null;
  stopUsageRefresh();
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const container = document.getElementById('page-content');
  // Remove any per-page main modifier classes before rendering the new page.
  const mainEl = document.querySelector('.main');
  if (mainEl) mainEl.classList.remove('main-no-scroll');
  container.innerHTML = '';
  container.classList.remove('page-enter');
  const p = (() => {
    switch (page) {
      case 'endpoint': return renderEndpoint(container);
      case 'providers': return renderProviders(container);
      case 'combos': return renderCombos(container);
      case 'usage': return renderUsage(container);
      case 'console': return renderConsole(container);
    }
  })();
  if (p && p.then) p.then(() => container.classList.add('page-enter'));
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 8) + '...';
}

function formatMillionTokens(n) {
  return (Number(n || 0) / 1000000).toFixed(3) + 'M';
}

function copyToClipboard(text, label) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      toast((label || text) + ' ' + t('copied'), 'success');
    }).catch(function() {
      fallbackCopy(text, label);
    });
  } else {
    fallbackCopy(text, label);
  }
}

function fallbackCopy(text, label) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast((label || text) + ' ' + t('copied'), 'success');
  } catch (e) {
    toast(t('copyFailed'), 'error');
  }
  document.body.removeChild(ta);
}

function withLoading(btn, asyncFn) {
  if (!btn || btn.disabled) return Promise.resolve();
  var original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span>';
  return Promise.resolve(asyncFn()).finally(function() {
    btn.disabled = false;
    btn.innerHTML = original;
  });
}

function emptyState(msg) {
  return '<div class="empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg><p>' + msg + '</p></div>';
}

function getProviderBrand(name) {
  var n = (name || '').toLowerCase();
  if (n.indexOf('deepseek') >= 0) return '#4fc3f7';
  if (n.indexOf('openai') >= 0 || n.indexOf('gpt') >= 0) return '#10a37f';
  if (n.indexOf('claude') >= 0 || n.indexOf('anthropic') >= 0) return '#d97706';
  if (n.indexOf('gemini') >= 0 || n.indexOf('google') >= 0) return '#4285f4';
  if (n.indexOf('moonshot') >= 0 || n.indexOf('kimi') >= 0) return '#6b21a8';
  if (n.indexOf('qwen') >= 0 || n.indexOf('alibaba') >= 0 || n.indexOf('aliyun') >= 0) return '#ff6a00';
  if (n.indexOf('baichuan') >= 0) return '#2563eb';
  if (n.indexOf('siliconflow') >= 0) return '#7c3aed';
  if (n.indexOf('modelscope') >= 0) return '#a855f7';
  return '';
}

function toast(message, type, duration) {
  if (type === undefined) type = 'info';
  if (duration === undefined) duration = 3500;
  const container = document.getElementById('toast-container');
  if (!container) return;
  var svgCheck = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var svgX = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var svgInfo = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  var svgWarn = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  const icons = { success: svgCheck, error: svgX, info: svgInfo, warning: svgWarn };
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = '<span class="toast-icon">' + icons[type] + '</span><span class="toast-message">' + escapeHtml(message) + '</span><div class="toast-progress"></div>';
  container.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('show'); });
  setTimeout(function() {
    el.classList.remove('show');
    el.addEventListener('transitionend', function() { el.remove(); }, { once: true });
  }, duration);
}

function confirmModal(message) {
  return new Promise(function(resolve) {
    var overlay = document.getElementById('modal-overlay');
    if (overlay.classList.contains('show')) { resolve(false); return; }
    overlay.innerHTML = '<div class="modal"><div class="modal-title">' + t('confirmTitle') + '</div><div class="modal-body">' + escapeHtml(message) + '</div><div class="modal-footer"><button class="btn btn-ghost" id="modal-cancel">' + t('cancel') + '</button><button class="btn btn-primary" id="modal-confirm">' + t('confirm') + '</button></div></div>';
    requestAnimationFrame(function() { overlay.classList.add('show'); });
    function close(result) {
      document.removeEventListener('keydown', escHandler);
      overlay.classList.remove('show');
      overlay.addEventListener('transitionend', function() { overlay.innerHTML = ''; }, { once: true });
      resolve(result);
    }
    document.getElementById('modal-cancel').onclick = function() { close(false); };
    document.getElementById('modal-confirm').onclick = function() { close(true); };
    overlay.onclick = function(e) { if (e.target === overlay) close(false); };
    var escHandler = function(e) { if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
  });
}

function initTheme() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  updateThemeButton(theme);
}

function updateThemeButton(theme) {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  var sunSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  var moonSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  btn.innerHTML = theme === 'dark' ? sunSvg : moonSvg;
}

function initFontSize() {
  const size = document.documentElement.getAttribute('data-font-size') || 's';
  updateFontButton(size);
}

function updateFontButton(size) {
  const btn = document.getElementById('font-btn');
  if (btn) btn.textContent = size.toUpperCase();
}

function initLang() {
  const lang = document.documentElement.getAttribute('data-lang') || 'en';
  updateLangButton(lang);
  updateSidebarNav();
}

function updateSidebarNav() {
  document.querySelectorAll('.nav-item').forEach(function(el) {
    var page = el.dataset.page;
    if (page) el.textContent = t(page);
  });
  var shutdownBtn = document.querySelector('.shutdown-btn');
  if (shutdownBtn) shutdownBtn.textContent = t('shutdown');
}

function toggleFontSize() {
  const current = document.documentElement.getAttribute('data-font-size') || 's';
  const order = { 's': 'm', 'm': 'l', 'l': 's' };
  const next = order[current] || 's';
  document.documentElement.setAttribute('data-font-size', next);
  localStorage.setItem('fontSize', next);
  updateFontButton(next);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton(next);
}

async function shutdownServer() {
  const ok = await confirmModal(t('confirmShutdown'));
  if (!ok) return;
  try {
    await apiPost('/shutdown', {});
  } catch (e) {}
  document.body.innerHTML = '\
    <div class="app" style="align-items:center;justify-content:center">\
      <div class="card" style="text-align:center;max-width:360px">\
        <div class="card-title">' + t('serverStopped') + '</div>\
        <p class="muted mt-12">' + t('serverStoppedDesc') + '</p>\
      </div>\
    </div>';
  window.close();
}

function showSkeleton(container, count) {
  if (count === undefined) count = 3;
  var cards = [];
  for (var i = 0; i < count; i++) {
    var s = document.createElement('div');
    s.className = 'skeleton skeleton-card';
    cards.push(s);
  }
  container.replaceChildren.apply(container, cards);
}
