/**
 * Popup JS — Screenshot Bookmark (no Drive)
 */
const _browser = globalThis.browser || globalThis.chrome;

let allEntries = [], filteredEntries = [];
let selectedIds = new Set();
let activeFilter = 'all', activeFolder = '', activeTags = [];
let currentDetailId = null;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

document.addEventListener('DOMContentLoaded', async () => {
  await loadEntries();
  renderGrid();
  renderSidebar();
  checkBrokenLinks();
  bindEvents();
});

// ── Data ──
async function loadEntries() {
  try {
    const r = await _browser.storage.local.get('screenshotIndex');
    allEntries = Object.values(r.screenshotIndex || {})
      .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  } catch { allEntries = []; }
  applyFilters();
}

function applyFilters() {
  let e = [...allEntries];
  if (activeFolder) e = e.filter(x => x.folderPath === activeFolder);
  if (activeTags.length) e = e.filter(x => activeTags.every(t => (x.tags||[]).includes(t)));
  const now = new Date();
  if (activeFilter === 'today') { const s=new Date(now.getFullYear(),now.getMonth(),now.getDate()); e=e.filter(x=>new Date(x.capturedAt)>=s); }
  else if (activeFilter === 'week') { const s=new Date(now); s.setDate(s.getDate()-7); e=e.filter(x=>new Date(x.capturedAt)>=s); }
  else if (activeFilter === 'broken') e=e.filter(x=>x.linkStatus==='broken');
  const q=($('#searchInput')?.value||'').toLowerCase().trim();
  if (q) e=e.filter(x=>(x.pageTitle||'').toLowerCase().includes(q)||(x.sourceUrl||'').toLowerCase().includes(q)||(x.tags||[]).some(t=>t.toLowerCase().includes(q)));
  filteredEntries = e;
}

