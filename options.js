'use strict';

// ── Action definitions ────────────────────────────────────────────────────────

const ACTIONS = [
  {
    id: 'down',
    label: 'Navigate down',
    hint: 'Always works: ↓ · Tab',
  },
  {
    id: 'up',
    label: 'Navigate up',
    hint: 'Always works: ↑ · Shift+Tab',
  },
  {
    id: 'select',
    label: 'Select tab',
    hint: 'Always works: ⏎ Enter',
  },
  {
    id: 'close',
    label: 'Dismiss',
    hint: 'Always works: Esc',
  },
];

// Keys that shouldn't be used as navigation shortcuts (system / reserved)
const BLOCKED_KEYS = new Set([
  'Tab', 'CapsLock', 'Meta', 'Control', 'Alt', 'Shift',
  'OS', 'ContextMenu', 'Dead',
]);

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {{ [actionId: string]: string }} */
let bindings = {};

/** The action currently waiting for a key press, or null. */
let listeningAction = null;

// ── Storage ───────────────────────────────────────────────────────────────────

async function loadBindings() {
  try {
    const result = await chrome.storage.local.get('keybindings');
    bindings = result.keybindings || {};
  } catch {
    bindings = {};
  }
}

async function saveBindings() {
  try {
    await chrome.storage.local.set({ keybindings: bindings });
    showToast('Saved');
  } catch {
    showToast('Error saving');
  }
}

// ── Key label helpers ─────────────────────────────────────────────────────────

function keyLabel(key) {
  const MAP = {
    ArrowDown:  '↓',
    ArrowUp:    '↑',
    ArrowLeft:  '←',
    ArrowRight: '→',
    Enter:      '⏎',
    Escape:     'Esc',
    Backspace:  '⌫',
    Delete:     '⌦',
    ' ':        'Space',
  };
  return MAP[key] || (key.length === 1 ? key.toUpperCase() : key);
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const list = document.getElementById('bindings-list');
  list.innerHTML = '';

  for (const action of ACTIONS) {
    const custom = bindings[action.id];

    const row = document.createElement('div');
    row.className = 'binding-row';
    row.dataset.action = action.id;

    // Label
    const labelEl = document.createElement('div');
    labelEl.className = 'binding-label';
    labelEl.innerHTML = `${action.label}<small>${action.hint}</small>`;

    // Keys area
    const keysEl = document.createElement('div');
    keysEl.className = 'binding-keys';

    if (listeningAction === action.id) {
      // Listening state
      const badge = document.createElement('kbd');
      badge.className = 'key is-listening';
      badge.textContent = 'press a key…';
      keysEl.appendChild(badge);
    } else if (custom) {
      // Has a custom key — show it with reset option
      const badge = document.createElement('kbd');
      badge.className = 'key is-custom';
      badge.title = 'Click to change';
      badge.textContent = keyLabel(custom);
      badge.addEventListener('click', () => startListening(action.id));
      keysEl.appendChild(badge);

      const resetBtn = document.createElement('button');
      resetBtn.className = 'reset-key';
      resetBtn.textContent = 'reset';
      resetBtn.addEventListener('click', () => resetBinding(action.id));
      keysEl.appendChild(resetBtn);
    } else {
      // No custom key — offer to add one
      const addBtn = document.createElement('button');
      addBtn.className = 'add-key';
      addBtn.textContent = '+ add key';
      addBtn.addEventListener('click', () => startListening(action.id));
      keysEl.appendChild(addBtn);
    }

    row.append(labelEl, keysEl);
    list.appendChild(row);
  }
}

// ── Listening mode ────────────────────────────────────────────────────────────

function startListening(actionId) {
  listeningAction = actionId;
  render();
}

function stopListening() {
  listeningAction = null;
  render();
}

async function commitKey(key) {
  if (!listeningAction) return;
  bindings[listeningAction] = key;
  listeningAction = null;
  render();
  await saveBindings();
}

async function resetBinding(actionId) {
  delete bindings[actionId];
  render();
  await saveBindings();
}

// Global keydown: capture key when in listening mode
document.addEventListener('keydown', async (e) => {
  if (!listeningAction) return;

  e.preventDefault();
  e.stopPropagation();

  if (e.key === 'Escape') {
    stopListening();
    return;
  }

  if (BLOCKED_KEYS.has(e.key)) return; // ignore pure modifiers

  await commitKey(e.key);
});

// Click outside a listening row cancels it
document.addEventListener('click', (e) => {
  if (!listeningAction) return;
  const row = e.target.closest('.binding-row');
  if (!row || row.dataset.action !== listeningAction) {
    stopListening();
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// ── Activation shortcut link ──────────────────────────────────────────────────

document.getElementById('open-shortcuts-btn').addEventListener('click', () => {
  // Options pages are extension pages and can open chrome:// URLs via tabs API
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

loadBindings().then(render);
