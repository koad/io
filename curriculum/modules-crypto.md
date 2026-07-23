---
slug: modules-crypto
title: Modules, crypto, and verification
shortTitle: Crypto
level: Advanced
difficulty: 60
blurb: How shared modules, crypto helpers, sigchains, and merkle structures support identity and verification.
hypothesis: Sovereign systems need proofs that can outlive the current runtime.
---

## Hypothesis

Sovereign systems need proofs that can outlive the current runtime.

## Problem

Runtime state can lie, disappear, or be replayed without context. Sovereign operations need identity and verification primitives outside a single app process.

## Solution served by koad:io

Shared modules provide identity, crypto, sigchain, merkle, and BIP39 utilities that commands and packages can reuse.

## Technical model

- `modules/` exposes shared Node primitives.
- Keys identify entities and commitments.
- Sigchains and merkle structures support witnessed history.

## Install / setup path

1. Use shared modules instead of app-local crypto.
2. Generate or load local keys.
3. Sign and verify one commitment.

## Verification

A proof should remain checkable without trusting the UI that created it.
