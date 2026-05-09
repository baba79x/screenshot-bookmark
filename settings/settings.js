/**
 * Settings Page JS — No Drive
 */
import { readMetadata, bytesToDataUrl } from '../lib/image-metadata.js';
const _browser = globalThis.browser || globalThis.chrome;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const DEFAULTS = {
  openLibraryInTab: false,
  showAnnotationMode: false,
  showSaveDialog: true,
  showPreviewToast: true,
  rememberLastFolder: true,
  linkCheckFrequency: 'off',
  toastPosition: 'bottom-right',
  toastAutoDismiss: 5000,
  imageFormat: 'png',
  imageQuality: 90,
  customShortcut: ''
};

let settings = { ...DEFAULTS };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadSettings();
  applyToUI();
  bindNav();
  bindSettings();
  bindDangerZone();
  await loadTags();
}

async function loadSettings() {
  const r = await _browser.storage.local.get('settings');
  settings = { ...DEFAULTS, ...(r.settings || {}) };
}

async function saveSettings() {
  await _browser.storage.local.set({ settings });
}

function applyToUI() {
  const set = (id, val) => { const el = $(id); if (el) { if (el.type === 'checkbox') el.checked = val; else el.value = val; } };
  set('#openLibraryInTab',    settings.openLibraryInTab);
  set('#showAnnotationMode',  settings.showAnnotationMode);
  set('#showSaveDialog',      settings.showSaveDialog);
  set('#showPreviewToast',    settings.showPreviewToast);
  set('#rememberLastFolder',  settings.rememberLastFolder);
  set('#toastPosition',       settings.toastPosition);
  set('#toastAutoDismiss',    settings.toastAutoDismiss);
  set('#linkCheckFrequency',  settings.linkCheckFrequency);
  
  set('#imageFormat', settings.imageFormat);
  set('#imageQuality', settings.imageQuality);
  $('#qualityValue').textContent = settings.imageQuality;
  $('#jpegQualityRow').style.display = settings.imageFormat === 'jpeg' ? 'flex' : 'none';
  
  set('#customShortcut', settings.customShortcut);

  const lcEnabled = $('#linkCheckEnabled');
  if (lcEnabled) lcEnabled.checked = settings.linkCheckFrequency !== 'off';
}

function bindNav() {
  $$('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      $$('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      $$('.settings-section').forEach(s => s.style.display = 'none');
      $(`#sec-${link.dataset.section}`).style.display = 'block';
    });
  });
}

function bindSettings() {
  ['openLibraryInTab', 'showAnnotationMode', 'showSaveDialog', 'showPreviewToast', 'rememberLastFolder'].forEach(id => {
    $(`#${id}`)?.addEventListener('change', e => { settings[id] = e.target.checked; saveSettings(); });
  });
  $('#toastPosition')?.addEventListener('change',    e => { settings.toastPosition     = e.target.value; saveSettings(); });
  $('#toastAutoDismiss')?.addEventListener('change', e => { settings.toastAutoDismiss  = parseInt(e.target.value, 10); saveSettings(); });
  $('#linkCheckFrequency')?.addEventListener('change',e=>{ settings.linkCheckFrequency = e.target.value; saveSettings(); });
  $('#linkCheckEnabled')?.addEventListener('change',  e => {
    settings.linkCheckFrequency = e.target.checked ? 'daily' : 'off';
    const sel = $('#linkCheckFrequency'); if (sel) sel.value = settings.linkCheckFrequency;
    saveSettings();
  });

  // Quality settings
  $('#imageFormat')?.addEventListener('change', e => {
    settings.imageFormat = e.target.value;
    $('#jpegQualityRow').style.display = settings.imageFormat === 'jpeg' ? 'flex' : 'none';
    saveSettings();
  });
  
  $('#imageQuality')?.addEventListener('input', e => {
    $('#qualityValue').textContent = e.target.value;
  });
  
  $('#imageQuality')?.addEventListener('change', e => {
    settings.imageQuality = parseInt(e.target.value, 10);
    saveSettings();
  });

  // Shortcut recorder
  const shortcutInput = $('#customShortcut');
  if (shortcutInput) {
    let recording = false;
    
    shortcutInput.addEventListener('focus', () => {
      recording = true;
      shortcutInput.placeholder = 'Press keys now...';
      shortcutInput.value = '';
    });
    
    shortcutInput.addEventListener('blur', () => {
      recording = false;
      shortcutInput.placeholder = 'Click to record...';
      shortcutInput.value = settings.customShortcut;
    });
    
    shortcutInput.addEventListener('keydown', (e) => {
      if (!recording) return;
      e.preventDefault();
      
      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.metaKey) keys.push('Meta');
      
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      
      const k = e.key.toUpperCase();
      keys.push(k.length === 1 ? k : e.key);
      
      const combo = keys.join('+');
      shortcutInput.value = combo;
      settings.customShortcut = combo;
      saveSettings();
      shortcutInput.blur();
    });
  }

  $('#clearShortcutBtn')?.addEventListener('click', () => {
    settings.customShortcut = '';
    if ($('#customShortcut')) $('#customShortcut').value = '';
    saveSettings();
  });
}

