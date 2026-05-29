---
title: "harness command — koad:io harness router"
author: livy
date: 2026-05-07
status: current
type: developer-reference
relates-to:
  - /home/koad/.forge/commands/harness/command.sh
  - /home/koad/.forge/commands/harness/claude/command.sh
  - /home/koad/.forge/commands/harness/opencode/command.sh
  - /home/koad/.forge/commands/harness/default/command.sh
  - /home/koad/.forge/commands/harness/PRIMER.md
  - /home/koad/.forge/commands/README.md
  - /home/koad/.forge/packages/throne/README.md
entities:
  - livy
  - vulcan
  - juno
audience: developers building on or extending the koad:io harness system
---

# `harness` — koad:io harness router

Launch an entity through a chosen **harness x provider x model**. This is the operator surface for VESTA-SPEC-072 (Entity-Dir-as-Harness-Container) — every sub-command exports the entity directory as the harness config root, so the entity's identity, memories, trust bonds, and session state all live at the same path.

## Usage

```bash
<entity> harness <harness> [provider] [model] [prompt]
```

`<harness>` is required — but it can be the literal string `default` to use whatever `$ENTITY_DEFAULT_HARNESS` resolves to in the entity's `.env`. `<provider>` and `<model>` are always optional; each sub-command cascades missing values from the entity's `.env`, then the kingdom `.env`, then its own hardcoded default.

### Examples

```bash
# Fully explicit
juno  harness claude   anthropic opus-4-6
sibyl harness claude   anthropic sonnet-4-6 "scan briefs for blockers"
vesta harness opencode ollama    deepseek-r1
alice harness claude   anthropic haiku-4-5  "hi"

# Provider/model omitted — entity .env owns the defaults
vesta harness claude
vesta harness claude "close out the S1 triage batch"

# Harness also omitted via the 'default' meta-harness
vesta harness default
vesta harness default "close out the S1 triage batch"
alice harness default

# Local inference (no credentials needed)
think harness ollama deepseek-r1 "what is entropy"

# Human harness — entity shell with no LLM involved
juno harness bash
juno harness bash "git status"
```

Prompt is optional — if present, the harness runs one-shot (`-p`); if absent, it runs interactively.

### Multi-word prompts

Multi-word prompts can be passed via environment variable to sidestep shell quoting through koad-io's dispatcher:

```bash
PROMPT="review SPEC-072 and list gaps" vesta harness default
```

**Quoting-free form — pipe via stdin.** When the prompt contains nested quotes, `$vars`, backticks, or newlines, pipe it in. Stdin is read when it is not a TTY, and the content bypasses shell word-splitting entirely:

```bash
# Heredoc — the canonical form for anything non-trivial
cat <<'EOF' | vesta harness default -c
Here's a prompt with 'single' and "double" quotes,
$variables, `backticks`, and
multiple lines — all literal.
EOF

# File
cat brief.md | vesta harness default

# Command output
gh issue view 42 | vesta harness default -c
```

Precedence is `$PROMPT` env var -> stdin pipe -> positional args. The first one populated wins.

## Session continuity

Add `--continue` or `-c` to resume the most recent session for the current working directory (or set `CONTINUE=1` as an env var).

```bash
# New message to the same running conversation
PROMPT="follow-up question" vesta harness default -c

# Resume interactively
vesta harness default -c

# Resume a specific session by ID (claude harness only)
vesta harness claude --resume <session-id>
```

When `-c` is used without a prompt and without `--resume`, the claude harness prints a session picker that lists recent sessions with previews, then exits. This lets you inspect what's available before committing to `--resume <id>`.

**Rooted entities get exactly one persistent session per entity.** Because `$CWD` is always `$ENTITY_DIR` for a rooted entity (Juno, Vesta), `-c` always resumes the same session — stable memory across invocations, from any caller location.

**Roaming entities get one session per `(entity x project-dir)` pair.** A roaming entity (Vulcan, Mercury) invoked inside `~/code/foo` will resume its `foo` session; invoked inside `~/code/bar` will resume its `bar` session.

## Directory shape

```
~/.forge/commands/harness/
├── command.sh          # dispatcher — help + list installed harnesses
├── README.md           # this file
├── PRIMER.md           # agent orientation (deeper theory than this doc)
├── claude/
│   └── command.sh      # Claude Code harness
├── opencode/
│   ├── command.sh      # opencode TUI/run harness
│   ├── sidecar.py      # optional SSE cost/heartbeat sidecar
│   └── probe.py        # session probe utility
├── default/
│   └── command.sh      # meta-harness: resolves $ENTITY_DEFAULT_HARNESS
├── bash/
│   └── command.sh      # human harness — entity shell, no LLM
├── zsh/
│   └── command.sh      # human harness — zsh variant (Mac hosts)
├── pi/
│   └── command.sh      # pi-mono harness (draft, unverified on fourty4)
├── ollama/
│   └── command.sh      # local ollama inference (lightweight, no identity)
└── rebuild-agents/
    └── command.sh      # regenerate Claude Code subagent definition files
```

