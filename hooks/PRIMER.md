---
type: primer
folder: ~/.koad-io/hooks/
parents:
  - ~/.koad-io/
children: []
features:
  - name: entity-no-args-hook
    blurb: The "just type the entity name" door — resolves work dir, injects CWD PRIMER, delegates to harness default
    location: ~/.koad-io/hooks/executed-without-arguments.sh
  - name: entity-upstart-hook
    blurb: Boot-time daemon and desktop launcher; lock-guarded so only one copy runs per upstart
    location: ~/.koad-io/hooks/entity-upstart.sh
  - name: cwd-primer-injection
    blurb: Auto-prepend of $CWD/PRIMER.md to PROMPT when an entity is invoked inside a project folder
    location: ~/.koad-io/hooks/executed-without-arguments.sh
relates-to:
  - ~/.koad-io/
  - ~/.forge/hooks/PRIMER.md
  - ~/.koad-io/harness/
  - ~/.koad-io/commands/harness/
  - ~/.livy/features/INDEX.md
entities:
  - vulcan
  - juno
  - livy
last-walked: 2026-05-09
as-of: a67de948cfdb6f265035629f9c92160f546265ad
---

# ~/.koad-io/hooks/

Framework-tier lifecycle hooks. Two bash scripts and a TUI config file. They are the first door every entity walks through — not orchestration logic, not harness logic. Just the door.

## What lives here (and what does not)

| File | Type | Purpose |
|------|------|---------|
| `executed-without-arguments.sh` | Lifecycle hook | Fires when an entity is invoked with no args |
| `entity-upstart.sh` | Boot template | Starts daemon + desktop on system upstart |
| `tui.json` | Config | opencode TUI theme (carbonfox) |
| `PRIMER.md` | This file | Agent orientation |

The orchestration hooks (flight assembly, subagent env prefix, heartbeat, flight close) live in **juno's** hooks dir (`~/.juno/hooks/`). They are juno-tier, not framework-tier. KOAD_IO.md's hook table lists them under framework — that is a known documentation drift. The framework hooks dir contains only the two scripts above.

## The three-tier cascade

Framework hooks are the lowest tier:

```
~/.koad-io/hooks/     ← framework tier (this folder)
~/.forge/hooks/       ← forge tier (kingdom-wide harness extensions)
~/.<entity>/hooks/    ← entity tier (per-entity overrides)
```

When an entity command is invoked, the entity launcher looks for `hooks/<name>` first in the entity dir, then in the forge, then here. First match wins. Framework defaults fire when no override exists.

Most entities should never need to override. All divergence should be expressed through the `.env` cascade (see KOAD_IO.md). The one active entity-level override as of 2026-05-09 is documented in this PRIMER's history notes.

## `executed-without-arguments.sh`

Called when `juno`, `vulcan`, `alice`, or any other entity command is typed with no subcommand.

It does four things in order:

1. Resolves `$HARNESS_WORK_DIR` — `$ENTITY_DIR` if `KOAD_IO_ROOTED=true`, otherwise `$CALL_DIR`
2. Sets the terminal title to `entity on host in cwd`
3. Auto-injects `$CALL_DIR/PRIMER.md` into `$PROMPT` if the caller is inside a project folder (and that folder is not the entity's own dir)
4. Delegates to `~/.koad-io/harness/default/command.sh` (or the `$KOAD_IO_HARNESS` override)

Behavior is driven entirely by the `.env` cascade:

| Variable | Default | Effect |
|----------|---------|--------|
| `ENTITY_DEFAULT_HARNESS` | framework default | `claude`, `opencode`, `pi`, or `hermez` |
| `ENTITY_DEFAULT_PROVIDER` | harness-specific | Provider inside the harness |
| `ENTITY_DEFAULT_MODEL` | harness-specific | Model name |
| `ENTITY_SKIP_PERMISSIONS` | `false` | If `true`, passes `--dangerously-skip-permissions` (claude only) |
| `ENTITY_LOCKFILE` | `false` | PID busy-guard on one-shot claude launches |
| `ENTITY_EXTRACT_RESULT` | `false` | Forces `--output-format=json` on one-shot, extracts `.result` |
| `ENTITY_CONTINUE` | `false` | Adds `-c` to interactive claude launches (resumes last session) |
| `KOAD_IO_ROOTED` | unset | `true` = entity works from its own dir; default = roaming from CWD |

Adding a new entity requires no changes here. The hook is a shared door.

## `entity-upstart.sh`

Template for a system-upstart integration. Copy to `~/.$ENTITY/hooks/upstart.sh` and the upstart command (`koad-io upstart`) will invoke it.

Lock guard: checks `/dev/shm/koad-io.upstart.lock` before proceeding. Subsequent upstart calls are no-ops.

Start order:
1. Daemon: `screen -dmS koad-daemon` in `~/.koad-io/daemon/`
2. Desktop (if present): `screen -dmS koad-desktop` in `~/.koad-io/desktop/` — 3-second delay for daemon to settle

Falls back gracefully (no `screen`) to background subshells.

## `tui.json`

Not a lifecycle hook. The opencode TUI reads this file from `$CWD` (or a parent dir walk) to pick a color theme. Setting `carbonfox` here makes the kingdom's TUI dark by default.

## CWD PRIMER injection

The most impactful behavior in this folder is not immediately obvious. When an entity is invoked inside a project directory that has a `PRIMER.md`, the hook reads it and injects it:

- If `$PROMPT` is already set: prepends `Project context (from $CALL_DIR/PRIMER.md):\n<contents>\n\n---\n\n<original prompt>`
- If `$PROMPT` is unset (interactive session): sets `$KOAD_IO_CWD_PRIMER` to the PRIMER path; the harness picks it up at startup

This means every entity that reads `~/.koad-io/PRIMER.md` or a forge package PRIMER gets the entity oriented to where it was invoked, for free, before any prompt reaches the harness. The feature graph (PRIMERs in every folder) pays dividends here.

Skipped if the caller is inside the entity's own dir (that PRIMER already loads via the identity cascade in startup.sh).

## Override discipline

Forking `executed-without-arguments.sh` into an entity dir is almost always wrong. The three questions to ask first:

1. Can this be expressed as a new `$ENTITY_*` env var in the cascade?
2. Should the leaf harness script (`commands/harness/<name>/command.sh`) grow to handle it? That fixes it for every entity on that harness.
3. Is this a category (rooted, orchestrator, ...): teach the cascade, don't fork.

Only fork as a last resort. Forked hooks drift. The global hook doesn't.

## History

| Date | Commit | Agent | Change |
|------|--------|-------|--------|
| 2026-04-14 | 9d19a93 | Vulcan | Canonical global hook + `ENTITY_SKIP_PERMISSIONS` cascade |
| 2026-04-14 | ce24024 | Vulcan | Auto-inject `$CWD/PRIMER.md` into prompt |
| 2026-04-14 | 6941a59 | Vulcan | `ENTITY_LOCKFILE`, `ENTITY_EXTRACT_RESULT`, `ENTITY_CONTINUE` knobs |
| 2026-04-14 | 5f59287 | Vulcan | `KOAD_IO_HARNESS` override for kindergarten default |
| 2026-05-09 | a38f85a | Vulcan | Treat CALL_DIR PRIMER as context (not prompt) in no-args case |
