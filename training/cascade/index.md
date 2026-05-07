---
doc-debt: complete
doc-audience: developer
doc-updated: 2026-05-07
doc-maintainer: livy
title: "The koad:io Environment Cascade"
type: reference
relates-to:
  - /home/koad/.koad-io/bin/koad-io
  - /home/koad/.koad-io/bin/juno
  - /home/koad/.koad-io/.env
  - /home/koad/.koad-io/KOAD_IO.md
  - /home/koad/.koad-io/commands/assert/datadir/command.sh
entities:
  - livy
audience: developers, entity authors
---

# The koad:io Environment Cascade

The cascade is the mechanism that gives every command its identity context. Before a single line of `command.sh` runs, the dispatcher has sourced four layers of `.env` files, wiped stale state from parent shells, and handed off a clean, fully-resolved environment to the command.

This document traces that process end to end.

---

## The four layers

Every command invocation resolves its environment from these layers, in order:

```
1.  ~/.koad-io/.env             Framework-wide defaults
2.  ~/.koad-io/.credentials     Framework secrets (optional)
3.  ~/.<entity>/.env            Entity identity and behavior flags
4.  ~/.<entity>/.credentials    Entity secrets (optional)
5.  <command-dir>/.env          Command-local overrides (optional)
6.  <command-dir>/.credentials  Command-local secrets (optional)
```

**Last writer wins.** Each layer can override any variable set by earlier layers. A variable set in `~/.<entity>/.env` beats the same variable in `~/.koad-io/.env`. A variable in the command-local `.env` beats both.

The framework `.env` sets kingdom-wide defaults that apply to every entity:

```bash
KOAD_IO_MESH_IP=10.10.10.10
KOAD_IO_HOME_MACHINE=fourty4
KOAD_IO_COMMANDS_DIRS=$HOME/.forge/commands:$HOME/.koad-io/commands
KOAD_IO_DEFAULT_HARNESS=opencode
KOAD_IO_DEFAULT_MODEL=minimax-m2.5-free
```

The entity `.env` narrows those to the specific entity:

```bash
ENTITY=juno
ENTITY_DIR=/home/koad/.juno
ENTITY_DEFAULT_HARNESS=claude
ENTITY_DEFAULT_MODEL=opus-4-6
GIT_AUTHOR_NAME=Juno
GIT_AUTHOR_EMAIL=juno@kingofalldata.com
```

The command-local `.env` pins anything command-specific — ports, application modes, settings paths — without polluting the entity or framework level.

---

## What the launcher does

Entity launchers (`~/.koad-io/bin/juno`, `~/.koad-io/bin/livy`, etc.) are identical two-line scripts generated at entity creation:

```bash
#!/usr/bin/env bash
export ENTITY="juno"
export KOAD_IO_VIA_LAUNCHER=1
koad-io "$@";
```

The launcher sets two things and hands off to the dispatcher. That's it.

- `ENTITY="juno"` — the canonical caller intent, used by the dispatcher to locate `~/.$entity/.env`
- `KOAD_IO_VIA_LAUNCHER=1` — a signal to the dispatcher that says "a proper entity launcher called me"

Without `KOAD_IO_VIA_LAUNCHER=1`, the dispatcher assumes it was called directly (e.g. `koad-io tickle vesta "..."`) and wipes `ENTITY` before the cascade runs. This is intentional — an `ENTITY` inherited from a parent shell that ran a different entity would be stale context, not caller intent.

---

## Pre-cascade sanitization

The first thing the dispatcher does is wipe the inherited environment. This prevents leakage between entity invocations — if Juno dispatched Vulcan inside a session where `ENTITY_DIR=/home/koad/.juno` was set, Vulcan should not inherit Juno's dir.

**What gets wiped:** all `KOAD_IO_*` and `ENTITY*` variables.

**What survives sanitization:**

| Variable | Why it survives |
|----------|-----------------|
| `ENTITY` | Set by the launcher a moment ago — this is fresh caller intent, not stale inheritance |
| `KOAD_IO_ROOM` | Caller-pinned room for room-mode dispatch |
| `KOAD_IO_QUIET` | Verbosity preference; reasonable to inherit across dispatch |

After the wipe, the cascade runs from layer 1 through 6.

---

## Full walkthrough: `juno tickle vesta "pick up that brief"`

When you type that command, here is the exact sequence:

**1. Shell dispatches to `~/.koad-io/bin/juno`**

