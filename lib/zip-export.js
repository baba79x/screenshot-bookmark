/**
 * zip-export.js — Pure JS ZIP builder (no dependencies)
 * Exports selected screenshots as a downloadable .zip
 * Uses STORED (uncompressed) method for maximum compatibility.
 */

window.ZipExporter = (function () {

  // ─── CRC-32 Table ─────────────────────────────────────────────
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ─── Uint8Array helpers ───────────────────────────────────────
  function u16(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
  function u32(n) { return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF]; }

  function strBytes(s) {
    return new TextEncoder().encode(s);
  }

  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }

  // ─── DOS date/time ────────────────────────────────────────────
  function dosDateTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
    const day  = ((d.getFullYear() - 1980) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
    return { time, day };
  }

  // ─── ZIP builder ─────────────────────────────────────────────
  function buildZip(files) {
    // files: [{ name: string, data: Uint8Array, date: Date }]
    const localHeaders = [];
    const centralDirs  = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = strBytes(file.name);
      const data      = file.data;
      const crc       = crc32(data);
      const { time, day } = dosDateTime(file.date || new Date());

      // Local file header (30 bytes + name + data)
      const local = new Uint8Array([
        0x50, 0x4B, 0x03, 0x04,  // signature
        ...u16(20),               // version needed (2.0)
        ...u16(0),                // general flag
        ...u16(0),                // compression: STORED
        ...u16(time),             // mod time
        ...u16(day),              // mod date
        ...u32(crc),              // CRC-32
        ...u32(data.length),      // compressed size
        ...u32(data.length),      // uncompressed size
        ...u16(nameBytes.length), // file name length
        ...u16(0),                // extra field length
      ]);

      localHeaders.push(local, nameBytes, data);

      // Central directory entry
      const central = new Uint8Array([
        0x50, 0x4B, 0x01, 0x02,  // signature
        ...u16(20),               // version made by
        ...u16(20),               // version needed
        ...u16(0),                // general flag
        ...u16(0),                // compression: STORED
        ...u16(time),             // mod time
        ...u16(day),              // mod date
        ...u32(crc),              // CRC-32
        ...u32(data.length),      // compressed size
        ...u32(data.length),      // uncompressed size
        ...u16(nameBytes.length), // file name length
        ...u16(0),                // extra field length
        ...u16(0),                // file comment length
        ...u16(0),                // disk number start
        ...u16(0),                // internal attrs
        ...u32(0),                // external attrs
        ...u32(offset),           // offset of local header
      ]);

      centralDirs.push(central, nameBytes);
      offset += local.length + nameBytes.length + data.length;
    }

    const cdFlat    = concat(...centralDirs);
    const cdSize    = cdFlat.length;
    const cdOffset  = offset;
    const numFiles  = files.length;

    // End of central directory
    const eocd = new Uint8Array([
      0x50, 0x4B, 0x05, 0x06,  // signature
      ...u16(0),                // disk number
      ...u16(0),                // disk with CD start
      ...u16(numFiles),         // entries on disk
      ...u16(numFiles),         // total entries
      ...u32(cdSize),           // CD size
      ...u32(cdOffset),         // CD offset
      ...u16(0),                // comment length
    ]);

    return concat(...localHeaders.flat ? [...localHeaders] : localHeaders, cdFlat, eocd);
  }

  // ─── IndexedDB reader ────────────────────────────────────────
  function getFullImages(ids) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ScreenshotBookmarkDB', 1);
      req.onsuccess = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('screenshots')) { db.close(); resolve({}); return; }
        const tx   = db.transaction('screenshots', 'readonly');
        const store = tx.objectStore('screenshots');
        const results = {};
        let pending = ids.length;
        if (pending === 0) { db.close(); resolve(results); return; }
        for (const id of ids) {
          const r = store.get(id);
          r.onsuccess = () => {
            if (r.result) results[id] = r.result.dataUrl;
            if (--pending === 0) { db.close(); resolve(results); }
          };
          r.onerror = () => { if (--pending === 0) { db.close(); resolve(results); } };
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ─── dataUrl → Uint8Array ────────────────────────────────────
  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    if (!base64) return new Uint8Array(0);
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // ─── Safe filename ────────────────────────────────────────────
  function safeFilename(title, url, date, ext) {
    const dom = (() => { try { return new URL(url).hostname; } catch { return 'page'; } })();
    const d   = new Date(date);
    const ds  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const t   = (title || 'untitled').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 40);
    return `${ds}_${dom}_${t}.${ext}`;
  }

  // ─── Public API ──────────────────────────────────────────────
  async function exportZip(entries, zipName = 'screenshot-bookmarks') {
    if (!entries || !entries.length) { alert('No screenshots selected.'); return; }

    const ids = entries.map(e => e.id);

    // Show progress (if there's a status element)
    const showStatus = msg => {
      const el = document.getElementById('exportStatus');
      if (el) { el.textContent = msg; el.style.display = 'block'; }
      else console.log('[ZipExport]', msg);
    };

    showStatus(`Preparing ${entries.length} screenshot(s)…`);

    // Fetch full-res images from IndexedDB
    const fullImages = await getFullImages(ids);

    const files = [];

    for (const entry of entries) {
      // Try full-res first, fall back to thumbnail
      const dataUrl = fullImages[entry.id] || entry.thumbnailDataUrl || '';
      if (!dataUrl) continue;

      // Detect extension from dataUrl mime type
      const mime = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg') ? 'jpg' : 'png';
      const filename = safeFilename(entry.pageTitle, entry.sourceUrl, entry.capturedAt, mime);

      files.push({
        name: filename,
        data: dataUrlToBytes(dataUrl),
        date: new Date(entry.capturedAt)
      });
    }

    // Add metadata JSON
    const metadata = entries.map(e => ({
      id:          e.id,
      title:       e.pageTitle,
      url:         e.sourceUrl,
      capturedAt:  e.capturedAt,
      captureType: e.captureType,
      folder:      e.folderPath,
      tags:        e.tags,
      hasAnnotations: e.hasAnnotations,
      linkStatus:  e.linkStatus
    }));

    files.push({
      name: 'index.json',
      data: new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
      date: new Date()
    });

    showStatus(`Building ZIP with ${files.length - 1} image(s)…`);

    // Build ZIP
    const zipBytes = buildZip(files);
    const blob     = new Blob([zipBytes], { type: 'application/zip' });
    const url      = URL.createObjectURL(blob);

    // Trigger download
    const a = document.createElement('a');
    a.href     = url;
    a.download = `${zipName}-${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Cleanup
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showStatus('');
    if (document.getElementById('exportStatus')) {
      setTimeout(() => { const el = document.getElementById('exportStatus'); if(el) el.style.display='none'; }, 1000);
    }
  }

  // ─── PDF Export ──────────────────────────────────────────────
  async function exportPdf(entries, pdfName = 'screenshot') {
    if (!entries || !entries.length) { alert('No screenshots selected.'); return; }
    if (!window.jspdf) { alert('PDF library not loaded.'); return; }

    const ids = entries.map(e => e.id);
    const fullImages = await getFullImages(ids);
    const { jsPDF } = window.jspdf;
    
    let doc = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const dataUrl = fullImages[entry.id] || entry.thumbnailDataUrl || '';
      if (!dataUrl) continue;

      const img = new Image();
      await new Promise((res) => {
        img.onload = res;
        img.onerror = res;
        img.src = dataUrl;
      });

      if (!img.width) continue;

      const format = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg') ? 'JPEG' : 'PNG';
      const isLandscape = img.width > img.height;
      
      if (!doc) {
        doc = new jsPDF({
          orientation: isLandscape ? 'landscape' : 'portrait',
          unit: 'px',
          format: [img.width, img.height]
        });
      } else {
        doc.addPage([img.width, img.height], isLandscape ? 'landscape' : 'portrait');
      }

      doc.addImage(dataUrl, format, 0, 0, img.width, img.height);
    }

    if (doc) {
      doc.save(`${pdfName}-${new Date().toISOString().slice(0,10)}.pdf`);
    } else {
      alert('Failed to generate PDF.');
    }
  }

  return { exportZip, exportPdf };
})();
