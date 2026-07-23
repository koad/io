---
slug: sovereign
title: Keys and ownership
shortTitle: Sovereignty
level: Basic
difficulty: 20
blurb: How local keys, trust bonds, and git-backed identity prevent agent ownership from collapsing into platform tenancy.
hypothesis: Not your keys, not your agent.
---

## Hypothesis

Not your keys, not your agent.

## Problem

Platform agents borrow identity from the platform that hosts them. The platform issues credentials, stores state, defines permissions, and can revoke access.

## Solution served by koad:io

koad:io makes the entity a directory on hardware you control. Identity is declared in files. Keys are generated and stored locally. Trust bonds are signed files. History is git-backed.

## Technical model

- Local key material.
- GPG-clearsigned trust bonds.
- Bond gate enforcement.
- Git history.
- Optional chain witness.

## Install / setup path

1. Create an entity directory on owned hardware.
2. Generate entity keys locally.
3. Write the identity file.
4. Sign an initial trust bond.
5. Run a session and confirm the bond gate exposes only authorized tools.

## Verification

The entity's identity and authorization should survive without a platform account.
