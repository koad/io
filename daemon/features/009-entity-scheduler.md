# Feature: Entity Scheduler

## Summary
The daemon schedules and executes entity invocations — timed tasks, recurring jobs, and on-demand orchestration via Meteor server methods.

## Problem
Entity invocation is currently manual or chained with sleeps. There is no central place to define "run Sibyl's research every morning" or "invoke Argus health check after every deploy."

## Solution
Server methods on the daemon manage a task queue:
- Schedule tasks with cron expressions or intervals
- Execute by spawning entity in a screen session (`entity invoke`)
- Track state: scheduled, running, completed, failed
- Single-instance guard per entity (check screen name + port before spawning)
- Callable from hooks, other entities, or `meteor shell`

## Implementation
- `scheduler.add` — register a task (entity, prompt, schedule)
- `scheduler.remove` — unregister a task
- `scheduler.list` — show all scheduled tasks and their state
- `scheduler.run` — manually trigger a scheduled task
- `scheduler.status` — check what's currently running
- Uses koad:io-core cron package for timing
- Spawns via `koad-io invoke entity <name> "<task>"` in screen
- Logs to entity's builds or var directory

## Interaction
- **From shell:** `koad-io shell` → `Meteor.call('scheduler.add', {...})`
- **From hooks:** HTTP POST to daemon or pipe into `meteor shell`
- **From entities:** Any entity can call daemon methods via DDP

## Settings
- Tasks stored in in-memory collection (ephemeral — schedule is fixtured on startup)
- Schedule definitions can be stored in entity's `.env` or a `schedule.json`

## Status
- [ ] Not started — depends on 008-stateless-hub

## Related Features
- Feature: 004-process-management.md
- Feature: 008-stateless-hub.md
