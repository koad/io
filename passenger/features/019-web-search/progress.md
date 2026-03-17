# Progress: Web Search

## Status: 🔲 Not Started

## To Do (Basic)

- [x] Search input in popup
- [x] Search engine selector
- [x] Custom search engine support
- [x] Search history/autocomplete
- [x] Open results in new tab

## To Do (Advanced)

- [ ] Context menu for selected text
- [ ] Keyboard shortcut for selected text
- [ ] Selected text action UI
- [ ] DDP ingest for selected text
- [ ] Add note with selection

## Default Search Engines

| Name | URL |
|------|-----|
| Google | `https://google.com/search?q={query}` |
| DuckDuckGo | `https://duckduckgo.com/?q={query}` |
| Bing | `https://bing.com/search?q={query}` |
| GitHub | `https://github.com/search?q={query}` |

## Selected Text Actions

| Action | Description |
|--------|-------------|
| search | Search selected text |
| add note | Add note about selected text |
| check | Run security check on selected text |
| copy | Copy selected text |
| ingest | Send to passenger for processing |

## Context Menu

```javascript
chrome.contextMenus.create({
  id: "searchSelected",
  title: "Search with koad:io",
  contexts: ["selection"]
});
```

## DDP Method (Ingest)

```
passenger.ingest.text({
  text: "selected text from page",
  url: "https://current-page.com",
  title: "Current Page Title",
  action: "search"
})
```

## Dependencies

- Feature: 017-quick-commands
- Feature: 012-community-notes
- Feature: 016-activity-log

## Notes

Basic search is already implemented. Focus on selected text features next.
