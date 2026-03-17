# koad:io Daemon - Features

This folder contains feature specifications for the koad:io Daemon.

## Role: Central Hub

The daemon serves as the **central hub** for the koad:io ecosystem:
- Manages entities and their cryptographic identities
- Coordinates network communication via ZeroTier
- Handles process and database management
- Serves UI to desktop and admin interfaces
- Registers and manages passengers

## Architecture

```
┌─────────────────────────────────────────┐
│           koad:io Desktop               │
│       ~/.koad-io/desktop                │
└─────────────────┬───────────────────────┘
                  │ DDP / HTTP
                  ▼
┌─────────────────────────────────────────┐
│            koad:io Daemon               │
│           (this folder)                  │
│                                         │
│  • Entity management (001)              │
│  • Distributed network (002)            │
│  • ZeroTier integration (003)           │
│  • Process management (004)              │
│  • MongoDB management (005)              │
│  • UI serving (006)                      │
│  • Passenger registry (007)              │
└─────────────────┬───────────────────────┘
                  │
         ZeroTier VPN
                  │
                  ▼
┌─────────────────────────────────────────┐
│         koad:io Passengers              │
│       (~/.koad-io/passenger)            │
└─────────────────────────────────────────┘
```

## Features

| # | Feature | Status | File |
|---|---------|--------|------|
| 001 | Entity Management | ✅ Implemented | [001-entity-management.md](./001-entity-management.md) |
| 002 | Distributed Network | ✅ Implemented | [002-distributed-network.md](./002-distributed-network.md) |
| 003 | ZeroTier Integration | ✅ Implemented | [003-zerotier-integration.md](./003-zerotier-integration.md) |
| 004 | Process Management | ✅ Implemented | [004-process-management.md](./004-process-management.md) |
| 005 | MongoDB Management | ✅ Implemented | [005-mongodb-management.md](./005-mongodb-management.md) |
| 006 | UI Serving | ✅ Implemented | [006-ui-serving.md](./006-ui-serving.md) |
| 007 | Passenger Registry | ✅ Implemented | [007-passenger-registry.md](./007-passenger-registry.md) |

## Feature Status Legend

- ✅ Implemented - Code exists and works
- 🔄 In Progress - Currently being developed
- 🔲 Not Started - Planned but not yet implemented

## Structure

Each feature is documented in its own markdown file with:
- Summary of what the feature does
- Problem it solves
- How it works (solution)
- Implementation details
- Configuration settings
- Status tracking

## Adding a New Feature

1. Create new markdown file with 3-digit prefix (e.g., `008-`)
2. Use the feature template below
3. Update this README

## Feature Template

```markdown
# Feature: [Name]

## Summary
One sentence description

## Problem
Why is this needed?

## Solution
How it works

## Implementation
Technical details

## Settings
- `setting-name`: description (default: value)

## Status
- [ ] Not started
- [ ] In progress
- [ ] Complete

## Related Features
- Feature: 001-entity-management.md
```
