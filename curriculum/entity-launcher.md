---
slug: entity-launcher
title: Entity launcher and PATH
shortTitle: Launcher
level: Basic
difficulty: 8
blurb: How ~/.koad-io/bin/<entity> sets ENTITY and enters the framework command router.
hypothesis: An entity begins with a tiny launcher that gives the command cascade identity.
---

## Hypothesis

An entity begins with a tiny launcher that gives the command cascade identity.

## Problem

Without a launcher, tools run as anonymous shell commands. They do not know which entity is acting, which home directory owns context, or which trust boundaries apply.

## Solution served by koad:io

Each entity gets a launcher in `~/.koad-io/bin`. The launcher sets `ENTITY` and delegates to `koad-io`, which runs the cascade and command resolver.

## Technical model

- `~/.koad-io/bin/juno` sets `ENTITY=juno`.
- `~/.koad-io/bin` belongs on `PATH`.
- `koad-io` sanitizes stale environment and rebuilds context.

## Install / setup path

1. Add `~/.koad-io/bin` to `PATH`.
2. Gestate or install an entity launcher.
3. Run the entity name from a terminal.
4. Verify `ENTITY` and `ENTITY_DIR` resolve correctly.

## Verification

Typing the entity name should enter the kingdom through that entity's identity.
