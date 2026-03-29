# Skippy

![Skippy](logo.png)

You're deep in a tab. You need the one you were just on. You scan the tab bar, find it, click it — three seconds gone.

**`Cmd+Shift+,` → `Enter`.** You're there. Do it again, you're back. Two keystrokes, every time, no scanning required.

Skippy keeps a most-recently-used stack per window. The tab you were just on is always slot 1. After an hour with it, switching tabs any other way feels broken.

---

## Install

1. Clone or download this repo
2. Go to `chrome://extensions` and enable **Developer mode**
3. Click **Load unpacked** and select the `skippy/` folder

No build step. No npm install. No dependencies.

---

## Usage

**Open:** `Cmd+Shift+,` on macOS, `Ctrl+Shift+,` on Windows and Linux.

The panel opens with the second item already highlighted — the tab you were just on. Press Enter immediately to toggle between your two most recent tabs. Two keystrokes, no thought required.

### Keyboard reference

| Key | Action |
|-----|--------|
| `Enter` | Jump to highlighted tab |
| `1` – `9` | Instantly jump to that MRU position — no Enter needed |
| `↑` `↓` | Move highlight |
| `Tab` / `Shift+Tab` | Also moves highlight |
| Any letter | Switch to fuzzy search |
| `Esc` | Dismiss |

### Fuzzy search

Type any non-numeric character and Skippy switches to filter mode. Matching uses subsequence fuzzy search — characters must appear in order but don't need to be adjacent. Typing `gh` finds **G**it**H**ub. Typing `gd` finds **G**oogle **D**ocs. Matched characters are highlighted in your accent color.

Numeric keys (`1`–`9`) always jump to MRU positions regardless of search state. Clear the input to return to the full list.

### Privileged pages

On restricted pages like new tab, settings, and extension pages, Chrome blocks content script injection. Skippy detects this and opens as a browser action popup instead, with the same UI.

---

## Themes

Six built-in themes, switchable from the panel footer. Hover a swatch to preview instantly, click to commit. Your choice persists across sessions and adapts to your system's light or dark mode automatically.

| Theme | Light accent | Dark accent |
|-------|-------------|-------------|
| Amber (default) | `#b87c1e` | `#d4972a` |
| Cobalt | `#2563eb` | `#60a5fa` |
| Sage | `#4a7c59` | `#6bba85` |
| Rose | `#be185d` | `#f472b6` |
| Ember | `#c2410c` | `#fb923c` |
| Slate | `#475569` | `#94a3b8` |

---

## Customizing shortcuts

### Activation shortcut

The `Cmd+Shift+,` shortcut is managed by Chrome, not the extension. Change it at `chrome://extensions/shortcuts`. The **⚙** button in Skippy's footer opens that page directly.

### Navigation shortcuts

Open **Options** by right-clicking the extension icon and selecting Options, or via the **⚙** button in the footer. From there you can assign additional keys to any navigation action.

Custom keys augment the defaults rather than replacing them — both work in parallel. For example, setting `j` as navigate-down means both `j` and `↓` work. Custom keys are ignored while the search input has text, so they never interfere with typing.

| Action | Default | Common alternative |
|--------|---------|-------------------|
| Navigate down | `↓` · `Tab` | `j` |
| Navigate up | `↑` · `Shift+Tab` | `k` |
| Select | `Enter` | any key |
| Dismiss | `Esc` | any key |

---

## How it works

<details>
<summary>MRU engine</summary>

A Manifest V3 service worker listens to `chrome.tabs.onActivated` and maintains an in-memory array per `windowId`. When a tab is focused it moves to position 0. When a tab is closed it's removed. The array is serialised as **URLs** — not tab IDs, which are ephemeral — to `chrome.storage.local` on every change.

On startup, stored URL arrays are reconciled with currently open tabs by matching URLs to tab IDs. This means traversal history survives service worker restarts and full browser restarts with session restore, without any special session API.

</details>

<details>
<summary>Overlay architecture</summary>

On normal pages, the shortcut fires a `chrome.commands` event in the service worker, which sends a message to the active tab's content script. The content script manages a **closed Shadow DOM** attached to `document.documentElement` — completely isolated from the host page's CSS and JavaScript. The overlay is injected at `document_start` and kept hidden, so activation has no initialisation latency.

On privileged pages where content scripts are blocked, the command handler detects the restricted URL and calls `chrome.action.openPopup()`. The popup renders the same UI directly in the extension page body, with CSS loaded synchronously via a `<link>` element rather than the async `adoptedStyleSheets` path used in content scripts.

</details>

<details>
<summary>Fuzzy search</summary>

Subsequence matching with word-boundary scoring. No library — roughly 20 lines of vanilla JS. Each character in the pattern must appear in order in the text. Consecutive matches score `+2` each (multiplied by run length). Matches at position 0 or after a word separator (`space`, `-`, `_`, `.`, `/`, `:`) score an additional `+4`.

Results are sorted by score descending. The matched character indices are returned alongside the score and used to wrap individual characters in `<mark>` elements for inline highlighting in the rendered list.

</details>

---

## File structure

```
skippy/
├── manifest.json     MV3 manifest, keyboard command declaration
├── background.js     MRU engine, storage, command and message handling
├── content.js        TOGGLE listener, global Escape capture
├── ui.js             Shadow DOM overlay, fuzzy search, themes, keybindings
├── styles.css        All styles, injected via adoptedStyleSheets
├── popup.html        Privileged-page fallback — flat DOM, sync CSS load
├── popup.js          Calls SkippyUI.show() on popup load
├── options.html      Keybinding editor
└── options.js        Key capture, storage, reset logic
```
