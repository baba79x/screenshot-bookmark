/**
 * Duplicate Detection Module
 * 
 * Checks if a URL already exists in the screenshot index
 * before uploading a new capture.
 */

/**
 * Check for duplicates and return match info.
 * @param {string} url - The URL to check
 * @param {Object} index - The screenshot index object
 * @returns {{ isDuplicate: boolean, existing: Object|null, versionSuffix: string }}
 */
export function checkDuplicate(url, index) {
  const normalized = normalizeUrl(url);
  const matches = Object.values(index).filter(e => e.normalizedUrl === normalized);

  if (matches.length === 0) {
    return { isDuplicate: false, existing: null, versionSuffix: '' };
  }

  // Sort by date, newest first
  matches.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

  // Calculate version suffix
  const versionSuffix = `-v${matches.length + 1}`;

  return {
    isDuplicate: true,
    existing: matches[0], // most recent match
    allMatches: matches,
    versionSuffix
  };
}

/**
 * Generate a versioned filename for a duplicate save.
 * @param {string} baseName - Original filename
 * @param {number} version - Version number
 * @returns {string} Versioned filename
 */
export function getVersionedName(baseName, version) {
  const ext = baseName.includes('.') ? baseName.split('.').pop() : '';
  const name = ext ? baseName.slice(0, -(ext.length + 1)) : baseName;
  return ext ? `${name}-v${version}.${ext}` : `${name}-v${version}`;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.host}${path}${u.search}`.toLowerCase();
  } catch {
    return (url || '').toLowerCase().replace(/\/+$/, '');
  }
}
