# koad:io Dark Passenger - Features

This folder contains feature specifications for **Dark Passenger** — the browser entity of the koad:io ecosystem.

## What is Dark Passenger?

Dark Passenger is a **koad:io entity** that lives in Chrome. It's the entity that "rides" with you through the web, carrying your kingdom's other entities across all websites you visit.

## Role: Browser Integration

Dark Passenger serves as the **browser integration layer** for the koad:io ecosystem:
- Enables browser to communicate with local daemon via DDP
- Allows entities to travel with you as you browse
- Provides real-time entity-driven automations
- Enables local-first data capture

## Architecture

```
┌─────────────────────────────────────────┐
│         Chrome Browser                  │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │      Dark Passenger             │    │
│  │      (browser entity)           │    │
│  │                                 │    │
│  │  • DDP Connection (001)        │    │
│  │  • Entity Selector (002)        │    │
│  │  • Local-first Data (003)       │    │
│  │  • Cross-website Memory (004)   │    │
│  │  • Sovereign Identity (005)      │    │
│  │  • Sovereign Profiles (022)      │    │
│  │  • Passenger Auth (023)         │    │
│  └─────────────────┬─────────────────┘    │
└────────────────────┼─────────────────────┘
                     │ DDP
                     ▼
┌─────────────────────────────────────────┐
│            koad:io Daemon               │
│           ~/.koad-io/daemon             │
│                                         │
│  • Entity management                   │
│  • Passenger registry                  │
│  • MongoDB access                      │
└─────────────────────────────────────────┘
```

## Features

Each feature is in its own folder containing:

| File | Description |
|------|-------------|
| `README.md` | Feature specification |
| `progress.md` | Progress tracking & todos |

### Feature Folders

| # | Feature | Status | Folder |
|---|---------|--------|--------|
| 001 | DDP Connection | ✅ | [001-ddp-connection](./001-ddp-connection/) |
| 002 | Entity Selector | ✅ | [002-entity-selector](./002-entity-selector/) |
| 003 | Local-first Data | ✅ | [003-local-first-data](./003-local-first-data/) |
| 004 | Cross-website Memory | ✅ | [004-cross-website-memory](./004-cross-website-memory/) |
| 005 | Sovereign Identity | ✅ | [005-sovereign-identity](./005-sovereign-identity/) |
| 006 | Entity-powered Automations | ✅ | [006-entity-automations](./006-entity-automations/) |
| 007 | Chrome Extension UI | ✅ | [007-chrome-extension-ui](./007-chrome-extension-ui/) |
| 008 | Passenger & Skill Registry | 🔄 | [008-passenger-skill-registry](./008-passenger-skill-registry/) |
| 009 | Passenger Settings | 🔲 | [009-passenger-settings](./009-passenger-settings/) |
| 010 | Core Passenger Features | 🔄 | [010-core-passenger-features](./010-core-passenger-features/) |
| 011 | Community Chat Rooms | 🔲 | [011-community-chat-rooms](./011-community-chat-rooms/) |
| 012 | Community Notes | 🔲 | [012-community-notes](./012-community-notes/) |
| 013 | Augment Management | 🔲 | [013-augment-management](./013-augment-management/) |
| 014 | Read Later | 🔲 | [014-read-later](./014-read-later/) |
| 015 | Passenger Notifications | 🔲 | [015-passenger-notifications](./015-passenger-notifications/) |
| 016 | Activity Log & Cross-Device Sync | 🔲 | [016-activity-log](./016-activity-log/) |
| 017 | Quick Commands | 🔲 | [017-quick-commands](./017-quick-commands/) |
| 018 | Screenshot Capture | 🔲 | [018-screenshot-capture](./018-screenshot-capture/) |
| 019 | Web Search | 🔲 | [019-web-search](./019-web-search/) |
| 020 | URL Shortener | 🔲 | [020-url-shortener](./020-url-shortener/) |
| 021 | Send to Device | 🔲 | [021-send-to-device](./021-send-to-device/) |
| 022 | Sovereign Profiles | 🔄 | [022-sovereign-profiles](./022-sovereign-profiles/) |
| 023 | Passenger Auth | 🔄 | [023-passenger-auth](./023-passenger-auth/) |

## Feature Status Legend

- ✅ **Complete** - Fully implemented and working
- 🔄 **In Progress** - Currently being developed
- 🔲 **Not Started** - Planned but not yet implemented

## Folder Structure

Each feature folder contains:

```
📁 008-passenger-skill-registry/
   ├── README.md     # Feature specification
   └── progress.md  # Progress tracking
```

## Adding a New Feature

1. Create new folder with 3-digit prefix (e.g., `023-`)
2. Add `README.md` with feature specification
3. Add `progress.md` with todo items
4. Update this README

## Feature Template

See any existing feature folder for examples.
