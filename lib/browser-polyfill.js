/**
 * Browser Polyfill
 * Makes 'browser' namespace available in Chrome (which only has 'chrome').
 * Loaded before other scripts in popup, library, settings pages.
 */
(function() {
  if (typeof globalThis.browser === 'undefined') {
    if (typeof globalThis.chrome !== 'undefined') {
      globalThis.browser = globalThis.chrome;
    }
  }
})();
