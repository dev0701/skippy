// Skippy — MRU background service worker
// Maintains in-memory tab stacks { [windowId]: tabId[] } (most recent first)
// Persists as URL stacks for survival across service worker restarts

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {{ [windowId: number]: number[] }} */
const stacks = {};

let saveTimer = null;

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Debounced save: serialise stacks to URL arrays and write to storage.
 */
function saveStacks() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      // Build URL stacks from current tab IDs
      const urlStacks = {};
      for (const [winIdStr, tabIds] of Object.entries(stacks)) {
        const urls = [];
        for (const tabId of tabIds) {
          try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.url) urls.push(tab.url);
          } catch {
            // Tab may have been closed; skip it
          }
        }
        if (urls.length > 0) {
          urlStacks[winIdStr] = urls;
        }
      }
      await chrome.storage.local.set({ mru_url_stacks: urlStacks });
    } catch (err) {
      console.warn('[Skippy] saveStacks failed:', err);
    }
  }, 10);
}

/**
 * Load URL stacks from storage, reconcile with currently open tabs.
 */
async function loadStacks() {
  try {
    // Clear in-memory stacks before rebuilding
    for (const key of Object.keys(stacks)) delete stacks[key];

    const result = await chrome.storage.local.get('mru_url_stacks');
    const urlStacks = result.mru_url_stacks || {};

    // Get all current windows + their tabs
    const windows = await chrome.windows.getAll({ populate: true });

    // Build a map of current windows: windowId -> tabs[]
    const currentWindows = {};
    for (const win of windows) {
      currentWindows[win.id] = win.tabs || [];
    }

    // Greedy match: for each current window, find the stored window entry
    // with the highest URL overlap (each stored window used at most once).
    const storedWinIds = Object.keys(urlStacks);
    const usedStoredWins = new Set();

    for (const win of windows) {
      const currentTabs = currentWindows[win.id];
      const currentUrls = new Set(currentTabs.map(t => t.url).filter(Boolean));

      let bestStoredWinId = null;
      let bestOverlap = -1;

      for (const storedWinId of storedWinIds) {
        if (usedStoredWins.has(storedWinId)) continue;
        const storedUrls = urlStacks[storedWinId];
        let overlap = 0;
        for (const url of storedUrls) {
          if (currentUrls.has(url)) overlap++;
        }
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestStoredWinId = storedWinId;
        }
      }

      // Build a URL -> tabId map for this window
      const urlToTabId = {};
      for (const tab of currentTabs) {
        if (tab.url && !(tab.url in urlToTabId)) {
          urlToTabId[tab.url] = tab.id;
        }
      }

      const stack = [];
      const accountedTabIds = new Set();

      if (bestStoredWinId !== null && bestOverlap > 0) {
        usedStoredWins.add(bestStoredWinId);
        const storedUrls = urlStacks[bestStoredWinId];
        // Reconstruct stack from stored URL order
        for (const url of storedUrls) {
          const tabId = urlToTabId[url];
          if (tabId !== undefined && !accountedTabIds.has(tabId)) {
            stack.push(tabId);
            accountedTabIds.add(tabId);
          }
        }
      }

      // Append any current tabs not yet in the stack
      for (const tab of currentTabs) {
        if (!accountedTabIds.has(tab.id)) {
          stack.push(tab.id);
          accountedTabIds.add(tab.id);
        }
      }

      if (stack.length > 0) {
        stacks[win.id] = stack;
      }
    }
  } catch (err) {
    console.warn('[Skippy] loadStacks failed:', err);
  }
}

// ─── Stack helpers ────────────────────────────────────────────────────────────

function ensureStack(windowId) {
  if (!stacks[windowId]) stacks[windowId] = [];
  return stacks[windowId];
}

function moveToFront(windowId, tabId) {
  const stack = ensureStack(windowId);
  const idx = stack.indexOf(tabId);
  if (idx !== -1) stack.splice(idx, 1);
  stack.unshift(tabId);
}

function removeTab(windowId, tabId) {
  const stack = stacks[windowId];
  if (!stack) return;
  const idx = stack.indexOf(tabId);
  if (idx !== -1) stack.splice(idx, 1);
}

