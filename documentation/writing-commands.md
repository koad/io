# Writing Commands

How to author a `command.sh` that survives the cascade.

## The layout

```
<some-commands-dir>/<name>/
├── command.sh         # The entry point — koad-io dispatcher finds this
├── .env               # Optional command-local env (rarely used)
├── PRIMER.md          # Human-readable description
└── <sub-command>/
    └── command.sh     # Nested sub-commands, resolved by deeper match
```

A command can live at any depth up to 5 levels. The dispatcher walks
`KOAD_IO_COMMANDS_DIRS` (PATH-style, first-match-wins) and entity +
CWD command dirs, picking the deepest match.

## Golden rule: don't hardcode cascadable paths

A command that writes `$HOME/.koad-io/commands/foo` into its own script
has baked in an assumption about where foo lives. That's a latent break.
Commands move between framework (`~/.koad-io/`), business (`~/.forge/`),
and entity-level (`~/.<entity>/`) dirs, and the cascade resolves the
match — not your script.

**Self-location**

```bash
# CORRECT — the script knows where it lives
THIS_DIR="$(dirname "${BASH_SOURCE[0]}")"

# WRONG — breaks the moment the command moves
THIS_DIR="$HOME/.koad-io/commands/foo"
```

**Sibling command (same parent)**

```bash
# CORRECT — sibling resolution via BASH_SOURCE
PARENT="$(dirname "$(dirname "${BASH_SOURCE[0]}")")"
source "$PARENT/set/hue/command.sh" "$HUE"

# WRONG — hardcoded path to sibling
source "$HOME/.koad-io/commands/outfit/set/hue/command.sh" "$HUE"
```

**Cross-tree command (not a sibling)**

Don't `source` a command from an unrelated tree — invoke it through
the entity launcher so the cascade resolves:

```bash
# CORRECT — let the launcher walk the cascade
"$HOME/.koad-io/bin/koad-io" install opencode

# WRONG — hardcoded path that may not exist everywhere
"$HOME/.koad-io/commands/install/opencode/command.sh"
```

**Configuration paths**

Use the cascade env vars, not hardcoded locations:

| What you need | Use |
|---------------|-----|
| The command's own dir | `$(dirname "${BASH_SOURCE[0]}")` |
| The running command's resolved dir | `$COMMAND_LOCATION` (exported by launcher) |
| The entity's home | `$ENTITY_DIR` |
| The entity's working dir | `$CWD` (roaming) or `$ENTITY_DIR` (rooted) |
| Framework commands root | Walk `$KOAD_IO_COMMANDS_DIRS` |
| Framework packages root | Walk `$KOAD_IO_PACKAGE_DIRS` |
| Framework harness root | `$KOAD_IO_HARNESS` (with fallback to `$HOME/.koad-io/harness`) |

## The few stable paths you may hardcode

The framework kindergarten has a small set of primitives that stay put.
These are stable enough to reference by full path:

- `$HOME/.koad-io/bin/koad-io` — the dispatcher itself
- `$HOME/.koad-io/commands/assert/datadir/command.sh` — workspace validation helper
- `$HOME/.koad-io/commands/install/opencode/command.sh` — branded opencode builder
- `$HOME/.koad-io/harness/default/command.sh` — kindergarten harness
- `$HOME/.koad-io/harness/startup.sh` — context assembly
- `$HOME/.koad-io/helpers/emit.sh` — emission primitive

Everything else moves. Use BASH_SOURCE or the cascade.

## The env cascade

The launcher loads env in order. By the time your `command.sh` runs:

1. `$HOME/.koad-io/.env` — framework defaults
2. `$ENTITY_DIR/.env` — entity config (only if `$ENTITY` is set)
3. `$ENTITY_DIR/.credentials` — entity credentials
4. `$COMMAND_LOCATION/.env` — command-local (rarely used)

All variables are exported (`set -a`), so anything your script needs
should be read from the cascade, not hardcoded.

## Workspace-aware commands

If your command operates on a Meteor workspace (a dir with `src/`,
`config/`, `.env`, etc.), source the datadir assertion helper at the
top. It validates the CWD is a legit workspace, cd's into it, and
sources the workspace `.env`:

```bash
source "$HOME/.koad-io/commands/assert/datadir/command.sh"
```

After that line, `$DATADIR` is set to the workspace root, the CWD is
that root, and the workspace env is loaded. Use this pattern for
`start`, `stop`, `restart`, `deploy`, `build`, `upload` — any command
that treats the caller's CWD as a workspace target.

## Sub-command dispatch

Sub-commands live in subdirectories. The dispatcher picks the deepest
match, so `juno outfit extract foo.png` resolves to
`<commands-root>/outfit/extract/command.sh` with `foo.png` as `$1`.

If your command needs to dispatch internally (e.g. `configure` routing
to `configure/daemon/` or `configure/kingdom/seed/`), use the
sub-command invocation pattern through the launcher — don't build your
own dispatcher.

## Sourcing vs exec

- `source <command.sh>` — runs in the current shell, inherits env
- `exec <command.sh>` — replaces the current process
- Call via launcher (`<entity> <command>`) — clean env cascade, new process

**Source** when composing (e.g. `outfit extract` sources `outfit set/hue`
and `outfit set/saturation` to apply the extracted values).

**Exec** when handing off (e.g. the harness default execs opencode
after setup).

**Launcher** when orchestrating across entities or commands that need
their own env cascade.

## Testing a new command

1. `<entity> <command> --help` — show self-documented usage (if your
   command ends with the discovery footer)
2. `DEBUG=1 <entity> <command>` — verbose dispatch output
3. `search <command-name>` — find all references across the kingdom
   after moving or renaming

## Command graduation

New commands live in an entity's dir (`~/.<entity>/commands/`) or the
business layer (`~/.forge/commands/`). Promotion to framework
(`~/.koad-io/commands/`) happens only after the command proves
universally useful — i.e. a brand-new user who just installed koad:io
would benefit from having it on day 1.

When in doubt: start in the entity or business layer, graduate later.
The cascade makes graduation a single `mv` plus a path fixup.

## See also

- `~/.koad-io/KOAD_IO.md` — the kingdom lighthouse, loaded by every entity
- `~/.koad-io/onboarding/commands.md` — onboarding walkthrough
- `~/.koad-io/documentation/kingdom-model.md` — architectural shape of the kingdom
