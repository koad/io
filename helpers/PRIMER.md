---
type: primer
folder: ~/.koad-io/helpers/
parents:
  - ~/.koad-io/
children: []
features:
  - name: emit-helper
    blurb: Shared emission wire protocol — emit.sh wraps emit.py for bash; emit.py is the single source of truth for fire-and-forget + lifecycle (open/update/close)
    location: helpers/emit.sh, helpers/emit.py
  - name: discovery-helper
    blurb: Self-documenting command footer — source at end of any command.sh and call _koad_io_hint; prints sibling subcommands and recognized flags to stderr on TTY
    location: helpers/discovery.sh
  - name: ask-helper
    blurb: ENV-first interactive prompts — ask() and ask_yn() skip the prompt when env is pre-set, re-prompt until non-empty if --required, persist answers with --write
    location: helpers/ask.sh
  - name: spinner-helper
    blurb: Busy-wait animation primitives — spinner PID, pause SECS, cursorBack N; skipped entirely when KOAD_IO_QUIET=1
    location: helpers/spinner.sh
  - name: cd-reflex
    blurb: cd() wrap + hook registry — koad_io_cd_register adds a function to KOAD_IO_CD_HOOKS; all hooks fire in order on every cd
    location: helpers/cd-reflex.sh
  - name: node-tools-reflex
    blurb: NVM / Node version reflex on cd — reads package.json engines or .nvmrc; calls nvm use or warns when version doesn't satisfy requirement
    location: helpers/node-tools.sh
  - name: tickler-reflex
    blurb: Path-addressed tickle surfacing on cd — scans every entity's tickler/space/<host><path>/ for open .md files; surfaces them without being asked
    location: helpers/tickler-reflex.sh
relates-to:
  - ~/.koad-io/PRIMER.md
  - ~/.koad-io/commands/emit/PRIMER.md
  - ~/.livy/features/emission-lifecycle.md
  - ~/.livy/features/framework-emit-command.md
  - ~/.livy/features/INDEX.md
entities:
  - vulcan
  - juno
last-walked: 2026-05-09
as-of: e2358fbeebd7fca667a412db7ed6fc47a7fd294c
---

# ~/.koad-io/helpers/ — Sourced Utilities

> Not invoked directly. Sourced by commands, hooks, and shell profiles to add shared primitives.

Helpers are the shared substrate layer. They are valid bash (or Python) that must be safe to evaluate at source time. Unlike commands — which are invoked — helpers are sourced: their functions and variables become part of the calling context.

Every file here is intentionally small and self-contained. No helper imports another. No helper has a hard dependency on a running service (emit.sh no-ops silently when the daemon is down).

## The two families

**Emission helpers** (`emit.sh` + `emit.py`) — the single source of truth for all telemetry to the daemon. Any command that needs to emit — whether it's a bash command or a Python hook — calls through this pair. The bash functions are thin wrappers; the Python module is the wire protocol implementation.

**Shell UX helpers** (`discovery.sh`, `ask.sh`, `spinner.sh`) — primitives for building pleasant command-line interfaces. Sourced by wizard-style commands (init sovereign, gestate) and any command that wants a self-documenting footer.

**cd-reflex family** (`cd-reflex.sh`, `node-tools.sh`, `tickler-reflex.sh`) — context injection on directory change. Sourced in the operator's interactive shell profile. Each reflex registers itself with the cd-reflex hub; multiple reflexes coexist under one `cd()` intercept.

## Usage patterns

### Emission from a bash command

```bash
source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null

# Fire-and-forget (backgrounded, never blocks)
koad_io_emit notice "started on :${KOAD_IO_PORT}"

# Lifecycle (open → updates → close)
koad_io_emit_open service "my-worker: starting" '{"worker":"my-worker"}'
koad_io_emit_update "processing batch 1 of 5"
koad_io_emit_close "complete — 5 batches done"
```

### Emission from a Python hook

```python
import sys, os
sys.path.insert(0, os.path.expanduser('~/.koad-io/helpers'))
from emit import emit_open, emit_update, emit_close

eid = emit_open(type='flight', body='starting build')
emit_update(eid, 'tests passing')
emit_close(eid, 'shipped')
```

### Self-documenting footer

```bash
# At the end of any command.sh:
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
```

### Interactive prompts (wizard commands)

```bash
source "$HOME/.koad-io/helpers/ask.sh"

HANDLE=$(ask "Your handle" "${KOAD_IO_HANDLE:-}" "" --required --write ~/.koad-io/me/.env KOAD_IO_HANDLE)
if ask_yn "Enable Keybase?" "${KOAD_IO_HAS_KEYBASE:-}"; then
  # ...
fi
```

### cd-reflex (shell profile)

```bash
# Source order matters: hub first, then reflexes
source "$HOME/.koad-io/helpers/cd-reflex.sh"
source "$HOME/.koad-io/helpers/node-tools.sh"
source "$HOME/.koad-io/helpers/tickler-reflex.sh"
```

## Gates and quiet mode

Every helper respects `KOAD_IO_QUIET=1` where applicable:

| Helper | Gate variable | Effect when 0/unset |
|--------|---------------|---------------------|
| `emit.sh` | `KOAD_IO_EMIT` | All emits silently no-op |
| `discovery.sh` | `KOAD_IO_QUIET_DISCOVERY` | Footer not printed |
| `spinner.sh` | `KOAD_IO_QUIET` | Spinners skipped, waits are bare |
| `cd-reflex.sh` | `KOAD_IO_CD_REFLEX` | Entire cd wrap disabled |
| `node-tools.sh` | `KOAD_IO_NVM_REFLEX` | Node check not registered |
| `tickler-reflex.sh` | `KOAD_IO_TICKLER_REFLEX` | Tickle scan not registered |

`KOAD_IO_EMIT` defaults to disabled (opt-in). All other gates default to enabled.

## No subfolder PRIMERs needed

Every helper is a single file with a single coherent role. None of the subfolders warrant their own PRIMER (the `__pycache__/` is a Python build artifact).

---

*Livy walked this folder 2026-05-09. All seven files documented as features.*
