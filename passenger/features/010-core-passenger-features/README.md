# Feature: Core Passenger Features

## Summary

Built-in functionality available in Dark Passenger even when no passengers are loaded.

## Problem

Dark Passenger should provide useful browser utilities even without any entities active.

## Solution

Core features available by default in the popup:

### Copy Tabs

- Lists all open tabs in the current browser instance
- Formats as markdown links: `[Title](URL)`
- Copies to clipboard with one click

**Current implementation** (popup `logic.js`):
```javascript
chrome.runtime.sendMessage({ action: "getTabs" }, (response) => {
    const markdownLinks = response.map(tab => `[${tab.title}](${tab.url})`).join('\n');
    navigator.clipboard.writeText(markdownLinks);
});
```

### Copy Current Tab

- Copies only the currently active/focused tab
- Same markdown format as Copy Tabs
- Useful for quickly sharing a single link

### Kill/Discard Tabs

- Discards all tabs in the current browser instance
- Uses Chrome's `chrome.tabs.discard()` API
- Tab remains in tab strip but content is unloaded from memory
- User can click to reload when needed
- Only affects current browser, not all browsers

### No Actionable Methods Display

Shown in popup when no passengers provide skills for the current site:

```
┌─────────────────────────────────┐
│  koad:io                        │
│  Dark Passenger                 │
│                                 │
│  ────────────────────────────   │
│                                 │
│  This page has no actionable    │
│  methods on it                  │
│                                 │
│  [murder tab] [copy tabs]       │
│  [configure koad:io]             │
└─────────────────────────────────┘
```

### DOM Element Removal

- Hold **Ctrl+Shift** and click any element to remove it from the page
- Useful for hiding unwanted content (ads, popups, distracting elements)
- Removed elements stay removed until page refresh

```javascript
document.addEventListener('click', function (event) {
    if (event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        event.target.remove();
    }
});
```

### Configure Application

Opens the extension settings page.

## Implementation

- **Popup UI**: `dist/panes/popup/`
- **Logic**: `dist/panes/popup/logic.js`
- **Message Handler**: Background service worker handles `getTabs`, `showOptions`

## Status

- [x] Copy tabs button implemented
- [x] Copy current tab button implemented
- [x] No actionable methods message in popup
- [x] Configure button opens settings
- [x] Discard tabs button implemented

## Related Features

- Feature: 007-chrome-extension-ui.md
