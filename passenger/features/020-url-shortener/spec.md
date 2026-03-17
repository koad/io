# Technical Specification: URL Shortener

## Overview

Shorten URLs via passenger DDP service or third-party APIs.

## Shortener Options

### 1. is.gd (Default, No API Key)

```javascript
// GET request
fetch('https://is.gd/create.php?url=' + encodeURIComponent(longUrl))
  .then(r => r.text())
  .then(shortUrl => {
    // shortUrl: "https://is.gd/abc123"
  });
```

### 2. v.gd
Same as is.gd, different domain.

### 3. bit.ly (Requires API Key)

```javascript
fetch('https://api-ssl.bitly.com/v4/shorten', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    long_url: longUrl,
    domain: "bit.ly"
  })
})
```

### 4. Passenger DDP

```javascript
ddp.call('passenger.url.shorten', {
  url: "https://very-long-url.com/..."
})
// Returns: { shortUrl, clicks, expires }
```

## UI

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

## Click Tracking

If supported by provider:
```javascript
{
  shortUrl: "https://koad.io/abc123",
  originalUrl: "https://...",
  clicks: 42,
  created: "2024-01-15"
}
```

## Settings

```javascript
{
  "shortener": {
    "provider": "isgd",   // isgd | vgd | bitly | passenger
    "apiKey": "",
    "domain": ""         // custom domain for bitly
  }
}
```

## Implementation Files

- Popup UI: `dist/panes/popup/shortener.js`
- Background: `dist/background/url-shortener.js`
