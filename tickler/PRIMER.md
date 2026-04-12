# tickler/ — Kingdom-Level Protocol (No Tickles Live Here)

This directory is **intentionally empty of tickles**. The kingdom is substrate, not an actor — it has no responsibilities of its own, so it has no next actions to defer. What lives here is the protocol documentation for how tickler works across every entity on a koad:io host, and the framework-level config that shapes how tickles surface.

If you're looking for the canonical per-entity PRIMER (scope rules, dimensions, schema, loader behavior), read `~/.<entity>/tickler/PRIMER.md` on any entity that has one. Juno's is the current reference implementation.

## Where tickles actually live

```
~/.<entity>/tickler/
  time/         — calendar-addressed next actions (days / weeks / months)
  space/        — host- or location-addressed next actions
  github-issues/ — repo- or issue-addressed next actions
```

Each entity owns its own tickler. No entity's tickler is visible inside another entity's directory — they are fully sovereign per-entity inboxes.

## How the kingdom surfaces them

Two loaders, running at two different triggers, read all enabled entities' ticklers and surface what's due:

### Session start (time + host-level space)

The `tickler scan` command reads `time/` and `space/<host>/*.md` at session start and prints what's due today / this week / this month / on this host. Wired into every harness via the startup script splice. See any entity's PRIMER for the per-entity schema.

### cd reflex (path-level space)

`~/.koad-io/helpers/cd-reflex.sh` installs a bash function that wraps `cd`. Every directory change fires a registry of context-injection hooks. One of those hooks (`tickler-reflex.sh`) walks every enabled entity's `tickler/space/<host><absolute-path>/*.md` and surfaces open tickles for the location you just arrived at.

The operator sees something like:

```
$ cd /home/koad/some/project
Tickler (space) · vulcan: 1 here
  - Fix the build (fix-build.md)
Tickler (space) · juno: 2 here
  - Review the sponsor pitch (sponsor-pitch.md)
  - Schedule the demo call (demo-call.md)
```

…and can dispatch the right entity with a single word: `vulcan`, `juno`.

## Why tickles from all entities surface at once

Design intent: when a human operator (or any entity) is moving around the filesystem, they should see the **whole team's** pending next actions for the location, not just their own. That way the operator can:

- Spot work only a specific entity can handle and dispatch them (`vulcan`)
- Coordinate across entities that both have work in the same area
- See the full state of the kingdom at any given location

`$ENTITY` is **not** used as a filter. Every enabled entity's tickler contributes. "Enabled entity" is self-discovered: any `~/.<name>/tickler/` directory that exists is enabled.

## Why this directory has no tickles

A tickle is a next action with a return address, filed by someone who is responsible for doing it. The kingdom itself doesn't do things — entities do. If the framework needs a next action filed, the right home is either:

- The entity responsible for the work (`~/.<entity>/tickler/`), or
- `horizons/` on that entity, if it's active work that doesn't need a time/space gate

Never here. The kingdom directory is the map, not the territory.

## Config (env vars)

Framework-level reflex config cascades from `~/.koad-io/.env`. Entity-level `.env` files can override any of these.

| Var | Default | Meaning |
|-----|---------|---------|
| `KOAD_IO_CD_REFLEX` | `1` | Master switch for the cd reflex registry. `0` disables all context injection on cd. |
| `KOAD_IO_NVM_REFLEX` | `1` | Register the nvm/node/npm/yarn version check as a cd hook. `0` skips. |
| `KOAD_IO_TICKLER_REFLEX` | `1` | Register the tickler space-dimension scan as a cd hook. `0` skips. |
| `KOAD_IO_HOST` | `hostname -s` | Override the host name used for `space/<host>` lookups. Useful for aliasing a machine. |
| `KOAD_IO_QUIET` | `0` | Suppress registration banners when helpers load. Does not suppress reflex output itself. |

## Adding a new context injector

The cd reflex pattern is open. If you want to add a new "arriving here is interesting because…" hook:

1. Create `~/.koad-io/helpers/<something>-reflex.sh`
2. Define a function that does the work — reads disk, echoes whatever is relevant, exits silently if nothing to say
3. Gate the whole file on an env var (`KOAD_IO_<NAME>_REFLEX`) so it can be disabled
4. At the bottom, register with the registry if available:
   ```bash
   if declare -F koad_io_cd_register >/dev/null 2>&1; then
     koad_io_cd_register <your_function>
   fi
   ```

Alphabetical load order in `~/.koad-io/helpers/*.sh` means `cd-reflex.sh` is already loaded by the time your file runs. Hooks fire in registration order on every cd.

## See also

- `~/.koad-io/helpers/cd-reflex.sh` — the registry + cd wrap
- `~/.koad-io/helpers/node-tools.sh` — nvm_use_project, the first example
- `~/.koad-io/helpers/tickler-reflex.sh` — the second example, space-dimension scan
- `~/.<entity>/tickler/PRIMER.md` — per-entity scope rules, dimensions, schema

---

*The kingdom is the substrate. Entities do the work. This directory is the doc, not the inbox.*
