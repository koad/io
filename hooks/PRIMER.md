# hooks/

This directory contains framework-level hook defaults. Each file here is a template —
if an entity has a file with the same name in its own `~/.$ENTITY/hooks/` folder,
that file fires instead. The framework default is never called.

---

# entity-upstart.sh

Template for an entity's upstart script. Not called directly by the framework.

Copy it to `~/.$ENTITY/hooks/upstart.sh` to make the entity participate in upstart:

```bash
cp ~/.koad-io/hooks/entity-upstart.sh ~/.$ENTITY/hooks/upstart.sh
```

### How upstart works

`koad-io upstart` (bound to `<Super>u` on desktop) runs
`~/.koad-io/commands/upstart/command.sh`, which:

- If `$ENTITY` is set: fires `~/.$ENTITY/hooks/upstart.sh` only
- If `$ENTITY` is unset: scans all `~/.*` dirs and fires every `hooks/upstart.sh` found

```bash
koad-io upstart      # wake everything
juno upstart         # wake Juno only
```

This is the standard koad:io command paradigm — one global command, scoped by `$ENTITY`.

### What the script does

Starts the koad:io daemon and desktop UI (if present) using `screen`:

```bash
screen -dmS koad:io-daemon    bash -c 'cd ~/.koad-io/daemon  && koad-io start'
screen -dmS koad:io-desktop   bash -c 'cd ~/.koad-io/desktop && koad-io start'
```

A lock in `/dev/shm/.koad-io/locks/upstart` prevents it from running twice per session.

### Overriding

Edit your entity's copy directly:

```bash
$EDITOR ~/.$ENTITY/hooks/upstart.sh
```

---

# executed-without-arguments

Called when an entity command is invoked with no arguments — e.g. just typing `vulcan`.

Opens an interactive AI session rooted in the entity's directory, or runs a
non-interactive prompt when `PROMPT=` is set (entity-to-entity orchestration).

The AI harness is selected via `KOAD_IO_ENTITY_HARNESS`. Framework default is `opencode` —
free LLMs, no API key required, try before buy.

- **Alice** — inherits the default, no override needed
- **Team entities** (Juno, Vulcan, Veritas, Mercury, Muse, Sibyl, …) — set `KOAD_IO_ENTITY_HARNESS=claude` in their `.env`

---

## Harness selection

Set in `~/.koad-io/.env` (global default) or `~/.$ENTITY/.env` (per-entity override):

```bash
KOAD_IO_ENTITY_HARNESS=opencode    # default — free LLMs, try before buy
KOAD_IO_ENTITY_HARNESS=claude      # Claude Code — paid, full power
```

No `KOAD_IO_ENTITY_HARNESS` set → `opencode`. No API key needed to get started.
Team entities set `KOAD_IO_ENTITY_HARNESS=claude` in their `.env` to opt in to Claude.

Why opencode as the default: big-pickle is a capable LLM that regular people can use
without a credit card. All koad:io team entities were proven to work with it. Usage
limits are real but fine — the goal is 2–3 good conversations with Alice, enough to
understand what sovereign AI looks like before deciding to go deeper.

Each harness has its own invocation pattern for interactive and non-interactive paths.
The hook handles the translation.

---

## Two paths

### Interactive — user is at the keyboard

`PROMPT` is empty and stdin is a terminal.

| Harness | Invocation |
|---------|-----------|
| `claude` | `claude . --model sonnet --add-dir "$CALL_DIR"` |
| `opencode` | `opencode --agent "$ENTITY" --model "$OPENCODE_MODEL" ./` |

- Working directory: `~/.$ENTITY/`
- `$CALL_DIR` is the directory where the command was typed (passed where the harness supports it)
- No skip-permissions flags — the harness asks for approval. That is the safety net.

### Non-interactive — orchestration call

`PROMPT` is set (via env var or piped stdin).

| Harness | Invocation |
|---------|-----------|
| `claude` | `claude --model sonnet --dangerously-skip-permissions --output-format=json -p "$PROMPT"` |
| `opencode` | _(non-interactive not yet supported — falls back to claude)_ |

Output is expected on stdout. The hook normalises it to plain text before returning.

- No user present — session cannot pause to ask for approval
- The orchestrating entity takes responsibility for what it dispatches
- A PID lock (`/tmp/entity-$ENTITY.lock`) prevents overlapping calls

