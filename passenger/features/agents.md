# Agent Guide: Dark Passenger Development

This file explains how to work on the Dark Passenger codebase.

---

## What is Dark Passenger?

Dark Passenger is a **Chrome extension** that serves as the browser integration layer for the **koad:io** ecosystem. It's an entity that "rides along" with you through the web.

**Key concepts:**
- **Passengers**: Entities that can accompany you while browsing
- **Skills**: Actions/buttons passengers provide for specific websites
- **Augments**: Scripts/styles injected into pages
- **DDP**: Real-time communication with the local koad:io daemon

---

## Project Structure

```
passenger/
├── features/                 # Feature specifications
│   ├── README.md             # Overview of all features
│   ├── work-in-progress.md   # Current priorities
│   ├── 001-ddp-connection/
│   │   ├── README.md         # Feature overview
│   │   ├── spec.md           # Technical specification
│   │   └── progress.md       # Implementation progress
│   └── ...
│
├── src/                      # Source code
│   ├── server/               # Daemon-side code
│   └── ...                  # Extension source
│
├── dist/                    # Built extension
│   ├── manifest.json        # Extension manifest
│   ├── background/          # Background scripts
│   ├── panes/               # UI panels (popup, settings)
│   │   ├── popup/           # Toolbar popup
│   │   └── settings/        # Options page
│   └── workers/             # Content scripts
│
├── theme/                   # Extension theme assets
└── config/                 # Configuration
```

---

## Feature Structure

Each feature lives in its own folder under `features/`:

```
features/019-web-search/
├── README.md     # What the feature does (overview)
├── spec.md       # Technical implementation details
└── progress.md   # What needs to be done
```

### Files Explained

| File | Purpose |
|------|---------|
| `README.md` | High-level overview - what, why, key concepts |
| `spec.md` | Technical details - APIs, data structures, UI layouts |
| `progress.md` | Todo list - what's done, what's remaining |

---

## How Features Are Organized

Features are numbered (001-022+) and have status indicators:

| Status | Meaning |
|--------|---------|
| ✅ Complete | Fully implemented |
| 🔄 In Progress | Being developed |
| 🔲 Not Started | Not yet implemented |

---

## Implementing a New Feature

### Step 1: Create Feature Folder

```bash
cd /home/koad/.koad-io/passenger/features
mkdir -p 022-new-feature-name
```

### Step 2: Create README.md

```markdown
# Feature: New Feature Name

## Summary
One sentence description

## Problem
Why is this needed?

## Solution
How it works

## Status
- [ ] Not started
```

### Step 3: Create spec.md

Include:
- DDP methods (if any)
- Data structures
- UI mockups
- Storage schemas
- Implementation file locations

### Step 4: Create progress.md

```markdown
# Progress: New Feature Name

## Status: 🔲 Not Started

## To Do
- [ ] Task 1
- [ ] Task 2

## Dependencies
- Feature: 008-passenger-skill-registry.md
```

### Step 5: Implement

Write code in `src/` or `dist/`, then update progress.md.

---

## Important Conventions

### File Naming
- Feature folders: `###-feature-name/` (e.g., `019-web-search/`)
- Feature files: lowercase with dashes

### DDP Methods
- Use Meteor DDP protocol
- Methods: `passenger.methodName`
- Subscriptions: `passenger.subscriptionName`

### Storage
- Use `chrome.storage.sync` for settings
- Use `chrome.storage.local` for large data

### Manifest V3
- Use service workers for background
- Use declarativeNetRequest for blocking

---

## Key Files

### Extension Entry Points
- `dist/manifest.json` - Extension manifest
- `dist/background/index.js` - Service worker
- `dist/panes/popup/index.html` - Popup UI
- `dist/panes/settings/index.html` - Settings page

### Feature-Specific
- Check each feature's `spec.md` for implementation file locations

---

## Testing

1. Load unpacked extension in Chrome
2. Enable "Developer mode" in chrome://extensions
3. Click "Load unpacked"
4. Select the `dist` folder

---

## Common Tasks

### Add a New Button to Popup
1. Edit `dist/panes/popup/index.html`
2. Add button HTML
3. Add handler in `dist/panes/popup/logic.js`

