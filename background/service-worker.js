/**
 * Background Service Worker — Screenshot Bookmark
 * Minimal, reliable capture pipeline.
 */

const _browser = globalThis.browser || globalThis.chrome;

// ── Install ──────────────────────────────────────────────────────
_browser.runtime.onInstalled.addListener(() => {
  _browser.contextMenus.removeAll(() => {
    _browser.contextMenus.create({ id: 'capture-viewport',  title: '📷 Capture viewport',  contexts: ['page'] });
    _browser.contextMenus.create({ id: 'capture-region',    title: '✂️ Capture region',    contexts: ['page'] });
    _browser.contextMenus.create({ id: 'capture-full-page', title: '📄 Capture full page', contexts: ['page'] });
    _browser.contextMenus.create({ id: 'open-library',      title: '📚 Open library',       contexts: ['page'] });
  });
  _browser.alarms.create('link-check', { periodInMinutes: 1440 });
});

// ── Context Menu ─────────────────────────────────────────────────
_browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-library') {
    _browser.tabs.create({ url: _browser.runtime.getURL('library/library.html') });
    return;
  }
  let type = 'viewport';
  if (info.menuItemId === 'capture-full-page') type = 'full_page';
  if (info.menuItemId === 'capture-region') type = 'region';
  await startCapture(tab, type);
});

// ── Keyboard shortcut ────────────────────────────────────────────
_browser.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-screenshot') {
    const [tab] = await _browser.tabs.query({ active: true, currentWindow: true });
    if (tab) await startCapture(tab, 'viewport');
  }
});