// ─── Tab / Window event handlers ─────────────────────────────────────────────

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  moveToFront(windowId, tabId);
  saveStacks();
});

chrome.tabs.onRemoved.addListener((tabId, { windowId }) => {
  removeTab(windowId, tabId);
  saveStacks();
});

chrome.windows.onRemoved.addListener((windowId) => {
  delete stacks[windowId];
  saveStacks();
});

// When a new tab is created, add it to the window's stack (at the end so it
// doesn't displace the MRU order until actually activated).
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.windowId == null) return;
  const stack = ensureStack(tab.windowId);
  if (!stack.includes(tab.id)) {
    stack.push(tab.id);
  }
  saveStacks();
});

// ─── Command handler ──────────────────────────────────────────────────────────

/**
 * Returns true if the URL can accept content script injection.
 * chrome://, chrome-extension://, about:, edge://, etc. are all restricted.
 */
function canInject(url) {
  return typeof url === 'string' && (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('file://')
  );
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-skippy') return;

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;

    // Restricted page (new tab, settings, extension pages, etc.) —
    // content scripts cannot run there; open the action popup instead.
    if (!canInject(activeTab.url)) {
      try {
        await chrome.action.openPopup();
      } catch (err) {
        // chrome.action.openPopup() requires Chrome 127+.
        // On older builds there is no recoverable fallback for restricted pages.
        console.warn('[Skippy] Cannot open on restricted page:', activeTab.url, err);
      }
      return;
    }

    // Normal page — inject Shadow DOM overlay.
    try {
      await chrome.tabs.sendMessage(activeTab.id, { action: 'TOGGLE' });
    } catch {
      // Content script not yet injected — use scripting fallback.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['ui.js', 'content.js'],
        });
        await chrome.tabs.sendMessage(activeTab.id, { action: 'TOGGLE' });
      } catch (injErr) {
        console.warn('[Skippy] Could not inject scripts:', injErr);
      }
    }
  } catch (err) {
    console.warn('[Skippy] Command handler error:', err);
  }
});

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_STACK') {
    handleGetStack(sender, message).then(sendResponse).catch((err) => {
      console.warn('[Skippy] GET_STACK error:', err);
      sendResponse([]);
    });
    return true; // async response
  }

  if (message.action === 'SWITCH_TAB') {
    const { tabId } = message;
    chrome.tabs.update(tabId, { active: true }).catch((err) => {
      console.warn('[Skippy] SWITCH_TAB error:', err);
    });
    return false;
  }
});

/**
 * Return ordered tab info for the sender's window.
 * Tabs in the MRU stack come first (in MRU order), then any remaining tabs.
 */
async function handleGetStack(sender, message = {}) {
  // sender.tab is undefined when the request comes from an action popup (extension page).
  // Fall back to the windowId the popup explicitly included in the message.
  const windowId = sender.tab?.windowId ?? message.windowId;
  if (windowId == null) return [];

  try {
    const allTabs = await chrome.tabs.query({ windowId });
    const tabMap = {};
    for (const tab of allTabs) tabMap[tab.id] = tab;

    const stack = stacks[windowId] || [];
    const orderedIds = [];
    const seen = new Set();

    // MRU-ordered first
    for (const tabId of stack) {
      if (tabMap[tabId] && !seen.has(tabId)) {
        orderedIds.push(tabId);
        seen.add(tabId);
      }
    }

    // Any tabs not yet tracked (e.g. restored tabs not yet activated)
    for (const tab of allTabs) {
      if (!seen.has(tab.id)) {
        orderedIds.push(tab.id);
        seen.add(tab.id);
      }
    }

    return orderedIds.map((id) => {
      const tab = tabMap[id];
      return {
        id: tab.id,
        title: tab.title || '',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl || '',
      };
    });
  } catch (err) {
    console.warn('[Skippy] handleGetStack error:', err);
    return [];
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Load immediately when service worker starts
loadStacks();

chrome.runtime.onInstalled.addListener(() => loadStacks());
chrome.runtime.onStartup.addListener(() => loadStacks());
