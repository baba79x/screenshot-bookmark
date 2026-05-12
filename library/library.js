/**
 * Full-Tab Library JS
 * Chrome + Firefox compatible
 */
const _browser = globalThis.browser || globalThis.chrome;

let allEntries = [];
let filtered   = [];
let selectedIds = new Set();
let activeFilter = 'all';
let activeFolder = '';
let activeTags   = [];
let activeSort   = 'newest';
let currentDetailId = null;
let _notesDebounce = null;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

_browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'reloadLibrary') {
    load().then(() => {
      render();
      if (currentDetailId) openDetail(currentDetailId);
    });
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  await load();
  render();
  bindEvents();
});

// ── Data ──
async function load() {
  try {
    const r = await _browser.storage.local.get('screenshotIndex');
    allEntries = Object.values(r.screenshotIndex || {});
  } catch (err) {
    console.error('[SB] load error:', err);
    allEntries = [];
  }
  applyFilters();
}

function applyFilters() {
  let e = [...allEntries];
  if (activeFolder) e = e.filter(x => x.folderPath === activeFolder);
  if (activeTags.length) e = e.filter(x => activeTags.every(t => (x.tags||[]).includes(t)));

  const now = new Date();
  if (activeFilter === 'today') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    e = e.filter(x => new Date(x.capturedAt) >= s);
  } else if (activeFilter === 'week') {
    const s = new Date(now); s.setDate(s.getDate() - 7);
    e = e.filter(x => new Date(x.capturedAt) >= s);
  } else if (activeFilter === 'starred') {
    e = e.filter(x => x.starred === true);
  } else if (activeFilter === 'broken') {
    e = e.filter(x => x.linkStatus === 'broken');
  }

  const q = ($('#searchInput')?.value || '').toLowerCase().trim();
  if (q) e = e.filter(x =>
    (x.pageTitle||'').toLowerCase().includes(q) ||
    (x.sourceUrl||'').toLowerCase().includes(q) ||
    (x.tags||[]).some(t => t.toLowerCase().includes(q)) ||
    (x.notes||'').toLowerCase().includes(q)
  );

  if (activeSort === 'newest') e.sort((a,b) => new Date(b.capturedAt)-new Date(a.capturedAt));
  else if (activeSort === 'oldest') e.sort((a,b) => new Date(a.capturedAt)-new Date(b.capturedAt));
  else if (activeSort === 'domain') e.sort((a,b) => domain(a.sourceUrl).localeCompare(domain(b.sourceUrl)));
  else if (activeSort === 'folder') e.sort((a,b) => (a.folderPath||'').localeCompare(b.folderPath||''));

  filtered = e;
}

// ── Render ──
function render() { renderGrid(); renderSidebar(); renderBanners(); renderStats(); }