```bash
export ENTITY="juno"
export KOAD_IO_VIA_LAUNCHER=1
koad-io tickle vesta "pick up that brief"
```

**2. Dispatcher detects the launcher flag**

`KOAD_IO_VIA_LAUNCHER=1` is set, so the dispatcher:
- Unsets `KOAD_IO_VIA_LAUNCHER` (one-time handshake, consumed immediately)
- Wipes all `KOAD_IO_*` and `ENTITY*` variables **except** `ENTITY`
- Preserves `KOAD_IO_ROOM` and `KOAD_IO_QUIET` if they were set by the caller

**3. Cascade runs**

```bash
set -a
source ~/.koad-io/.env        # framework defaults
source ~/.koad-io/.credentials  # (if present)
source ~/.juno/.env           # entity identity — ENTITY_DIR, GIT_AUTHOR_*, etc.
source ~/.juno/.credentials   # (if present)
set +a
```

After this step: `ENTITY_DIR=/home/koad/.juno`, `GIT_AUTHOR_NAME=Juno`, `KOAD_IO_MESH_IP=10.10.10.10`, and everything else the command needs are all in the environment.

**4. Argument separation**

The dispatcher splits `tickle vesta "pick up that brief"` into:
- Positional args: `tickle`, `vesta`, `pick up that brief` — used for command directory resolution
- Flag args (any `--flag`): none in this example, but if `--dry-run` were present, it would go here

`KOAD_IO_FLAGS` is exported as the space-joined string of flag args. Positional args are used to resolve the command path.

**5. Command resolution**

The dispatcher walks `KOAD_IO_COMMANDS_DIRS` (framework + forge) and the entity's own `commands/` dir looking for the deepest matching directory path. For `tickle`, it finds `~/.koad-io/commands/tickle/` and sets:

```
COMMAND_LOCATION=~/.koad-io/commands/tickle
EXEC_FILE=~/.koad-io/commands/tickle/command.sh
EXEC_ARGS=(vesta "pick up that brief")
```

**6. Command-local `.env` (if present)**

```bash
source $COMMAND_LOCATION/.env         # (if exists)
source $COMMAND_LOCATION/.credentials # (if exists)
```

**7. Execution**

```bash
exec command.sh vesta "pick up that brief" "${_flag_args[@]}"
```

The command script runs with the full resolved environment already in place.

---

## The `KOAD_IO_*` prefix convention

Variables that configure the framework or an entity's behavior within the framework carry the `KOAD_IO_` prefix. They are:

- Set primarily in `~/.koad-io/.env` (framework-wide defaults)
- Optionally overridden in `~/.<entity>/.env` (entity-specific behavior)
- Wiped and re-established on every cascade — never stale between invocations

Common variables:

| Variable | Where set | What it controls |
|----------|-----------|-----------------|
| `KOAD_IO_MESH_IP` | Framework `.env` | Network mesh IP for daemon binding |
| `KOAD_IO_COMMANDS_DIRS` | Framework `.env` | Colon-separated command search path |
| `KOAD_IO_HARNESS` | Framework `.env` | Path to harness command directory |
| `KOAD_IO_DEFAULT_HARNESS` | Framework `.env` | Fallback harness when entity doesn't pin one |
| `KOAD_IO_DEFAULT_MODEL` | Framework `.env` | Fallback model when entity doesn't pin one |
| `KOAD_IO_QUIET` | Any layer | Suppress ANSI decoration; AI/CI-safe output |
| `KOAD_IO_EMIT` | Framework `.env` | Emit events to daemon on command run |
| `KOAD_IO_ROOTED` | Entity `.env` | Signal that this entity runs from its own home dir |
| `KOAD_IO_ROOM` | Caller | Pin a channel room for room-mode dispatch |
| `KOAD_IO_FLAGS` | Dispatcher (runtime) | Word-split string of flag args, for backward compat |

### The `KOAD_IO_FLAGS` re-parse gotcha

`KOAD_IO_FLAGS` is exported as a plain string (not an array) for backward compatibility with older commands that read it directly. **Do not iterate `KOAD_IO_FLAGS` in a flag-parse loop.**

The correct pattern is to iterate `"$@"` only:

```bash
# Right — iterates the actual argv array, no word-splitting surprises:
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --quiet)   QUIET=true ;;
  esac
done

# Wrong — KOAD_IO_FLAGS is re-word-split, breaks BODY="text with spaces":
for arg in $KOAD_IO_FLAGS; do
  ...
done
```