### Add a DDP Method
1. Add to daemon's method handlers
2. Document in feature's `spec.md`
3. Add to extension's DDP client

### Add Content Script
1. Add to `manifest.json` under `content_scripts`
2. Create script in `dist/workers/inject/`
3. Communicate via `chrome.runtime.sendMessage`

---

## Dependencies Between Features

```
008 Passenger & Skill Registry  ← Many features depend on this
├── 009 Passenger Settings
├── 011 Community Chat Rooms
├── 012 Community Notes
├── 013 Augment Management
├── 015 Passenger Notifications
├── 016 Activity Log
└── 021 Send to Device
```

**Before implementing features that depend on 008, ensure 008's extension-side code is working.**

---

## Keeping Documentation Up to Date

**THIS IS MANDATORY.** As you work, you must update these files to reflect your progress:

### 1. Feature's progress.md

Update after each task:
```markdown
## Status: 🔄 In Progress

## To Do
- [x] Task 1 just completed
- [ ] Task 2

## Completed
- [x] Task 1 - did this
- [x] Another thing that works now
```

### 2. Feature's README.md

Update status when feature is complete:
```markdown
## Status

- [x] Completed  (was [ ] Not Started)
```

### 3. features/work-in-progress.md

When starting a new feature:
- Move it from "Features That Can Be Built Now" to "Completed"
- Note what was implemented

When finishing:
- Mark as complete in the list

### 4. features/README.md

Update feature status when complete:
```markdown
| 019 | Web Search | ✅ Complete |  # was 🔲 Not Started
```

### 5. agents.md (this file)

If you discover new conventions, dependencies, or patterns, update this file to help future agents.

---

## Rules

1. **Never leave stale data** - If you complete a task, mark it done
2. **Never leave "In Progress" if blocked** - If blocked, note the blocker in progress.md
3. **Always update before finishing session** - Don't leave without updating
4. **Be specific** - "Fixed login button" not "Made progress"

---

## Sovereign Profiles Feature (022)

Feature 022 implements a self-sovereign identity system with:

- **GPG Key Generation**: Using kbpgp-js library
- **Social Proofs**: DNS TXT, URL, keybase, github, x, youtube, twitch, substack, myspace
- **Profile Structure**: Matches `koads-profile-as-an-example.json` format
- **Navigation**: Shows "Sovereign: {name}" when profile is active

### Routes

| Route | Template | Purpose |
|-------|----------|---------|
| `/profiles.html` | SovereignProfiles | List all profiles |
| `/profiles/new.html` | ProfileEditor | Create new profile |
| `/profiles/edit.html?id=xxx` | ProfileEditor | Edit profile |
| `/profiles/sign.html` | SignMessage | Sign message |
| `/profiles/verify.html` | VerifyMessage | Verify signature |

### Package Structure

```
src/packages/koad-io-sovereign-profiles/
├── package.js
├── lib/
│   ├── crypto.js      # Key generation using kbpgp
│   ├── proofs.js     # Social/domain proof creation
│   └── messages.js   # Signed message handling
└── client/
    ├── templates.html
    ├── styles.css
    └── logic.js
```

### Profile Data Structure

```javascript
{
  _id, name, handle, bio, location, emitter: "koad.sh",
  keys: [{ _id, public, fingerprint, sixty4bit, proof, type, url }],
  domains: [{ _id, handle, type, url, proof }],
  socials: [{ _id, type, handle, url, proof }],
  addresses: [{ _id, type, network, address, proof }]
}
```

### Adding New Features as Packages

1. Create package in `src/packages/koad-io-{feature-name}/`
2. Add to `.meteor/packages` file
3. Use existing patterns:
   - `templating` for templates
   - `koad:io-router` for routes
   - `koad:io-session` for session state

---

## Checking Work-In-Progress

Before starting work, check:
1. `features/work-in-progress.md` - What to work on next
2. Feature's `progress.md` - What's done and remaining
3. Feature's `spec.md` - Technical details

---

## Need Help?

- Check `features/README.md` for feature overview
- Check the specific feature folder for details
- Check the daemon codebase for DDP methods