// ── Message router ───────────────────────────────────────────────
_browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {

        case 'startCapture': {
          const [tab] = await _browser.tabs.query({ active: true, currentWindow: true });
          if (tab) await startCapture(tab, msg.captureType || 'viewport');
          sendResponse({ success: true });
          break;
        }

        case 'forceCapture': {
          const [tab] = await _browser.tabs.query({ active: true, currentWindow: true });
          if (tab) await startCapture(tab, msg.captureType || 'viewport', true);
          sendResponse({ success: true });
          break;
        }

        case 'captureViewportForStitch': {
          const settings = await getSettings();
          const format = settings.imageFormat === 'jpeg' ? 'jpeg' : 'png';
          const opts = { format };
          if (format === 'jpeg') opts.quality = parseInt(settings.imageQuality, 10) || 90;
          const dataUrl = await _browser.tabs.captureVisibleTab(null, opts);
          sendResponse({ dataUrl });
          break;
        }

        case 'regionSelectionCancelled':
          sendResponse({ success: true });
          break;

        case 'regionSelectionComplete': {
          const [tab] = await _browser.tabs.query({ active: true, currentWindow: true });
          if (tab) await startCapture(tab, 'region', false, msg.rect);
          sendResponse({ success: true });
          break;
        }

        // Annotation done — show save dialog with folder/tag picker
        case 'showSaveDialog': {
          const tabId = sender.tab?.id;
          if (!tabId) { sendResponse({ error: 'No tab id' }); break; }
          // If annotated version, overwrite temp storage
          if (msg.annotatedDataUrl) {
            await _browser.storage.local.set({ [msg.tempId]: msg.annotatedDataUrl });
          }
          const stored = await getTempImage(msg.tempId);
          const thumb  = stored ? await makeThumbnail(stored, 800) : '';
          await showSaveDialog(tabId, msg.tempId, thumb, msg.pageUrl, msg.pageTitle, msg.captureType, msg.hasAnnotations);
          sendResponse({ success: true });
          break;
        }

        case 'switchToAnnotation': {
          const tabId = sender.tab?.id;
          if (!tabId) break;
          const dataUrl = await getTempImage(msg.tempId);
          await _browser.scripting.insertCSS({ target: { tabId }, files: ['content/styles/annotate.css'] });
          await _browser.scripting.executeScript({ target: { tabId }, files: ['content/annotate.js'] });
          await sleep(80);
          await _browser.tabs.sendMessage(tabId, {
            action: 'openAnnotationMode',
            tempId: msg.tempId,
            dataUrl,
            pageUrl: msg.pageUrl,
            pageTitle: msg.pageTitle,
            captureType: msg.captureType
          });
          sendResponse({ success: true });
          break;
        }

        case 'saveEditedImage': {
          const { entryId, annotatedDataUrl } = msg;
          const r = await _browser.storage.local.get('screenshotIndex');
          const idx = r.screenshotIndex || {};
          const entry = idx[entryId];
          if (!entry) { sendResponse({ error: 'Entry not found' }); break; }

          entry.hasAnnotations = true;
          entry.thumbnailDataUrl = await makeThumbnail(annotatedDataUrl, 800);

          // Update IndexedDB
          await new Promise((resolve, reject) => {
            const req = indexedDB.open('ScreenshotBookmarkDB', 1);
            req.onsuccess = e => {
              const db = e.target.result;
              const tx = db.transaction('screenshots', 'readwrite');
              tx.objectStore('screenshots').put({ id: entryId, dataUrl: annotatedDataUrl });
              tx.oncomplete = () => resolve();
            };
            req.onerror = () => reject(req.error);
          });

          // Re-embed metadata
          const { embedMetadata } = await import('../lib/image-metadata.js');
          let format = entry.savedFilename.endsWith('.jpeg') || entry.savedFilename.endsWith('.jpg') ? 'jpeg' : 'png';
          
          let blobUrl;
          try {
            const blob = await (await fetch(annotatedDataUrl)).blob();
            const taggedBlob = await embedMetadata(blob, format, entry);
            blobUrl = URL.createObjectURL(taggedBlob);
          } catch (e) {
            blobUrl = annotatedDataUrl; // fallback
          }

          // Overwrite the file on disk
          await _browser.downloads.download({
            url: blobUrl,
            filename: entry.savedFilename,
            saveAs: false,
            conflictAction: 'overwrite'
          });

          // Save index
          await _browser.storage.local.set({ screenshotIndex: idx });
          
          // Tell library to reload
          _browser.runtime.sendMessage({ action: 'reloadLibrary' }).catch(() => {});
          sendResponse({ success: true });
          break;
        }

        // Save dialog confirmed by user (folder + tags chosen)
        case 'confirmSave': {
          const dataUrl = await getTempImage(msg.tempId);
          await deleteTempImage(msg.tempId);
          if (!dataUrl) { sendResponse({ error: 'Capture expired — try again' }); break; }
          const result = await handleSave(dataUrl, msg);
          // Show success toast on page
          const tid = sender.tab?.id;
          if (tid) {
            try {
              await _browser.scripting.insertCSS({ target: { tabId: tid }, files: ['content/styles/toast.css'] });
              await _browser.scripting.executeScript({ target: { tabId: tid }, files: ['content/page-indicator.js'] });
              await _browser.tabs.sendMessage(tid, { action: 'showToast', message: '📷 Saved!', type: 'success' });
            } catch { /* toast is non-critical */ }
          }
          sendResponse(result);
          break;
        }

        case 'cancelSave': {
          if (msg.tempId) await deleteTempImage(msg.tempId);
          sendResponse({ success: true });
          break;
        }

        case 'getIndexData': {
          const r = await _browser.storage.local.get('screenshotIndex');
          const entries = Object.values(r.screenshotIndex || {});
          sendResponse({
            folders: [...new Set(entries.map(e => e.folderPath).filter(Boolean))].sort(),
            tags:    [...new Set(entries.flatMap(e => e.tags || []))].sort()
          });
          break;
        }

        case 'checkUrl':
          sendResponse(await checkUrl(msg.url));
          break;

        case 'deleteEntry':
          sendResponse(await deleteEntry(msg.id));
          break;

        case 'openLibrary':
          _browser.tabs.create({ url: _browser.runtime.getURL('library/library.html') });
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ error: 'Unknown: ' + msg.action });
      }
    } catch (err) {
      console.error('[SB SW] Error:', err);
      sendResponse({ error: err.message });
    }
  })();
  return true; // async response
});

// ── Badge ────────────────────────────────────────────────────────
_browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status === 'complete' && tab.url) await setBadge(tabId, tab.url);
});
_browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try { const t = await _browser.tabs.get(tabId); if (t.url) await setBadge(t.id, t.url); } catch { }
});

_browser.alarms.onAlarm.addListener(() => runLinkCheck());
_browser.runtime.onStartup.addListener(async () => {
  // Clean up stale temp captures
  try {
    const all = await _browser.storage.local.get(null);
    const stale = Object.keys(all).filter(k => k.startsWith('tmp_'));
    if (stale.length) await _browser.storage.local.remove(stale);
  } catch { }
  runLinkCheck();
});

