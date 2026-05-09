/**
 * PNG tEXt Chunk Metadata Encoder/Decoder
 * Pure JS — no external dependencies.
 */

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const KEYWORD = 'ScreenshotBookmark';

// CRC32 table
const crcTbl = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = crcTbl[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function u32be(v) {
  return new Uint8Array([(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]);
}

function rU32(b, o) {
  return ((b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3]) >>> 0;
}

function dataUrlToBytes(url) {
  const bin = atob(url.split(',')[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function bytesToDataUrl(bytes, mime = 'image/png') {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,` + btoa(s);
}

function buildTextChunk(obj) {
  const json = enc.encode(JSON.stringify(obj));
  const kw = enc.encode(KEYWORD);
  const data = new Uint8Array(kw.length + 1 + json.length);
  data.set(kw); data[kw.length] = 0; data.set(json, kw.length + 1);
  const type = enc.encode('tEXt');
  const crcIn = new Uint8Array(type.length + data.length);
  crcIn.set(type); crcIn.set(data, type.length);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  chunk.set(u32be(data.length)); chunk.set(type, 4);
  chunk.set(data, 8); chunk.set(u32be(crc32(crcIn)), 8 + data.length);
  return chunk;
}

function stripExisting(png) {
  const parts = []; let o = 8;
  while (o < png.length) {
    const len = rU32(png, o); const end = o + 12 + len;
    const tp = dec.decode(png.slice(o + 4, o + 8));
    if (tp === 'tEXt') {
      const ds = o + 8; const ne = png.indexOf(0, ds);
      if (ne !== -1 && ne < ds + len && dec.decode(png.slice(ds, ne)) === KEYWORD) { o = end; continue; }
    }
    parts.push(png.slice(o, end)); o = end;
  }
  const total = 8 + parts.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total); out.set(PNG_SIG);
  let p = 8; for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}

const JPEG_SIG = new Uint8Array([0xFF, 0xD8]);
const JPEG_EOF_MARKER = enc.encode('\n===SB_META===\n');

export function embedMetadata(dataUrl, metadata) {
  const raw = dataUrlToBytes(dataUrl);
  
  // Check PNG
  let isPng = true;
  for (let i = 0; i < 8; i++) { if (raw[i] !== PNG_SIG[i]) isPng = false; }
  
  // Check JPEG
  let isJpeg = raw[0] === JPEG_SIG[0] && raw[1] === JPEG_SIG[1];

  if (!isPng && !isJpeg) throw new Error('Unsupported image format');

  if (isPng) {
    const clean = stripExisting(raw);
    const ihdrLen = rU32(clean, 8);
    const ihdrEnd = 8 + 12 + ihdrLen;
    const chunk = buildTextChunk(metadata);
    const result = new Uint8Array(clean.length + chunk.length);
    result.set(clean.slice(0, ihdrEnd));
    result.set(chunk, ihdrEnd);
    result.set(clean.slice(ihdrEnd), ihdrEnd + chunk.length);
    return bytesToDataUrl(result, 'image/png');
  }

  if (isJpeg) {
    const jsonBytes = enc.encode(JSON.stringify(metadata));
    // Strip existing EOF marker if present
    let endIdx = raw.length;
    for (let i = raw.length - 1; i >= 0; i--) {
      // Very naive backwards search for ===SB_META===
      // Better to use indexOf on the last few KB, but this is fine
      // Let's just find the marker by converting to string
    }
    // Convert last 5KB to string to search for marker
    const tailLen = Math.min(raw.length, 5000);
    const tail = raw.slice(raw.length - tailLen);
    const tailStr = dec.decode(tail);
    const markerIdx = tailStr.lastIndexOf('\n===SB_META===\n');
    
    let cleanRaw = raw;
    if (markerIdx !== -1) {
      // Convert string index back to byte index (assuming ASCII marker)
      cleanRaw = raw.slice(0, raw.length - tailLen + markerIdx);
    }

    const result = new Uint8Array(cleanRaw.length + JPEG_EOF_MARKER.length + jsonBytes.length);
    result.set(cleanRaw);
    result.set(JPEG_EOF_MARKER, cleanRaw.length);
    result.set(jsonBytes, cleanRaw.length + JPEG_EOF_MARKER.length);
    return bytesToDataUrl(result, 'image/jpeg');
  }
}

export function readMetadata(imgData) {
  const b = imgData instanceof Uint8Array ? imgData : new Uint8Array(imgData);
  
  let isPng = true;
  for (let i = 0; i < 8; i++) { if (b[i] !== PNG_SIG[i]) { isPng = false; break; } }
  
  if (isPng) {
    let o = 8;
    while (o < b.length) {
      const len = rU32(b, o); const tp = dec.decode(b.slice(o + 4, o + 8));
      if (tp === 'tEXt') {
        const ds = o + 8; const ne = b.indexOf(0, ds);
        if (ne !== -1 && ne < ds + len && dec.decode(b.slice(ds, ne)) === KEYWORD) {
          try { return JSON.parse(dec.decode(b.slice(ne + 1, ds + len))); } catch { return null; }
        }
      }
      if (tp === 'IEND') break;
      o += 12 + len;
    }
    return null;
  }

  // Check JPEG
  if (b[0] === JPEG_SIG[0] && b[1] === JPEG_SIG[1]) {
    const tailLen = Math.min(b.length, 5000);
    const tail = b.slice(b.length - tailLen);
    const tailStr = dec.decode(tail);
    const markerIdx = tailStr.lastIndexOf('\n===SB_META===\n');
    if (markerIdx !== -1) {
      const jsonStr = tailStr.slice(markerIdx + 15); // 15 is marker length
      try { return JSON.parse(jsonStr); } catch { return null; }
    }
    return null;
  }

  return null;
}

export function readMetadataFromDataUrl(dataUrl) {
  return readMetadata(dataUrlToBytes(dataUrl));
}

export function createMetadata({ sourceUrl = '', pageTitle = '', captureType = 'viewport', folderPath = '', tags = [], hasAnnotations = false } = {}) {
  return { sourceUrl, pageTitle, capturedAt: new Date().toISOString(), captureType, folderPath, tags, hasAnnotations };
}
