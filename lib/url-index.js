/**
 * URL Index — In-memory URL → screenshot entry map
 * Backed by browser.storage.local for persistence.
 */

const STORAGE_KEY = 'screenshotIndex';

let _index = null; // { [normalizedUrl]: EntryObject }

/** Normalize a URL for consistent comparison */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Strip trailing slash, hash, and common tracking params
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.host}${path}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

/** Load index from storage */
async function loadIndex() {
  if (_index !== null) return _index;
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    _index = result[STORAGE_KEY] || {};
  } catch {
    _index = {};
  }
  return _index;
}

/** Persist index to storage */
async function saveIndex() {
  if (_index === null) return;
  await browser.storage.local.set({ [STORAGE_KEY]: _index });
}

/**
 * Add or update a screenshot entry in the index.
 * @param {Object} entry - { id, sourceUrl, pageTitle, capturedAt, captureType,
 *   folderPath, tags, hasAnnotations, thumbnailDataUrl, linkStatus }
 * @returns {string} The entry ID
 */
export async function addEntry(entry) {
  const index = await loadIndex();
  const id = entry.id || crypto.randomUUID();
  const normalizedUrl = normalizeUrl(entry.sourceUrl);

  index[id] = {
    ...entry,
    id,
    normalizedUrl,
    sourceUrl: entry.sourceUrl,
    pageTitle: entry.pageTitle || '',
    capturedAt: entry.capturedAt || new Date().toISOString(),
    captureType: entry.captureType || 'viewport',
    folderPath: entry.folderPath || '',
    tags: entry.tags || [],
    hasAnnotations: entry.hasAnnotations || false,
    thumbnailDataUrl: entry.thumbnailDataUrl || '',
    linkStatus: entry.linkStatus || 'healthy', // healthy | broken | unchecked
    linkCheckedAt: entry.linkCheckedAt || null
  };

  await saveIndex();
  return id;
}

/** Remove an entry by ID */
export async function removeEntry(id) {
  const index = await loadIndex();
  delete index[id];
  await saveIndex();
}

/** Get an entry by ID */
export async function getEntry(id) {
  const index = await loadIndex();
  return index[id] || null;
}

/** Get all entries as an array, sorted by capturedAt (newest first) */
export async function getAllEntries() {
  const index = await loadIndex();
  return Object.values(index).sort((a, b) =>
    new Date(b.capturedAt) - new Date(a.capturedAt)
  );
}

/** Find entries matching a URL (normalized comparison) */
export async function findByUrl(url) {
  const index = await loadIndex();
  const norm = normalizeUrl(url);
  return Object.values(index).filter(e => e.normalizedUrl === norm);
}

/** Check if a URL exists in the index */
export async function hasUrl(url) {
  const matches = await findByUrl(url);
  return matches.length > 0;
}

/** Update specific fields on an entry */
export async function updateEntry(id, updates) {
  const index = await loadIndex();
  if (!index[id]) return null;
  Object.assign(index[id], updates);
  if (updates.sourceUrl) {
    index[id].normalizedUrl = normalizeUrl(updates.sourceUrl);
  }
  await saveIndex();
  return index[id];
}

/** Get entries filtered by folder */
export async function getByFolder(folderPath) {
  const index = await loadIndex();
  return Object.values(index).filter(e => e.folderPath === folderPath);
}

/** Get entries filtered by tag (AND logic for multiple tags) */
export async function getByTags(tags) {
  const index = await loadIndex();
  return Object.values(index).filter(e =>
    tags.every(t => e.tags.includes(t))
  );
}

/** Get all unique tags with counts */
export async function getTagCloud() {
  const index = await loadIndex();
  const counts = {};
  for (const entry of Object.values(index)) {
    for (const tag of (entry.tags || [])) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/** Get all unique folders */
export async function getFolders() {
  const index = await loadIndex();
  const folders = new Set();
  for (const entry of Object.values(index)) {
    if (entry.folderPath) folders.add(entry.folderPath);
  }
  return [...folders].sort();
}

/** Get entries with broken links */
export async function getBrokenLinks() {
  const index = await loadIndex();
  return Object.values(index).filter(e => e.linkStatus === 'broken');
}

/** Get total count */
export async function getCount() {
  const index = await loadIndex();
  return Object.keys(index).length;
}

/** Search entries by title or URL */
export async function search(query) {
  const index = await loadIndex();
  const q = query.toLowerCase();
  return Object.values(index).filter(e =>
    (e.pageTitle || '').toLowerCase().includes(q) ||
    (e.sourceUrl || '').toLowerCase().includes(q) ||
    (e.tags || []).some(t => t.toLowerCase().includes(q))
  ).sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
}

/** Clear entire index */
export async function clearAll() {
  _index = {};
  await saveIndex();
}

/** Force reload from storage (useful after external changes) */
export async function reload() {
  _index = null;
  return loadIndex();
}