If `KOAD_IO_FLAGS` contains a flag with a value (e.g. `--note "some text"`), re-parsing it as a string loses the quoting and splits the value.

---

## The `ENTITY_*` prefix convention

Variables that describe a specific entity carry the `ENTITY_` prefix. They are set in the entity's `~/.<entity>/.env` and describe that entity's identity and behavioral preferences:

| Variable | Typical value | What it means |
|----------|--------------|---------------|
| `ENTITY` | `juno` | Canonical entity name (lowercase) |
| `ENTITY_DIR` | `/home/koad/.juno` | Entity home directory |
| `ENTITY_HOME` | `/home/koad/.juno/home/juno` | Entity's personal home within its dir |
| `ENTITY_KEYS` | `/home/koad/.juno/juno.keys` | Path to entity's public keys |
| `ENTITY_DEFAULT_HARNESS` | `claude` | Preferred harness for this entity |
| `ENTITY_DEFAULT_MODEL` | `opus-4-6` | Preferred model for this entity |
| `ENTITY_SKIP_PERMISSIONS` | `true` | Skip interactive permission prompts |
| `KOAD_IO_ENTITY_ROLE` | `orchestrator` | Role within the entity graph |

The `ENTITY_DEFAULT_*` variables override the `KOAD_IO_DEFAULT_*` framework fallbacks. An entity that pins `ENTITY_DEFAULT_MODEL=opus-4-6` will not use the framework's `KOAD_IO_DEFAULT_MODEL`.

---

## The `HARNESS_*` prefix convention

Harness commands set `HARNESS_*` variables to pass session identity into the running harness process. These are **set inside the harness command script** (after the cascade has already run) and are not cascade inputs — they are cascade outputs used by the harness lifecycle:

| Variable | Set by | What it means |
|----------|--------|---------------|
| `HARNESS_PID` | `harness/claude/command.sh` | PID of the harness process |
| `HARNESS_SESSION_ID` | `harness/claude/command.sh` | `${ENTITY}-${HARNESS_PID}` |
| `HARNESS_EMISSION_ID_FILE` | Harness commands | Path to the emission ID for continuity |

`HARNESS_*` variables survive pre-cascade sanitization because the sanitization wipe targets `KOAD_IO_*` and `ENTITY*` patterns, not `HARNESS_*`. This is intentional — a parent harness may set `HARNESS_*` context that child commands need to inherit.

---

## `KOAD_IO_LOCAL=true` — daemon dev mode

One flag changes the behavior of the daemon startup significantly. When `KOAD_IO_LOCAL=true` is set (either in `~/.koad-io/daemon/.env` or passed as `--local`), the daemon runs in Meteor dev mode:

- Hot reload on file changes in `src/`
- `meteor shell` available for live method calls
- No bundle step — edits to `~/.koad-io/daemon/src/**` are picked up within seconds

Without `KOAD_IO_LOCAL`, the start command attempts to run a pre-built bundle. The daemon is the one Meteor app in the kingdom that is **never** built — it always runs in dev mode via this flag.

```bash
# Start daemon in dev mode:
koad-io start --local

# Equivalent via .env pin (in ~/.koad-io/daemon/.env):
KOAD_IO_LOCAL=true
```

Note: `KOAD_IO_LOCAL` and `KOAD_IO_LOCAL_ONLY` are different. `KOAD_IO_LOCAL_ONLY` is used by `assert/datadir` to indicate a local workspace build context; it does not affect daemon mode.

---

## `KOAD_IO_VIA_LAUNCHER=1` — why bypassing breaks things

If you invoke `koad-io` directly (without going through an entity launcher like `juno`), the dispatcher detects the absence of `KOAD_IO_VIA_LAUNCHER=1` and wipes `ENTITY` before the cascade runs. That means:

- No entity `.env` is sourced
- `ENTITY_DIR`, `GIT_AUTHOR_*`, `ENTITY_DEFAULT_*` are all absent
- Commands that require entity context fail or use framework defaults

The dispatcher does this deliberately. An `ENTITY` from a parent shell is stale; it reflects the last entity that ran in that shell, not the entity the user intends to invoke. Only a launcher can set fresh caller intent.

**When `koad-io` is called directly (no launcher), the cascade is framework-only.** This is correct for framework commands like `koad-io gestate` that create new entities — they intentionally run without an entity context.

---

## What happens when a variable is missing

