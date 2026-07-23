---
slug: daemon-flights
title: Daemon, emissions, and flights
shortTitle: Daemon
level: Moderate
difficulty: 35
blurb: How the live backbone tracks signals, missions, sessions, and public evidence.
hypothesis: Coordination needs a nervous system, not just files.
---

## Hypothesis

Coordination needs a nervous system, not just files.

## Problem

Files preserve memory, but live operations also need signals: what is running, who is working, what landed, and what needs attention.

## Solution served by koad:io

The daemon indexes live state. Emissions publish signals. Flights carry delegated missions from dispatch to landing.

## Technical model

- Daemon: volatile nervous system.
- Emissions: structured operational signals.
- Flights: delegated work records with lineage.
- Sessions: active work surfaces attached to entities.

## Install / setup path

1. Start the daemon.
2. Emit a test signal.
3. Dispatch a bounded flight.
4. Inspect landing and session records.

## Verification

Live state should be visible without reading every file manually.
