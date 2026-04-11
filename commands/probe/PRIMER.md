# PRIMER — `~/.koad-io/commands/probe/`

> Naked-LLM context testing primitive. Makes entity context segments falsifiable.

## What this command is

`probe` runs `opencode` in a **sealed, entity-less** mode with a hand-picked context slice + prompt. The LLM sees only the files you attach and the prompt — no `ENTITY.md`, no memories, no harness loadout, no cwd-inherited `AGENTS.md`, no external plugins.

The point is **falsifiability.** Before probe, every memory/feedback/project file in `~/.<entity>/` was trusted to shape behavior but never measured. With probe, each file becomes a testable unit:

- **A/B test memories.** Does `feedback_gtd_alignment.md` shift answers to "should we build this speculative feature?" — run the prompt with and without the file, diff the output.
- **Bisect a loadout.** Entity gave a surprising answer → drop context files one at a time until the behavior changes. `git bisect` for context.
- **Regression-test memory edits.** Before landing a rewrite, run a probe suite; after, re-run; flag regressions.
- **Reproduce past decisions.** `(git sha of entity dir + context slice + prompt) → answer`. If answers match, the reasoning is auditable. If not, something else was in the room — investigate.

## Usage

```bash
probe [options] "prompt"
echo "prompt" | probe [options]
```

**Options:**

| Flag | Purpose |
|------|---------|
| `-c`, `--context <file>` | Context file to attach (repeatable). Relative paths resolve against `$ENTITY_DIR` when set, else `$PWD`. |
| `-m`, `--model <id>` | Model in `provider/model` format. Default `opencode/big-pickle`. |
| `-n`, `--dry-run` | Print what would be sent, don't call the LLM. |
| `-h`, `--help` | Show help. |

**Environment:**

- `PROBE_MODEL` — override the default model without a flag.

## Examples

```bash
# Does the GTD-alignment feedback memory actually shape answers?
juno probe -c memories/feedback_gtd_alignment.md \
  "should we build a speculative analytics dashboard?"

# Bisect a context slice across two files
juno probe -c ENTITY.md -c memories/feedback_commit_push.md \
  "should I push this commit to GitHub right now?"

# Pipe a long prompt instead of inlining it
cat question.txt | juno probe -c memories/feedback_pr_protocol.md

# Dry-run to see exactly what would be sent
juno probe -n -c ENTITY.md "who are you?"

# Override the model
juno probe -m anthropic/claude-sonnet-4-6 -c ENTITY.md "who are you?"
```

## How the sealing works

The naked environment is enforced at four layers, in this order:

1. **`unset XDG_CONFIG_HOME`.** Rooted entities (Juno, Vesta) have `XDG_CONFIG_HOME=$ENTITY_DIR`, which would leak entity-flavored opencode config into the probe run. Unsetting falls back to `~/.config/opencode` — user-default, where auth lives — so auth is preserved and entity flavor is dropped.
2. **`--dir /tmp`.** opencode walks up from cwd looking for `AGENTS.md`. Pointing `--dir` at `/tmp` sidesteps that entirely.
3. **`--pure`.** Disables external opencode plugins on this run. Nothing extra is loaded beyond the core runtime.
4. **No `--agent`.** opencode uses its default agent, not any entity-specific one.

**Result:** the LLM's context is exactly `opencode-system-prompt + attached-files + user-prompt`. Nothing else.

## Argument-parsing gotcha (yargs + file arrays)

opencode's `run` subcommand is yargs-based. `-f FILE "prompt"` is **greedy** — `-f` as an array option swallows the positional prompt as another file. The script works around this two ways:

- Uses `--file=FILE` equals-form instead of `-f FILE` (no ambiguity about which token is the value).
- Inserts a literal `--` before the prompt positional, which yargs respects as "everything after this is positional, not a flag value."

If you ever copy the exec line out of this script and modify it, keep both of those — dropping either will cause opencode to error with `File not found: <your prompt text>`.

## Current state

- **Layer 1 shipped** 2026-04-11. Commit `490d6b5` in `~/.koad-io` (not pushed). Proven with an A/B against `~/.juno/ENTITY.md` — attached yields correct Juno self-ID, no context yields generic "AI assistant."
- **Default model: `opencode/big-pickle`.** Free-first policy — every koad:io framework default must be reachable without an API key, credit card, or signup. Big-pickle (opencode's free tier) is the only provider that currently hits that bar, so it's the default for probe, for the opencode harness, and for any future framework command that needs to make an LLM call. Per-entity `.env` files override the default once a user has opted into paid providers. See `feedback_free_first_defaults.md` in Juno's memory for the full rule.
- **Plugin disabled = ollama unavailable.** `--pure` strips the ollama plugin, so `-m ollama/<model>` fails with `ProviderModelNotFoundError` inside probe. Not a bug — a consequence of the sealing. See "Open items" below.

## Open items

- [ ] **`probe audit` (layer 2).** Snapshot `(git sha of attached files, prompt, response, timestamp, model, environment hash)` → sign with entity key → append to `~/.<entity>/audits/probe/`. Turns every probe run into a cryptographically attributable decision record. Ties to `project_verified_action_stack` in Juno's memory — reproducibility is the precondition for attribution.
- [ ] **`probe test` (layer 3).** YAML suites of `(context, prompt, assertion)` tuples. `juno probe test memories/tests/gtd.yaml` runs every case, reports pass/fail, exits non-zero on regression. Make it hookable from a pre-commit on `~/.<entity>/` so memory edits can't land without passing the probe suite.
- [ ] **Local-inference escape hatch.** Add `--impure` / `--plugins` that drops the `--pure` flag so `-m ollama/<model>` works for local-only probes (cheap, private, no API cost). The trade-off: external plugins might leak state we're trying to seal. Worth investigating the plugin list before enabling.
- [ ] **Refresh stale anthropic auth** in `~/.local/share/opencode/auth.json` (`invalid x-api-key` on haiku/sonnet/opus). Independent of the free-first default — it just means `-m anthropic/...` overrides don't work right now even for users who have opted into the paywall. Would unblock fall-through to claude models when specifically requested.
- [ ] **Harness-floor measurement.** Use probe to measure how much a given entity's loadout actually costs in tokens. Run a minimal ping prompt naked vs with the entity's full file set; the delta is the entity's real context weight. Cacheable per `(entity × model)`; useful for entity optimization.

## Related

- `~/.koad-io/commands/PRIMER.md` — the parent directory's primer, explains the command paradigm and gitignore whitelist quirk (you need both `!probe` **and** `!probe/**`).
- `~/.koad-io/commands/harness/PRIMER.md` — the sibling command, the *stateful* launcher. probe is its mirror image: stateless, one-shot, context-injected.
- `~/.koad-io/commands/think/command.sh` — a related but distinct primitive: raw ollama on fourty4, no harness integration. Use `think` for quick local inference when identity doesn't matter; use `probe` when you want to test *specific context files* in isolation.
- Juno memory `project_probe_command.md` — captures the build story, the A/B proof, and the gotchas from shipping layer 1.
- Juno memory `feedback_naked_llm_primitive.md` — the asymmetry insight that motivated probe (opencode stateless vs claude stateful-by-design).
