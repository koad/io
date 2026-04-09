# Feature: Meteor Shell as Internal API

## Summary
The daemon runs Meteor in dev mode permanently, keeping `meteor shell` available as the internal REPL/API for orchestration. Never deployed, never bundled, never exposed.

## Problem
Production-deployed apps lose access to `meteor shell` — the compiler isn't running. HTTP APIs add complexity and attack surface for internal-only operations.

## Solution
The framework daemon is internal-only (`127.0.0.1`), never production-deployed:
- Meteor compiler always running → `meteor shell` always available
- `koad-io shell` drops into the daemon's REPL
- Server methods callable directly from the shell
- Hooks can pipe commands into the shell for automation
- No HTTP API surface needed for local orchestration

## Interaction Patterns
```bash
# Interactive — human or AI at the REPL
koad-io shell
> Meteor.call('scheduler.list')
> Meteor.call('passenger.reload')

# Scripted — hook pipes a command
echo "Meteor.call('scheduler.run', 'sibyl-research')" | koad-io shell

# Entity — any entity calls daemon methods via DDP
```

## Security
- Bound to 127.0.0.1 only — never exposed on ZeroTier or public
- Compiler overhead is acceptable — no users, no traffic, internal control plane
- No production bundle exists for the daemon — it's always dev mode

## Status
- [ ] Partially working — `koad-io shell` command exists, daemon dev mode works
- [ ] Blocked — daemon can't start until MONGO_URL=false fix lands

## Related Features
- Feature: 008-stateless-hub.md
- Feature: 009-entity-scheduler.md
