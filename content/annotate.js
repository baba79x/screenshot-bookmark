/**
 * Content Script — Annotation Mode
 */
(function() {
  'use strict';
  const _br = globalThis.browser || globalThis.chrome;
  if (!_br) return;

  if (window.__sbAnnotateLoaded) return;
  window.__sbAnnotateLoaded = true;

  let overlay = null, canvas = null, ctx = null, bgImg = null, captureData = null;
  let tool = 'arrow', color = '#378ADD';
  const COLORS = ['#378ADD', '#E24B4A', '#EF9F27', '#1D9E75'];
  let drawing = false, sx = 0, sy = 0;
  let undoStack = [], penPath = [], notes = [];
  let _tempId = null; // echoed back to SW via showSaveDialog
  let _mode = null; // 'edit' or null

  function handleOpenMessage(msg) {
    if (msg.action === 'openAnnotationMode') {
      captureData = msg;
      _tempId = msg.tempId || null;
      _mode = msg.mode || null;
      open(msg.dataUrl);
    }
  }

  _br.runtime.onMessage.addListener(handleOpenMessage);
  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    if (e.data && e.data.action === 'openAnnotationMode') {
      handleOpenMessage(e.data);
    }
  });

  function open(dataUrl) {
    overlay = el('div', 'sb-annotation-overlay');

    // Toolbar
    const tb = el('div', 'sb-anno-toolbar');
    tb.innerHTML = `
      <button class="sb-anno-btn active" data-tool="arrow" title="Arrow (A)">↗</button>
      <button class="sb-anno-btn" data-tool="highlight" title="Highlight (H)">▬</button>
      <button class="sb-anno-btn" data-tool="note" title="Note (N)">📝</button>
      <button class="sb-anno-btn" data-tool="pen" title="Pen (P)">✎</button>
      <button class="sb-anno-btn" data-tool="rect" title="Rect (R)">▢</button>
      <button class="sb-anno-btn" data-tool="text" title="Text (T)">T</button>
      <button class="sb-anno-btn" data-tool="blur" title="Blur (B)">💧</button>
      <button class="sb-anno-btn" data-tool="bw" title="Black & White">◐</button>
      <button class="sb-anno-btn" data-tool="confidential" title="Confidential Stamp">🛑</button>
      <button class="sb-anno-btn" data-tool="embed" title="Embed Image">🖼️</button>
      <button class="sb-anno-btn" data-tool="crop" title="Crop (C)">✂️</button>
      <div class="sb-anno-sep"></div>
      ${COLORS.map((c,i) => `<div class="sb-color-dot${i===0?' selected':''}" data-color="${c}" style="background:${c}"></div>`).join('')}
      <div class="sb-anno-sep"></div>
      <button class="sb-anno-btn" data-action="undo" title="Undo">↶</button>
      <button class="sb-anno-btn" data-action="clear" title="Clear">🗑</button>
      <span class="sb-anno-label">Annotation Mode — Esc to skip</span>`;

    // Canvas wrap
    const wrap = el('div', 'sb-anno-canvas-wrap');
    const cont = el('div', 'sb-anno-canvas-container');
    bgImg = el('img', 'sb-anno-bg-img');
    bgImg.src = dataUrl;
    canvas = el('canvas', 'sb-anno-canvas');
    cont.append(bgImg, canvas);
    wrap.append(cont);

    // Footer
    const ft = el('div', 'sb-anno-footer');
    ft.innerHTML = `
      <button class="sb-anno-action" data-action="skip">Skip — Save as-is</button>
      <button class="sb-anno-action primary" data-action="save">💾 Save with annotations</button>`;

    overlay.append(tb, wrap, ft);
    document.body.appendChild(overlay);

    bgImg.onload = () => {
      canvas.width  = bgImg.naturalWidth;
      canvas.height = bgImg.naturalHeight;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.lineCap = ctx.lineJoin = 'round';
      saveState();
    };

    // Toolbar actions
    tb.addEventListener('click', e => {
      const btn = e.target.closest('[data-tool]');
      if (btn) {
        if (btn.dataset.tool === 'bw') {
          toggleBW(btn);
          return;
        }
        if (btn.dataset.tool === 'confidential') {
          addConfidentialStamp();
          return;
        }
        if (btn.dataset.tool === 'embed') {
          triggerEmbedImage();
          return;
        }
        tool = btn.dataset.tool;
        tb.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        canvas.style.cursor = (tool === 'note' || tool === 'text') ? 'text' : (tool === 'crop' || tool === 'blur') ? 'crosshair' : 'crosshair';
      }
      const dot = e.target.closest('[data-color]');
      if (dot) {
        color = dot.dataset.color;
        tb.querySelectorAll('.sb-color-dot').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
      }
      const act = e.target.closest('[data-action]');
      if (act?.dataset.action === 'undo') undo();
      if (act?.dataset.action === 'clear') clearAll();
    });

    // Canvas drawing
    canvas.addEventListener('mousedown', e => {
      const p = coords(e);
      sx = p.x; sy = p.y;
      if (tool === 'note') { addNote(e.clientX, e.clientY); return; }
      if (tool === 'text') { addText(p.x, p.y); return; }
      drawing = true;
      if (tool === 'pen') penPath = [p];
      else saveState();
    });
    canvas.addEventListener('mousemove', e => {
      if (!drawing) return;
      const p = coords(e);
      if (tool === 'pen') {
        penPath.push(p);
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath();
        if (penPath.length >= 2) {
          const prev = penPath[penPath.length - 2];
          ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        }
      } else {
        restoreState(); drawShape(sx, sy, p.x, p.y);
      }
    });
    canvas.addEventListener('mouseup', e => {
      if (!drawing) return;
      drawing = false;
      const p = coords(e);
      if (tool === 'pen') { penPath = []; saveState(); }
      else { 
        restoreState(); 
        if (tool === 'crop') {
          performCrop(sx, sy, p.x, p.y);
        } else if (tool === 'blur') {
          performBlur(sx, sy, p.x, p.y);
        } else {
          drawShape(sx, sy, p.x, p.y); 
          saveState(); 
        }
      }
    });

    // Footer actions
    ft.addEventListener('click', e => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      if (a.dataset.action === 'skip') skipSave();
      if (a.dataset.action === 'save') doSave();
    });

    document.addEventListener('keydown', onKey);
  }

  function coords(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top)  * (canvas.height / r.height)
    };
  }

  function drawShape(x1, y1, x2, y2) {
    ctx.strokeStyle = color; ctx.fillStyle = color;
    if (tool === 'arrow') drawArrow(x1, y1, x2, y2);
    else if (tool === 'highlight') {
      ctx.fillStyle = color + '55';
      ctx.fillRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
    } else if (tool === 'rect') {
      ctx.lineWidth = 3;
      ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
    } else if (tool === 'crop') {
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      
      const w = canvas.width, h = canvas.height;
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
      
      ctx.fillRect(0, 0, w, ry);
      ctx.fillRect(0, ry + rh, w, h - (ry + rh));
      ctx.fillRect(0, ry, rx, rh);
      ctx.fillRect(rx + rw, ry, w - (rx + rw), rh);
    }
  }

  function drawArrow(x1, y1, x2, y2) {
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(y2-y1, x2-x1), L = 14;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - L * Math.cos(a - Math.PI/6), y2 - L * Math.sin(a - Math.PI/6));
    ctx.lineTo(x2 - L * Math.cos(a + Math.PI/6), y2 - L * Math.sin(a + Math.PI/6));
    ctx.closePath(); ctx.fill();
  }

  function addText(cx, cy) {
    const cont = overlay.querySelector('.sb-anno-canvas-container');
    const r = cont.getBoundingClientRect();
    const textEl = el('div', 'sb-anno-text');
    textEl.style.left = (cx - r.left) + 'px';
    textEl.style.top  = (cy - r.top)  + 'px';
    textEl.style.color = color;
    textEl.style.position = 'absolute';
    textEl.style.fontSize = '24px';
    textEl.style.fontWeight = 'bold';
    textEl.style.fontFamily = 'sans-serif';
    textEl.style.cursor = 'move';
    textEl.style.padding = '8px';
    textEl.style.border = '2px dashed transparent';
    textEl.innerHTML = `
      <div class="sb-text-drag" style="position:absolute; top:-10px; left:-10px; width:24px; height:24px; background:var(--accent,#378ADD); color:#fff; border-radius:50%; font-size:14px; display:flex; align-items:center; justify-content:center; cursor:move; box-shadow:0 2px 4px rgba(0,0,0,0.2); opacity:0; transition:opacity 0.2s;">✢</div>
      <div contenteditable="true" style="outline:none; min-width:20px; min-height:24px; padding:0;">Text</div>
    `;
    
    const dragHandle = textEl.querySelector('.sb-text-drag');
    textEl.addEventListener('mouseenter', () => dragHandle.style.opacity = '1');
    textEl.addEventListener('mouseleave', () => { if (!textEl.classList.contains('selected')) dragHandle.style.opacity = '0'; });

    let drag = false, ox = 0, oy = 0;
    
    // Clicking anywhere in the textEl selects it
    textEl.addEventListener('mousedown', e => {
      overlay.querySelectorAll('.sb-anno-text').forEach(el => {
        el.style.borderColor = 'transparent';
        el.classList.remove('selected');
        el.querySelector('.sb-text-drag').style.opacity = '0';
      });
      textEl.style.borderColor = 'rgba(255,255,255,0.5)';
      textEl.classList.add('selected');
      dragHandle.style.opacity = '1';

      // If they clicked the drag handle, start dragging!
      if (e.target === dragHandle) {
        drag = true; 
        ox = e.clientX - textEl.offsetLeft - r.left; 
        oy = e.clientY - textEl.offsetTop - r.top;
      }
    });
    
    document.addEventListener('mousemove', e => { 
      if (drag) { 
        textEl.style.left = (e.clientX - r.left - ox) + 'px'; 
        textEl.style.top = (e.clientY - r.top - oy) + 'px'; 
      } 
    });
    document.addEventListener('mouseup', () => { drag = false; });
    
    // Auto-focus and select
    textEl.querySelector('div[contenteditable]').addEventListener('focus', () => {
      overlay.querySelectorAll('.sb-anno-text').forEach(el => { 
        el.style.borderColor = 'transparent'; 
        el.classList.remove('selected'); 
        el.querySelector('.sb-text-drag').style.opacity = '0';
      });
      textEl.style.borderColor = 'rgba(255,255,255,0.5)';
      textEl.classList.add('selected');
      dragHandle.style.opacity = '1';
    });

    cont.appendChild(textEl);
    notes.push({ el: textEl, type: 'text' });
    
    // Select all text inside
    const range = document.createRange();
    const ce = textEl.querySelector('div[contenteditable]');
    range.selectNodeContents(ce);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    ce.focus();
  }

  function toggleBW(btn) {
    btn.classList.toggle('active');
    if (btn.classList.contains('active')) {
      bgImg.style.filter = 'grayscale(100%)';
    } else {
      bgImg.style.filter = 'none';
    }
  }

  function triggerEmbedImage() {
    let input = document.getElementById('sb-anno-embed-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.id = 'sb-anno-embed-input';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => embedImageObject(ev.target.result);
        reader.readAsDataURL(file);
        input.value = '';
      });
    }
    input.click();
  }

  function addConfidentialStamp() {
    const cont = overlay.querySelector('.sb-anno-canvas-container');
    const wrap = el('div', 'sb-anno-text');
    wrap.style.position = 'absolute';
    wrap.style.left = '100px';
    wrap.style.top = '100px';
    wrap.style.background = '#000';
    wrap.style.border = '4px solid #f00';
    wrap.style.color = '#f00';
    wrap.style.padding = '4px 8px';
    wrap.style.fontSize = '24px';
    wrap.style.fontWeight = '900';
    wrap.style.fontFamily = 'monospace';
    wrap.style.textTransform = 'uppercase';
    wrap.style.letterSpacing = '2px';
    wrap.style.cursor = 'move';
    wrap.style.zIndex = '50';
    wrap.style.resize = 'both';
    wrap.style.overflow = 'hidden';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.style.minWidth = '200px';
    wrap.style.minHeight = '50px';
    
    wrap.innerHTML = `
      <div class="sb-text-drag" style="position:absolute; top:-10px; left:-10px; width:24px; height:24px; background:var(--accent,#378ADD); color:#fff; border-radius:50%; font-size:14px; display:flex; align-items:center; justify-content:center; cursor:move; box-shadow:0 2px 4px rgba(0,0,0,0.2); opacity:0; transition:opacity 0.2s; z-index:100;">✢</div>
      <div style="pointer-events:none;">CONFIDENTIAL</div>
    `;

    const dragHandle = wrap.querySelector('.sb-text-drag');
    wrap.addEventListener('mouseenter', () => dragHandle.style.opacity = '1');
    wrap.addEventListener('mouseleave', () => { if (!wrap.classList.contains('selected')) dragHandle.style.opacity = '0'; });

    let drag = false, ox = 0, oy = 0;
    wrap.addEventListener('mousedown', e => {
      overlay.querySelectorAll('.sb-anno-text').forEach(el => {
        el.style.borderColor = 'transparent';
        if(el.style.color && el.style.color.includes('red')) el.style.borderColor = 'rgba(255,0,0,0.8)'; // restore red border
        el.classList.remove('selected');
        el.querySelector('.sb-text-drag').style.opacity = '0';
      });
      wrap.classList.add('selected');
      dragHandle.style.opacity = '1';

      if (e.target === dragHandle) {
        drag = true; 
        const r = cont.getBoundingClientRect();
        ox = e.clientX - wrap.offsetLeft - r.left; 
        oy = e.clientY - wrap.offsetTop - r.top;
      }
    });

    document.addEventListener('mousemove', e => { 
      if (drag) { 
        const r = cont.getBoundingClientRect();
        wrap.style.left = (e.clientX - r.left - ox) + 'px'; 
        wrap.style.top = (e.clientY - r.top - oy) + 'px'; 
      } 
    });
    document.addEventListener('mouseup', () => { drag = false; });

    cont.appendChild(wrap);
    notes.push({ el: wrap, type: 'confidential' });
  }

  function embedImageObject(src) {
    const cont = overlay.querySelector('.sb-anno-canvas-container');
    const wrap = el('div', 'sb-anno-text');
    wrap.style.position = 'absolute';
    wrap.style.left = '50px';
    wrap.style.top = '50px';
    wrap.style.border = '2px dashed transparent';
    wrap.innerHTML = `
      <div class="sb-text-drag" style="position:absolute; top:-10px; left:-10px; width:24px; height:24px; background:var(--accent,#378ADD); color:#fff; border-radius:50%; font-size:14px; display:flex; align-items:center; justify-content:center; cursor:move; box-shadow:0 2px 4px rgba(0,0,0,0.2); opacity:0; transition:opacity 0.2s; z-index:100;">✢</div>
      <img src="${src}" style="max-width:300px; display:block; pointer-events:none;">
    `;

    const dragHandle = wrap.querySelector('.sb-text-drag');
    wrap.addEventListener('mouseenter', () => dragHandle.style.opacity = '1');
    wrap.addEventListener('mouseleave', () => { if (!wrap.classList.contains('selected')) dragHandle.style.opacity = '0'; });

    let drag = false, ox = 0, oy = 0;
    wrap.addEventListener('mousedown', e => {
      overlay.querySelectorAll('.sb-anno-text').forEach(el => {
        el.style.borderColor = 'transparent';
        el.classList.remove('selected');
        el.querySelector('.sb-text-drag').style.opacity = '0';
      });
      wrap.style.borderColor = 'rgba(255,255,255,0.5)';
      wrap.classList.add('selected');
      dragHandle.style.opacity = '1';

      if (e.target === dragHandle) {
        drag = true; 
        const r = cont.getBoundingClientRect();
        ox = e.clientX - wrap.offsetLeft - r.left; 
        oy = e.clientY - wrap.offsetTop - r.top;
      }
    });

    document.addEventListener('mousemove', e => { 
      if (drag) { 
        const r = cont.getBoundingClientRect();
        wrap.style.left = (e.clientX - r.left - ox) + 'px'; 
        wrap.style.top = (e.clientY - r.top - oy) + 'px'; 
      } 
    });
    document.addEventListener('mouseup', () => { drag = false; });

    cont.appendChild(wrap);
    notes.push({ el: wrap, type: 'embed' });
  }

  function performBlur(x1, y1, x2, y2) {
    const rx = Math.max(0, Math.min(x1, x2));
    const ry = Math.max(0, Math.min(y1, y2));
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    
    if (rw < 5 || rh < 5) return;

    // We must blur the BACKGROUND image + whatever is currently on the canvas
    const tempFc = document.createElement('canvas');
    tempFc.width = canvas.width;
    tempFc.height = canvas.height;
    const tfcCtx = tempFc.getContext('2d', { willReadFrequently: true });
    
    if (bgImg.style.display !== 'none') {
        if (bgImg.style.filter === 'grayscale(100%)') tfcCtx.filter = 'grayscale(100%)';
        tfcCtx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
        tfcCtx.filter = 'none';
    }
    tfcCtx.drawImage(canvas, 0, 0);
    
    // Apply blur to the specific region
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();
    
    ctx.filter = 'blur(8px)';
    ctx.drawImage(tempFc, 0, 0);
    ctx.restore();
    
    saveState();
  }

  function performCrop(x1, y1, x2, y2) {
    const rx = Math.max(0, Math.min(x1, x2));
    const ry = Math.max(0, Math.min(y1, y2));
    const rw = Math.min(canvas.width - rx, Math.abs(x2 - x1));
    const rh = Math.min(canvas.height - ry, Math.abs(y2 - y1));
    
    if (rw < 10 || rh < 10) return; // Too small

    // Create a temporary canvas representing the full merged state
    const tempFc = document.createElement('canvas');
    tempFc.width = canvas.width;
    tempFc.height = canvas.height;
    const tfcCtx = tempFc.getContext('2d', { willReadFrequently: true });
    
    // Draw background if not already hidden
    if (bgImg.style.display !== 'none') {
        tfcCtx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
    }
    tfcCtx.drawImage(canvas, 0, 0);

    // Get cropped merged data
    const croppedData = tfcCtx.getImageData(rx, ry, rw, rh);
    
    // Resize canvas
    canvas.width = rw;
    canvas.height = rh;
    
    // Resize container
    const cont = overlay.querySelector('.sb-anno-canvas-container');
    if (cont) {
      cont.style.width = 'fit-content';
      cont.style.height = 'fit-content';
    }
    
    bgImg.style.display = 'none'; // We don't need the background image underneath anymore
    ctx.putImageData(croppedData, 0, 0);

    // Adjust floating elements (text & notes)
    notes.forEach(note => {
      const el = note.el;
      const left = parseFloat(el.style.left || 0);
      const top = parseFloat(el.style.top || 0);
      el.style.left = (left - rx) + 'px';
      el.style.top = (top - ry) + 'px';
    });
    
    // Clear undo stack since dimensions changed
    undoStack = [];
    saveState();
  }

  function addNote(cx, cy) {
    const cont = overlay.querySelector('.sb-anno-canvas-container');
    const r = cont.getBoundingClientRect();
    const note = el('div', 'sb-sticky-note');
    note.style.left = (cx - r.left) + 'px';
    note.style.top  = (cy - r.top)  + 'px';
    note.innerHTML  = `<span class="sb-sticky-close">✕</span><textarea placeholder="Add a note…" rows="2"></textarea>`;
    note.querySelector('.sb-sticky-close').onclick = () => { note.remove(); notes = notes.filter(n => n !== note); };

    let drag = false, ox = 0, oy = 0;
    note.addEventListener('mousedown', e => {
      if (e.target.tagName === 'TEXTAREA' || e.target.classList.contains('sb-sticky-close')) return;
      drag = true; ox = e.clientX - note.offsetLeft - r.left; oy = e.clientY - note.offsetTop - r.top;
    });
    document.addEventListener('mousemove', e => { if (drag) { note.style.left = (e.clientX - r.left - ox) + 'px'; note.style.top = (e.clientY - r.top - oy) + 'px'; } });
    document.addEventListener('mouseup', () => { drag = false; });

    cont.appendChild(note);
    notes.push({ el: note, type: 'note' });
    note.querySelector('textarea').focus();
  }

  function saveState() {
    if (!ctx) return;
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > 30) undoStack.shift();
  }
  function restoreState() { if (undoStack.length) ctx.putImageData(undoStack[undoStack.length-1], 0, 0); }
  function undo() {
    if (undoStack.length > 1) { undoStack.pop(); ctx.putImageData(undoStack[undoStack.length-1], 0, 0); }
    else if (undoStack.length === 1) { undoStack.pop(); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
  function clearAll() { 
    undoStack = []; 
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); 
    notes.forEach(n => n.el.remove()); 
    notes = []; 
  }

  function onKey(e) {
    if (!overlay) return;
    
    // Delete selected text object
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't delete if they are actively typing inside a contenteditable
      if (document.activeElement && document.activeElement.hasAttribute('contenteditable')) return;
      if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;

      const sel = overlay.querySelector('.sb-anno-text.selected');
      if (sel) {
        sel.remove();
        notes = notes.filter(n => n.el !== sel);
        return;
      }
    }

    if (e.key === 'Escape') skipSave();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'a') setTool('arrow');
    if (e.key === 'h') setTool('highlight');
    if (e.key === 'n') setTool('note');
    if (e.key === 'p') setTool('pen');
    if (e.key === 'r') setTool('rect');
  }

  function setTool(t) {
    tool = t;
    overlay.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  }

  function skipSave() {
    _br.runtime.sendMessage({
      action: 'showSaveDialog',
      tempId:        _tempId,
      pageUrl:       captureData.pageUrl,
      pageTitle:     captureData.pageTitle,
      captureType:   captureData.captureType,
      hasAnnotations: false
    });
    closeOverlay();
  }

  async function doSave() {
    // After a crop, bgImg is hidden and canvas holds the merged cropped content.
    const isCropped = bgImg.style.display === 'none';
    const fc = document.createElement('canvas');
    fc.width  = isCropped ? canvas.width  : bgImg.naturalWidth;
    fc.height = isCropped ? canvas.height : bgImg.naturalHeight;
    const fctx = fc.getContext('2d', { willReadFrequently: true });

    if (!isCropped) {
      if (bgImg.style.filter === 'grayscale(100%)') {
        fctx.filter = 'grayscale(100%)';
      }
      fctx.drawImage(bgImg, 0, 0);
      fctx.filter = 'none';
    }

    fctx.drawImage(canvas, 0, 0);

    // Bake sticky notes and text objects
    const cont = overlay.querySelector('.sb-anno-canvas-container');
    const cr = cont.getBoundingClientRect();
    const sx2 = fc.width / cr.width, sy2 = fc.height / cr.height;
    
    // Deselect before baking
    overlay.querySelectorAll('.sb-anno-text').forEach(el => { el.style.borderColor = 'transparent'; el.classList.remove('selected'); });

    for (const note of notes) {
      if (note.type === 'note') {
        const nr = note.el.getBoundingClientRect();
        const nx = (nr.left - cr.left) * sx2, ny = (nr.top - cr.top) * sy2;
        const nw = nr.width * sx2, nh = nr.height * sy2;
        fctx.fillStyle = '#FAEEDA'; fctx.strokeStyle = '#EF9F27'; fctx.lineWidth = 2;
        fctx.beginPath(); fctx.roundRect(nx, ny, nw, nh, 6); fctx.fill(); fctx.stroke();
        const txt = note.el.querySelector('textarea').value;
        if (txt) { fctx.fillStyle = '#633806'; fctx.font = `${14 * sx2}px sans-serif`; fctx.fillText(txt, nx + 8*sx2, ny + 18*sy2); }
      } else if (note.type === 'text') {
        const nr = note.el.getBoundingClientRect();
        const nx = (nr.left - cr.left) * sx2, ny = (nr.top - cr.top) * sy2;
        const txt = note.el.querySelector('div[contenteditable]').innerText || note.el.querySelector('div[contenteditable]').textContent;
        if (txt.trim() && txt.trim() !== 'Text') {
          fctx.fillStyle = note.el.style.color;
          fctx.font = `bold ${24 * sx2}px sans-serif`;
          fctx.textBaseline = 'top';
          fctx.fillText(txt, nx + 8*sx2, ny + 8*sy2);
        }
      } else if (note.type === 'embed') {
        const nr = note.el.getBoundingClientRect();
        const nx = (nr.left - cr.left) * sx2, ny = (nr.top - cr.top) * sy2;
        const img = note.el.querySelector('img');
        const nw = img.clientWidth * sx2, nh = img.clientHeight * sy2;
        fctx.drawImage(img, nx, ny, nw, nh);
      } else if (note.type === 'confidential') {
        const nx = note.el.offsetLeft * sx2;
        const ny = note.el.offsetTop * sy2;
        const nw = note.el.clientWidth * sx2;
        const nh = note.el.clientHeight * sy2;
        
        fctx.save();
        fctx.translate(nx, ny);
        
        fctx.fillStyle = '#000';
        fctx.fillRect(0, 0, nw, nh);
        
        fctx.strokeStyle = '#f00';
        fctx.lineWidth = 4 * sx2;
        fctx.strokeRect(0, 0, nw, nh);
        
        fctx.fillStyle = '#f00';
        fctx.font = `900 ${24 * sx2}px monospace`;
        fctx.textBaseline = 'middle';
        fctx.textAlign = 'center';
        fctx.fillText('CONFIDENTIAL', nw / 2, nh / 2);
        
        fctx.restore();
      }
    }

    if (_mode === 'edit') {
      _br.runtime.sendMessage({
        action: 'saveEditedImage',
        entryId: _tempId,
        annotatedDataUrl: fc.toDataURL('image/png')
      });
      closeOverlay();
      return;
    }

    // For new annotated images: overwrite the temp entry in IDB via SW,
    // then show save dialog
    _br.runtime.sendMessage({
      action:        'showSaveDialog',
      tempId:        _tempId,
      annotatedDataUrl: fc.toDataURL('image/png'), // SW will overwrite temp IDB
      pageUrl:       captureData.pageUrl,
      pageTitle:     captureData.pageTitle,
      captureType:   captureData.captureType,
      hasAnnotations: true
    });
    closeOverlay();
  }

  function closeOverlay() {
    document.removeEventListener('keydown', onKey);
    overlay?.remove();
    overlay = canvas = ctx = bgImg = null;
    undoStack = []; notes = [];
    window.__sbAnnotateLoaded = false;
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
})();
