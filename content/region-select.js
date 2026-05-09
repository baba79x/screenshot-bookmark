(function() {
  'use strict';
  const _br = globalThis.browser || globalThis.chrome;
  if (!_br || window.__sbRegionActive) return;
  window.__sbRegionActive = true;

  const overlay = document.createElement('div');
  overlay.className = 'sb-region-overlay';

  const backdrop = document.createElement('div');
  backdrop.className = 'sb-region-backdrop';

  const box = document.createElement('div');
  box.className = 'sb-region-box';

  const info = document.createElement('div');
  info.className = 'sb-region-info';

  overlay.appendChild(backdrop);
  overlay.appendChild(box);
  overlay.appendChild(info);
  document.body.appendChild(overlay);

  let isDrawing = false;
  let startX = 0, startY = 0;
  let currentX = 0, currentY = 0;

  function updateBox() {
    const minX = Math.min(startX, currentX);
    const minY = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    box.style.display = 'block';
    box.style.left = minX + 'px';
    box.style.top = minY + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';

    info.style.display = 'block';
    info.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    info.style.left = minX + 'px';
    info.style.top = (minY > 24 ? minY - 24 : minY + h + 4) + 'px';
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    currentX = startX;
    currentY = startY;
    backdrop.style.display = 'none'; // Box shadow will handle the dimming
    updateBox();
  }

  function onMouseMove(e) {
    if (!isDrawing) return;
    currentX = e.clientX;
    currentY = e.clientY;
    updateBox();
  }

  async function onMouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    currentX = e.clientX;
    currentY = e.clientY;
    
    const minX = Math.min(startX, currentX);
    const minY = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    cleanup();

    if (w < 10 || h < 10) {
      // Too small, user probably misclicked or cancelled
      _br.runtime.sendMessage({ action: 'regionSelectionCancelled' });
      return;
    }

    // Multiply by devicePixelRatio because captureVisibleTab captures native pixels
    const dpr = window.devicePixelRatio || 1;
    _br.runtime.sendMessage({
      action: 'regionSelectionComplete',
      rect: {
        x: Math.round(minX * dpr),
        y: Math.round(minY * dpr),
        w: Math.round(w * dpr),
        h: Math.round(h * dpr)
      }
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
      _br.runtime.sendMessage({ action: 'regionSelectionCancelled' });
    }
  }

  function cleanup() {
    window.__sbRegionActive = false;
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKeyDown);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
})();