function renderGrid() {
  const grid = $('#screenshotGrid'), empty = $('#emptyState');
  if (!filtered.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = filtered.map(e => `
    <div class="card ${selectedIds.has(e.id)?'selected':''} ${e.starred?'starred':''}" data-id="${e.id}">
      <div class="card-checkbox" data-action="select">
        ${selectedIds.has(e.id)?'<i class="ti ti-check"></i>':''}
      </div>
      ${e.linkStatus==='broken'?'<div class="card-badge broken"><i class="ti ti-alert-triangle"></i>Dead link</div>':''}
      <div class="card-thumb">
        ${e.thumbnailDataUrl
          ? `<img src="${e.thumbnailDataUrl}" alt="${esc(e.pageTitle)}" loading="lazy">`
          : '<span class="placeholder"><i class="ti ti-photo"></i></span>'}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(e.pageTitle||'Untitled')}</div>
        <div class="card-domain">${domain(e.sourceUrl)}</div>
        <div class="card-meta">
          <span class="card-time">${timeAgo(e.capturedAt)}</span>
          ${e.starred?'<i class="ti ti-star-filled card-starred-icon" title="Starred"></i>':''}
          ${e.folderPath?`<span class="card-folder">${esc(e.folderPath)}</span>`:''}
        </div>
      </div>
      <div class="card-hover">
        <button class="hover-btn btn-star ${e.starred?'active':''}" data-action="star" title="${e.starred?'Unstar':'Star'}"><i class="ti ${e.starred?'ti-star-filled':'ti-star'}"></i></button>
        <button class="hover-btn" data-action="edit" title="Edit"><i class="ti ti-pencil"></i></button>
        <button class="hover-btn" data-action="visit" title="Visit"><i class="ti ti-external-link"></i></button>
        <button class="hover-btn" data-action="copy-link" title="Copy URL"><i class="ti ti-link"></i></button>
        <button class="hover-btn" data-action="copy-md" title="Markdown"><i class="ti ti-markdown"></i></button>
        <button class="hover-btn" data-action="delete" title="Delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>
  `).join('');
}

function renderSidebar() {
  const folders = [...new Set(allEntries.map(e => e.folderPath).filter(Boolean))].sort();
  $('#folderTree').innerHTML = `
    <div class="folder-item ${activeFolder===''?'active':''}" data-folder="">
      <i class="ti ti-folder"></i> All (${allEntries.length})
    </div>
    ${folders.map(f => `
      <div class="folder-item ${activeFolder===f?'active':''}" data-folder="${esc(f)}">
        <i class="ti ti-folder"></i> ${esc(f)} (${allEntries.filter(e=>e.folderPath===f).length})
      </div>
    `).join('')}
  `;

  const tc = {};
  allEntries.forEach(e => (e.tags||[]).forEach(t => { tc[t]=(tc[t]||0)+1; }));
  const cloud = $('#tagCloud');
  cloud.innerHTML = Object.keys(tc).length
    ? Object.entries(tc).sort((a,b)=>b[1]-a[1]).map(([t,c])=>
        `<span class="tag-pill ${activeTags.includes(t)?'active':''}" data-tag="${esc(t)}">${esc(t)}<span>${c}</span></span>`
      ).join('')
    : '<span style="font-size:11px;color:var(--text-muted)">No tags yet</span>';
}

function renderBanners() {
  const broken  = allEntries.filter(e => e.linkStatus === 'broken');
  const healthy = allEntries.filter(e => e.linkStatus === 'healthy');
  const bb = $('#brokenBanner');
  if (broken.length) { bb.style.display='flex'; $('#brokenCount').textContent=`${broken.length} saved page${broken.length>1?'s are':' is'} unreachable`; }
  else bb.style.display='none';
  const hs = $('#healthyStrip');
  if (healthy.length && broken.length) { hs.style.display='flex'; $('#healthyCount').textContent=`${healthy.length} other links are healthy`; }
  else hs.style.display='none';
}

function renderStats() {
  $('#statTotal').textContent = allEntries.length;
  const wk = new Date(); wk.setDate(wk.getDate()-7);
  $('#statWeek').textContent = allEntries.filter(e=>new Date(e.capturedAt)>=wk).length;
  $('#statStarred').textContent = allEntries.filter(e=>e.starred===true).length;
  const bn = allEntries.filter(e=>e.linkStatus==='broken').length;
  $('#statBroken').textContent = bn;
  $('#statBroken').className = bn > 0 ? 'danger' : '';
}

// ── Events ──
function bindEvents() {
  $('#searchInput').addEventListener('input', () => { applyFilters(); renderGrid(); });
  $('#sortSelect').addEventListener('change', e => { activeSort=e.target.value; applyFilters(); renderGrid(); });

  // Topbar capture button
  $('#captureBtn')?.addEventListener('click', async () => {
    const [tab] = await _browser.tabs.query({ active: true, currentWindow: true });
    if (tab) { await _browser.runtime.sendMessage({ action: 'startCapture', captureType: 'viewport' }); }
  });

  // Topbar settings button
  $('#settingsBtn')?.addEventListener('click', () => {
    _browser.runtime.openOptionsPage ? _browser.runtime.openOptionsPage() : window.open('../settings/settings.html');
  });

  // Add folder
  $('#addFolderBtn')?.addEventListener('click', async () => {
    const name = prompt('New folder name:');
    if (name?.trim()) {
      // Just a visual label, will be populated when screenshots are moved here
      alert(`Folder "${name.trim()}" created. Move screenshots to it using the detail pane.`);
    }
  });

  // Filter chips
  $('#filterChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    $$('.chip').forEach(x=>x.classList.remove('active'));
    c.classList.add('active');
    activeFilter = c.dataset.filter;
    applyFilters(); renderGrid();
  });
  
  // Select All
  $('#selectAllBtn')?.addEventListener('click', () => {
    filtered.forEach(x => selectedIds.add(x.id));
    updateBulk();
    renderGrid();
  });

  // Sidebar nav items
  $$('.nav-item').forEach(item => item.addEventListener('click', () => {
    $$('.nav-item').forEach(x=>x.classList.remove('active'));
    item.classList.add('active');
    const view = item.dataset.view;
    if (view==='all') activeFilter='all';
    else if (view==='recent') activeFilter='week';
    applyFilters(); render();
  }));

  $('#folderTree').addEventListener('click', e => {
    const f = e.target.closest('.folder-item'); if (!f) return;
    activeFolder = f.dataset.folder; applyFilters(); render();
  });

  $('#tagCloud').addEventListener('click', e => {
    const p = e.target.closest('.tag-pill'); if (!p) return;
    const t = p.dataset.tag;
    activeTags = activeTags.includes(t) ? activeTags.filter(x=>x!==t) : [...activeTags, t];
    applyFilters(); render();
  });

  // Grid click delegation
  $('#screenshotGrid').addEventListener('click', e => {
    const card = e.target.closest('.card'); if (!card) return;
    const id   = card.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action==='select' || e.shiftKey) { toggleSel(id); return; }
    if (action==='star')      { toggleStar(id); return; }
    if (action==='visit')     { visitEntry(id); return; }
    if (action==='copy-link') { copyLink(id); return; }
    if (action==='copy-md')   { copyMd(id); return; }
    if (action==='edit')      { editEntry(id); return; }
    if (action==='delete')    { deleteEntry(id); return; }
    openDetail(id);
  });

  // Long-press to multi-select
  let pt = null;
  $('#screenshotGrid').addEventListener('pointerdown', e => {
    const c = e.target.closest('.card'); if (!c) return;
    pt = setTimeout(() => toggleSel(c.dataset.id), 400);
  });
  $('#screenshotGrid').addEventListener('pointerup', () => clearTimeout(pt));
  $('#screenshotGrid').addEventListener('pointerleave', () => clearTimeout(pt));

  // Banners
  $('#reviewBroken')?.addEventListener('click', () => {
    activeFilter='broken'; $$('.chip').forEach(c=>c.classList.remove('active'));
    applyFilters(); renderGrid();
  });
  // NOTE: library.html uses id="dismissBanner" (not "dismissBroken")
  $('#dismissBanner')?.addEventListener('click', () => { $('#brokenBanner').style.display='none'; });

  // Bulk bar
  $('#bulkCancel')?.addEventListener('click', clearSel);
  $('#bulkDelete')?.addEventListener('click', bulkDel);
  $('#bulkMove')?.addEventListener('click', async () => {
    const folder = prompt('Move selected to folder:');
    if (folder === null) return;
    for (const id of [...selectedIds]) {
      const e = findEntry(id); if (!e) continue;
      e.folderPath = folder.trim(); await saveEntry(e);
    }
    clearSel(); await load(); render();
  });
  $('#bulkTag')?.addEventListener('click', async () => {
    const tag = prompt('Add tag to selected:');
    if (!tag?.trim()) return;
    for (const id of [...selectedIds]) {
      const e = findEntry(id); if (!e) continue;
      if (!e.tags) e.tags = [];
      if (!e.tags.includes(tag.trim())) e.tags.push(tag.trim());
      await saveEntry(e);
    }
    clearSel(); await load(); render();
  });
  $('#bulkOpenLinks')?.addEventListener('click', () => {
    const selected = filtered.filter(e => selectedIds.has(e.id));
    if (!selected.length) return;
    let opened = 0;
    for (const e of selected) {
      if (e.sourceUrl && e.sourceUrl.startsWith('http')) {
        _browser.tabs.create({ url: e.sourceUrl, active: false });
        opened++;
      }
    }
    if (opened === 0) alert('No valid links found for the selected screenshots.');
    clearSel();
  });
  $('#bulkTutorial')?.addEventListener('click', () => {
    const selected = filtered.filter(e => selectedIds.has(e.id));
    if (!selected.length) return;
    const ids = selected.map(e => e.id).join(',');
    _browser.tabs.create({ url: `../tutorial/tutorial.html?ids=${encodeURIComponent(ids)}` });
    clearSel();
  });
  $('#bulkExport')?.addEventListener('click', () => {
    const selected = filtered.filter(e => selectedIds.has(e.id));
    if (!selected.length) { alert('No screenshots selected.'); return; }
    window.ZipExporter.exportZip(selected);
  });
  $('#bulkExportPdf')?.addEventListener('click', () => {
    const selected = filtered.filter(e => selectedIds.has(e.id));
    if (!selected.length) { alert('No screenshots selected.'); return; }
    window.ZipExporter.exportPdf(selected, 'screenshot-bookmarks');
  });

  // Detail pane — all IDs match library.html exactly
  $('#detailClose').addEventListener('click', closeDetail);
  $('#copyUrl')?.addEventListener('click', () => { const e=findEntry(currentDetailId); if(e) navigator.clipboard.writeText(e.sourceUrl).catch(()=>{}); });
  $('#visitSite')?.addEventListener('click', () => { const e=findEntry(currentDetailId); if(e) window.open(e.sourceUrl,'_blank'); });
  $('#copyMdBtn')?.addEventListener('click', () => { copyMd(currentDetailId); showCopied(); });
  $('#exportBtn')?.addEventListener('click', () => { 
    const e = findEntry(currentDetailId); 
    if(!e) return; 
    const req = indexedDB.open('ScreenshotBookmarkDB', 1);
    req.onsuccess = ev => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('screenshots')) return;
      const tx = db.transaction('screenshots', 'readonly');
      const r = tx.objectStore('screenshots').get(e.id);
      r.onsuccess = () => {
        if (r.result && r.result.dataUrl) {
          const a = document.createElement('a');
          a.href = r.result.dataUrl;
          const ext = r.result.dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png';
          a.download = (e.pageTitle || 'screenshot').replace(/[<>:"/\\|?*\x00-\x1F]/g,'').replace(/\s+/g,'-') + '.' + ext;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          alert('Full resolution image not found in cache.');
        }
      };
    };
  });
  $('#exportPdfBtn')?.addEventListener('click', () => { const e=findEntry(currentDetailId); if(e) window.ZipExporter.exportPdf([e],'screenshot'); });
  $('#deleteBtn')?.addEventListener('click', () => { if(currentDetailId){ deleteEntry(currentDetailId); closeDetail(); } });
  
  $('#editBtn')?.addEventListener('click', () => {
    if (currentDetailId) editEntry(currentDetailId);
  });

  $('#detailStar')?.addEventListener('click', () => {
    if (currentDetailId) toggleStar(currentDetailId);
  });

  $('#recaptureBtn')?.addEventListener('click', () => {
    const e = findEntry(currentDetailId);
    if (!e) return;
    const btn = $('#recaptureBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-refresh"></i>Opening…';
    _browser.runtime.sendMessage({ action: 'recaptureUrl', url: e.sourceUrl })
      .then(res => {
        if (res?.error) { alert(res.error); }
      })
      .catch(() => { alert('Recapture failed. Make sure the URL is reachable.'); })
      .finally(() => {
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = '<i class="ti ti-refresh"></i>Recapture';
        }, 2000);
      });
  });

  $('#detailNotes')?.addEventListener('input', () => {
    clearTimeout(_notesDebounce);
    _notesDebounce = setTimeout(async () => {
      const e = findEntry(currentDetailId);
      if (!e) return;
      e.notes = ($('#detailNotes')?.value || '').slice(0, 5000);
      await saveEntry(e);
      const saved = $('#notesSaved');
      if (saved) {
        saved.textContent = 'Saved';
        setTimeout(() => { if (saved) saved.textContent = ''; }, 1500);
      }
    }, 500);
  });

  function editEntry(id) {
    _browser.runtime.sendMessage({ action: 'editEntryWithAnnotation', entryId: id })
      .catch(err => alert('Could not open annotation mode: ' + (err?.message || err)));
  }

  // Tag input — library.html uses id="tagInput" and id="tagAddBtn"
  $('#tagAddBtn')?.addEventListener('click', addTag);
  $('#tagInput')?.addEventListener('keydown', e => { if(e.key==='Enter') addTag(); });
  // Folder select in detail
  $('#detailFolder')?.addEventListener('change', async ev => {
    const e = findEntry(currentDetailId); if (!e) return;
    e.folderPath = ev.target.value; await saveEntry(e); await load(); renderSidebar();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key==='Escape') { if($('#detailOverlay').style.display!=='none') closeDetail(); else if(selectedIds.size) clearSel(); }
    if ((e.ctrlKey||e.metaKey) && e.key==='a') { e.preventDefault(); filtered.forEach(x=>selectedIds.add(x.id)); updateBulk(); renderGrid(); }
    if (e.key==='Delete' && selectedIds.size) bulkDel();
  });
}

