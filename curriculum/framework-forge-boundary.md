---
slug: framework-forge-boundary
title: Framework vs forge boundary
shortTitle: Boundary
level: Advanced
difficulty: 48
blurb: How generic runtime stays in ~/.koad-io while kingdom business lives in overlays.
hypothesis: The skeleton stays clean so kingdoms can diverge without corrupting the framework.
---

## Hypothesis

The skeleton stays clean so kingdoms can diverge without corrupting the framework.

## Problem

When business logic leaks into the generic framework, every kingdom inherits assumptions that only one kingdom needed.

## Solution served by koad:io

`~/.koad-io` holds generic runtime. `~/.forge` holds kingdom business overlays. Entities hold identity and operating memory.

## Technical model

- Framework: runtime, commands, packages, daemon, harness.
- Forge: products, websites, business commands, app packages.
- Entity: identity, memory, skills, trust relationships.

## Install / setup path

1. Put generic reusable shapes in framework.
2. Put business implementation in forge.
3. Put role memory in entity directories.

## Verification

Another kingdom should be able to use the framework without inheriting your business.
