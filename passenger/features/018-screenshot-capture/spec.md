# Technical Specification: Screenshot Capture

## Overview

Capture screenshots of pages - viewport, full page, selection, or specific elements.

## Capture Modes

### Viewport
```javascript
chrome.tabs.captureVisibleTab(tab.id, { format: 'png' }, (dataUrl) => {
  // dataUrl: "data:image/png;base64,..."
});
```

### Full Page
1. Get page height via executeScript
2. Capture with calculated full height
3. For very long pages, capture in chunks and stitch

```javascript
chrome.tabs.executeScript(tab.id, {
  code: 'document.body.scrollHeight'
}, (heights) => {
  const height = Math.max(...heights);
  chrome.tabs.captureVisibleTab(tab.id, {
    format: 'png',
    rect: { width: window.innerWidth, height: height }
  });
});
```

### Selection
1. Inject overlay into page
2. User draws rectangle
3. Capture using canvas crop

### Element Capture
1. Inject mouse handlers
2. On hover: highlight element with blue border + tooltip
3. On click: capture element bounds

```javascript
// Hover highlighting
document.addEventListener('mouseover', (e) => {
  e.target.style.outline = '2px solid #0066ff';
});

// Capture element
const rect = element.getBoundingClientRect();
// Use chrome.tabs.captureVisibleTab with rect
```

## Preview UI

```
┌─────────────────────────────────────────┐
│  📷 Screenshot                    [▼]   │
├─────────────────────────────────────────┤
│  [📷 Viewport] [📷 Full Page]          │
│  [✂️ Select]  [🖱 Element]              │
│                                         │
│  Preview:                               │
│  ┌─────────────────────────────────┐   │
│  │                                 │   │
│  │     [Screenshot Preview]        │   │
│  │                                 │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [Save] [Copy] [Save to Passenger]    │
└─────────────────────────────────────────┘
```

## Save Options

| Method | Implementation |
|--------|----------------|
| Download | chrome.downloads.download() |
| Clipboard | navigator.clipboard.write() |
| Passenger | DDP: passenger.screenshot.save() |

## DDP Method

```javascript
ddp.call('passenger.screenshot.save', {
  image: "data:image/png;base64,...",
  url: "https://...",
  title: "Page Title",
  timestamp: "2024-01-15T10:30:00Z"
})
```

## Implementation Files

- Popup UI: `dist/panes/popup/screenshot.js`
- Content script: `dist/workers/inject/screenshot-helpers.js`
- Background: `dist/background/screenshot-capture.js`