// ── Select / Bulk ──
function toggleSel(id) { if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id); updateBulk(); renderGrid(); }
function clearSel()    { selectedIds.clear(); updateBulk(); renderGrid(); }
function updateBulk()  {
  const b = $('#bulkBar');
  if (selectedIds.size) { b.style.display='flex'; $('#bulkCount').textContent=`${selectedIds.size} selected`; }
  else b.style.display='none';
}

// ── Detail Pane ──
function openDetail(id) {
  const e = findEntry(id); if (!e) return;
  currentDetailId = id;
  $('#detailTitle').textContent = e.pageTitle || 'Untitled';
  $('#detailImage').src = e.thumbnailDataUrl || '';
  
  // Asynchronously load full resolution image
  const req = indexedDB.open('ScreenshotBookmarkDB', 1);
  req.onsuccess = ev => {
    const db = ev.target.result;
    if (!db.objectStoreNames.contains('screenshots')) return;
    const tx = db.transaction('screenshots', 'readonly');
    const r = tx.objectStore('screenshots').get(id);
    r.onsuccess = () => {
      if (r.result && r.result.dataUrl && currentDetailId === id) {
        $('#detailImage').src = r.result.dataUrl;
      }
    };
  };

  if (!e.sourceUrl || e.sourceUrl.includes('unknown') || e.sourceUrl === 'https://') {
    $('#detailUrl').href = '#';
    $('#detailUrl').textContent = 'Link unavailable (Old screenshot)';
    $('#detailUrl').style.pointerEvents = 'none';
    $('#detailUrl').style.color = 'var(--muted)';
  } else {
    $('#detailUrl').href = e.sourceUrl;
    $('#detailUrl').textContent = e.sourceUrl;
    $('#detailUrl').style.pointerEvents = 'auto';
    $('#detailUrl').style.color = '';
  }
  
  $('#detailDate').textContent = new Date(e.capturedAt).toLocaleString();
  $('#detailType').textContent = e.captureType === 'full_page' ? 'Full page' : 'Viewport';

  // Star button
  _updateDetailStar(e.starred === true);

  // Notes
  const notesEl = $('#detailNotes');
  if (notesEl) notesEl.value = e.notes || '';
  const notesSaved = $('#notesSaved');
  if (notesSaved) notesSaved.textContent = '';

  // Recapture button — only show for http/https URLs
  const rcBtn = $('#recaptureBtn');
  if (rcBtn) rcBtn.style.display = /^https?:/.test(e.sourceUrl) ? 'flex' : 'none';

  // Annotation badge
  const ar = $('#annotationRow');
  if (ar) ar.style.display = e.hasAnnotations ? 'flex' : 'none';

  // Drive link or local download — now always shows local file info
  const fileEl = $('#detailFile');
  if (fileEl) {
    fileEl.textContent = e.savedFilename
      ? '💾 ' + e.savedFilename.split('/').pop()
      : 'Saved to Downloads/Screenshot Bookmark/';
    fileEl.title = e.savedFilename || 'Auto-saved to Downloads folder';
  }

  // Tags
  const tagsEl = $('#detailTags');
  tagsEl.innerHTML = (e.tags||[]).map(t =>
    `<span class="detail-tag">${esc(t)}<span class="remove-tag" data-tag="${esc(t)}">✕</span></span>`
  ).join('');
  tagsEl.querySelectorAll('.remove-tag').forEach(btn => {
    btn.addEventListener('click', async () => {
      e.tags = (e.tags||[]).filter(t=>t!==btn.dataset.tag);
      await saveEntry(e); openDetail(id); await load(); renderSidebar();
    });
  });

  // Folder dropdown — populate with known folders
  const folderSel = $('#detailFolder');
  if (folderSel) {
    const folders = [...new Set(allEntries.map(x=>x.folderPath).filter(Boolean))].sort();
    folderSel.innerHTML = '<option value="">No folder</option>' +
      folders.map(f=>`<option value="${esc(f)}" ${e.folderPath===f?'selected':''}>${esc(f)}</option>`).join('');
    folderSel.value = e.folderPath || '';
  }

  $('#detailOverlay').style.display = 'block';
}

