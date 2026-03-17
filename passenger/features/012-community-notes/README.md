# Feature: Community Notes (Entity-Based)

## Summary

A note-taking system about domains/URLs. Can be community-driven or personal - works for individuals or groups.

## Problem

- Single entities can't know everything about every domain
- Twitter-style community notes but owned by entities
- Entity owners can publish notes others can trust
- **Individual use**: Leave personal notes for yourself about URLs you visit

## Personal vs Community

### Personal Notes (Single User)

Even a single user can benefit:
- "Bought marijuana strain X - didn't like it"
- "This is my login page for bank"
- "Good article, read later"
- "Avoid this site - spam"

Notes are stored locally and only visible to you.

### Community Notes (Shared)

Multiple users share note repositories:
- Entity owners publish notes via git
- Others add trusted repos in settings
- Notes merged from all sources

## Solution

Entity owners maintain git repositories with JSON notes. Users add trusted repos in settings. Notes are fetched and displayed alongside warnings.

## Implementation

### Repository Structure

Each entity publishes a notes repo with this structure:

```
/notes
  /domains
    github.com.json
    example-scam.com.json
  /urls
    https-github-com-koad-io.json
```

### Note Schema

```json
{
  "domain": "example-scam.com",
  "note": "Fake Apple store selling iPhones at 90% discount. Do not buy.",
  "severity": "danger",
  "category": "scam",
  "author": "alice",
  "entity": "alice",
  "created": "2024-01-15T10:30:00Z",
  "updated": "2024-01-20T15:00:00Z",
  "references": [
    "https://scamtracker.example/report/123"
  ],
  "votes": {
    "up": 150,
    "down": 2
  },
  "status": "verified",
  "visibility": "personal"  // "personal" or "community"
}
```

### Personal Note Example

```json
{
  "domain": "weed-delivery.com",
  "note": "Bought strain X - too harsh, prefer Y instead",
  "severity": "info",
  "category": "personal",
  "author": "koad",
  "entity": "alice",
  "visibility": "personal"
}
```

### Note with Selected Text

Notes can include the specific text on the page being referenced:

```json
{
  "domain": "weed-delivery.com/strains/sour-diesel",
  "url": "https://weed-delivery.com/strains/sour-diesel",
  "note": "Tried this - very harsh, prefer GG4 instead",
  "selectedText": "Sour Diesel - known for its pungent diesel-like smell",
  "severity": "info",
  "category": "personal",
  "author": "koad",
  "entity": "alice",
  "visibility": "personal"
}
```

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Full URL (optional if domain) |
| `selectedText` | string | The exact text this note references |
| `quote` | string | Quoted text from the page |

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `domain` | string | Target domain |
| `note` | string | The note content |
| `severity` | string | info/warning/danger/critical |
| `category` | string | scam/fake-news/phishing/malware/spam/legit |
| `author` | string | Author's handle |
| `entity` | string | Entity name |
| `status` | string | unverified/pending/verified/disputed |

### Settings Configuration

In extension settings, users add trusted note repositories:

```json
{
  "noteSources": [
    {
      "entity": "alice",
      "url": "https://github.com/koad/alice-notes",
      "enabled": true,
      "trustLevel": "high"
    }
  ],
  "personalNotes": {
    "enabled": true,
    "storage": "local"
  }
}
```

### Local Storage for Personal Notes

Personal notes have two storage options:

**Option 1: Chrome Storage (Default)**
- Stored in `chrome.storage.local`
- Only visible to you
- No network required

**Option 2: Passenger DDP Connection**
- If a passenger with DDP is selected, notes can sync to the entity
- Provides backup and cross-device sync
- Configure in settings:

```json
{
  "personalNotes": {
    "storage": "passenger",  // or "local"
    "passenger": "alice"
  }
}
```

When `storage: "passenger"` is set:
- Notes are saved via DDP method `passenger.save.note`
- Synced to the entity's MongoDB
- Available across devices if the entity is networked

```json
{
  "noteSources": [
    {
      "entity": "alice",
      "url": "https://github.com/koad/alice-notes",
      "enabled": true,
      "trustLevel": "high"
    },
    {
      "entity": "maya",
      "url": "https://github.com/maya/security-notes",
      "enabled": true,
      "trustLevel": "medium"
    }
  ]
}
```

### Trust Levels

- `high` - Notes always shown prominently
- `medium` - Notes shown with source attribution
- `low` - Notes shown as community input

### Integration with Warnings

Community notes feed into the warning system (feature 008):

```json
{
  "warning": true,
  "level": "danger",
  "title": "Scam Alert",
  "note": "Fake Apple store...",
  "source": "alice-notes (GitHub)",
  "category": "scam"
}
```

### DDP Method

**Method**: `passenger.get.notes`

**Request**:
```json
{
  "domain": "example-scam.com",
  "url": "https://example-scam.com"
}
```

**Response**:
```json
{
  "notes": [
    {
      "note": "Fake Apple store...",
      "severity": "danger",
      "category": "scam",
      "entity": "alice",
      "status": "verified",
      "trustLevel": "high"
    }
  ]
}
```

## Note Sources (Git Repos)

Users configure trusted note repositories in settings. The extension:
1. Fetches `notes/domains/{domain}.json` from each repo
2. Merges notes from all sources
3. Shows notes with source attribution
4. Higher trust = more prominent display

### DDP Methods (for Passenger Storage)

**Save Note**:
```json
{
  "method": "passenger.save.note",
  "args": {
    "domain": "example.com",
    "note": "My note",
    "visibility": "personal"
  }
}
```

**Load Notes**:
```json
{
  "method": "passenger.get.notes",
  "args": {
    "domain": "example.com"
  }
}
```

## Status

- [ ] Define note JSON schema
- [ ] Define settings schema for note sources
- [ ] Implement note fetching from git repos
- [ ] Implement passenger.get.notes method
- [ ] Integrate with warning system
- [ ] UI for managing note sources

## Related Features

- Feature: 008-passenger-skill-registry.md (warnings)
- Feature: 009-passenger-settings.md
