# Feature: Web Search

## Summary

Quick web search from the popup or command palette.

## Problem

- Need to search without leaving current tab
- Want custom search engines
- Search history tracking

## Solution

Integrated search in popup with customizable search engines.

## Default Search Engines

| Name | URL |
|------|-----|
| Google | `https://google.com/search?q={query}` |
| DuckDuckGo | `https://duckduckgo.com/?q={query}` |
| Bing | `https://bing.com/search?q={query}` |
| GitHub | `https://github.com/search?q={query}` |

## Custom Search Engines

Users can add custom search engines in settings:

```json
{
  "searchEngines": [
    { "name": "Google", "url": "https://google.com/search?q={query}", "default": true },
    { "name": "Reddit", "url": "https://reddit.com/search?q={query}" },
    { "name": "YouTube", "url": "https://youtube.com/results?search_query={query}" },
    { "name": "DDG", "url": "https://duckduckgo.com/?q={query}" }
  ]
}
```

## UI

### Search Bar in Popup

```
┌─────────────────────────────────────────┐
│  🔍 Search...              [Google ▼]   │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Search suggestions...           │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### Search Results

Opens in new tab with selected search engine.

## Search History

Recent searches saved to activity log:
- Stored locally or via passenger
- Shown in autocomplete
- Clearable

## Search with Selected Text

Highlight text on any page, right-click or use keyboard shortcut to search/injest:

### Trigger Methods

1. **Context Menu**: Right-click → "Search with koad:io"
2. **Keyboard**: Ctrl+Shift+S (configurable)
3. **Command Palette**: `search "selected text"`

### Selected Text Actions

When text is selected, user can:

| Action | Description |
|--------|-------------|
| `search` | Search selected text |
| `add note` | Add note about selected text |
| `check` | Run security check on selected text |
| `copy` | Copy selected text |
| `ingest` | Send to passenger for processing |

### Context Menu Integration

```javascript
chrome.contextMenus.create({
  id: "searchSelected",
  title: "Search with koad:io",
  contexts: ["selection"]
});
```

### DDP Method (Ingest Selected Text)

```
passenger.ingest.text({
  text: "selected text from page",
  url: "https://current-page.com",
  title: "Current Page Title",
  action: "search"
})
```

### UI - Selected Text Popup

```
┌─────────────────────────────────────────┐
│  Selected: "symptoms of COVID"          │
│                                         │
│  [🔍 Search]  [+ Note]  [🛡 Check]    │
│  [📋 Copy]   [→ Ingest]               │
└─────────────────────────────────────────┘
```

### Add Note with Selection

When adding a note with selected text:
```json
{
  "note": "symptoms of COVID - research from example.com",
  "url": "https://example.com/article",
  "selectedText": "symptoms of COVID",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Settings

```json
{
  "search": {
    "defaultEngine": "Google",
    "showSuggestions": true,
    "saveHistory": true,
    "maxHistory": 50
  }
}
```

## Status

- [x] Search input in popup
- [x] Search engine selector
- [x] Custom search engine support
- [x] Search history/autocomplete
- [x] Open results in new tab
- [ ] Context menu for selected text
- [ ] Keyboard shortcut for selected text
- [ ] Selected text action UI
- [ ] DDP ingest for selected text
- [ ] Add note with selection

## Related Features

- Feature: 017-quick-commands.md
- Feature: 016-activity-log.md