function closeDetail() { $('#detailOverlay').style.display='none'; currentDetailId=null; }

async function addTag() {
  const input = $('#tagInput');
  const tag = input?.value.trim(); if (!tag || !currentDetailId) return;
  const e = findEntry(currentDetailId); if (!e) return;
  if (!e.tags) e.tags = [];
  if (!e.tags.includes(tag)) e.tags.push(tag);
  await saveEntry(e); input.value=''; openDetail(currentDetailId); await load(); renderSidebar();
}

// ── Entry Actions ──
function visitEntry(id) { const e=findEntry(id); if(e) window.open(e.sourceUrl,'_blank'); }
function copyLink(id)   { const e=findEntry(id); if(e) navigator.clipboard.writeText(e.sourceUrl).catch(()=>{}); }

function copyMd(id) {
  const e = findEntry(id); if (!e) return;
  const md = [
    `![${e.pageTitle||'Screenshot'}](${e.sourceUrl})`,
    `> Source: ${e.sourceUrl}`,
    `> Saved: ${new Date(e.capturedAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}${e.folderPath?' · '+e.folderPath:''}`,
    e.tags?.length ? `> Tags: ${e.tags.join(', ')}` : ''
  ].filter(Boolean).join('\n');
  navigator.clipboard.writeText(md).catch(()=>{});
  showCopied();
}

