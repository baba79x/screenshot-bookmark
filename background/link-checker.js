/**
 * Background — Broken Link Checker
 * 
 * Periodic HEAD request checker for saved URLs.
 * Runs every 24 hours (configurable) and on extension startup.
 */

const STORAGE_KEY = 'screenshotIndex';

/**
 * Run the link checker against all saved entries.
 * @param {Object} options - { frequency: 'daily'|'weekly'|'off' }
 */
export async function runCheck(options = {}) {
  if (options.frequency === 'off') return { checked: 0, broken: 0 };

  const result = await browser.storage.local.get(STORAGE_KEY);
  const index = result[STORAGE_KEY] || {};
  const entries = Object.values(index);

  let checked = 0, broken = 0, updated = false;

  for (const entry of entries) {
    // Skip non-HTTP URLs
    if (!shouldCheck(entry.sourceUrl)) continue;

    // Skip if checked recently (within 12 hours)
    if (entry.linkCheckedAt) {
      const lastCheck = new Date(entry.linkCheckedAt).getTime();
      if (Date.now() - lastCheck < 12 * 60 * 60 * 1000) continue;
    }

    try {
      const resp = await fetch(entry.sourceUrl, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: AbortSignal.timeout(10000)
      });

      const newStatus = (resp.ok || resp.type === 'opaque') ? 'healthy' : 'broken';
      if (index[entry.id]) {
        index[entry.id].linkStatus = newStatus;
        index[entry.id].linkCheckedAt = new Date().toISOString();
        if (newStatus === 'broken') broken++;
        updated = true;
      }
    } catch {
      if (index[entry.id]) {
        index[entry.id].linkStatus = 'broken';
        index[entry.id].linkCheckedAt = new Date().toISOString();
        broken++;
        updated = true;
      }
    }

    checked++;

    // Rate limit: 2 seconds between requests
    await new Promise(r => setTimeout(r, 2000));
  }

  if (updated) {
    await browser.storage.local.set({ [STORAGE_KEY]: index });
  }

  // Notify if broken links found
  if (broken > 0) {
    try {
      await browser.notifications.create('broken-links', {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon-128.png'),
        title: 'Screenshot Bookmark',
        message: `${broken} saved page${broken > 1 ? 's are' : ' is'} no longer reachable.`
      });
    } catch { /* notifications may fail */ }
  }

  return { checked, broken };
}

/**
 * Check a single URL and return its status.
 */
export async function checkSingle(url) {
  if (!shouldCheck(url)) return 'unchecked';

  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: AbortSignal.timeout(10000)
    });
    return (resp.ok || resp.type === 'opaque') ? 'healthy' : 'broken';
  } catch {
    return 'broken';
  }
}

/**
 * Determine if a URL should be checked.
 */
function shouldCheck(url) {
  try {
    const u = new URL(url);
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(u.hostname)) return false;
    if (['file:', 'about:', 'moz-extension:', 'chrome-extension:', 'data:'].includes(u.protocol)) return false;
    if (u.hostname.endsWith('.local')) return false;
    return true;
  } catch {
    return false;
  }
}
