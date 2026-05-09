/**
 * Content Script — Page Indicator + Toast System
 */
(function() {
  'use strict';
  const _br = globalThis.browser || globalThis.chrome;
  if (!_br) return;

  if (window.__sbPageIndicatorLoaded) return;
  window.__sbPageIndicatorLoaded = true;

  _br.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'showToast')               showSimpleToast(msg.message, msg.type || 'success');
    if (msg.action === 'showAlreadyCapturedToast') showAlreadyCapturedToast(msg.entry, msg.captureType);
    if (msg.action === 'showSavedPill')            showSavedPill();
    if (msg.action === 'hideSavedPill')            hideSavedPill();
  });

  // Auto-check if this page is already saved
  checkIfSaved();

  async function checkIfSaved() {
    try {
      const r = await _br.runtime.sendMessage({ action: 'checkUrl', url: location.href });
      if (r && r.found) showSavedPill();
    } catch { /* background may not be ready yet */ }
  }

  function showSimpleToast(message, type = 'success') {
    removeExisting('.sb-toast');
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const toast = make('div', 'sb-toast');
    toast.innerHTML = `
      <div class="sb-toast-row">
        <div class="sb-toast-icon ${type}">${icons[type] || '📷'}</div>
        <div class="sb-toast-body">
          <div class="sb-toast-title">${type === 'success' ? 'Screenshot Bookmark' : 'Error'}</div>
          <div class="sb-toast-sub">${esc(message)}</div>
        </div>
      </div>`;
    document.body.appendChild(toast);
    setTimeout(() => dismiss(toast), 4000);
  }

  function showAlreadyCapturedToast(entry, captureType) {
    removeExisting('.sb-toast');
    const toast = make('div', 'sb-toast');
    toast.innerHTML = `
      <div class="sb-toast-row">
        <div class="sb-toast-thumb">
          ${entry.thumbnailDataUrl
            ? `<img src="${entry.thumbnailDataUrl}" alt="thumb">`
            : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#6a6a80;font-size:20px">📷</div>'}
        </div>
        <div class="sb-toast-body">
          <div class="sb-toast-title">${esc(entry.pageTitle || 'Untitled')}</div>
          <div class="sb-toast-badge saved">✓ Already saved — ${timeAgo(entry.capturedAt)}</div>
        </div>
      </div>
      <div class="sb-toast-actions">
        <button class="sb-toast-btn" data-a="view">👁 View</button>
        <button class="sb-toast-btn warn" data-a="resave">↻ Re-save</button>
        <button class="sb-toast-btn primary" data-a="dismiss">✕ Dismiss</button>
      </div>`;

    toast.querySelector('[data-a="view"]').onclick = () => { _br.runtime.sendMessage({ action: 'openLibrary' }); dismiss(toast); };
    toast.querySelector('[data-a="resave"]').onclick = () => { _br.runtime.sendMessage({ action: 'forceCapture', captureType }); dismiss(toast); };
    toast.querySelector('[data-a="dismiss"]').onclick = () => dismiss(toast);
    document.body.appendChild(toast);
  }

  function showSavedPill() {
    if (document.querySelector('.sb-saved-pill')) return;
    const pill = make('div', 'sb-saved-pill');
    pill.textContent = '📷 Saved';
    pill.title = 'This page has a screenshot — click to view library';
    pill.onclick = () => _br.runtime.sendMessage({ action: 'openLibrary' });
    document.body.appendChild(pill);
  }

  function hideSavedPill() { removeExisting('.sb-saved-pill'); }

  function dismiss(el) {
    if (!el || !el.parentNode) return;
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 250);
  }

  function removeExisting(sel) { document.querySelectorAll(sel).forEach(e => e.remove()); }

  function make(tag, cls) {
    const el = document.createElement(tag);
    el.className = cls;
    return el;
  }

  function esc(s) { if(!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

  function timeAgo(d) {
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
})();