// ═══════════════════════════════════════════════════════════════════
// CAPTURE  (the core function — kept intentionally simple)
// ═══════════════════════════════════════════════════════════════════

async function startCapture(tab, captureType, force = false, cropRect = null) {
  // Guard: can't capture extension/system pages
  if (!tab?.url) return;
  if (/^(chrome|chrome-extension|moz-extension|about|edge):/.test(tab.url)) return;

  // Handle region selection phase 1
  if (captureType === 'region' && !cropRect) {
    await _browser.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/styles/region-select.css'] });
    await _browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/region-select.js'] });
    return;
  }

  try {
    // Duplicate check
    if (!force) {
      const existing = await checkUrl(tab.url);
      if (existing.found) {
        await injectToast(tab.id);
        await _browser.tabs.sendMessage(tab.id, {
          action: 'showAlreadyCapturedToast',
          entry: existing.entries[0],
          captureType
        }).catch(() => {});
        return;
      }
    }

    // Step 1 — Capture the screenshot
    let dataUrl;
    const settings = await getSettings();
    const format = settings.imageFormat === 'jpeg' ? 'jpeg' : 'png';
    const opts = { format };
    if (format === 'jpeg') opts.quality = parseInt(settings.imageQuality, 10) || 90;

    if (captureType === 'viewport' || captureType === 'region') {
      dataUrl = await _browser.tabs.captureVisibleTab(null, opts);
      
      if (captureType === 'region' && cropRect) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const bitmap = await createImageBitmap(blob);
        
        const cx = Math.max(0, Math.min(cropRect.x, bitmap.width - 1));
        const cy = Math.max(0, Math.min(cropRect.y, bitmap.height - 1));
        const cw = Math.min(cropRect.w, bitmap.width - cx);
        const ch = Math.min(cropRect.h, bitmap.height - cy);

        const canvas = new OffscreenCanvas(cw, ch);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, cx, cy, cw, ch, 0, 0, cw, ch);
        
        const croppedBlob = await canvas.convertToBlob({ type: `image/${format}`, quality: opts.quality ? opts.quality / 100 : 1.0 });
        const reader = new FileReader();
        dataUrl = await new Promise(resolve => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(croppedBlob);
        });
      }
    } else {
      // Full page — inject capture script
      await _browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/capture.js'] });
      await sleep(200);
      const res = await tabMessage(tab.id, { action: 'captureFullPage', format, quality: opts.quality });
      if (!res?.success) throw new Error(res?.error || 'Full-page capture failed');
      dataUrl = res.dataUrl;
    }

    if (!dataUrl) throw new Error('Capture failed: No dataUrl returned.');

    // Step 2 — Store image under a temp key (storage.local, unlimited)
    const tempId = 'tmp_' + crypto.randomUUID();
    await _browser.storage.local.set({ [tempId]: dataUrl });

    // Step 3 — Generate small thumbnail for the dialog
    const thumb = await makeThumbnail(dataUrl, 800);

    // Step 4 — Handling the capture
    if (settings.showAnnotationMode) {
      // Show annotation overlay first; it will trigger the save dialog when done
      await _browser.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/styles/annotate.css'] });
      await _browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/annotate.js'] });
      await sleep(80);
      await _browser.tabs.sendMessage(tab.id, {
        action: 'openAnnotationMode',
        tempId, dataUrl,
        pageUrl: tab.url, pageTitle: tab.title, captureType
      });
    } else if (settings.showSaveDialog !== false) {
      // Go straight to save dialog
      await showSaveDialog(tab.id, tempId, thumb, tab.url, tab.title, captureType, false);
    } else {
      // Silent Save! No dialogs at all.
      let folder = '';
      if (settings.rememberLastFolder) {
        const lr = await _browser.storage.local.get('lastFolder');
        folder = lr.lastFolder || '';
      }
      
      await handleSave(dataUrl, {
        sourceUrl: tab.url,
        pageTitle: tab.title,
        captureType,
        folderPath: folder,
        tags: [],
        hasAnnotations: false
      });
      await _browser.storage.local.remove([tempId]);
      
      if (settings.showPreviewToast) {
        try {
          await injectToast(tab.id);
          await _browser.tabs.sendMessage(tab.id, {
            action: 'showToast',
            message: 'Screenshot saved to ' + (folder || 'root folder'),
            type: 'success'
          });
        } catch {}
      }
    }

  } catch (err) {
    console.error('[SB] startCapture failed:', err);
    try {
      await injectToast(tab.id);
      await _browser.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: 'Capture failed: ' + err.message,
        type: 'error'
      });
    } catch { }
  }
}

