# Technical Specification: Core Passenger Features

## Overview

Built-in browser utilities available even without active passengers.

## Features

### Copy Tabs
- Lists all open tabs in current window
- Formats as markdown: `[Title](URL)`
- One-click copy to clipboard

**Implementation**:
```javascript
chrome.tabs.query({currentWindow: true}, (tabs) => {
  const markdown = tabs.map(t => `[${t.title}](${t.url})`).join('\n');
  navigator.clipboard.writeText(markdown);
});
```

### Copy Current Tab
- Copies only active tab
- Markdown format

### Kill/Discard Tabs
- Uses `chrome.tabs.discard()`
- Tab stays in strip but unloads content
- Click to reload when needed

### DOM Element Removal
- **Trigger**: Ctrl+Shift+Click on element
- Removes element from DOM
- Persists until page refresh

**Implementation**:
```javascript
document.addEventListener('click', (e) => {
  if (e.ctrlKey && e.shiftKey) {
    e.preventDefault();
    e.target.remove();
  }
});
```

### Configure Button
- Opens extension options page
- Uses `chrome.runtime.openOptionsPage()`

## UI Layout

```
┌─────────────────────────────────┐
│  [Avatar] Passenger Name        │
│                                 │
│  ───────────────────────────   │
│                                 │
│  [murder tab] [copy tabs]       │
│  [copy tab] [discard tabs]     │
│                                 │
│  [configure koad:io]             │
└─────────────────────────────────┘
```

## Storage Keys

```javascript
{
  "coreFeatures": {
    "showDiscardTab": true,
    "showCopyTabs": true
  }
}
```

## Implementation Files

- Popup logic: `dist/panes/popup/logic.js`
- Content script: `dist/workers/inject/dom-tools.js`
