const $ = s => document.querySelector(s);
const _br = globalThis.browser || globalThis.chrome;
let blocks = []; // Array of { id, type: 'image'|'text', content: string (dataUrl or html) }
let draggedBlockId = null;
let currentInsertTargetId = null; // Used when uploading an image between blocks

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const idsParam = urlParams.get('ids');
  
  if (idsParam) {
    const ids = idsParam.split(',');
    await loadScreenshots(ids);
  }

  bindEvents();
});

async function loadScreenshots(ids) {
  const req = indexedDB.open('ScreenshotBookmarkDB', 1);
  req.onsuccess = ev => {
    const db = ev.target.result;
    if (!db.objectStoreNames.contains('screenshots')) return;
    const tx = db.transaction('screenshots', 'readonly');
    const store = tx.objectStore('screenshots');
    
    let loaded = 0;
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result && getReq.result.dataUrl) {
          addBlock('image', getReq.result.dataUrl);
        }
        loaded++;
        if (loaded === ids.length && blocks.length === 0) {
          addBlock('text', 'Start writing your tutorial here...');
        }
      };
    }
  };
}

function renderBlocks() {
  const container = $('#blocksContainer');
  container.innerHTML = '';
  
  blocks.forEach((block, idx) => {
    // Insert Zone (above every block)
    const zone = document.createElement('div');
    zone.className = 'insert-zone';
    zone.innerHTML = `
      <div class="insert-line"></div>
      <div class="insert-btns">
        <button class="ibtn" title="Insert Text" onclick="addBlock('text', '', '${idx === 0 ? '__TOP__' : blocks[idx-1].id}')"><i class="ti ti-typography"></i></button>
        <button class="ibtn" title="Insert Image" onclick="triggerInsertImage('${idx === 0 ? '__TOP__' : blocks[idx-1].id}')"><i class="ti ti-photo"></i></button>
      </div>
      <div class="insert-line"></div>
    `;
    container.appendChild(zone);

    const wrap = document.createElement('div');
    wrap.className = 'block-wrapper';
    wrap.dataset.id = block.id;
    wrap.draggable = true;

    // Drag Handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'block-drag-handle';
    dragHandle.innerHTML = '⋮⋮';
    wrap.appendChild(dragHandle);

    if (block.type === 'image') {
      wrap.insertAdjacentHTML('beforeend', `<img src="${block.content}" class="block-image">`);
    } else if (block.type === 'text') {
      const div = document.createElement('div');
      div.className = 'block-text';
      div.contentEditable = 'true';
      div.innerHTML = block.content;
      div.addEventListener('blur', () => { block.content = div.innerHTML; });
      wrap.appendChild(div);
    }

    const controls = document.createElement('div');
    controls.className = 'block-controls';
    controls.innerHTML = `
      <button class="bc-btn" onclick="moveBlock('${block.id}', -1)" title="Move up" ${idx===0?'disabled':''}><i class="ti ti-chevron-up"></i></button>
      <button class="bc-btn" onclick="moveBlock('${block.id}', 1)" title="Move down" ${idx===blocks.length-1?'disabled':''}><i class="ti ti-chevron-down"></i></button>
      <button class="bc-btn danger" onclick="removeBlock('${block.id}')" title="Delete"><i class="ti ti-trash"></i></button>
    `;
    wrap.appendChild(controls);
    
    // Drag Events
    wrap.addEventListener('dragstart', e => {
      draggedBlockId = block.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => wrap.style.opacity = '0.4', 0);
    });
    wrap.addEventListener('dragend', () => {
      draggedBlockId = null;
      wrap.style.opacity = '1';
      $$('.block-wrapper').forEach(el => el.classList.remove('drag-over'));
    });
    wrap.addEventListener('dragover', e => {
      e.preventDefault();
      if (draggedBlockId && draggedBlockId !== block.id) wrap.classList.add('drag-over');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
    wrap.addEventListener('drop', e => {
      e.preventDefault();
      wrap.classList.remove('drag-over');
      if (!draggedBlockId || draggedBlockId === block.id) return;
      
      const fromIdx = blocks.findIndex(b => b.id === draggedBlockId);
      const toIdx = blocks.findIndex(b => b.id === block.id);
      
      const [moved] = blocks.splice(fromIdx, 1);
      blocks.splice(toIdx, 0, moved);
      renderBlocks();
    });

    container.appendChild(wrap);
  });
}

function triggerInsertImage(insertAfterId) {
  currentInsertTargetId = insertAfterId;
  $('#fileUploadInsert').click();
}

function addBlock(type, content, insertAfterId = null) {
  const block = { id: 'blk_' + Date.now() + Math.random().toString(36).substr(2, 5), type, content };
  if (insertAfterId === '__TOP__') {
    blocks.unshift(block);
  } else if (insertAfterId) {
    const idx = blocks.findIndex(b => b.id === insertAfterId);
    if (idx >= 0) blocks.splice(idx + 1, 0, block);
    else blocks.push(block);
  } else {
    blocks.push(block);
  }
  renderBlocks();
}

// ── Events ──
function bindEvents() {
  $('.add-block-bottom [data-type="text"]').addEventListener('click', () => addBlock('text', ''));
  $('.add-block-bottom [data-type="image"]').addEventListener('click', () => $('#fileUploadBottom').click());
  
  $('#fileUploadBottom').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => addBlock('image', ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  $('#fileUploadInsert').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => addBlock('image', ev.target.result, currentInsertTargetId);
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  $('#exportMdBtn').addEventListener('click', exportMarkdown);
  $('#exportPdfBtn').addEventListener('click', exportPdf);
  
  // Floating Toolbar setup
  document.addEventListener('selectionchange', handleSelection);
  $$('.ft-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault(); // keep text selection
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val || null;
      document.execCommand(cmd, false, val);
    });
  });

  // Make these accessible to onclick handlers
  window.moveBlock = moveBlock;
  window.removeBlock = removeBlock;
  window.triggerInsertImage = triggerInsertImage;
  window.addBlock = addBlock;
}