async function showSaveDialog(tabId, tempId, thumb, pageUrl, pageTitle, captureType, hasAnnotations) {
  await _browser.scripting.insertCSS({ target: { tabId }, files: ['content/styles/save-dialog.css'] });
  await _browser.scripting.executeScript({ target: { tabId }, files: ['content/save-dialog.js'] });
  await sleep(80);
  await _browser.tabs.sendMessage(tabId, {
    action: 'openSaveDialog',
    tempId, thumbnailDataUrl: thumb,
    pageUrl, pageTitle, captureType, hasAnnotations
  });
}

// ═══════════════════════════════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════════════════════════════

async function handleSave(dataUrl, opts) {
  const { sourceUrl, pageTitle, captureType, folderPath, tags, hasAnnotations } = opts;

  const thumb = await makeThumbnail(dataUrl, 800);
  const id    = crypto.randomUUID();
  const now   = new Date().toISOString();

  const entry = {
    id,
    normalizedUrl:   normalizeUrl(sourceUrl),
    sourceUrl,
    pageTitle:       pageTitle || '',
    capturedAt:      now,
    captureType,
    folderPath:      folderPath || '',
    tags:            Array.isArray(tags) ? tags : [],
    hasAnnotations:  hasAnnotations || false,
    thumbnailDataUrl: thumb,
    savedFilename:   '',
    linkStatus:      'healthy',
    linkCheckedAt:   null
  };

  // Save metadata index
  const res   = await _browser.storage.local.get('screenshotIndex');
  const index = res.screenshotIndex || {};
  index[id]   = entry;
  await _browser.storage.local.set({ screenshotIndex: index });

  // Embed metadata directly into the image file
  let finalDataUrl = dataUrl;
  try {
    finalDataUrl = embedMetadata(dataUrl, {
      id, sourceUrl, pageTitle, capturedAt: now, captureType, folderPath: folderPath || '', tags: Array.isArray(tags) ? tags : [], hasAnnotations: hasAnnotations || false
    });
  } catch (err) {
    console.error('[SB] Failed to embed metadata:', err);
  }

  // Save full image in IDB (for ZIP export)
  await idbPut({ id, dataUrl: finalDataUrl });

  // Auto-download to Downloads/Screenshot Bookmark/
  try {
    const d     = new Date(now);
    const ds    = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const tm    = `${pad(d.getHours())}${pad(d.getMinutes())}`;
    const dom   = safeHostname(sourceUrl);
    const title = (pageTitle || 'screenshot').replace(/[<>:"/\\|?*\x00-\x1F]/g,'').replace(/\s+/g,'-').slice(0,60);
    const ext   = finalDataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png';
    const folder = entry.folderPath ? `${entry.folderPath.replace(/[<>:"/\\|?*\x00-\x1F]/g,'')}/` : '';
    const filename = `Screenshot Bookmark/${folder}${ds}_${tm}_${dom}_${title}.${ext}`;
    await _browser.downloads.download({ url: finalDataUrl, filename, saveAs: false, conflictAction: 'uniquify' });
    // Store filename back
    const r2 = await _browser.storage.local.get('screenshotIndex');
    if (r2.screenshotIndex?.[id]) {
      r2.screenshotIndex[id].savedFilename = filename;
      await _browser.storage.local.set({ screenshotIndex: r2.screenshotIndex });
    }
  } catch (e) { console.warn('[SB] Download failed:', e.message); }

  // Update badge
  try {
    const [activeTab] = await _browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab) await setBadge(activeTab.id, activeTab.url);
  } catch { }

  return { success: true, id };
}

async function deleteEntry(id) {
  const res   = await _browser.storage.local.get('screenshotIndex');
  const index = res.screenshotIndex || {};
  delete index[id];
  await _browser.storage.local.set({ screenshotIndex: index });
  try { await idbDelete(id); } catch { }
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════
// THUMBNAIL
// ═══════════════════════════════════════════════════════════════════

async function makeThumbnail(dataUrl, maxW) {
  try {
    const blob   = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale  = Math.min(1, maxW / bitmap.width);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const oc = new OffscreenCanvas(w, h);
    oc.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const out = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    const ab  = await out.arrayBuffer();
    const b   = new Uint8Array(ab);
    let s = ''; const ch = 8192;
    for (let i = 0; i < b.length; i += ch) s += String.fromCharCode(...b.subarray(i, i + ch));
    return `data:image/jpeg;base64,${btoa(s)}`;
  } catch { return ''; }
}

// ═══════════════════════════════════════════════════════════════════
// TEMP STORAGE  (storage.local, cleared on startup)
// ═══════════════════════════════════════════════════════════════════

async function getTempImage(id) {
  if (!id) return null;
  const r = await _browser.storage.local.get(id);
  return r[id] || null;
}
async function deleteTempImage(id) {
  if (id) await _browser.storage.local.remove(id).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════
// INDEXEDDB  (full-res images for ZIP export)
// ═══════════════════════════════════════════════════════════════════

function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('ScreenshotBookmarkDB', 1);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains('screenshots'))
        e.target.result.createObjectStore('screenshots', { keyPath: 'id' });
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = () => rej(req.error);
  });
}