## Installed harnesses

| Harness | Status | Config-dir mechanic | Notes |
|---------|--------|---------------------|-------|
| `default` | shipped | (delegates) | Meta-harness. Resolves `$ENTITY_DEFAULT_HARNESS` and execs the chosen sub-command with `$PROMPT` exported. |
| `claude` | shipped | `CLAUDE_CONFIG_DIR=$ENTITY_DIR` | Claude Code. Verified with real CLI. Provider: anthropic only. |
| `opencode` | shipped | `XDG_CONFIG_HOME=$ENTITY_DIR` | opencode TUI + `opencode run`. Providers: anthropic, openai, ollama, openrouter, google/gemini, opencode-zen. |
| `bash` | shipped | (none — human harness) | Entity shell. No LLM. Loads entity env, cd to rooted/roaming cwd, entity-tagged PS1. |
| `zsh` | shipped | (none — human harness) | Mirror of bash for Mac hosts (fourty4). Uses per-entity ZDOTDIR. Untested on wonderland (Linux). |
| `pi` | draft | `PI_CONFIG_DIR` + `XDG_CONFIG_HOME` | pi-mono harness. **UNVERIFIED** — drafted from SPEC-072 rules, needs validation on fourty4. |
| `ollama` | shipped | (none) | Lightweight local inference via ollama. No identity, no session, no tools — just prompt-in/text-out. Also exposed as the `think` command. |
| `rebuild-agents` | utility | (none) | Regenerates Claude Code subagent definition files from structured data sources. Used by Juno for agent maintenance. |
| `tui` | not started | — | Planned. |
| `hermez` | not started | — | Planned. NousResearch v0.6.0; GPG bonds need a custom plugin. |

## Defaults cascade

Three axes resolve independently, each with the same shape:

```
harness:  positional arg
            -> $ENTITY_DEFAULT_HARNESS    (~/.<entity>/.env)
            -> $KOAD_IO_DEFAULT_HARNESS   (~/.koad-io/.env)
            -> opencode                   (hardcoded)

provider: positional arg
            -> $ENTITY_DEFAULT_PROVIDER   (~/.<entity>/.env)
            -> $KOAD_IO_DEFAULT_PROVIDER  (~/.koad-io/.env)
            -> anthropic                  (hardcoded per sub-command)

model:    positional arg
            -> $ENTITY_DEFAULT_MODEL      (~/.<entity>/.env)
            -> $KOAD_IO_DEFAULT_MODEL     (~/.koad-io/.env)
            -> per sub-command            (opus-4-6 for claude, big-pickle for opencode)
```

Only the `default` meta-harness resolves the harness axis. Provider and model are resolved inside each real sub-command, so the cascade is identical whether you called `vesta harness default`, `vesta harness claude`, or `vesta harness claude anthropic sonnet-4-6`.

Recommended entity `.env` block:

```bash
ENTITY_DEFAULT_HARNESS=claude
ENTITY_DEFAULT_PROVIDER=anthropic
ENTITY_DEFAULT_MODEL=sonnet-4-6
```

## Sub-command contract

Each `harness/<harness>/command.sh` is responsible for five things:

1. **Config-dir invariant.** Export `<HARNESS>_CONFIG_DIR=$ENTITY_DIR`. For claude, that is `CLAUDE_CONFIG_DIR`. For opencode, `XDG_CONFIG_HOME`. This is the structural rule from SPEC-072.
2. **Credentials resolution.** The koad-io loader cascades `~/.koad-io/.credentials` -> `~/.<entity>/.credentials` into the environment before this script runs. Sub-commands validate that the required keys for the requested provider are present and warn if not.
3. **Model normalization.** Accept both short names (`opus-4-6`) and full IDs (`claude-opus-4-6`); resolve to whatever the underlying CLI expects.
4. **Rooted vs roaming cwd.** Read `KOAD_IO_ROOTED` from the entity `.env`. If `true`, cd to `$ENTITY_DIR`. If unset or `false`, stay in `$CWD` (so roaming entities operate on the project they were invoked inside).
5. **Interactive vs one-shot.** No prompt -> interactive session. Prompt given -> one-shot with the harness's equivalent of `-p`.

## Lifecycle environment variables

These variables are set by the harness wrapper process and are available to all subprocesses (hooks, session commands, MCP tools):

