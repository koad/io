# Progress: URL Shortener

## Status: 🔲 Not Started

## To Do

- [ ] Implement is.gd/v.gd integration
- [ ] Add passenger DDP method support
- [ ] UI in popup
- [ ] Context menu option
- [ ] Click tracking display

## Shortener Options

### 1. Passenger DDP

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

| Provider | URL Template |
|----------|--------------|
| is.gd | `https://is.gd/create.php?url={url}` |
| v.gd | `https://v.gd/create.php?url={url}` |
| bit.ly | `https://api-ssl.bitly.com/v4/shorten` |

## Settings

```json
{
  "shortener": {
    "provider": "isgd",
    "apiKey": "..."
  }
}
```

## Dependencies

- Feature: 010-core-passenger-features (for popup UI)

## Notes

Simple utility feature - can use free is.gd API without registration.
