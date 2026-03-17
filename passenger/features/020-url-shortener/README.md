# Feature: URL Shortener

## Summary

Shorten URLs via passenger's DDP service or third-party APIs.

## Problem

- Need to share short URLs
- Custom shortener for personal branding
- Track click stats

## Solution

Shorten URLs through configured shortener service.

## Shortener Options

### 1. Passenger DDP

If passenger has shortener service:

```
passenger.url.shorten({
  url: "https://very-long-url.com/..."
})
```

**Response**:
```json
{
  "shortUrl": "https://koad.io/abc123",
  "clicks": 0,
  "expires": "2025-01-15"
}
```

### 2. Third-Party APIs

Configured in settings:

```json
{
  "shortener": {
    "provider": "isgd",  // or "passenger", "bitly", "custom"
    "apiKey": "..."
  }
}
```

### Supported Providers

| Provider | URL Template |
|----------|--------------|
| is.gd | `https://is.gd/create.php?url={url}` |
| v.gd | `https://v.gd/create.php?url={url}` |
| bit.ly | `https://api-ssl.bitly.com/v4/shorten` |

## UI

### In Popup

```
┌─────────────────────────────────────────┐
│  URL: https://long-url.com/...    [▼]  │
│                                         │
│  [Shorten] [Copy] [Open]               │
│                                         │
│  Short URL:                             │
│  ┌─────────────────────────────────┐   │
│  │ https://koad.io/abc123    [📋]  │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Context Menu

Right-click → "Shorten URL"

## Click Tracking (if supported)

```json
{
  "shortUrl": "https://koad.io/abc123",
  "originalUrl": "https://...",
  "clicks": 42,
  "created": "2024-01-15"
}
```

## Status

- [ ] Implement is.gd/v.gd integration
- [ ] Add passenger DDP method support
- [ ] UI in popup
- [ ] Context menu option
- [ ] Click tracking display

## Related Features

- Feature: 010-core-passenger-features.md
