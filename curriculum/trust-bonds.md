---
slug: trust-bonds
title: Trust bonds and bond gate
shortTitle: Bonds
level: Moderate
difficulty: 25
blurb: How signed relationship files and runtime checks define executable authority.
hypothesis: Authority must be enforced by the substrate, not requested from the model.
---

## Hypothesis

Authority must be enforced by the substrate, not requested from the model.

## Problem

Prompt rules are not permission systems. A model can be asked to obey boundaries, but executable authority needs to be checked before tool use.

## Solution served by koad:io

Trust bonds are signed relationship files. The bond gate reads active bonds and blocks tools, paths, and dispatches outside granted scope.

## Technical model

- Bond files declare relationship and scope.
- GPG signatures make authorization verifiable.
- Tool lanes map scope to read, write, exec, and typed actions.

## Install / setup path

1. Create the narrowest useful bond.
2. Sign it with the granting identity.
3. Run authorized and unauthorized actions.

## Verification

In-scope actions pass; out-of-scope actions fail before execution.
