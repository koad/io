# Progress: Screenshot Capture

## Status: 🔲 Not Started

## To Do

- [ ] Implement visible capture
- [ ] Implement full page capture
- [ ] Implement selection capture
- [ ] Preview UI
- [ ] Save to clipboard
- [ ] Save to download
- [ ] Save to passenger

## Capture Modes

| Mode | Description |
|------|-------------|
| viewport | Capture visible area only (default) |
| fullpage | Capture entire page (full scroll length) |
| selection | User draws a rectangle to capture |
| element | Click on a specific element to capture it |

## Element Capture Details

1. User clicks "Element" button
2. Cursor changes to crosshair
3. **Hover highlighting** - Elements highlight as you hover
   - Blue border appears around hovered element
   - Tooltip shows tag name (e.g., `<div class="container">`)
4. Click to capture that specific element

## Storage Options

- **Clipboard**: Copy as image
- **Download**: Save as PNG file
- **Passenger**: Save to passenger's storage via DDP

## DDP Method

```
passenger.screenshot.save({
  image: "data:image/png;base64,...",
  url: "https://...",
  title: "Page Title",
  timestamp: "2024-01-15T10:30:00Z"
})
```

## Dependencies

- Feature: 010-core-passenger-features (for popup UI)

## Notes

Full page capture needs to handle lazy-loaded images by scrolling through the page.
