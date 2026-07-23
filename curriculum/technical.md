---
slug: technical
title: Governed entity runtime
shortTitle: Runtime
level: Moderate
difficulty: 40
blurb: How to install an entity runtime where identity, memory, tool access, and dispatch authority are bounded by files.
hypothesis: Governance must be structural, not prompt-based.
---

## Hypothesis

Governance must be structural, not prompt-based.

## Problem

Most agent runtimes treat tool use as an application concern: the model receives tools, the prompt describes policy, and the app hopes the agent stays inside the lines.

## Solution served by koad:io

koad:io runs entities through a harness that loads identity, workspace context, memories, skills, trust bonds, and tool permissions before work begins.

## Technical model

1. Environment cascade.
2. Bond gate.
3. Command system.
4. Dispatch substrate.
5. Audit trail.

## Install / setup path

1. Install koad:io.
2. Initialize an entity.
3. Define read, write, exec, and tool lanes through trust bonds.
4. Add commands for approved actions.
5. Start a harness session and verify permitted tools.

## Verification

Authorized work completes; blocked paths and ungranted tools fail before execution.
