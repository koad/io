---
slug: package-dirs
title: Package dirs and METEOR_PACKAGE_DIRS
shortTitle: Package dirs
level: Advanced
difficulty: 55
blurb: How package search paths let framework, forge, and domain packages compose into app shells.
hypothesis: Reusable application behavior depends on a declared package path.
---

## Hypothesis

Reusable application behavior depends on a declared package path.

## Problem

Packages cannot compose if apps do not know where framework, forge, and domain packages live.

## Solution served by koad:io

The command cascade resolves `KOAD_IO_PACKAGE_DIRS` and exports `METEOR_PACKAGE_DIRS` so Meteor apps see the same package universe.

## Technical model

- `KOAD_IO_PACKAGE_DIRS` is the kingdom package search path.
- `METEOR_PACKAGE_DIRS` mirrors it for Meteor.
- Framework packages, forge packages, and domain packages can compose.

## Install / setup path

1. Set package dirs in the environment cascade.
2. Add a package to an app's `.meteor/packages`.
3. Start the app through the launcher.

## Verification

Meteor should resolve packages from all declared package roots.
