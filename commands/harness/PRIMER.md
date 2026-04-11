# PRIMER — `~/.koad-io/commands/harness/`

> The harness router. Drop-in point for the operator surface of VESTA-SPEC-072 (Entity-Dir-as-Harness-Container).

## What this directory is

The koad:io `harness` built-in lets any entity be launched through any harness with any provider and any model. One primitive, four axes:

```
<entity> harness <harness> <provider> <model> [prompt]
```

Every sub-directory here is one harness. Every sub-command is responsible for the same five things:

1. Export `<HARNESS>_CONFIG_DIR=$ENTITY_DIR` (the SPEC-072 structural rule — mechanically it may be `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `PI_CONFIG_DIR`, etc., depending on what the underlying CLI respects)
2. Cascade-resolve credentials for the requested provider (koad-io loader has already sourced `~/.koad-io/.credentials` → `~/.<entity>/.credentials` into the environment before this script runs)
3. Normalize the model name into whatever the harness CLI expects
4. Honor `KOAD_IO_ROOTED` for cwd selection (`$ENTITY_DIR` if rooted, `$CWD` if roaming)
5. Interactive mode when no prompt; one-shot with the harness's `-p` equivalent when a prompt is present

## Current state

| Harness  | Status      | Config-dir mechanic                   | Notes |
|----------|-------------|---------------------------------------|-------|
| claude   | **shipped** | `CLAUDE_CONFIG_DIR=$ENTITY_DIR`       | Verified with real `claude` CLI. Provider: anthropic. |
| opencode | **shipped** | `XDG_CONFIG_HOME=$ENTITY_DIR`         | Verified with fake binary. Providers: anthropic/openai/ollama/openrouter/google + passthrough. |
| pi       | **draft**   | `PI_CONFIG_DIR` + `XDG_CONFIG_HOME`   | **UNVERIFIED** — drafted from memory, pending validation on fourty4 where pi-mono actually runs. Binary name, flags, and model format all guessed. See the TESTING NOTES block in `pi/command.sh`. |
| tui      | not started | —                                     | Planned. |
| hermez   | not started | —                                     | Planned. NousResearch v0.6.0; GPG bonds need custom plugin. |

## Files at this level

- `command.sh` — top-level dispatcher. Fires only when no sub-harness matches the second positional arg. Auto-discovers installed harnesses by listing sibling dirs that hold a `command.sh`, prints usage, lists what's available, errors clearly on unknown harness.
- `README.md` — human-facing documentation of the convention, contract, and defaults cascade. Link this when introducing the concept.
- `PRIMER.md` — this file. Agent orientation: what's here, current state, where to work next.
- `<harness>/command.sh` — one per harness.

## How dispatch reaches a sub-harness

The koad-io CLI (`~/.koad-io/bin/koad-io`) finds the **deepest matching command directory** against the positional args.

For `juno harness claude anthropic opus-4-6 "hi"`:

- depth 1: `~/.koad-io/commands/harness/` exists → candidate
- depth 2: `~/.koad-io/commands/harness/claude/` exists → deeper, wins
- `EXEC_ARGS` becomes `"anthropic opus-4-6 hi"`
- exec `harness/claude/command.sh anthropic opus-4-6 hi`

Word-splitting on exec means multi-word prompts arrive as separate positional args. Sub-commands must either `PROMPT="$*"` to reassemble, or honor an env-var `PROMPT` override for callers who want to sidestep the splitting.

## Adding a new harness

Drop-in checklist:

1. `mkdir ~/.koad-io/commands/harness/<name>/`
2. Write `<name>/command.sh` — copy `claude/command.sh` or `opencode/command.sh` as a starting template. Both follow the same five-section structure: guard rails → arg parsing → provider awareness → model normalization → SPEC-072 invariants → cwd → announce → exec.
3. `chmod +x <name>/command.sh`
4. Update `commands/.gitignore` — new harnesses are auto-allowlisted by the `!harness/**` rule, so no gitignore change is needed.
5. Test with a fake binary stub: drop an executable named `<cli>` on `PATH` that echoes its args + any config env vars. Run `<entity> harness <name> <provider> <model>` and verify the announce banner + exec line.
6. Test with the real CLI if available.
7. Commit. Update this PRIMER's "Current state" table.

## SPEC-072 relationship

This directory **is** the operator surface of SPEC-072. The spec says "entity directory IS the harness config directory." Without a command that exercises that contract, the abstraction is invisible — the entity dir and the harness config dir happen to be the same place, but nobody can feel it. With `harness`, the four-axis cube (entity × harness × provider × model) becomes addressable from the shell in one line, and the abstraction becomes load-bearing.

Notable observation from implementation: SPEC-072's structural rule applies **mechanically differently** per harness. claude wants a dedicated `CLAUDE_CONFIG_DIR` env var. opencode wants `XDG_CONFIG_HOME` pointed at the entity root (plus a workspace-local `opencode.jsonc`). pi-mono probably wants something else again. The conformance section of SPEC-072 needs to enumerate these variants, not assume one env var name. Feed this back to Vesta next pass on 072.

## Related specs

- **VESTA-SPEC-072** — Entity Directory as Harness Container (the structural rule)
- **VESTA-SPEC-006** — Commands System (how koad-io resolves nested commands)
- **VESTA-SPEC-053** — Entity Portability Contract (what 072 extends)
- **VESTA-SPEC-067** — Context Load Order (adjacent — layer 3 is harness config)

## Known open items

- [ ] `harness/pi/command.sh` needs validation on fourty4. Every `# UNVERIFIED` comment in that script is a future patch.
- [ ] `harness/tui/command.sh` — not started.
- [ ] `harness/hermez/command.sh` — not started; blocked on GPG bond plugin for NousResearch.
- [ ] Sibyl field report on multi-harness coexistence (brief filed at `~/.sibyl/briefs/multi-harness-container-field-report.md`) — when Sibyl runs claude alongside opencode at `~/.sibyl`, this directory's convention gets lived-data validation and SPEC-072 can land canonical.
- [ ] Consider adding a `providers.yaml` registry so model-name aliases are decoupled from individual harness scripts. Deferred until the duplication actually hurts.