---

## PRIMER.md injection

If a `PRIMER.md` exists in `$CALL_DIR` (the directory where the command was typed),
its contents are prepended to `PROMPT` before the session starts:

```
Project context (from /path/to/PRIMER.md):
<contents>

---

<original prompt>
```

Works in both paths. In interactive mode it seeds the session context. In
non-interactive mode it gives the entity situational awareness about the calling
directory without the orchestrator having to pass it manually.

---

## Portable vs Rooted entities

**Portable** — no fixed home machine. Runs wherever it is called from. Default.
No configuration needed.

**Rooted** — lives on a specific machine (private HQ, local files, installed apps
not in git). Must run there regardless of where the command is issued from.

Set `ENTITY_HOST` in `~/.$ENTITY/.env` to activate rooted mode:

```bash
ENTITY_HOST=wonderland
```

For hosts with non-standard PATH (e.g. macOS + NVM):

```bash
REMOTE_HARNESS_BIN=$HOME/.nvm/versions/node/v24.14.0/bin/claude
REMOTE_NVM_INIT=export PATH=/opt/homebrew/bin:$HOME/.nvm/versions/node/v24.14.0/bin:$PATH
```

When rooted and called from a remote machine:

- Interactive: `ssh -t $ENTITY_HOST` → opens harness session on the home machine
- Non-interactive: `ssh $ENTITY_HOST` → prompt is base64-encoded for safe transport,
  decoded on arrival, passed to harness

---

## Configuration reference

All variables are set in `~/.koad-io/.env` or `~/.$ENTITY/.env`. Entity values win.

| Variable | Default | Purpose |
|----------|---------|---------|
| `KOAD_IO_ENTITY_HARNESS` | `opencode` | Which AI harness to launch (`opencode` or `claude`). Team entities set `claude` in their `.env`. |
| `OPENCODE_MODEL` | _(set by opencode)_ | Model passed to opencode harness. |
| `KOAD_IO_ROOTED` | _(unset)_ | If `true`, entity works from `$ENTITY_DIR` (has an office). Unset = roaming (works from `$CWD`). |
| `ENTITY_HOST` | _(unset)_ | Machine the entity lives on. Unset = portable. |
| `REMOTE_HARNESS_BIN` | _(harness name)_ | Full path to harness binary on the remote host. |
| `REMOTE_NVM_INIT` | _(unset)_ | PATH setup command to run before harness on remote host. |

---

## Overriding the hook

Every hook in `~/.koad-io/hooks/` is a framework default. If an entity has a file
with the same name in its own `~/.$ENTITY/hooks/` folder, that file fires instead.
The framework default is never called.

```
~/.koad-io/hooks/executed-without-arguments.sh   ← framework default (this file)
~/.juno/hooks/executed-without-arguments.sh      ← Juno's override — fires instead
~/.alice/hooks/executed-without-arguments.sh     ← Alice's override — fires instead
```

To override for a specific entity, copy and edit:

```bash
cp ~/.koad-io/hooks/executed-without-arguments.sh ~/.$ENTITY/hooks/
$EDITOR ~/.$ENTITY/hooks/executed-without-arguments.sh
```

Common reasons to override:

- Force `--dangerously-skip-permissions` in interactive mode (e.g. orchestrator entities like Juno)
- Use a different model or harness flags for one entity without affecting others
- Add entity-specific startup logic before the session opens

---

## Guestbook

Sessions that worked here — what was considered, what was decided.

| Date | Agent | Notes |
|------|-------|-------|
| 2026-04-04 | Juno (claude-sonnet-4-6) | Wrote this PRIMER. Established `KOAD_IO_ENTITY_HARNESS` — opencode as framework default (free LLMs, try before buy), claude as explicit opt-in for team entities. Renamed `REMOTE_CLAUDE_BIN` → `REMOTE_HARNESS_BIN`. Documented upstart pattern: `koad-io upstart` fires all, `juno upstart` fires one — same global command scoped by `$ENTITY`. Non-interactive path falls back to claude when opencode selected (opencode has no headless mode yet). Established GPG-signed policy block pattern for entity hooks — blocks are content-addressed, IPFS-pinnable, publishable as Nostr events. Entity Ed25519 keys are native Nostr format. Specced in koad/vesta#81, Mercury notified via koad/mercury#22. |