function bindDangerZone() {
  $('#clearCacheBtn')?.addEventListener('click', async () => {
    if (!confirm('Clear the library index?\n\nFiles in Downloads/Screenshot Bookmark/ are NOT deleted.')) return;
    await _browser.storage.local.remove('screenshotIndex');
    alert('Library cleared. Your files in Downloads are still safe.');
  });

  $('#deleteAllBtn')?.addEventListener('click', async () => {
    const typed = prompt('This clears the library AND internal image cache.\nFiles in your Downloads folder are preserved.\n\nType "delete" to confirm:');
    if (typed?.toLowerCase() !== 'delete') { alert('Cancelled.'); return; }
    await _browser.storage.local.remove('screenshotIndex');
    const req = indexedDB.deleteDatabase('ScreenshotBookmarkDB');
    req.onsuccess = () => alert('Library and cache cleared. Downloads folder untouched.');
    req.onerror   = () => alert('Partially cleared.');
  });

  $('#importFolderBtn')?.addEventListener('click', async () => {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      const statusEl = $('#importStatus');
      if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Scanning files...'; }
      
      const importedCount = await scanAndImport(dirHandle);
      
      if (statusEl) { statusEl.textContent = `Successfully imported ${importedCount} screenshots!`; }
      alert(`Import complete! ${importedCount} screenshot(s) restored.`);
      await loadTags(); // refresh tags
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Import error:', err);
        alert('Error during import: ' + err.message);
      }
      const statusEl = $('#importStatus');
      if (statusEl) statusEl.style.display = 'none';
    }
  });
}

async function scanAndImport(dirHandle, currentPath = '') {
  let count = 0;
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'directory') {
      const folderName = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      count += await scanAndImport(entry, folderName);
    } else if (entry.kind === 'file') {
      if (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg')) {
        const file = await entry.getFile();
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        let metadata = readMetadata(bytes);
        
        // Fallback for older screenshots without embedded metadata
        if (!metadata || !metadata.id) {
          const parts = entry.name.replace(/\.[^/.]+$/, "").split('_');
          if (parts.length >= 3 && parts[0].match(/^\d{4}-\d{2}-\d{2}$/)) {
            const dateStr = parts[0];
            const timeStr = parts[1];
            const domain = parts[2];
            const title = parts.slice(3).join('_') || domain;
            
            let dateObj = new Date();
            try {
              dateObj = new Date(`${dateStr}T${timeStr.slice(0,2)}:${timeStr.slice(2,4)}:00`);
            } catch (e) {}

            metadata = {
              id: crypto.randomUUID(),
              sourceUrl: `https://${domain}`,
              pageTitle: title,
              capturedAt: dateObj.toISOString(),
              captureType: 'viewport',
              folderPath: currentPath,
              tags: [],
              hasAnnotations: false
            };
          } else {
            // Generic fallback if filename doesn't match
            metadata = {
              id: crypto.randomUUID(),
              sourceUrl: `https://unknown`,
              pageTitle: entry.name,
              capturedAt: new Date().toISOString(),
              captureType: 'viewport',
              folderPath: currentPath,
              tags: [],
              hasAnnotations: false
            };
          }
        }

        if (metadata && metadata.id) {
          // Reconstruct IDB and storage.local entry
          const mime = entry.name.endsWith('.png') ? 'image/png' : 'image/jpeg';
          const dataUrl = bytesToDataUrl(bytes, mime);
          
          await saveToIDB(metadata.id, dataUrl);
          
          const r = await _browser.storage.local.get('screenshotIndex');
          const index = r.screenshotIndex || {};
          
          // Generate a small thumbnail
          const thumbUrl = await generateThumbnailFromDataUrl(dataUrl);
          
          // Force the folder path to exactly match where we found it, or what was stored
          // if it was directly in the root of the picked directory, currentPath is ''
          const mappedFolder = currentPath || metadata.folderPath || '';
          
          index[metadata.id] = {
            ...metadata,
            folderPath: mappedFolder,
            thumbnailDataUrl: thumbUrl,
            savedFilename: `Screenshot Bookmark/${currentPath ? currentPath+'/' : ''}${entry.name}`
          };
          
          await _browser.storage.local.set({ screenshotIndex: index });
          count++;
        }
      }
    }
  }
  return count;
}

function saveToIDB(id, dataUrl) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ScreenshotBookmarkDB', 1);
    req.onupgradeneeded = e => { e.target.result.createObjectStore('screenshots', { keyPath: 'id' }); };
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('screenshots', 'readwrite');
      const store = tx.objectStore('screenshots');
      store.put({ id, dataUrl });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function generateThumbnailFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const max = 800;
      let w = img.width; let h = img.height;
      if (w > max || h > max) {
        if (w > h) { h = Math.round((h * max) / w); w = max; }
        else { w = Math.round((w * max) / h); h = max; }
      }
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

async function loadTags() {
  const r = await _browser.storage.local.get('screenshotIndex');
  const index = r.screenshotIndex || {};
  const tagCounts = {};
  Object.values(index).forEach(e => (e.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));

  const list = $('#tagList'); if (!list) return;
  if (!Object.keys(tagCounts).length) {
    list.innerHTML = '<span style="font-size:12px;color:var(--muted)">No tags created yet.</span>';
    return;
  }
  function esc(s){if(!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');}

  list.innerHTML = Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).map(([tag,count])=>`
    <span class="tag-manager-item">
      ${esc(tag)} (${count})
      <span class="delete-tag" data-tag="${esc(tag)}" title="Delete tag">✕</span>
    </span>`).join('');

  list.querySelectorAll('.delete-tag').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tag = btn.dataset.tag;
      if (!confirm(`Remove tag "${tag}" from all screenshots?`)) return;
      const r2 = await _browser.storage.local.get('screenshotIndex');
      const idx = r2.screenshotIndex || {};
      for (const e of Object.values(idx)) { if (e.tags) e.tags = e.tags.filter(t=>t!==tag); }
      await _browser.storage.local.set({ screenshotIndex: idx });
      await loadTags();
    });
  });
}
