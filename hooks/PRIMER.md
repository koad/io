<!-- SPDX-License-Identifier: CC0-1.0 -->

# hooks/

Framework-level hook defaults. Every file here is a template. If an entity
has a file with the same name in its own `~/.$ENTITY/hooks/` folder, that
file fires instead and the framework default is never called.

Most entities should NOT ship overrides. The framework defaults read each
entity's `.env` cascade and behave correctly for every shipped harness
(claude, opencode, pi, hermez). An override is only justified when an
entity needs behavior the cascade cannot express — and when that happens,
the preferred fix is to teach the cascade a new knob, not fork the hook.

Current overrides in the field (as of 2026-04-14):

| Entity | File | Reason | Retire when |
|--------|------|--------|------------|
| juno   | `executed-without-arguments.sh` | pre-cascade fork, `--dangerously-skip-permissions` | `ENTITY_SKIP_PERMISSIONS=true` added to `.env`, delete fork |
| chiron | `executed-without-arguments.sh` | pre-cascade fork, injects CWD PRIMER.md into PROMPT | move CWD-primer injection into framework default (or let harness/claude handle it) |

---

# entity-upstart.sh

Template for an entity's upstart script. Copy to `~/.$ENTITY/hooks/upstart.sh`
to make the entity participate in upstart.

```bash
cp ~/.koad-io/hooks/entity-upstart.sh ~/.$ENTITY/hooks/upstart.sh
```

`koad-io upstart` (bound to `<Super>u` on desktop) runs
`~/.koad-io/commands/upstart/command.sh`, which:

- If `$ENTITY` is set: fires `~/.$ENTITY/hooks/upstart.sh` only
- If `$ENTITY` is unset: scans all `~/.*` dirs and fires every `hooks/upstart.sh` found

A lock in `/dev/shm/.koad-io/locks/upstart` prevents double-firing per
session.

---

# executed-without-arguments.sh

Called when an entity command is invoked with no arguments — `vulcan`,
`juno`, `alice`. Single global script, no per-entity logic baked in. The
script itself is ~45 lines: pick the working directory (rooted vs roaming),
set a terminal title, delegate to `harness default`.

All divergence between entities is expressed through the `.env` cascade.
Adding a new entity should never require touching this file.

## Env-var contract

Read in this precedence (first hit wins):

1. Entity `.env` at `~/.$ENTITY/.env`
2. Framework `.env` at `~/.koad-io/.env`
3. Hardcoded fallback inside the leaf harness script

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENTITY_DEFAULT_HARNESS` | `opencode` | Which AI harness to launch. Valid: `claude`, `opencode`, `pi`, `hermez`. |
| `ENTITY_DEFAULT_PROVIDER` | harness-specific | Provider inside the harness (e.g. `anthropic`, `ollama`). |
| `ENTITY_DEFAULT_MODEL` | harness-specific | Model name (e.g. `opus-4-6`, `big-pickle`). |
| `ENTITY_SKIP_PERMISSIONS` | `false` | If `true`, pass `--dangerously-skip-permissions` (claude harness only). Juno-only by convention. |
| `KOAD_IO_ROOTED` | unset | If `true`, entity works from `$ENTITY_DIR`. Unset = roaming (works from `$CWD`). |
| `KOAD_IO_ROOM` | unset | Sealed portable room — overrides `CLAUDE_CONFIG_DIR` when set. |
| `ENTITY_HOST` | unset | Rooted entity's home host. Framework ssh's here before launch. |
| `REMOTE_HARNESS_BIN` | harness name | Full path to harness binary on the remote host (macOS + NVM workaround). |
| `REMOTE_NVM_INIT` | unset | PATH setup to run before harness on remote host. |

Framework-level equivalents live in `~/.koad-io/.env` as
`KOAD_IO_DEFAULT_HARNESS`, `KOAD_IO_DEFAULT_PROVIDER`, `KOAD_IO_DEFAULT_MODEL`.
They catch entities that don't pin their own.

## What the hook actually does

```
~/.koad-io/hooks/executed-without-arguments.sh
  │
  ├─ Resolve $ENTITY_DIR (default $HOME/.$ENTITY)
  ├─ Resolve $CALL_DIR (the CWD the user typed the command from)
  ├─ Pick $HARNESS_WORK_DIR:
  │    KOAD_IO_ROOTED=true → $ENTITY_DIR
  │    otherwise           → $CALL_DIR
  ├─ Set terminal title ("entity on host in cwd")
  ├─ cd "$HARNESS_WORK_DIR"
  └─ exec ~/.koad-io/commands/harness/default/command.sh
       │
       └─ Reads $ENTITY_DEFAULT_HARNESS, execs
          ~/.koad-io/commands/harness/$HARNESS/command.sh
            │
            └─ That script (e.g. harness/claude) does:
                 - Read $ENTITY_DEFAULT_PROVIDER / $ENTITY_DEFAULT_MODEL
                 - Read $ENTITY_SKIP_PERMISSIONS (claude only)
                 - Read $KOAD_IO_ROOM / $KOAD_IO_ROOTED for CLAUDE_CONFIG_DIR
                 - Run startup.sh → SYSTEM_PROMPT
                 - exec claude ... (or opencode, pi, hermez)
```

Each layer is thin and single-purpose. The hook is just the door;
delegation does the work.

## Adding a new entity

Nothing to do. As long as `~/.$ENTITY/.env` exists with
`ENTITY_DEFAULT_HARNESS` set (or the framework default is acceptable),
`$ENTITY` as a typed command will find this hook and launch the configured
harness.

A hook override in `~/.$ENTITY/hooks/executed-without-arguments.sh` is
almost always the wrong answer. If you find yourself wanting one, ask
first:

1. Can this be expressed as a new `$ENTITY_*` env var in the cascade?
2. Can the leaf harness script (`commands/harness/<name>/command.sh`)
   grow to handle this? That fixes it for every entity on that harness,
   not just mine.
3. Is this really entity-specific, or is it a category (rooted, Juno-class,
   orchestrator, ...)? If it's a category, teach the cascade.

Only fork the hook as a last resort. Forked hooks drift. The global hook
doesn't.

## Interactive vs non-interactive

The hook itself does not distinguish — it always launches interactive.
Non-interactive orchestration goes through `<entity> harness default
"prompt"` or `PROMPT="..." <entity> harness default`, which skips the
hook entirely and enters the cascade directly.

See [feedback_harness_dispatch] in MEMORY for canonical dispatch patterns.

---

## Guestbook

Sessions that shaped this file.

| Date | Agent | Notes |
|------|-------|-------|
| 2026-04-04 | Juno (claude-sonnet-4-6) | Wrote the original PRIMER. Established `KOAD_IO_ENTITY_HARNESS` — opencode as framework default (free LLMs, try before buy), claude as explicit opt-in for team entities. Renamed `REMOTE_CLAUDE_BIN` → `REMOTE_HARNESS_BIN`. Documented upstart pattern. |
| 2026-04-14 | Vulcan (claude-opus-4-6) | koad/vulcan#17. Rewrote for cascade-driven global hook. `KOAD_IO_ENTITY_HARNESS` is gone — replaced by `ENTITY_DEFAULT_HARNESS` (entity) and `KOAD_IO_DEFAULT_HARNESS` (framework), resolved by `commands/harness/default`. Added `ENTITY_SKIP_PERMISSIONS` knob to `harness/claude` so Juno's fork can retire. Documented field overrides (juno, chiron) and the retire-when criteria. Hook itself now has SPDX header. Did NOT delete entity copies in this flight — migration is a follow-up. |
