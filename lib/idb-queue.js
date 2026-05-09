/**
 * IndexedDB Offline Queue
 * 
 * Stores captured screenshots when offline, auto-flushes on reconnection.
 */

const DB_NAME = 'ScreenshotBookmarkQueue';
const DB_VERSION = 1;
const STORE_NAME = 'offlineQueue';

/**
 * Open (or create) the IndexedDB database.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: false
        });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Add a capture to the offline queue (FIFO).
 * @param {Object} captureData - { dataUrl, sourceUrl, pageTitle, captureType, tags, folderPath, hasAnnotations }
 * @returns {string} The queue entry ID
 */
export async function enqueue(captureData) {
  const db = await openDB();
  const id = crypto.randomUUID();
  const entry = {
    id,
    ...captureData,
    createdAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(entry);
    tx.oncomplete = () => {
      updateBadge();
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get the oldest queued item (FIFO order).
 * @returns {Object|null} The oldest entry or null if queue is empty
 */
export async function dequeue() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const request = index.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      resolve(cursor ? cursor.value : null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove an entry from the queue by ID.
 */
export async function remove(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      updateBadge();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get the number of items in the queue.
 */
export async function getQueueCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all queued items.
 */
export async function getAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear the entire queue.
 */
export async function clearQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => {
      updateBadge();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Update the extension badge with queue count.
 */
async function updateBadge() {
  try {
    const count = await getQueueCount();
    if (count > 0) {
      await browser.action.setBadgeText({ text: String(count) });
      await browser.action.setBadgeBackgroundColor({ color: '#EF9F27' });
    }
    // Don't clear badge here — the service worker manages per-tab badges
  } catch { /* ignore in non-background contexts */ }
}

/**
 * Auto-flush: try to sync queued items when online.
 * Call this from the service worker on navigator.onLine events.
 */
export async function autoFlush(uploadFn) {
  if (!navigator.onLine) return;

  let count = await getQueueCount();
  let synced = 0;

  while (count > 0) {
    const entry = await dequeue();
    if (!entry) break;

    try {
      await uploadFn(entry);
      await remove(entry.id);
      synced++;
    } catch (err) {
      console.error('[ScreenshotBookmark] Queue sync failed for entry:', entry.id, err);
      break; // Stop on first failure to prevent data loss
    }

    count = await getQueueCount();
  }

  if (synced > 0) {
    try {
      await browser.notifications.create('queue-synced', {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon-48.png'),
        title: 'Screenshot Bookmark',
        message: `${synced} queued screenshot${synced > 1 ? 's' : ''} synced to Drive.`
      });
    } catch { /* notifications may not be available */ }
  }

  return synced;
}