// ── Rendering ──
function renderGrid() {
  const grid=$('#screenshotGrid'), empty=$('#emptyState');
  if (!filteredEntries.length) { grid.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  grid.innerHTML = filteredEntries.map(e => `
    <div class="card ${selectedIds.has(e.id)?'selected':''}" data-id="${e.id}">
      <div class="card-checkbox" data-action="toggle-select">${selectedIds.has(e.id)?'<i class="ti ti-check"></i>':''}</div>
      ${e.linkStatus==='broken'?'<div class="card-badge broken"><i class="ti ti-alert-triangle"></i>Dead link</div>':''}
      <div class="card-thumb">
        ${e.thumbnailDataUrl?`<img src="${e.thumbnailDataUrl}" alt="${esc(e.pageTitle)}" loading="lazy">`:'<i class="ti ti-photo"></i>'}
      </div>
      <div class="card-info">
        <div class="card-title">${esc(e.pageTitle||'Untitled')}</div>
        <div class="card-domain">${domain(e.sourceUrl)}</div>
        <div class="card-meta">
          <span class="card-time">${timeAgo(e.capturedAt)}</span>
          ${e.folderPath?`<span class="card-folder-tag">${esc(e.folderPath)}</span>`:''}
          ${e.savedFilename?'<span class="card-saved-dot" title="Saved to disk">💾</span>':''}
        </div>
      </div>
      <div class="card-actions">
        <button class="card-action-btn" data-action="visit" title="Visit"><i class="ti ti-external-link"></i></button>
        <button class="card-action-btn" data-action="copy-link" title="Copy URL"><i class="ti ti-link"></i></button>
        <button class="card-action-btn" data-action="copy-md" title="Markdown"><i class="ti ti-markdown"></i></button>
        <button class="card-action-btn" data-action="delete" title="Delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('');
}

function renderSidebar() {
  const folders=[...new Set(allEntries.map(e=>e.folderPath).filter(Boolean))].sort();
  $('#folderTree').innerHTML=`
    <li class="folder-item ${activeFolder===''?'active':''}" data-folder=""><i class="ti ti-folder"></i> All (${allEntries.length})</li>
    ${folders.map(f=>`<li class="folder-item ${activeFolder===f?'active':''}" data-folder="${esc(f)}"><i class="ti ti-folder"></i> ${esc(f)} (${allEntries.filter(e=>e.folderPath===f).length})</li>`).join('')}`;
  const tc={};
  allEntries.forEach(e=>(e.tags||[]).forEach(t=>{tc[t]=(tc[t]||0)+1;}));
  $('#tagCloud').innerHTML=Object.keys(tc).length
    ?Object.entries(tc).sort((a,b)=>b[1]-a[1]).map(([t,c])=>`<span class="tag-pill ${activeTags.includes(t)?'active':''}" data-tag="${esc(t)}">${esc(t)}<span>${c}</span></span>`).join('')
    :'<span class="empty-label">No tags yet</span>';
}

function checkBrokenLinks() {
  const broken=allEntries.filter(e=>e.linkStatus==='broken');
  const bb=$('#brokenBanner');
  if(broken.length){bb.style.display='flex';$('#brokenCount').textContent=`${broken.length} saved page${broken.length>1?'s are':' is'} no longer reachable`;}
  else bb.style.display='none';
}

// ── Events ──
function bindEvents() {
  $('#searchInput').addEventListener('input',()=>{applyFilters();renderGrid();});

  $('#filterChips').addEventListener('click',e=>{
    const c=e.target.closest('.chip');if(!c)return;
    $$('.chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');
    activeFilter=c.dataset.filter;applyFilters();renderGrid();
  });

  $('#screenshotGrid').addEventListener('click',e=>{
    const card=e.target.closest('.card');if(!card)return;
    const id=card.dataset.id;
    const action=e.target.closest('[data-action]')?.dataset.action;
    if(action==='toggle-select'){toggleSelect(id);return;}
    if(action==='visit'){visitEntry(id);return;}
    if(action==='copy-link'){copyLink(id);return;}
    if(action==='copy-md'){copyMarkdown(id);return;}
    if(action==='delete'){deleteEntry(id);return;}
    openDetail(id);
  });

  $('#folderTree').addEventListener('click',e=>{
    const item=e.target.closest('.folder-item');if(!item)return;
    activeFolder=item.dataset.folder;applyFilters();renderGrid();renderSidebar();
  });

  $('#tagCloud').addEventListener('click',e=>{
    const pill=e.target.closest('.tag-pill');if(!pill)return;
    const t=pill.dataset.tag;
    activeTags=activeTags.includes(t)?activeTags.filter(x=>x!==t):[...activeTags,t];
    applyFilters();renderGrid();renderSidebar();
  });

  $('#reviewBroken')?.addEventListener('click',()=>{activeFilter='broken';$$('.chip').forEach(c=>c.classList.remove('active'));applyFilters();renderGrid();});
  $('#dismissBroken')?.addEventListener('click',()=>{$('#brokenBanner').style.display='none';});

  $('#bulkCancel')?.addEventListener('click',clearSelection);
  $('#bulkDelete')?.addEventListener('click',bulkDelete);
  $('#bulkMove')?.addEventListener('click',bulkMove);
  $('#bulkTag')?.addEventListener('click',bulkAddTag);
  $('#bulkExport')?.addEventListener('click',bulkExport);

  // Detail pane
  $('#detailClose').addEventListener('click',closeDetail);
  $('#detailVisit').addEventListener('click',()=>currentDetailId&&visitEntry(currentDetailId));
  $('#detailCopyMd').addEventListener('click',()=>currentDetailId&&copyMarkdown(currentDetailId));
  $('#detailExport').addEventListener('click',()=>{if(currentDetailId){const e=allEntries.find(x=>x.id===currentDetailId);if(e)window.ZipExporter.exportZip([e],'screenshot');}});
  $('#detailDelete').addEventListener('click',()=>{if(currentDetailId){deleteEntry(currentDetailId);closeDetail();}});
  $('#copyUrl').addEventListener('click',()=>{const e=allEntries.find(x=>x.id===currentDetailId);if(e)navigator.clipboard.writeText(e.sourceUrl).catch(()=>{});});
  $('#detailTagAdd').addEventListener('click',addTagToDetail);
  $('#detailTagInput').addEventListener('keydown',e=>{if(e.key==='Enter')addTagToDetail();});
  $('#detailFolder')?.addEventListener('change',async ev=>{
    const e=allEntries.find(x=>x.id===currentDetailId);
    if(e){e.folderPath=ev.target.value;await saveEntry(e);await loadEntries();renderSidebar();}
  });

  // Footer
  $('#captureBtn').addEventListener('click',captureCurrentPage);
  $('#captureRegionBtn')?.addEventListener('click', () => { _browser.runtime.sendMessage({ action: 'startCapture', captureType: 'region' }); window.close(); });
  $('#captureFullBtn')?.addEventListener('click', () => { _browser.runtime.sendMessage({ action: 'startCapture', captureType: 'full_page' }); window.close(); });
  $('#libraryBtn').addEventListener('click',()=>_browser.runtime.sendMessage({action:'openLibrary'}));
  $('#settingsBtn').addEventListener('click',()=>_browser.runtime.openOptionsPage());

  // Keyboard
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if($('#detailPane').classList.contains('open'))closeDetail();else if(selectedIds.size)clearSelection();}
    if((e.ctrlKey||e.metaKey)&&e.key==='a'){e.preventDefault();filteredEntries.forEach(x=>selectedIds.add(x.id));updateBulkBar();renderGrid();}
    if(e.key==='Delete'&&selectedIds.size)bulkDelete();
  });
}

// ── Selection ──
function toggleSelect(id){if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);updateBulkBar();renderGrid();}
function clearSelection(){selectedIds.clear();updateBulkBar();renderGrid();}
function updateBulkBar(){
  const bar=$('#bulkBar');
  if(selectedIds.size){bar.style.display='flex';$('#bulkCount').textContent=`${selectedIds.size} selected`;}
  else bar.style.display='none';
}

// ── Detail Pane ──
function openDetail(id) {
  const e=allEntries.find(x=>x.id===id);if(!e)return;
  currentDetailId=id;
  $('#detailTitle').textContent=e.pageTitle||'Untitled';
  $('#detailImage').src=e.thumbnailDataUrl||'';
  $('#detailUrl').href=e.sourceUrl;
  $('#detailUrl').textContent=e.sourceUrl;
  $('#detailDate').textContent=new Date(e.capturedAt).toLocaleString();
  $('#detailType').textContent=e.captureType==='full_page'?'Full page':'Viewport';

  // Show saved filename
  const fileEl=$('#detailFile');
  if(fileEl){
    fileEl.textContent = e.savedFilename
      ? '💾 ' + e.savedFilename.split('/').pop()
      : 'Auto-saved to Downloads/Screenshot Bookmark/';
    fileEl.title = e.savedFilename || 'Saved automatically to Downloads folder';
  }

  const tagsEl=$('#detailTags');
  tagsEl.innerHTML=(e.tags||[]).map(t=>`<span class="detail-tag">${esc(t)}<span class="remove-tag" data-tag="${esc(t)}">✕</span></span>`).join('');
  tagsEl.querySelectorAll('.remove-tag').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      e.tags=(e.tags||[]).filter(t=>t!==btn.dataset.tag);
      await saveEntry(e);openDetail(id);await loadEntries();renderSidebar();
    });
  });

  // Populate folder dropdown
  const sel=$('#detailFolder');
  if(sel){
    const folders=[...new Set(allEntries.map(x=>x.folderPath).filter(Boolean))].sort();
    sel.innerHTML='<option value="">No folder</option>'+folders.map(f=>`<option value="${esc(f)}" ${e.folderPath===f?'selected':''}>${esc(f)}</option>`).join('');
    sel.value=e.folderPath||'';
  }

  $('#detailPane').classList.add('open');
}

function closeDetail(){$('#detailPane').classList.remove('open');currentDetailId=null;}

async function addTagToDetail(){
  const input=$('#detailTagInput');const tag=input.value.trim();
  if(!tag||!currentDetailId)return;
  const e=allEntries.find(x=>x.id===currentDetailId);if(!e)return;
  if(!e.tags)e.tags=[];if(!e.tags.includes(tag))e.tags.push(tag);
  await saveEntry(e);input.value='';openDetail(currentDetailId);await loadEntries();renderSidebar();
}

// ── Entry Actions ──
function visitEntry(id){const e=allEntries.find(x=>x.id===id);if(e)_browser.tabs.create({url:e.sourceUrl});}
function copyLink(id){const e=allEntries.find(x=>x.id===id);if(e)navigator.clipboard.writeText(e.sourceUrl).catch(()=>{});}
function copyMarkdown(id){
  const e=allEntries.find(x=>x.id===id);if(!e)return;
  const md=[`![${e.pageTitle||'Screenshot'}](${e.sourceUrl})`,`> Source: ${e.sourceUrl}`,`> Saved: ${new Date(e.capturedAt).toLocaleDateString()}`,e.tags?.length?`> Tags: ${e.tags.join(', ')}`:''].filter(Boolean).join('\n');
  navigator.clipboard.writeText(md).catch(()=>{});
}
async function deleteEntry(id){
  if(!confirm('Delete this screenshot? (File in Downloads is kept)'))return;
  await _browser.runtime.sendMessage({action:'deleteEntry',id});
  await loadEntries();renderGrid();renderSidebar();
}
async function bulkDelete(){
  if(!confirm(`Delete ${selectedIds.size} screenshot(s) from the library? (Files in Downloads are kept)`))return;
  for(const id of [...selectedIds])await _browser.runtime.sendMessage({action:'deleteEntry',id});
  clearSelection();await loadEntries();renderGrid();renderSidebar();
}
async function bulkMove(){
  const folder=prompt('Move selected screenshots to folder:');if(folder===null)return;
  for(const id of [...selectedIds]){const e=allEntries.find(x=>x.id===id);if(e){e.folderPath=folder.trim();await saveEntry(e);}}
  clearSelection();await loadEntries();renderGrid();renderSidebar();
}
async function bulkAddTag(){
  const tag=prompt('Add tag to selected screenshots:');if(!tag?.trim())return;
  for(const id of [...selectedIds]){const e=allEntries.find(x=>x.id===id);if(e){if(!e.tags)e.tags=[];if(!e.tags.includes(tag.trim()))e.tags.push(tag.trim());await saveEntry(e);}}
  clearSelection();await loadEntries();renderGrid();renderSidebar();
}
function bulkExport(){
  const selected=filteredEntries.filter(e=>selectedIds.has(e.id));
  if(!selected.length){alert('No screenshots selected.');return;}
  window.ZipExporter.exportZip(selected);
}
async function captureCurrentPage(){
  const[tab]=await _browser.tabs.query({active:true,currentWindow:true});
  if(tab){await _browser.runtime.sendMessage({action:'startCapture',captureType:'viewport'});window.close();}
}
async function saveEntry(entry){
  const r=await _browser.storage.local.get('screenshotIndex');
  const idx=r.screenshotIndex||{};idx[entry.id]=entry;
  await _browser.storage.local.set({screenshotIndex:idx});
}

// ── Helpers ──
function esc(s){if(!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');}
function domain(u){try{return new URL(u).hostname;}catch{return u;}}
function timeAgo(d){
  const diff=Date.now()-new Date(d).getTime();const m=Math.floor(diff/60000);
  if(m<1)return 'just now';if(m<60)return m+'m ago';
  const h=Math.floor(m/60);if(h<24)return h+'h ago';
  const dy=Math.floor(h/24);if(dy<7)return dy+'d ago';
  return new Date(d).toLocaleDateString();
}
