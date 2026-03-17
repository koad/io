# Feature: Screenshot Capture

## Summary

Capture screenshots of the current page or specific elements.

## Problem

- Need to capture page for reference
- No easy screenshot tool built-in
- Want to save to passenger's storage

## Solution

Screenshot button in popup that captures and optionally saves.

## Implementation

### Capture Options

| Option | Description |
|--------|-------------|
| `viewport` | Capture visible area only (default) |
| `fullpage` | Capture entire page (full scroll length) |
| `selection` | User draws a rectangle to capture |
| `element` | Click on a specific element to capture it |

### Viewport Capture

```javascript
chrome.tabs.captureVisibleTab(callback)
```

### Full Page Capture

```javascript
// First get page dimensions
chrome.tabs.executeScript(tabId, {
  code: `
    Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    )
  `
}, (heights) => {
  const maxHeight = Math.max(...heights);
  // Capture with viewport dimensions but full height
  chrome.tabs.captureVisibleTab({
    format: 'png',
    rect: { width: window.innerWidth, height: maxHeight }
  }, callback);
});
```

### Selection Capture

1. User clicks "Selection" button
2. Overlay appears over page
3. User draws rectangle
4. Capture that specific area

```javascript
// After user selects area
const dataUrl = canvas.toDataURL('image/png');
```

### Element Capture

1. User clicks "Element" button
2. Cursor changes to crosshair
3. **Hover highlighting** - Elements highlight as you hover (like browser dev tools)
   - Blue border appears around hovered element
   - Tag name shows in tooltip (e.g., `<div class="container">`)
   - Helps identify exactly which element will be captured
4. User clicks on element to capture it

```javascript
// Inject hover highlighting
document.addEventListener('mouseover', (e) => {
  e.target.style.outline = '2px solid #0066ff';
  e.target.style.setProperty('z-index', '999999', 'important');
  
  // Show tooltip
  const tooltip = document.createElement('koad-screenshot-tooltip');
  tooltip.innerHTML = `<${e.target.tagName.toLowerCase()}>${e.target.className ? '.' + e.target.className.split(' ').join('.') : ''}`;
  document.body.appendChild(tooltip);
});

document.addEventListener('mouseout', (e) => {
  e.target.style.outline = '';
  e.target.style.zIndex = '';
  
  // Remove tooltip
  const tooltip = document.querySelector('koad-screenshot-tooltip');
  if (tooltip) tooltip.remove();
});

document.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  
  const element = e.target;
  const rect = element.getBoundingClientRect();
  
  // Capture element
  chrome.runtime.sendMessage({
    action: 'captureElement',
    options: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }
  });
}, { once: true });
```

### Hover Highlighting Style

```
┌─────────────────────────────────────────┐
│  When hovering:                        │
│                                         │
│  ┌─────────────────────┐                │
│  │ Element gets       │ ← Blue border  │
│  │ blue outline       │   + tooltip    │
│  └─────────────────────┘                │
│         ↖ <div class="container">       │
│           Tooltip with tag info          │
└─────────────────────────────────────────┘
```

### Full Page Capture

- Scroll through entire page
- Capture each viewport
- Stitch together into single image
- Handles lazy-loaded images

### DDP Method (Save to Passenger)

```
passenger.screenshot.save({
  image: "data:image/png;base64,...",
  url: "https://...",
  title: "Page Title",
  timestamp: "2024-01-15T10:30:00Z"
})
```

## UI

```
┌─────────────────────────────────────────┐
│  📷 Screenshot                    [▼]   │
├─────────────────────────────────────────┤
│                                         │
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
│  [Save to Files] [Copy to Clipboard]   │
│  [Save to Passenger]                   │
└─────────────────────────────────────────┘
```

### Viewport
- Captures what's currently visible in the browser window

### Full Page
- Scrolls through entire page
- Captures full scroll length
- Stitches into single image
- Handles lazy-loaded images

### Selection
- User draws rectangle on page
- Captures only the selected area
- Useful for capturing specific regions

### Element
- Cursor changes to crosshair
- Click directly on any element
- Captures just that specific element
- Perfect for capturing single images, buttons, or specific UI components
┌─────────────────────────────────────────┐
│  📷 Screenshot                    [▼]   │
├─────────────────────────────────────────┤
│                                         │
│  [📷 Visible] [📷 Full Page]           │
│  [📷 Selection]                         │
│                                         │
│  Preview:                               │
│  ┌─────────────────────────────────┐   │
│  │                                 │   │
│  │     [Screenshot Preview]       │   │
│  │                                 │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [Save to Files] [Copy to Clipboard]   │
│  [Save to Passenger]                   │
└─────────────────────────────────────────┘
```

## Storage

- **Clipboard**: Copy as image
- **Download**: Save as PNG file
- **Passenger**: Save to passenger's storage via DDP

## Status

- [ ] Implement visible capture
- [ ] Implement full page capture
- [ ] Implement selection capture
- [ ] Preview UI
- [ ] Save to clipboard
- [ ] Save to download
- [ ] Save to passenger

## Related Features

- Feature: 010-core-passenger-features.md
