// Skippy — content script glue layer
// ui.js is injected before this file (see manifest.json), so SkippyUI is available.

'use strict';

if (!window.__skippyInitialized) {
  window.__skippyInitialized = true;

  // Listen for TOGGLE messages from the background service worker
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.action === 'TOGGLE') {
      SkippyUI.toggle();
    }
  });

  // ESC key dismissal — capture phase so it fires before anything else
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        SkippyUI.hide();
      }
    },
    true /* capture */
  );
}
