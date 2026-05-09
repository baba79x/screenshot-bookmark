/**
 * Content Script — Screenshot Capture Engine
 */
(function() {
  'use strict';
  const _br = globalThis.browser || globalThis.chrome;
  if (!_br) return;

  if (window.__sbCaptureLoaded) return;
  window.__sbCaptureLoaded = true;

  _br.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'captureFullPage') {
      captureFullPage(msg).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

  async function captureFullPage(msg) {
    const originalY = window.scrollY;
    
    // Scroll to top first to ensure we start clean
    if (originalY > 0) {
      window.scrollTo(0, 0);
      // Wait a bit longer for the first scroll to handle smooth scrolling
      await sleep(300);
    }

    const totalHeight  = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const vpHeight     = window.innerHeight;
    const vpWidth      = window.innerWidth;
    const dpr          = window.devicePixelRatio || 1;
    const segments     = Math.ceil(totalHeight / vpHeight);

    // Hide fixed/sticky elements to prevent duplication
    const fixed = [];
    document.querySelectorAll('*').forEach(el => {
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        fixed.push({ el, vis: el.style.visibility });
        el.style.visibility = 'hidden';
      }
    });

    const captures = [];
    try {
      for (let i = 0; i < segments; i++) {
        const scrollY = i * vpHeight;
        window.scrollTo(0, scrollY);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        
        // Chrome restricts captureVisibleTab to max 2 calls per second.
        // We must sleep >500ms to avoid MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota error.
        await sleep(600);

        const resp = await _br.runtime.sendMessage({ action: 'captureViewportForStitch' });
        if (resp && resp.error) throw new Error(resp.error);
        if (!resp || !resp.dataUrl) throw new Error('No data from captureViewportForStitch');

        const actualY  = window.scrollY;
        const segHeight = i === segments - 1 ? totalHeight - actualY : vpHeight;
        captures.push({ dataUrl: resp.dataUrl, y: actualY, height: segHeight });
      }
    } finally {
      // Always restore
      fixed.forEach(({ el, vis }) => { el.style.visibility = vis; });
      window.scrollTo(0, originalY);
    }

    const stitched = await stitch(captures, vpWidth, totalHeight, dpr, msg.format, msg.quality);
    return { success: true, dataUrl: stitched };
  }

  async function stitch(captures, width, totalHeight, dpr, format, quality) {
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(width * dpr);
    canvas.height = Math.round(totalHeight * dpr);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    for (const seg of captures) {
      const img = await loadImg(seg.dataUrl);
      const srcH = Math.round(seg.height * dpr);
      const dstY = Math.round(seg.y * dpr);
      ctx.drawImage(img, 0, 0, img.width, srcH, 0, dstY, canvas.width, srcH);
    }

    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const q = format === 'jpeg' ? (quality || 90) / 100 : undefined;
    return canvas.toDataURL(mime, q);
  }

  function loadImg(dataUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = dataUrl;
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();