The cascade does not fail silently on missing variables — it just does not set them. Commands see the absence and handle it with one of three patterns:

**1. Empty string / falsy default (silent)**

Most variables use bash parameter expansion with a default:

```bash
KOAD_IO_BIND_IP=${KOAD_IO_MESH_IP:-127.0.0.1}
```

If `KOAD_IO_MESH_IP` is not set, `KOAD_IO_BIND_IP` becomes `127.0.0.1`. The command runs; it just uses the localhost fallback.

**2. Explicit guard (informative)**

Some commands check and report:

```bash
if [ -d "$ENTITY_DIR" ]; then
    source $ENTITY_DIR/.env
else
    echo "No configurations found for entity: $ENTITY"
fi
```

No exit — the cascade continues without the entity's vars. Commands that need them will fail downstream with more specific messages.

**3. Required variable (exit 64)**

`assert/datadir` exits 64 if it cannot resolve a valid `DATADIR`. Commands that source `assert/datadir` inherit that exit. This is the correct pattern for commands that genuinely cannot proceed without workspace context.

**The gap to know:** There is no framework-level mechanism to declare a variable required. Each command is responsible for its own guards. If a command does not guard for a missing variable, it will either fail at the point of use (unhelpfully) or produce wrong behavior silently. The style convention is to guard at the top of `command.sh` with an early exit.

---

## The `--flag value` vs `--flag=value` form

The dispatcher's flag parser supports both forms, but they behave differently in contexts where a flag value is re-parsed from a string:

```bash
# Safe — self-contained, no lookahead needed:
juno tickle vesta --note="pick up the brief"

# Works at dispatch time, but dangerous if re-read from KOAD_IO_FLAGS:
juno tickle vesta --note "pick up the brief"
```

When `--flag value` is used, the dispatcher absorbs the next token as the flag's value into `_flag_args`. The bash array (`_flag_args[@]`) preserves the pairing correctly through to `exec`. The string form (`KOAD_IO_FLAGS`) does not — it collapses to `--flag value`, and any consumer that re-parses it will split `value` as a separate token.

**Rule:** Use `--flag=value` form in scripts, automation, and dispatch prompts where flag values may contain spaces. Use `--flag value` form only for interactive use where you are certain the value is a single token.

---

## Resolution summary

| Layer | File | Wins over |
|-------|------|-----------|
| Framework | `~/.koad-io/.env` | (nothing — first) |
| Framework secrets | `~/.koad-io/.credentials` | Framework `.env` |
| Entity | `~/.<entity>/.env` | Framework |
| Entity secrets | `~/.<entity>/.credentials` | Entity `.env` |
| Command-local | `<command-dir>/.env` | Entity |
| Command-local secrets | `<command-dir>/.credentials` | Command-local `.env` |

Later layers win. Framework vars are defaults; entity vars narrow them; command-local vars pin them for a specific invocation context.

---

## Known gaps

**`KOAD_IO_VIA_LAUNCHER` is a one-way handshake.** There is no mechanism for a command to verify that it was invoked through a launcher with correct entity context. A command author must trust that the cascade ran correctly or implement their own checks.

**`KOAD_IO_FLAGS` word-split form is not deprecated.** Some commands (notably `start`, `stop`, `restart`) read `KOAD_IO_FLAGS` directly for boolean flags. This works because boolean flags have no value token — `--local` is always a single token. The gotcha only bites when a value-carrying flag is re-parsed from the string.

**`KOAD_IO_LOCAL` is daemon-specific.** Despite the `KOAD_IO_` prefix, this flag's primary semantic is daemon dev-mode. It is not a framework-wide "run everything locally" toggle. Other commands that accept a `--local` positional or flag have their own meaning for "local."

**Implementation note (2026-05-07):** The `ENTITY_*` wipe in pre-cascade sanitization matches the glob `^(KOAD_IO_|ENTITY)`. This catches `ENTITY` (the name), `ENTITY_DIR`, `ENTITY_HOME`, `ENTITY_KEYS`, and any other `ENTITY_*` var. If a future command introduces a var with an `ENTITY_` prefix that should survive inter-entity dispatch, it will need explicit preservation in the sanitization block (same pattern as `KOAD_IO_ROOM`).

---

*This document was graduated from operational practice to the training library on 2026-05-07. It describes the cascade as implemented in `~/.koad-io/bin/koad-io`. When the dispatcher changes, this document should change with it.*
