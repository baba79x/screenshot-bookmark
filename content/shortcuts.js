/**
 * Content Script — Custom Shortcuts
 * Listens for the user's custom shortcut to trigger captures.
 */
(function() {
  'use strict';
  const _br = globalThis.browser || globalThis.chrome;
  if (!_br) return;

  let currentShortcut = '';

  // Load shortcut on init
  _br.storage.local.get('settings').then(res => {
    currentShortcut = res.settings?.customShortcut || '';
  });

  // Listen for settings changes
  _br.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      currentShortcut = changes.settings.newValue?.customShortcut || '';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!currentShortcut) return;
    
    // Ignore input if user is typing in a field
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }

    const keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Meta');
    
    // Ignore lonely modifier keys
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    
    const k = e.key.toUpperCase();
    keys.push(k.length === 1 ? k : e.key); // handle 'A' vs 'Enter'

    const pressed = keys.join('+');
    
    if (pressed === currentShortcut) {
      e.preventDefault();
      _br.runtime.sendMessage({ action: 'startCapture', captureType: 'viewport' });
    }
  });
})();