function handleSelection() {
  const tb = $('#floatingToolbar');
  const sel = window.getSelection();
  if (sel.isCollapsed || !sel.rangeCount) {
    tb.classList.remove('visible');
    return;
  }
  
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const isInsideEditor = container.nodeType === 3 ? container.parentElement.closest('.block-text') : container.closest('.block-text');
  
  if (!isInsideEditor) {
    tb.classList.remove('visible');
    return;
  }

  const rect = range.getBoundingClientRect();
  tb.style.left = (rect.left + rect.width / 2 - tb.offsetWidth / 2) + 'px';
  tb.style.top = (rect.top + window.scrollY - 40) + 'px'; // 40px above
  tb.classList.add('visible');
}

// ── Export ──
function exportMarkdown() {
  const title = $('#tutorialTitle').innerText || 'Untitled Tutorial';
  const desc = $('#tutorialDesc').innerText || '';
  
  let md = `# ${title}\n\n${desc}\n\n`;
  
  blocks.forEach(b => {
    if (b.type === 'text') {
      // Very crude HTML to MD
      let t = b.content.replace(/<br\s*\/?>/gi, '\n');
      t = t.replace(/<b>(.*?)<\/b>/gi, '**$1**');
      t = t.replace(/<i>(.*?)<\/i>/gi, '*$1*');
      t = t.replace(/<div>(.*?)<\/div>/gi, '\n$1');
      t = t.replace(/<[^>]*>?/gm, ''); // strip remaining tags
      md += t + '\n\n';
    } else {
      md += `![Tutorial Image](${b.content})\n\n`; // Actually dataUrl is bad for markdown copying unless they are pasting to an editor that supports it.
      // Better to warn them.
    }
  });

  navigator.clipboard.writeText(md).then(() => {
    alert('Markdown copied to clipboard! (Note: Images are embedded as data URLs, which may not be supported everywhere. Consider saving as PDF instead).');
  }).catch(() => alert('Failed to copy.'));
}

async function exportPdf() {
  const title = $('#tutorialTitle').innerText || 'Untitled Tutorial';
  const desc = $('#tutorialDesc').innerText || '';
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = 210, ph = 297;
  let y = 20;

  doc.setFontSize(24);
  doc.text(title, 15, y);
  y += 10;
  
  doc.setFontSize(12);
  doc.setTextColor(100);
  const lines = doc.splitTextToSize(desc, 180);
  doc.text(lines, 15, y);
  y += (lines.length * 6) + 10;

  for (const b of blocks) {
    if (y > ph - 30) { doc.addPage(); y = 20; }
    
    if (b.type === 'text') {
      doc.setTextColor(0);
      doc.setFontSize(12);
      // Strip HTML for basic PDF text
      const t = b.content.replace(/<br\s*\/?>/gi, '\n').replace(/<div>(.*?)<\/div>/gi, '\n$1').replace(/<[^>]*>?/gm, '');
      const lns = doc.splitTextToSize(t, 180);
      doc.text(lns, 15, y);
      y += (lns.length * 6) + 5;
    } else if (b.type === 'image') {
      try {
        const res = await fetch(b.content);
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        
        // Calculate aspect ratio fit within width
        const maxWidth = 180;
        let imgW = bmp.width;
        let imgH = bmp.height;
        
        if (imgW > maxWidth * 3) { // rough px to mm
          const ratio = (maxWidth * 3) / imgW;
          imgW *= ratio;
          imgH *= ratio;
        }
        
        const finalW = imgW / 3;
        const finalH = imgH / 3;

        if (y + finalH > ph - 20) { doc.addPage(); y = 20; }
        
        const format = b.content.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
        doc.addImage(b.content, format, 15, y, finalW, finalH);
        y += finalH + 10;
      } catch (err) {
        console.error('Image render fail', err);
      }
    }
  }

  doc.save(`${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
}
