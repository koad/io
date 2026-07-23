---
slug: skeletons-gestation
title: Skeletons and gestation
shortTitle: Gestation
level: Advanced
difficulty: 45
blurb: How starter shapes and gestation commands create new entities and project surfaces.
hypothesis: New sovereign units should be born from repeatable skeletons.
---

## Hypothesis

New sovereign units should be born from repeatable skeletons.

## Problem

Copying an old entity or app by hand preserves mistakes and misses required identity, config, and launch surfaces.

## Solution served by koad:io

Skeletons provide starter shapes. Gestation commands create new entities with launchers, identity files, keys, and expected directory structure.

## Technical model

- `skeletons/` holds starter project shapes.
- `commands/gestate/entity` creates entities.
- `commands/init/*` initializes kingdom and entity forms.

## Install / setup path

1. Pick the right skeleton.
2. Run gestation/init.
3. Inspect generated identity, launcher, and directories.
4. Commit the new sovereign unit.

## Verification

A new entity should be runnable through the normal cascade immediately.