| Variable | Set by | Value |
|----------|--------|-------|
| `HARNESS_PID` | claude, opencode | PID of the wrapper bash process (not the underlying CLI) |
| `HARNESS_SESSION_ID` | claude, opencode | `<entity>-<harness-pid>` — stable for this wrapper's lifetime; shared by all subprocesses via the process tree |
| `HARNESS_EMISSION_ID_FILE` | claude, opencode | Path to a file containing the current session's emission ID (persists across resume) |
| `KOAD_IO_SPIRIT` | claude, opencode | Who is at the keyboard — defaults to `$USER` until sovereign-login is wired |
| `KOAD_IO_MCP_SESSION_TOKEN` | claude | Pre-registered UUID for MCP auth. Registered with the daemon before the claude CLI starts; cleaned up on exit. |
| `KOAD_IO_SESSION_KEK` | claude | Session key encryption key from the memory KEK ceremony (if `KOAD_IO_MEMORY_ENABLED=1`). Empty if ceremony aborted. |
| `KOAD_IO_HARNESS` | bash, zsh | Set to the harness name so rc files can detect the context. |

The PID file and emission ID file are written to `$ENTITY_DIR/.local/state/harness/`. The session-scanner and daemon use these to correlate running processes with emissions and detect orphaned sessions.

## Entity behavior flags

These flags live in the entity's `.env` and modify harness behavior for that entity:

| Flag | Harness | Effect |
|------|---------|--------|
| `ENTITY_CONTINUE=true` | claude | Auto-resume the last session on interactive startup. One-shot mode is unaffected — that is an explicit caller choice. |
| `ENTITY_SKIP_PERMISSIONS=true` | claude | Passes `--dangerously-skip-permissions`. Juno-only by convention — orchestrator entities can not pause mid-flight to ask for approval. |
| `ENTITY_LOCKFILE=true` | claude | Refuse to launch one-shot mode if another one-shot is already running for this entity. Prevents orchestrators from racing two dispatches into the same conversation. Interactive mode is intentionally unguarded. |
| `ENTITY_EXTRACT_RESULT=true` | claude | Force `--output-format=json` and emit only the `.result` field. Gives orchestrators a clean string without the JSON envelope. Interactive mode is unaffected. |
| `KOAD_IO_MEMORY_ENABLED=1` | claude | Run the memory KEK ceremony before launching. Prompts for the memory passphrase, exports `KOAD_IO_SESSION_KEK` if successful. |

## Emission system integration

Both the claude and opencode harnesses integrate with the daemon emission system at startup and shutdown:

- **On launch:** emits `session` (interactive) or `flight` (one-shot) with harness, model, PID, spirit, host, cwd metadata.
- **On resume:** reconnects to the existing emission rather than opening a new one.
- **On exit:** emits close with clean/interrupted/error classification.
- **Heartbeat (opencode only):** when `KOAD_IO_OPENCODE_SSE_PORT` is set, a Python sidecar (`sidecar.py`) tails the opencode SSE stream, computes cost from token usage, and updates the emission throughout the session.

The emission ID is written to `HARNESS_EMISSION_ID_FILE` so hooks and session commands can annotate it mid-flight without needing to track the ID themselves.

## Rooms

The claude and opencode harnesses support `KOAD_IO_ROOM` — a caller-pinned directory used as the config root instead of `$ENTITY_DIR`. Rooms are sealed portable workspaces: their own session history lives in the room dir and travels with it. Multiple roaming entities visiting the same room via `--session-id` share the same conversation file naturally.

If `KOAD_IO_ROOM` is set and is a valid directory, it wins over all other config-dir modes.

## Relationship to entity launchers

The entity launchers at `~/.koad-io/bin/<entity>` (e.g. `juno`, `vesta`) are quick-start paths with the entity's defaults baked in. `harness` is the explicit override for when you want to pin a harness, switch providers, or test a different model. Both paths go through the same koad-io dispatcher and honor the same environment cascade.

`juno` with no subcommand is shorthand for `juno harness default`. The `harness` command makes the four-axis cube (entity x harness x provider x model) explicit and addressable from the shell.

## Why this command exists

Once you accept SPEC-072 — the entity directory IS the harness config directory — the same entity can be run through any harness that honors the convention. `harness` is what makes that cube addressable from the shell. Without it, the abstraction is invisible; with it, it is one command away.

See `PRIMER.md` in this directory for the deeper theory: what makes something a harness, when to add a dispatcher vs. a plugin, and the "any app" thesis.

## See also

- **VESTA-SPEC-072** — Entity Directory as Harness Container (structural rule)
- **VESTA-SPEC-053** — Entity Portability Contract
- **VESTA-SPEC-067** — Context Load Order
- **VESTA-SPEC-006** — Commands System (how koad-io resolves nested commands)
- `~/.forge/packages/throne/README.md` — the Meteor-side harness endpoint that claude and opencode connect through
- `~/.forge/commands/harness/PRIMER.md` — agent-facing orientation and deeper theory
