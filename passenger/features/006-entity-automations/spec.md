# Technical Specification: Entity Automations

## Overview

Rules-based automation that watches webpages and triggers entity actions.

## Automation Rules

### Rule Structure
```javascript
{
  _id: ObjectId,
  name: String,
  enabled: Boolean,
  trigger: {
    type: "page.load" | "element.appear" | "element.change" | "form.submit",
    domain: String,           // e.g., "github.com"
    path: String,             // e.g., "/repos/*"
    selector: String,         // CSS selector for element triggers
    condition: Object         // optional JS condition
  },
  action: {
    type: "emit.event" | "capture.data" | "inject.script" | "notify",
    payload: Object
  },
  passenger: String,
  createdAt: Date
}
```

## Trigger Types

| Type | Description |
|------|-------------|
| page.load | Page finishes loading |
| element.appear | Element appears in DOM |
| element.change | Element value changes |
| form.submit | Form is submitted |

## Action Types

| Type | Description |
|------|-------------|
| emit.event | Send event to entity via DDP |
| capture.data | Store data to entity database |
| inject.script | Run JavaScript in page context |
| notify | Send Chrome notification |

## Content Script Injection

### Manifest Configuration
```json
{
  "content_scripts": [
    {
      "matches": ["*://*.github.com/*"],
      "js": ["dist/workers/inject/automation.js"],
      "run_at": "document_end"
    }
  ]
}
```

### Communication
```
Content Script ──message──► Background ──DDP──► Daemon ──► Entity
```

## Implementation Files

- Content script: `dist/workers/inject/automation.js`
- Background handler: `dist/background/automation-runner.js`
- Rule storage: `dist/lib/automation-rules.js`
