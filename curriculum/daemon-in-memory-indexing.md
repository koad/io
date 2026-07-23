---
slug: daemon-in-memory-indexing
title: The daemon as in-memory index and event emitter
shortTitle: Daemon index
level: Moderate
difficulty: 33
blurb: How the daemon turns filesystem facts and runtime signals into a volatile live index, then emits events for the rest of the kingdom to observe.
hypothesis: The daemon should remember what is happening right now without becoming the source of truth.
---

## Hypothesis

The daemon should remember what is happening right now without becoming the source of truth.

## Problem

Files are durable, auditable, and sovereign, but they are not enough for live coordination. A filesystem can preserve what happened, but it does not automatically answer: who is online, what just changed, what is flying now, what session opened, what signal should observers react to?

Traditional systems solve this by making a central database the authority. That creates a new dependency: the live database becomes the source of truth, and the filesystem becomes secondary.

## Solution served by koad:io

koad:io uses the daemon as a volatile live index and event emitter. It watches, scans, receives, and summarizes current kingdom state, then publishes signals outward as emissions, DDP records, HTTP read views, and operational pulse.

The daemon is not the truth. The files, bonds, keys, sessions, commits, and logs remain the durable truth. The daemon is the nervous system: fast, reactive, rebuildable, and allowed to forget because it can re-index from source.

## Technical model

- In-memory indexes summarize entities, bonds, sessions, flights, services, questions, and emissions.
- Scanners read durable source material from disk or runtime registries.
- DDP publications expose live collections to clients.
- HTTP endpoints provide read-only status surfaces.
- Emissions broadcast operational events as they happen.
- Restarting the daemon should rebuild live state from source rather than corrupting truth.

## Install / setup path

1. Start the daemon through the framework start/upstart path.
2. Confirm it indexes entities, services, sessions, flights, and emissions.
3. Trigger a small event: session open, emission, dispatch, or status change.
4. Observe the event through status tools, DDP, or the storefront.
5. Restart the daemon and confirm durable facts are re-indexed.

## Verification

The daemon should make current state visible quickly, emit events when state changes, and remain disposable: if it restarts, the durable kingdom should survive and the live index should rebuild.
