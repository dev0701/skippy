# Skippy: Design Document

**Version:** 1.0

**Status:** Architecture Blueprint

**Concept:** A zero-latency, traversal-based tab switcher for power users.

---

## 1. Project Objective

To provide a minimalist keyboard-driven interface that allows users to navigate their browser history based on the order of traversal (MRU) rather than the physical order of tabs in the window.

## 2. Technical Stack

To maintain a "near-instant" feel and minimize resource overhead, the extension uses a zero-dependency stack:

| Component | Choice |
|---|---|
| **Architecture** | Manifest V3 (Service Worker + Content Scripts) |
| **Language** | Vanilla JavaScript (ES6+) |
| **UI Engine** | Shadow DOM (Injected Overlay) |
| **Styling** | CSS3 Variables with `prefers-color-scheme` support |
| **Storage** | `chrome.storage.local` (for session persistence) |

## 3. Core Architecture & Logic

### 3.1 The MRU Engine (Service Worker)

The background Service Worker acts as the "source of truth" for tab history.

- **Scoped Tracking:** Only tracks tabs within the `currentWindow`.
- **Stack Management:**
  - Listens to `tabs.onActivated`.
  - When a tab is focused, its ID is moved to the top of the stack.
  - When a tab is closed (`tabs.onRemoved`), it is pruned from the stack.
- **Pinned Tabs:** Treated as standard entries; their position in the list is dictated strictly by traversal recency.

### 3.2 The Injected Overlay (Content Script)

Skippy bypasses the standard `browser_action` popup for a faster, injected Shadow DOM.

- **Shadow DOM Isolation:** Ensures website CSS (e.g., from YouTube or GitHub) does not interfere with Skippy's layout.
- **Pre-Injection:** The script is injected at `document_start` but remains hidden until the shortcut is triggered, ensuring **0ms latency** upon activation.

## 4. UI/UX & Interaction Model

### 4.1 Activation

- **Shortcut:** `Cmd + Shift + ,` (macOS) or `Ctrl + Shift + ,` (Windows/Linux).
- **Initial State:** The overlay opens with the second item (Index 1) automatically highlighted. This allows the user to press **Shortcut → Enter** to instantly toggle between the two most recent tabs.

### 4.2 The Hybrid Input System

The search bar at the top of the modal serves a dual purpose:

1. **Numeric Jump:** If a key `1-9` is pressed, the extension immediately switches to that specific index in the list.
2. **Fuzzy Search:** If any non-numeric character is typed, the UI switches to **Filter Mode**.
   - Results are filtered by Tab Title and URL.
   - Pressing `Enter` in this mode selects the top-most filtered result.

### 4.3 Visual Components

- **List Items:** Each row displays `[Index Number] [Favicon] [Tab Title]`.
- **Empty State:** If only one tab is open in the window, the modal displays: *"No traversal history."*
- **Backdrop:** A minimalist, centered modal with a slight backdrop blur to maintain focus.

## 5. Performance Strategy

- **Favicon Helper:** Utilizes `chrome-extension://_favicon/` to fetch cached icons directly from the browser's internal database.
- **Keyboard Hijacking:** Implements `event.stopPropagation()` to ensure that complex web apps (like Google Docs or Notion) do not capture keys while Skippy is active.
- **Message Passing:** Uses a single `chrome.runtime.sendMessage` to request the stack and a single message to execute the jump, minimizing background chatter.

## 6. Proposed File Structure

```
skippy/
├── manifest.json          # Permissions & Command definitions
├── background.js          # MRU logic & state management
├── content.js             # Overlay injection & keyboard listeners
├── ui.js                  # Shadow DOM rendering & Search logic
└── styles.css             # Scoped UI styles
```
