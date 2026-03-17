# Dark Passenger

> "The dark-passenger rides with you."

Dark Passenger is a **docking-port for your koad:io entities** that lives in your browser. It's not just a Chrome extension — it's a portal that brings your kingdom's entities into the web, enabling them to interact with you at a browser-tab level and allowing the entities to augment and enhance webpages and experiences as you browse.

## What is an Entity?

In koad:io, an **entity** is a focused agent that lives in your kingdom (`~/.koad-io/`) and accomplishes specific goals. Entities have a `passenger.json` file that defines their browser capabilities.

## Dark Passenger

Dark Passenger is the browser docking-port — it carries your entities (like Alice, Maya, etc.) with you as you surf the web, allowing them to observe, react, and enhance your browsing experience.

### Passenger Configuration

Each entity can define a `passenger.json` in their home folder (`~/.alice/passenger.json`):

```json
{
  "handle": "alice",
  "name": "Alice",
  "avatar": "avatar.png",
  "outfit": { "hue": 12, "saturation": 6, "brightness": 15 },
  "buttons": [
    { "key": "cross", "label": "Home", "action": "open.pwa", "target": "..." },
    { "key": "coffin-cross", "label": "File", "action": "open.with.default.app", "target": "..." }
  ]
}
```

### Daemon Integration

Dark Passenger connects to `~/.koad-io/daemon` which:

The extension connects to `~/.koad-io/daemon` via DDP (Meteor's Distributed Data Protocol):

- **Connection**: WebSocket to `127.0.0.1:28282`
- **Background worker**: `dist/background/ddp-connection.js`
- **Methods called**:
  - `passenger.check.in` - Check in a passenger
  - `passenger.sign.in` - Sign in with entity credentials
  - `passenger.check.duty` - Check which entity is on duty

### Extension Structure

```
passenger/
├── src/
│   ├── private/              # Static files copied to dist
│   │   ├── manifest.json      # Chrome extension manifest
│   │   ├── global/            # Scripts running on all pages
│   │   ├── workers/           # Site-specific modules
│   │   └── ...
│   └── ...                    # Meteor app source
├── dist/                      # Built extension (loaded in Chrome)
├── commands/                  # Build commands
└── config/                    # Configuration
```

### How the Build Works

1. Meteor builds the server bundle → `builds/`
2. `meteor-build-client` extracts client JS/CSS → `bundles/`
3. Build script stitches files + copies `src/private/*` → `dist/`

**This is implementation detail.** Developers should focus on features, not the build pipeline.

## Features

### Global Content Script
- File: `src/private/global/logic.js`
- Runs on every page (`<all_urls>`)
- Currently adds shift+click to remove elements

### Site Workers

Site-specific modules that provide custom functionality for particular web services.

**Current approach** (hardcoded):
- Location: `src/private/workers/`
- Each subdirectory is a site-specific module
- Currently includes: GitHub, Twitter, YouTube, Facebook, Discord, Spotify, Telegram, etc.

**Future approach** (dynamic):
- Workers are defined in `passenger.json` via `buttons` with `action: "inject.script"`
- Code is loaded remotely from entity repositories
- Example: Alice's GitHub worker could come from `https://raw.githubusercontent.com/koad/alice/main/browser/github.js`

### Background Service Worker
- Location: `dist/background/`
- `index.js` - Main service worker
- `ddp-connection.js` - DDP client for daemon communication

### UI Components
- **Popup**: `panes/popup/`
- **Side Panel**: `panes/panel/`
- **Settings**: `panes/settings/`
- **New Tab**: Overrides Chrome's new tab page

### Content Script Injections
Defined in `manifest.json` under `content_scripts`:
- Global styles + logic on all pages
- YouTube preview button
- ChatGPT conversation copier
- Site-specific modifications

## Configuration

- `.env` - Environment variables
- `config/wonderland.json` - Runtime config (public settings)

## Getting Started

1. Start the daemon: `koad-io setup daemon`
2. Build the extension: `koad-io passenger build`
3. Load in Chrome: `chrome://extensions` → Developer Mode → Load unpacked → `~/.koad-io/passenger/dist`

## Adding a New Feature

Features should be documented in the `features/` folder. Each feature should include:
- What it does
- How it works
- Configuration options (if any)
