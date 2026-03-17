# Technical Specification: Passenger & Skill Registry

## Overview

System for detecting passengers, managing their configuration, and providing skills/augments to the browser extension.

## Daemon Implementation

### Detection
1. Scan `~/*` folders for entities with `.env` containing `KOAD_IO_`
2. Read `passenger.json` from each entity folder
3. Store in `Passengers` MongoDB collection

### DDP Methods

| Method | Params | Returns |
|--------|--------|---------|
| `passenger.check.in` | `[name]` | `{ success, passenger }` |
| `passenger.check.out` | `[]` | `{ success }` |
| `passenger.reload` | `[]` | `{ success, count }` |
| `passenger.ingest.url` | `[payload]` | `{ success }` |
| `passenger.get.skills` | `[request]` | `{ skills }` |
| `passenger.get.augments` | `[request]` | `{ augments }` |
| `passenger.resolve.identity` | `[request]` | `{ found, identity }` |
| `passenger.check.url` | `[request]` | `{ warning, level, ... }` |
| `passenger.summarize` | `[request]` | `{ summary, keyPoints, ... }` |

### DDP Subscriptions

- `passengers` - with params `["all"]` or `["current"]`

## Passenger JSON Schema

```json
{
  "handle": "alice",
  "name": "Alice",
  "avatar": "avatar.png",
  "outfit": {
    "hue": 12,
    "saturation": 6,
    "brightness": 15
  },
  "buttons": [
    {
      "key": "icon-key",
      "label": "Button Label",
      "action": "action.type",
      "target": "action-target"
    }
  ],
  "ddp": {
    "host": "10.10.10.10",
    "port": 3000,
    "ssl": false
  },
  "sidebar": {
    "url": "https://alice.koad.sh/sidebar",
    "match": "github.com/*",
    "width": 400
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `handle` | string | Unique identifier |
| `name` | string | Display name |
| `avatar` | string | Path to avatar image |
| `outfit` | object | Visual customization (hue, saturation, brightness) |
| `buttons` | array | List of skills/actions |
| `ddp` | object | Custom DDP endpoint |
| `sidebar` | object | Custom sidebar config |

## DDP Method Payloads

### passenger.ingest.url

**Payload**:
```json
{
  "url": "https://github.com/koad/io",
  "title": "koad/io",
  "timestamp": "2024-01-15T10:30:00Z",
  "domain": "github.com",
  "favicon": "https://github.com/favicon.ico"
}
```

### passenger.resolve.identity

**Request**:
```json
{
  "domain": "github.com",
  "url": "https://github.com/koad"
}
```

**Response (found)**:
```json
{
  "found": true,
  "identity": {
    "name": "Koad",
    "avatar": "https://...",
    "proof": {
      "type": "dns",
      "value": "koad.io",
      "verified": true
    },
    "gpg": "https://keybase.io/koad/key.asc",
    "social": {
      "github": "koad",
      "twitter": "koad_io"
    }
  }
}
```

**Response (not found)**:
```json
{
  "found": false
}
```

### passenger.get.skills

**Request**:
```json
{
  "domain": "github.com",
  "url": "https://github.com/koad/io",
  "title": "koad/io"
}
```

**Response**:
```json
{
  "skills": [
    {
      "id": "github:pr:review",
      "label": "Open PR Review",
      "icon": "github",
      "action": "open.url",
      "target": "https://github.com/pulls"
    },
    {
      "id": "github:repo:stats",
      "label": "View Stats",
      "icon": "chart",
      "action": "call.ddp",
      "method": "github.getStats",
      "args": { "repo": "koad/io" }
    }
  ]
}
```

### passenger.get.augments

**Request**:
```json
{
  "domain": "github.com",
  "url": "https://github.com/koad/io",
  "title": "koad/io"
}
```

**Response**:
```json
{
  "augments": [
    {
      "name": "GitHub PR Notifier",
      "type": "script",
      "code": "console.log('PRNotifier loaded');",
      "runAt": "document_end"
    },
    {
      "name": "Dark Theme",
      "type": "style",
      "code": ".body { background: #0d0d0d; }"
    }
  ]
}
```

### passenger.summarize

**Request**:
```json
{
  "url": "https://article.com/interesting-post",
  "title": "Interesting Post Title",
  "content": "Full article text content extracted from the page...",
  "text": "Stripped innerText of main content..."
}
```

**Response**:
```json
{
  "summary": "This article discusses the benefits of...",
  "keyPoints": [
    "First key point about the topic",
    "Second important finding",
    "Third takeaway"
  ],
  "sentiment": "positive",
  "wordCount": 500
}
```

### passenger.check.url

**Request**:
```json
{
  "domain": "example-scam-store.com",
  "url": "https://example-scam-store.com/buy-cheap-iphone"
}
```

**Response (warning found)**:
```json
{
  "warning": true,
  "level": "danger",
  "title": "Known Scam Domain",
  "message": "This domain is operated by scammers...",
  "source": "Alice's threat database",
  "references": [
    "https://scamtracker.example/report/123"
  ]
}
```

**Response (safe)**:
```json
{
  "warning": false,
  "safe": true
}
```

**Warning Levels**:
- `info` - Informational notice
- `warning` - Proceed with caution
- `danger` - Do not proceed
- `critical` - Immediate threat

## Button/Skill Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique skill ID |
| `key` | string | Icon key |
| `label` | string | Button label |
| `icon` | string | Icon name |
| `action` | string | Action type |
| `target` | string | Action target |

### Action Types

| Action | Description |
|--------|-------------|
| `open.url` | Open a URL |
| `call.ddp` | Call a DDP method |
| `inject.script` | Inject a script |
| `inject.css` | Inject stylesheet |
| `copy.to.clipboard` | Copy text |
| `open.pwa` | Open Chrome PWA |
| `open.with.default.app` | Open with system app |

### Dynamic Skill Loading

Skills can load remote code:

```json
{
  "key": "github",
  "label": "GitHub",
  "action": "inject.script",
  "target": "https://raw.githubusercontent.com/koad/alice/main/browser/github.js"
}
```

## Sidebar Configuration

```json
{
  "sidebar": {
    "url": "https://alice.koad.sh/sidebar",
    "match": "github.com/*",
    "width": 400
  }
}
```

### Conflict Resolution

When multiple passengers specify a sidebar:
1. User configures priority in settings
2. Higher-priority passenger wins
3. User can manually switch

## Settings

```javascript
{
  "passenger": {
    "autoSelect": true,
    "showOutfit": true,
    "loadRemoteSkills": true
  }
}
```

## Content Extraction

Before summarization:
1. Strip HTML → plain text
2. Extract main content (article body)
3. Remove ads/navigation
4. Send to passenger

## Implementation Files

- Daemon: `daemon/packages/passengers/server/`
- Extension popup: `dist/panes/popup/passengers.js`
- Background: `dist/background/passenger-registry.js`
- Storage: `dist/lib/passenger-storage.js`
