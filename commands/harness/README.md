# `harness` — koad:io harness router

Launch an entity through a chosen **harness × provider × model**. This is the operator surface for VESTA-SPEC-072 (Entity-Dir-as-Harness-Container) — every sub-command sets `<HARNESS>_CONFIG_DIR=$ENTITY_DIR` before exec, so the entity's identity, memories, trust bonds, and harness state all live at the same root.

## Usage

```bash
<entity> harness <harness> [provider] [model] [prompt]
```

`<harness>` is required — but it can be the literal string `default` to use whatever `$ENTITY_DEFAULT_HARNESS` resolves to in the entity's `.env`. `<provider>` and `<model>` are **always optional**; each sub-command cascades missing values from the entity's `.env`, then the kingdom `.env`, then its own hardcoded default.

### Examples

```bash
# Fully explicit
juno  harness claude   anthropic opus-4-6
sibyl harness claude   anthropic sonnet-4-6 "scan briefs for blockers"
vesta harness opencode ollama    deepseek-r1
alice harness claude   anthropic haiku-4-5  "hi"

# Provider/model omitted — each harness reads ENTITY_DEFAULT_* from the entity's .env
vesta harness claude
vesta harness claude "close out the S1 triage batch"

# Harness also omitted — the 'default' meta-harness reads ENTITY_DEFAULT_HARNESS
vesta harness default
vesta harness default "close out the S1 triage batch"
alice harness default
```

Prompt is optional — if present, the harness runs one-shot (`-p`); if absent, it runs interactively.

Multi-word prompts can also be passed via environment variable to sidestep shell quoting through koad-io's dispatcher:

```bash
PROMPT="review SPEC-072 and list gaps" vesta harness default
```

## Directory shape

```
~/.koad-io/commands/harness/
├── command.sh            # dispatcher — help + list installed harnesses
├── README.md             # this file
└── <harness>/
    └── command.sh        # one per harness — see contract below
```

Current harnesses: **default** (meta), **claude**, **opencode**, **pi** (draft). Planned: **tui**, **hermez**.

## Sub-command contract

Each `harness/<harness>/command.sh` is responsible for five things:

1. **Config-dir invariant.** Export `<HARNESS>_CONFIG_DIR=$ENTITY_DIR`. For claude, that's `CLAUDE_CONFIG_DIR`. For opencode, `OPENCODE_CONFIG_DIR` (if it exists — otherwise document the deviation). This is the structural rule from SPEC-072.
2. **Credentials resolution.** The koad-io loader already cascades `~/.koad-io/.credentials` → `~/.<entity>/.credentials` into the environment before this script runs. Sub-commands validate that the required keys for the requested provider are present and warn if not.
3. **Model normalization.** Accept both short names (`opus-4-6`) and full IDs (`claude-opus-4-6`); resolve to whatever the underlying CLI expects.
4. **Rooted vs roaming cwd.** Read `KOAD_IO_ROOTED` from the entity `.env`. If `true`, cd to `$ENTITY_DIR`. If unset or `false`, stay in `$CWD` (so roaming entities operate on the project they were invoked inside).
5. **Interactive vs one-shot.** No prompt → interactive session. Prompt given → one-shot with the harness's equivalent of `-p`.

## Defaults cascade

Three axes resolve independently, each with the same shape:

```
harness:  positional arg
            → $ENTITY_DEFAULT_HARNESS    (~/.<entity>/.env)
            → $KOAD_IO_DEFAULT_HARNESS   (~/.koad-io/.env)
            → opencode                   (hardcoded)

provider: positional arg
            → $ENTITY_DEFAULT_PROVIDER   (~/.<entity>/.env)
            → $KOAD_IO_DEFAULT_PROVIDER  (~/.koad-io/.env)
            → anthropic                  (hardcoded per sub-command)

model:    positional arg
            → $ENTITY_DEFAULT_MODEL      (~/.<entity>/.env)
            → $KOAD_IO_DEFAULT_MODEL     (~/.koad-io/.env)
            → per sub-command            (opus-4-6 for claude, claude-sonnet-4-6 for opencode)
```

Only the `default` meta-harness resolves the **harness axis**. Provider and model are resolved inside each real sub-command (claude, opencode, …) so the cascade is identical whether you called `vesta harness default`, `vesta harness claude`, or `vesta harness claude anthropic sonnet-4-6`.

Recommended entity `.env` block (entity-scoped under the `ENTITY_` namespace):

```bash
ENTITY_DEFAULT_HARNESS=claude
ENTITY_DEFAULT_PROVIDER=anthropic
ENTITY_DEFAULT_MODEL=sonnet-4-6
```

Entities can pin their own preferences without affecting other entities. A kingdom-wide fallback can be set in `~/.koad-io/.env` using the `KOAD_IO_DEFAULT_*` form.

## Relationship to existing launchers

The entity launchers at `~/.koad-io/bin/<entity>` (e.g. `juno`, `vesta`) continue to work as quick-start paths with the entity's defaults. `harness` is the **explicit override** for when you want to pin a harness, switch providers, or test a different model. Both paths go through the same koad-io dispatcher and honor the same environment cascade.

## Why this command exists

Once you accept SPEC-072 — the entity directory IS the harness config directory — the same entity can be run through any harness that honors the convention. `harness` is what makes that four-axis cube (entity × harness × provider × model) addressable from the shell. Without it, the abstraction is invisible; with it, the abstraction is one command away.

## See also

- **VESTA-SPEC-072** — Entity Directory as Harness Container (structural rule)
- **VESTA-SPEC-053** — Entity Portability Contract
- **VESTA-SPEC-067** — Context Load Order
- **VESTA-SPEC-006** — Commands System (how koad-io resolves nested commands)