async function deleteEntry(id) {
  if (!confirm('Delete this screenshot?')) return;
  await _browser.runtime.sendMessage({ action: 'deleteEntry', id });
  if (currentDetailId === id) closeDetail();
  await load(); render();
}

async function bulkDel() {
  if (!confirm(`Delete ${selectedIds.size} screenshot(s)?`)) return;
  for (const id of [...selectedIds]) await _browser.runtime.sendMessage({ action: 'deleteEntry', id });
  clearSel(); await load(); render();
}

function showCopied() {
  const p = $('#copiedPill'); if (!p) return;
  p.style.display='flex';
  setTimeout(() => { p.style.display='none'; }, 2200);
}

async function saveEntry(entry) {
  const r = await _browser.storage.local.get('screenshotIndex');
  const idx = r.screenshotIndex || {};
  idx[entry.id] = entry;
  await _browser.storage.local.set({ screenshotIndex: idx });
}

async function toggleStar(id) {
  const e = findEntry(id);
  if (!e) return;
  e.starred = !e.starred;
  await saveEntry(e);
  await load();
  render();
  if (currentDetailId === id) _updateDetailStar(e.starred);
}

function _updateDetailStar(starred) {
  const btn = $('#detailStar');
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (!icon) return;
  if (starred) {
    icon.className = 'ti ti-star-filled';
    btn.classList.add('starred');
    btn.title = 'Unstar this screenshot';
  } else {
    icon.className = 'ti ti-star';
    btn.classList.remove('starred');
    btn.title = 'Star this screenshot';
  }
}

// ── Helpers ──
function findEntry(id) { return allEntries.find(e => e.id === id); }
function esc(s) { if(!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function domain(u) { try { return new URL(u).hostname; } catch { return u; } }
function timeAgo(d) {
  const diff = Date.now()-new Date(d).getTime();
  const m = Math.floor(diff/60000);
  if(m<1) return 'just now'; if(m<60) return m+'m ago';
  const h = Math.floor(m/60); if(h<24) return h+'h ago';
  const dy = Math.floor(h/24); if(dy<7) return dy+'d ago';
  return new Date(d).toLocaleDateString();
}