async function idbPut(obj) {
  try {
    const db = await openIDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('screenshots', 'readwrite');
      tx.objectStore('screenshots').put(obj);
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror    = () => { db.close(); rej(tx.error); };
    });
  } catch (e) { console.warn('[SB] idbPut failed:', e.message); }
}

async function idbDelete(id) {
  try {
    const db = await openIDB();
    await new Promise(res => {
      const tx = db.transaction('screenshots', 'readwrite');
      tx.objectStore('screenshots').delete(id);
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror    = () => { db.close(); res(); };
    });
  } catch { }
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

async function checkUrl(url) {
  const r = await _browser.storage.local.get('screenshotIndex');
  const norm = normalizeUrl(url);
  const entries = Object.values(r.screenshotIndex || {}).filter(e => e.normalizedUrl === norm);
  return { found: entries.length > 0, entries };
}

async function setBadge(tabId, url) {
  try {
    const { found } = await checkUrl(url);
    await _browser.action.setBadgeText({ text: found ? '✓' : '', tabId });
    if (found) await _browser.action.setBadgeBackgroundColor({ color: '#185FA5', tabId });
  } catch { }
}

async function injectToast(tabId) {
  try {
    await _browser.scripting.insertCSS({ target: { tabId }, files: ['content/styles/toast.css'] });
    await _browser.scripting.executeScript({ target: { tabId }, files: ['content/page-indicator.js'] });
  } catch { }
}

async function tabMessage(tabId, msg) {
  return new Promise(res => {
    try {
      _browser.tabs.sendMessage(tabId, msg, r => {
        res(_browser.runtime.lastError ? null : r);
      });
    } catch { res(null); }
  });
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/,'') || '/'}${u.search}`.toLowerCase();
  } catch { return (url || '').toLowerCase().replace(/\/+$/, ''); }
}

function safeHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'page'; }
}

function pad(n) { return String(n).padStart(2, '0'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getSettings() {
  const r = await _browser.storage.local.get('settings');
  return { 
    showAnnotationMode: false, 
    showSaveDialog: true,
    linkCheckFrequency: 'off', 
    imageFormat: 'png',
    imageQuality: 90,
    ...(r.settings || {}) 
  };
}

// ═══════════════════════════════════════════════════════════════════
// BROKEN LINK CHECKER
// ═══════════════════════════════════════════════════════════════════

async function runLinkCheck() {
  const settings = await getSettings();
  if (settings.linkCheckFrequency === 'off') return;
  const r = await _browser.storage.local.get('screenshotIndex');
  const index = r.screenshotIndex || {};
  let changed = false;
  for (const e of Object.values(index)) {
    if (!isCheckable(e.sourceUrl)) continue;
    if (e.linkCheckedAt && Date.now() - new Date(e.linkCheckedAt).getTime() < 12 * 3600e3) continue;
    try {
      const resp = await fetch(e.sourceUrl, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(8000) });
      index[e.id].linkStatus = (resp.ok || resp.type === 'opaque') ? 'healthy' : 'broken';
    } catch { index[e.id].linkStatus = 'broken'; }
    index[e.id].linkCheckedAt = new Date().toISOString();
    changed = true;
    await sleep(2000);
  }
  if (changed) await _browser.storage.local.set({ screenshotIndex: index });
}

function isCheckable(url) {
  try {
    const u = new URL(url);
    return !['file:','about:','moz-extension:','chrome-extension:','chrome:'].includes(u.protocol)
        && !['localhost','127.0.0.1'].includes(u.hostname);
  } catch { return false; }
}
