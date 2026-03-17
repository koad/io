# Technical Specification: Web Search

## Overview

Integrated search in popup with customizable engines.

## Search Engine Config

```javascript
{
  "searchEngines": [
    { "name": "Google", "url": "https://google.com/search?q={query}", "default": true },
    { "name": "DuckDuckGo", "url": "https://duckduckgo.com/?q={query}" },
    { "name": "GitHub", "url": "https://github.com/search?q={query}" }
  ]
}
```

## Search Input

```javascript
// On form submit
const query = inputElement.value;
const engine = getSelectedEngine();
const url = engine.url.replace('{query}', encodeURIComponent(query));
chrome.tabs.create({ url });
```

## Selected Text Actions

### Context Menu
```javascript
chrome.contextMenus.create({
  id: "searchSelected",
  title: "Search with koad:io",
  contexts: ["selection"]
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "searchSelected") {
    search(info.selectionText);
  }
});
```

### Keyboard Shortcut
- Default: Ctrl+Shift+S (configurable)

## Selected Text UI

```
┌─────────────────────────────────────────┐
│  Selected: "symptoms of COVID"          │
│                                         │
│  [🔍 Search]  [+ Note]  [🛡 Check]    │
│  [📋 Copy]   [→ Ingest]               │
└─────────────────────────────────────────┘
```

## DDP Ingest

```javascript
ddp.call('passenger.ingest.text', {
  text: "selected text",
  url: "https://current-page.com",
  title: "Page Title",
  action: "search"  // or "note", "check", "copy", "ingest"
})
```

## Settings

```javascript
{
  "search": {
    "defaultEngine": "Google",
    "shortcut": "Ctrl+Shift+S",
    "showSuggestions": true,
    "saveHistory": true,
    "maxHistory": 50
  }
}
```

## Implementation Files

- Popup UI: `dist/panes/popup/search.js`
- Context menu: `dist/background/search-context.js`
- Background: `dist/background/search-handler.js`
