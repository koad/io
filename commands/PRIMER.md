<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/`

> The framework command set. Every entity in the kingdom inherits these as last-resort fallbacks; individual entities override by dropping a same-named command in `~/.<entity>/commands/`.

## What this directory is

`commands/` is the **framework-level command set** in the koad:io discovery chain. Every call of the form `<entity> <cmd> [args]` walks three locations in order:

1. `~/.<entity>/commands/<cmd>/command.sh` — entity-level override
2. `./commands/<cmd>/command.sh` — local to working directory
3. `~/.koad-io/commands/<cmd>/command.sh` — **this directory** (framework fallback)

First match wins. Adding a command here makes it available to **every entity** unless a same-named command in a more-specific location shadows it.

## The shape of a command

Each command is its own directory with a `command.sh` inside. Nested commands use nested directories — the dispatcher walks as deep as the positional args match, so `juno harness claude anthropic opus-4-6` resolves to `commands/harness/claude/command.sh` with `anthropic opus-4-6` as `$@`.

```
commands/
├── PRIMER.md               ← this file (agent orientation)
├── README.md               ← human-facing philosophy + sovereignty message
├── .gitignore              ← whitelist-style: * ignored, then !foo per folder
├── harness/
│   ├── command.sh
│   ├── PRIMER.md
│   ├── claude/command.sh
│   ├── opencode/command.sh
│   └── default/command.sh
├── probe/
│   ├── command.sh
│   └── PRIMER.md
├── think/command.sh
└── ...
```

Minimum contract for a `command.sh`:

- `#!/usr/bin/env bash` + `set -euo pipefail` (or `set -e` if you have bash-array edge cases)
- `-h` / `--help` / `help` prints a usage block to stderr and exits 0
- Reads `$ENTITY`, `$ENTITY_DIR`, `$CWD` from the env the dispatcher sets
- Honors `KOAD_IO_ROOTED` if the behavior depends on rooted-vs-roaming cwd
- Exits with conventional codes: `64` usage error, `66` missing input file, `69` missing dependency

## Current state

| Command  | Status      | One-line purpose |
|----------|-------------|------------------|
| `harness`  | **shipped** | entity × harness × provider × model launcher; includes human harnesses `bash`/`zsh`; see `harness/PRIMER.md` |
| `probe`    | **shipped** | naked-LLM context testing (layer 1); see `probe/PRIMER.md` |
| `think`    | **shipped** | raw one-liner to fourty4 ollama for local inference (not entity-aware) |
| `io`       | **shipped** | `.io` container format for sovereign identity capsules |
| `install`  | **shipped** | post-clone setup |
| `sign`     | **shipped** | clearsign-style wrapper for keybase saltpack |
| `build`    | shipped     | runtimer |
| `commit`   | shipped     | entity commit flow |
| `gestate`  | shipped     | new-entity creation |
| `init`     | shipped     | entity bootstrap |
| `respond`  | shipped     | reply to GitHub issues / chat |
| `shell`    | shipped     | interactive shell inside an entity env |
| `spawn`    | shipped     | process/entity spawner |
| `start`    | shipped     | runtime start |
| `upload`   | shipped     | publish content |
| `upstart`  | shipped     | service supervision |
| `test`     | placeholder | — |
| `assert`   | placeholder (datadir only) | — |
| `deploy`   | placeholder | — |
| `outfit`   | placeholder | — |
| `party`    | placeholder | — |

"Placeholder" means the directory exists (as a slot in the gitignore whitelist and as a reminder of intent) but there is no `command.sh` yet. See `README.md` — the koad:io philosophy is that unfinished command slots *are* a form of documentation: they declare what should exist.

## The `.gitignore` whitelist

`commands/.gitignore` is **deny-by-default**:

```gitignore
# Ignore all files in the folder
*
*/
!.gitignore

# Include specific command folders
!assert
!harness
!harness/**
!probe
!probe/**
...
```

Two rules worth knowing:

1. **New commands need a whitelist entry.** Adding `foo/command.sh` without `!foo` in `commands/.gitignore` means git silently ignores it and the command vanishes when you clone fresh.
2. **Nested commands need `!foo/**` too.** The bare `!foo` whitelists the directory but **not its children** (`foo/command.sh` stays ignored). Look at `harness/` + `harness/**` and `probe/` + `probe/**` for the pattern. This bit us when adding `probe` — the bare `!probe` was present but `!probe/**` was missing, so `git status` didn't show the new file at all.

Checklist when adding a new framework command:

1. `mkdir ~/.koad-io/commands/<name>/`
2. Write `<name>/command.sh` + make it executable
3. Write `<name>/PRIMER.md` (agent orientation — current state, open items)
4. Add **both** `!<name>` and `!<name>/**` to `commands/.gitignore`
5. Update the table in this PRIMER
6. Commit

## Related

- `README.md` — the human-facing README: sovereignty principles, why you shouldn't blindly copy, command-index-by-category. Philosophy, not orientation.
- `~/.koad-io/commands/harness/PRIMER.md` — deep dive on the harness command (SPEC-072 operator surface, session continuity, the `default` meta-harness).
- `~/.koad-io/commands/probe/PRIMER.md` — deep dive on the probe command (naked-LLM primitive, A/B test methodology, layers 2 and 3).
- `VESTA-SPEC-006` — Commands System spec (how the dispatcher resolves nested paths, env cascade, exec semantics).
- `~/.koad-io/hooks/PRIMER.md` — the sibling surface; commands are the *user reaches in*, hooks are the *system calls out*.
