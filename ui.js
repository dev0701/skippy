// Skippy — Shadow DOM UI layer
// Defines the global SkippyUI object: { toggle, show, hide }

'use strict';

const SkippyUI = (() => {

  // ─── Themes ────────────────────────────────────────────────────────────────
  // Each theme provides accent-family vars for both light and dark modes.
  // Neutral palette (bg, border, text) stays tied to prefers-color-scheme.

  const THEMES = {
    amber: {
      name: 'Amber',
      swatch: '#b87c1e',
      light: { '--accent': '#b87c1e', '--accent-subtle': '#ede4d0', '--selected-bg': '#ede9df', '--selected-border': '#b87c1e' },
      dark:  { '--accent': '#d4972a', '--accent-subtle': '#2e2610', '--selected-bg': '#2a2720', '--selected-border': '#d4972a' },
    },
    cobalt: {
      name: 'Cobalt',
      swatch: '#2563eb',
      light: { '--accent': '#2563eb', '--accent-subtle': '#dbeafe', '--selected-bg': '#eff6ff', '--selected-border': '#2563eb' },
      dark:  { '--accent': '#60a5fa', '--accent-subtle': '#1a2d4a', '--selected-bg': '#192640', '--selected-border': '#60a5fa' },
    },
    sage: {
      name: 'Sage',
      swatch: '#4a7c59',
      light: { '--accent': '#4a7c59', '--accent-subtle': '#dcf0e3', '--selected-bg': '#edf7f1', '--selected-border': '#4a7c59' },
      dark:  { '--accent': '#6bba85', '--accent-subtle': '#172a1e', '--selected-bg': '#1b2c21', '--selected-border': '#6bba85' },
    },
    rose: {
      name: 'Rose',
      swatch: '#be185d',
      light: { '--accent': '#be185d', '--accent-subtle': '#fce7f3', '--selected-bg': '#fdf2f8', '--selected-border': '#be185d' },
      dark:  { '--accent': '#f472b6', '--accent-subtle': '#2d1220', '--selected-bg': '#291620', '--selected-border': '#f472b6' },
    },
    ember: {
      name: 'Ember',
      swatch: '#c2410c',
      light: { '--accent': '#c2410c', '--accent-subtle': '#ffedd5', '--selected-bg': '#fff7ed', '--selected-border': '#c2410c' },
      dark:  { '--accent': '#fb923c', '--accent-subtle': '#2c1908', '--selected-bg': '#281d0d', '--selected-border': '#fb923c' },
    },
    slate: {
      name: 'Slate',
      swatch: '#64748b',
      light: { '--accent': '#475569', '--accent-subtle': '#e2e8f0', '--selected-bg': '#f1f5f9', '--selected-border': '#475569' },
      dark:  { '--accent': '#94a3b8', '--accent-subtle': '#1b2030', '--selected-bg': '#1e2333', '--selected-border': '#94a3b8' },
    },
  };

  // ─── State ─────────────────────────────────────────────────────────────────

  /** @type {HTMLElement|null} */
  let host = null;
  /** @type {ShadowRoot|null} */
  let shadowRoot = null;

  /** Full MRU array from background. Index 0 = current tab (not shown). */
  let tabData = [];
  /** tabData.slice(1) with mruIdx field added. */
  let displayList = [];
  /** Currently rendered list — displayList or filtered subset. */
  let activeList = [];
  /** Highlighted row index within activeList. */
  let selectedIndex = 0;

  let isVisible = false;
  let isInitialized = false;
  let initPromise = null;

  /** Currently applied theme key. */
  let currentTheme = 'amber';
  /** Last saved/clicked theme — used to revert hover previews. */
  let committedTheme = 'amber';

  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  // True when running inside popup.html (extension page), not injected into a website.
  const IS_POPUP = location.protocol === 'chrome-extension:';

  // ── Custom keybindings ────────────────────────────────────────────────────
  // Loaded from storage. Custom keys AUGMENT defaults — they never replace them.
  // e.g. setting down='j' means both 'j' AND ArrowDown/Tab all navigate down.
  let keybindings = { down: null, up: null, select: null, close: null };

  async function loadKeybindings() {
    try {
      const result = await chrome.storage.local.get('keybindings');
      if (result.keybindings) Object.assign(keybindings, result.keybindings);
    } catch {}
  }

  // ─── DOM refs ──────────────────────────────────────────────────────────────

  let overlayEl  = null;
  let inputEl    = null;
  let tabListEl  = null;
  let emptyEl    = null;
  let swatchesEl = null;

  // ─── Fuzzy search ──────────────────────────────────────────────────────────

  /**
   * Subsequence fuzzy match with word-boundary scoring.
   * Returns { score, indices } where indices are character positions in `text`
   * that matched the pattern. score = -1 means no match.
   */
  function fuzzyMatch(pattern, text) {
    const p = pattern.toLowerCase();
    const t = text.toLowerCase();
    let pi = 0, score = 0, consecutive = 0, lastMatch = -1;
    const indices = [];

    for (let ti = 0; ti < t.length && pi < p.length; ti++) {
      if (t[ti] === p[pi]) {
        consecutive = ti === lastMatch + 1 ? consecutive + 1 : 1;
        score += consecutive * 2;
        if (ti === 0 || /[\s\-_./:]/.test(t[ti - 1])) score += 4;
        lastMatch = ti;
        indices.push(ti);
        pi++;
      }
    }

    return pi < p.length ? { score: -1, indices: [] } : { score, indices };
  }

  /**
   * Filter and score displayList against query.
   * Returns items annotated with _score, _titleIndices, _urlIndices, _shortUrl.
   */
  function filterTabs(query) {
    const results = [];
    for (const item of displayList) {
      const titleMatch = fuzzyMatch(query, item.title);
      const shortUrl   = truncateUrl(item.url);
      const urlMatch   = fuzzyMatch(query, shortUrl);

      if (titleMatch.score < 0 && urlMatch.score < 0) continue;

      results.push({
        ...item,
        _score:        Math.max(titleMatch.score, urlMatch.score),
        _titleIndices: titleMatch.score >= 0 ? titleMatch.indices : [],
        _shortUrl:     shortUrl,
        _urlIndices:   urlMatch.score  >= 0 ? urlMatch.indices  : [],
      });
    }
    results.sort((a, b) => b._score - a._score);
    return results;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function getFaviconUrl(tab) {
    if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) return tab.favIconUrl;
    try { return `${new URL(tab.url).origin}/favicon.ico`; } catch { return ''; }
  }

  function truncateUrl(url, maxLen = 60) {
    try {
      const u = new URL(url);
      const display = u.hostname + u.pathname.replace(/\/$/, '');
      return display.length > maxLen ? display.slice(0, maxLen) + '…' : display;
    } catch {
      return url.length > maxLen ? url.slice(0, maxLen) + '…' : url;
    }
  }

  /**
   * Build an array of Text/mark DOM nodes from `text`, highlighting the
   * characters at the given `indices` with a <mark class="skippy-match">.
   */
  function highlightText(text, indices) {
    if (!indices || indices.length === 0) return [document.createTextNode(text)];
    const nodes = [];
    const indexSet = new Set(indices);
    let buf = '';
    for (let c = 0; c < text.length; c++) {
      if (indexSet.has(c)) {
        if (buf) { nodes.push(document.createTextNode(buf)); buf = ''; }
        const mark = document.createElement('mark');
        mark.className = 'skippy-match';
        mark.textContent = text[c];
        nodes.push(mark);
      } else {
        buf += text[c];
      }
    }
    if (buf) nodes.push(document.createTextNode(buf));
    return nodes;
  }

  // ─── Theme management ──────────────────────────────────────────────────────

  /**
   * Apply a theme by injecting CSS custom property overrides onto the host
   * element (which cascades into the shadow DOM). Pass save=true to persist.
   */
  function applyTheme(key, { save = false } = {}) {
    const theme = THEMES[key] || THEMES.amber;
    currentTheme = key;
    const vars = darkMQ.matches ? theme.dark : theme.light;
    // Popup: variables live on <html> (no shadow host). Content script: on host element.
    const target = IS_POPUP ? document.documentElement : host;
    if (!target) return;
    for (const [prop, val] of Object.entries(vars)) {
      target.style.setProperty(prop, val);
    }
    if (swatchesEl) {
      swatchesEl.querySelectorAll('.skippy-swatch').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.theme === key);
      });
    }
    if (save) {
      committedTheme = key;
      try { chrome.storage.local.set({ skippy_theme: key }); } catch {}
    }
  }

  async function loadTheme() {
    try {
      const result = await chrome.storage.local.get('skippy_theme');
      const key = result.skippy_theme || 'amber';
      committedTheme = key;
      applyTheme(key);
    } catch {
      applyTheme('amber');
    }
  }

  // Re-apply when system dark/light mode changes
  darkMQ.addEventListener('change', () => applyTheme(currentTheme));

  // ─── Rendering ─────────────────────────────────────────────────────────────

  function renderList() {
    if (!tabListEl || !emptyEl) return;

    if (tabData.length <= 1) {
      tabListEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      return;
    }

    emptyEl.style.display = 'none';
    tabListEl.style.display = '';

    const isFiltering = tabListEl.classList.contains('is-filtering');

    // Clear list
    while (tabListEl.firstChild) tabListEl.removeChild(tabListEl.firstChild);

    for (let i = 0; i < activeList.length; i++) {
      const item = activeList[i];
      const shortUrl     = item._shortUrl     || truncateUrl(item.url);
      const titleIndices = isFiltering ? (item._titleIndices || []) : [];
      const urlIndices   = isFiltering ? (item._urlIndices   || []) : [];

      const li = document.createElement('li');
      li.className = 'skippy-tab' + (i === selectedIndex ? ' is-selected' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === selectedIndex));

      // Index badge
      const idxSpan = document.createElement('span');
      idxSpan.className = 'skippy-idx';
      idxSpan.textContent = item.mruIdx <= 9 ? String(item.mruIdx) : '·';

      // Favicon
      const img = document.createElement('img');
      img.className = 'skippy-fav';
      img.width = 16;
      img.height = 16;
      const favUrl = getFaviconUrl(item);
      if (favUrl) {
        img.src = favUrl;
        img.onerror = () => { img.style.display = 'none'; };
      } else {
        img.style.display = 'none';
      }

      // Info
      const infoDiv = document.createElement('div');
      infoDiv.className = 'skippy-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'skippy-title';
      titleSpan.append(...highlightText(item.title || item.url || '(no title)', titleIndices));

      const urlSpan = document.createElement('span');
      urlSpan.className = 'skippy-url';
      urlSpan.append(...highlightText(shortUrl, urlIndices));

      infoDiv.append(titleSpan, urlSpan);
      li.append(idxSpan, img, infoDiv);

      li.addEventListener('mouseenter', () => { selectedIndex = i; updateSelection(); });
      li.addEventListener('click', () => switchToTab(item.id));

      tabListEl.appendChild(li);
    }
  }

  function updateSelection() {
    if (!tabListEl) return;
    const items = tabListEl.querySelectorAll('.skippy-tab');
    items.forEach((el, i) => {
      const sel = i === selectedIndex;
      el.classList.toggle('is-selected', sel);
      el.setAttribute('aria-selected', String(sel));
    });
    const selEl = items[selectedIndex];
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }

  // ─── Tab switching ─────────────────────────────────────────────────────────

  function switchToTab(tabId) {
    // Send message BEFORE hide() — in popup context hide() schedules window.close(),
    // so the message must be queued first to ensure it isn't dropped.
    try { chrome.runtime.sendMessage({ action: 'SWITCH_TAB', tabId }); } catch {}
    hide();
  }

  // ─── Input handlers ────────────────────────────────────────────────────────

  function onKeyDown(e) {
    e.stopPropagation();
    e.stopImmediatePropagation();

    const kb = keybindings;
    // Custom keys only fire when the input is empty so they don't block typing.
    const inputEmpty = inputEl && inputEl.value === '';

    if (e.key === 'Escape' || (kb.close && e.key === kb.close)) { hide(); return; }

    if (e.key === 'Enter' || (kb.select && inputEmpty && e.key === kb.select)) {
      e.preventDefault();
      const item = activeList[selectedIndex];
      if (item) switchToTab(item.id);
      return;
    }

    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) ||
        (kb.down && inputEmpty && e.key === kb.down)) {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, activeList.length - 1);
      updateSelection();
      return;
    }

    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ||
        (kb.up && inputEmpty && e.key === kb.up)) {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateSelection();
      return;
    }

    // Digit 1–9: instant jump (only when input is empty)
    if (
      inputEl && inputEl.value === '' &&
      /^[1-9]$/.test(e.key) &&
      !e.ctrlKey && !e.metaKey && !e.altKey
    ) {
      e.preventDefault();
      const item = displayList[parseInt(e.key, 10) - 1];
      if (item) switchToTab(item.id);
    }
  }

  function onInput() {
    if (!inputEl) return;
    const value = inputEl.value;
    if (value.length > 0 && !/^\d+$/.test(value)) {
      tabListEl.classList.add('is-filtering');
      activeList = filterTabs(value);
      selectedIndex = 0;
    } else {
      tabListEl.classList.remove('is-filtering');
      activeList = displayList.slice();
      selectedIndex = 0;
    }
    renderList();
  }

  // ─── init() ────────────────────────────────────────────────────────────────

  function init() {
    if (isInitialized || host) return Promise.resolve();
    if (initPromise) return initPromise;

    initPromise = (async () => {
      if (IS_POPUP) {
        // Popup page: render directly into body. CSS is loaded synchronously via
        // <link> in popup.html — no fetch required, no flash.
        shadowRoot = null;
      } else {
        // Content script: Shadow DOM isolates Skippy from the host page's CSS.
        host = document.createElement('div');
        host.id = 'skippy-extension-host';
        document.documentElement.appendChild(host);
        shadowRoot = host.attachShadow({ mode: 'closed' });

        try {
          const cssText = await fetch(chrome.runtime.getURL('styles.css')).then(r => r.text());
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(cssText);
          shadowRoot.adoptedStyleSheets = [sheet];
        } catch (err) {
          console.warn('[Skippy] Failed to load styles:', err);
        }
      }

      // ── Overlay ──
      overlayEl = document.createElement('div');
      overlayEl.id = 'skippy-overlay';
      overlayEl.setAttribute('role', 'dialog');
      overlayEl.setAttribute('aria-modal', 'true');
      overlayEl.setAttribute('aria-label', 'Skippy tab switcher');

      const scrimEl = document.createElement('div');
      scrimEl.id = 'skippy-scrim';
      scrimEl.addEventListener('click', () => hide());

      const panelEl = document.createElement('div');
      panelEl.id = 'skippy-panel';
      panelEl.addEventListener('click', e => e.stopPropagation());

      // ── Search wrap ──
      const searchWrapEl = document.createElement('div');
      searchWrapEl.id = 'skippy-search-wrap';

      const sigilEl = document.createElement('span');
      sigilEl.id = 'skippy-sigil';
      sigilEl.textContent = '⇥';

      inputEl = document.createElement('input');
      inputEl.id = 'skippy-input';
      inputEl.type = 'text';
      inputEl.placeholder = 'jump 1–9 or search…';
      inputEl.setAttribute('autocomplete', 'off');
      inputEl.setAttribute('spellcheck', 'false');
      inputEl.addEventListener('keydown', onKeyDown, true);
      inputEl.addEventListener('input', onInput);

      const escKbd = document.createElement('kbd');
      escKbd.id = 'skippy-esc';
      escKbd.textContent = 'ESC';

      searchWrapEl.append(sigilEl, inputEl, escKbd);

      // ── Tab list ──
      tabListEl = document.createElement('ul');
      tabListEl.id = 'skippy-tab-list';
      tabListEl.setAttribute('role', 'listbox');
      tabListEl.setAttribute('aria-label', 'Tabs');

      // ── Empty state ──
      emptyEl = document.createElement('div');
      emptyEl.id = 'skippy-empty';
      const emptySpan = document.createElement('span');
      emptySpan.textContent = 'No traversal history.';
      emptyEl.appendChild(emptySpan);

      // ── Footer: hints + theme swatches ──
      const footerEl = document.createElement('div');
      footerEl.id = 'skippy-footer';

      const hintsEl = document.createElement('span');
      hintsEl.id = 'skippy-hints';
      hintsEl.textContent = '↑↓ navigate · 1-9 jump · ⏎ select · esc close';

      swatchesEl = document.createElement('div');
      swatchesEl.id = 'skippy-swatches';

      for (const [key, theme] of Object.entries(THEMES)) {
        const btn = document.createElement('button');
        btn.className = 'skippy-swatch';
        btn.dataset.theme = key;
        btn.title = theme.name;
        btn.setAttribute('aria-label', `${theme.name} theme`);
        btn.style.backgroundColor = theme.swatch;

        // Hover: preview immediately
        btn.addEventListener('mouseenter', () => applyTheme(key));
        // Leave: revert to committed theme if we didn't click
        btn.addEventListener('mouseleave', () => {
          if (currentTheme !== committedTheme) applyTheme(committedTheme);
        });
        // Click: commit
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          applyTheme(key, { save: true });
        });

        swatchesEl.appendChild(btn);
      }

      const optionsBtn = document.createElement('button');
      optionsBtn.id = 'skippy-options-btn';
      optionsBtn.title = 'Options';
      optionsBtn.setAttribute('aria-label', 'Open options');
      optionsBtn.textContent = '⚙';
      optionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { chrome.runtime.openOptionsPage(); } catch {}
      });

      footerEl.append(hintsEl, swatchesEl, optionsBtn);
      panelEl.append(searchWrapEl, tabListEl, emptyEl, footerEl);
      overlayEl.append(scrimEl, panelEl);
      if (IS_POPUP) {
        document.body.appendChild(overlayEl);
      } else {
        shadowRoot.appendChild(overlayEl);
      }

      // Apply persisted theme and keybindings after DOM is ready
      await Promise.all([loadTheme(), loadKeybindings()]);

      isInitialized = true;
    })();

    return initPromise;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async function show() {
    await init();

    isVisible = true;
    if (inputEl)   inputEl.value = '';
    if (tabListEl) tabListEl.classList.remove('is-filtering');

    tabData = [];
    displayList = [];
    activeList = [];
    selectedIndex = 0;

    overlayEl.classList.add('is-visible');
    renderList(); // show empty/loading state immediately

    requestAnimationFrame(() => { if (inputEl) inputEl.focus(); });

    try {
      // In popup context (action popup on a privileged page) there is no sender.tab,
      // so the background can't infer the windowId. Fetch it here and send it along.
      let windowId;
      if (IS_POPUP) {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          windowId = activeTab?.windowId;
        } catch {}
      }

      const tabs = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ action: 'GET_STACK', windowId }, (response) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(response || []);
          });
        } catch (err) { reject(err); }
      });

      tabData = tabs;
      displayList = tabs.slice(1).map((tab, i) => ({ ...tab, mruIdx: i + 1 }));
      activeList = displayList.slice();
      selectedIndex = 0;
      renderList();
    } catch (err) {
      console.warn('[Skippy] Failed to get stack:', err);
    }
  }

  function hide() {
    if (!isVisible) return;
    isVisible = false;
    if (overlayEl) overlayEl.classList.remove('is-visible');
    if (inputEl)   inputEl.value = '';
    if (tabListEl) tabListEl.classList.remove('is-filtering');
    // When running as the action popup, close the window on dismiss.
    // Timeout gives sendMessage (called before hide) time to be delivered.
    if (location.protocol === 'chrome-extension:') {
      setTimeout(() => window.close(), 50);
    }
  }

  function toggle() {
    if (isVisible) hide(); else show();
  }

  return { toggle, show, hide };
})();

// When loaded as the extension action popup, show immediately.
// This replaces the separate popup.js file and avoids Chrome treating a
// single-statement external script as an inline script (CSP hash mismatch).
if (location.protocol === 'chrome-extension:') {
  SkippyUI.show();
}
