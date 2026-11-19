# helpers/ — the sourced layer

Fifteen files that exist so no command, hook, or launcher has to re-invent a
mechanical fact. They are not a library in the usual sense: nothing here is
imported, versioned, or installed. A helper is a bash function or a small CLI
that already encodes a decision the kingdom has paid for once — a wire protocol,
an identity rule, a search policy, a quoting rule — and the file states *why* it
exists at the top, because a helper without its failure story is just another
abstraction to distrust.

**The rule for adding one.** Source it, or call it. If a command needs three
lines of the same reasoning a second time, that reasoning belongs here. If it
needs business knowledge — a website, a product, a service — it belongs in
`~/.forge/`, not here. The framework ships generic runtime; helpers are the most
generic layer of it.

## The inventory

| file | what it is for | how you use it |
|---|---|---|
| `argv.sh` | The launcher's argv boundary — which tokens may be command words, and the exec slice | **source** (by `bin/koad-io`, and by the argv tests) |
| `ask.sh` | Interactive questions, ENV-first, with optional `.env` write-back | **source** |
| `bond-gate.sh` | Shell-side scope checks before a command touches a path | **source** |
| `cd-reflex.sh` | The one `cd()` wrap; other helpers register context injectors here | **source** from a shell profile |
| `discovery.sh` | The self-documenting footer a command prints at the end | **source**, last line of a `command.sh` |
| `emit.py` | **The emission wire.** Single source of truth for the protocol | **call** (CLI) or **import** (Python) |
| `emit.sh` | The bash interface to `emit.py`, for a *running* shell | **source** |
| `env.sh` | One reader for one key in an `.env` file | **source** (or `exec`) |
| `kingdom-safe-search.sh` | The policy behind `bin/grep` and `bin/find` | **source** (by the wrappers) |
| `node-tools.sh` | Runtime-version check on `cd`, via `package.json` engines | **source**; registers a `cd` hook |
| `session-files.sh` | Record the two inputs that made a session — system prompt, dispatch | **source** (by launchers) |
| `session-identity.sh` | Derive a session id that is unique to one launch and never handed out twice | **source** (by launchers) |
| `spinner.sh` | Busy-wait animation that stays silent in quiet mode | **source** |
| `status-check.sh` | Monitor mode for `koad-io status --check` — change-only reporting and alerts | **source** (by `bin/status`) |
| `tickler-reflex.sh` | Surface path-addressed tickles when you `cd` into a place where work is filed | **source**; registers a `cd` hook |

**Source vs. call is not stylistic.** Anything that must leave state in *your*
shell has to be sourced — `cd-reflex.sh` installs a `cd()` wrapper, `emit.sh`
keeps `HARNESS_EMISSION_ID` alive, `env.sh` defines a function. Anything that
must survive a process boundary, or run from a non-bash caller, is a CLI:
`emit.py` is a program precisely because the emissions it sends are read by
Python hooks, bash commands, and the harness alike.

---

## `emit.py` — the wire

The one thing every other emission surface calls. Two ways in:

```bash
# CLI — for bash callers, and for anything that cannot import
python3 ~/.koad-io/helpers/emit.py emit  notice "started on :28283"
python3 ~/.koad-io/helpers/emit.py open  flight "building /traffic" --meta '{"parentId":"abc"}'
python3 ~/.koad-io/helpers/emit.py update "tests passing" --id "$ID"
python3 ~/.koad-io/helpers/emit.py close  "shipped" --id "$ID"
```

```python
# Module — for Python hooks (the documented form, and the one that keeps ids)
sys.path.insert(0, os.path.expanduser('~/.koad-io/helpers'))
from emit import emit_open, emit_update, emit_close

eid = emit_open('vulcan', 'flight', 'building /traffic', meta={'parentId': 'abc'})
emit_update(eid, 'tests passing')
emit_close(eid, 'shipped')
```

**Three gates, all of which have to be open.**

1. `KOAD_IO_EMIT=1` — opt-in, default **off**. Every function returns `None`
   when it is off; nothing raises, nothing logs. That silence is deliberate for
   hooks (a telemetry failure must never break a commit) and wrong for a human,
   which is why the routed door reports it — see below.
2. The daemon has to answer `/api/health` with JSON `status: "ok"`. A Meteor
   compile-error page returns **HTTP 200 with HTML**, so the check parses the
   body: "looks like a server" is not the same as "is the server".
3. The write has to be accepted. The ingress rules live in control-tower's
   `emit-rulebook.js`, not here — this helper is a client.

**Two targets, decided by the payload, not by the caller.** If the payload names
a session — `sessionId`, or `meta.session_id` (this helper injects
`HARNESS_SESSION_ID` there on every call), or `meta.payload.sessionId` — the
emission is `$push`ed onto that session's `signals[]` and the returned id **is
the session id**. If no session is named, it lands as its own document in
`koad.indexes.emissions` with the reserved `em:` prefix, and that id is what
`update`/`close` address. Both paths are one write path in control-tower; the
`em:` prefix is how the two namespaces stay apart.

This is why the same command means two things in two places: inside a harness
session, `koad-io emit notice "..."` narrates onto your own session (and
`emissions` stays empty); from a plain shell with no `HARNESS_SESSION_ID`, it
mints an emission document.

**Caps, because they are silent.** `emit`/`open`/`update` send `body[:500]` —
the first 500 characters, dropped on the floor past that, no warning. `note`
carries 2000. `emit_close` turns the close text into a timeline note. The
rulebook would accept 2000 for a body; the helper is the tighter of the two.
If a message must be longer than 500 characters, it is a note or a results
payload, not a body.

**Lifecycle types** (support open → update → close): `session`, `flight`,
`service`, `conversation`, `hook`. **Fire-and-forget types:** `notice`,
`warning`, `error`, `request`. A type is an open-vocabulary string matching
`^[A-Za-z0-9][A-Za-z0-9._:-]*$`, max 100 — convention is `noun.verb`
(`commit.signed`, `bond.witnessed`, `brief.dispatched`).

## `emit.sh` — the same wire, from a running shell

```bash
source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null

koad_io_emit        notice "started on :28283"      # backgrounded, never waits
koad_io_emit_sync   warning "port already in use"   # waits — use when it must land before exit
koad_io_emit_open   session "harness opened"        # sets + exports HARNESS_EMISSION_ID
koad_io_emit_update "context assembly complete"     # backgrounded
koad_io_emit_close  "clean exit"                    # exports HARNESS_EMISSION_ID=""
koad_io_emit_resume "resumed"                       # from HARNESS_EMISSION_ID_FILE
```

`open` is synchronous because it *returns* the id — everything downstream
addresses it. `update` is backgrounded because it is narration and a caller
should never wait for telemetry. Pass an id file (`HARNESS_EMISSION_ID_FILE`) and
`open`/`resume`/`close` will use it, including deleting it on close.

**This file is for sourcing, not for calling.** An exported variable dies with
the process, so a command that runs `emit.sh` on its own gets a `HARNESS_EMISSION_ID`
that nothing downstream can see. That is the reason the routed door
(`koad-io emit`, in `~/.forge/commands/emit/`) calls `emit.py` directly and
*prints* the id instead of exporting it; and it is the reason a command named
`emit` had to gain that door in the first place (tickler
`emit-name-collision`, 2026-11-12 — a command named `emit` must be able to emit).

---

## The three that guard the edges

**`argv.sh` — an argv boundary, not an argument parser.** The launcher has one
job it cannot delegate: find the command. It may *remove* the command words it
resolved; it may not add, drop, or move any other token (SPEC-245 §0, A-3).
`koad_io_split_argv` produces a resolution view (which leading tokens could be
command words) and `koad_io_exec_slice` replays the caller's argv minus exactly
those. The `KOAD_IO_VALUE_FLAGS` table exists *only* so a value-taking flag does
not let its value be mistaken for a command word, and it is consulted only
before the last resolved command word — after that, tokens are data.
Do not reintroduce `KOAD_IO_FLAGS`: it was a word-split string, so every
consumer that re-split it lost the caller's quoting a second time.

**`env.sh` — one reader, one meaning.** The framework writes every value as
`KEY="escaped value"`, which shell `source` unquotes correctly and which
`grep KEY= | cut -d= -f2-` does not. `env_value FILE KEY` prints what `source`
would have assigned: quotes removed, `\\` and `\"` reversed. Exit `0` when the
key is present (an empty value is *present*), `1` when it is absent, `2` on
misuse. It deliberately does not evaluate `$(...)` or expand variables — a
reader must not execute file content to read it — and it does not do multi-line
values, because the writer cannot produce one.

**`kingdom-safe-search.sh` — the policy behind `bin/grep` and `bin/find`.** A
broad search prunes by path *before* traversing: generated, cached, derived,
scratch, and substrate trees, plus a secret-basename class so that "search the
kingdom for X" can never be the way a credential leaves. Exclusion and not a
timeout, because a process in uninterruptible disk wait (STAT `D`) does not
answer signals — the only fix is to not open the tree. Three loud escapes:
name an excluded tree as the search root, `--raw`, or `--show-excludes`.

## The two that give a session its name

**`session-identity.sh`** — `koad_session_identity <entity> <conversation> [harness] [model] [spirit] [flight] [host]`
prints a 17-character content id over the *launch*, through the same cid function
the kingdom uses for handles and bonds. Not a pid: pids are recycled, and a
recycled id made control-tower treat a dead session as running. Launches should
keep exporting `HARNESS_PID` for orphan detection — it is a fact about a process,
which is all it ever was.

**`session-files.sh`** — `koad_record_session_files <entity> <id> [system-prompt] [prompt]`
writes `system-prompt.md` and `dispatch.md` under
`$KOAD_IO_RUNTIME_PATH/entities/<entity>/sessions/<id>/`, plus `clues/` and the
session's temp dir (`koad_session_tmp` repoints `TMPDIR`/`TMP`/`TEMP` at the
session and leaves the literal `/tmp` alone). Additive only: it creates new
files, never touches the session id, and a failure to record never blocks a
session from starting. It refuses a folder named by a 5-character display tail —
that is a handle you say out loud, not an address.

## The reflex layer

**`cd-reflex.sh`** owns the single `cd()` wrap. Others register instead of
wrapping: `koad_io_cd_register <function>` and their function runs on every `cd`,
in registration order. Two register today — `nvm_use_project` (warns when the
runtime does not satisfy the local `package.json` engines) and
`_koad_io_tickler_reflex` (prints the tickles filed at this exact path, for every
entity, so the operator can see whose work is parked where). Each gates itself on
its own variable (`KOAD_IO_NVM_REFLEX`, `KOAD_IO_TICKLER_REFLEX`), and the master
switch is `KOAD_IO_CD_REFLEX=0`.

**`discovery.sh`** is the footer: source it as the last line of a `command.sh`
and call `_koad_io_hint`. It reads the command's own directory for sibling
subcommands and its own `case` labels for flags, and prints both to **stderr**,
on a TTY only, silenced by `KOAD_IO_QUIET`. Stdout stays clean for command
substitution — which is why every confirmation in the framework goes to stderr.

## The rest, in one line each

- **`ask.sh`** — `ask` / `ask_yn`: ENV first (a pre-set value skips the prompt),
  then a TTY prompt, then a hard failure with a clear message. `--write .env VAR`
  persists the answer, quoted, which is exactly why `env.sh` exists to read it back.
- **`bond-gate.sh`** — `koad_io_require_command`, `koad_io_require_path`,
  `koad_io_bond_scope`: thin wrappers over `modules/node/bond-gate-cli.js` so a
  shell command can ask the same gate the harness asks before touching a path.
- **`spinner.sh`** — `spinner PID`, `pause [secs]`, `cursorBack N`. One breathing
  braille cycle, `KOAD_IO_BUSY_CURSOR` to override it, and total silence under
  `KOAD_IO_QUIET=1` (it still waits).
- **`status-check.sh`** — the `--check` mode of `bin/status`: compares the probe
  sweep against a ledger and reports *changes only* — up→down, down→up, degraded,
  cert thresholds, registry additions and removals. "All 48 fine" every hour is
  noise; the first thing anyone does with noise is mute the channel, and then the
  real alert is muted with it. Sets `_CHECK_EXIT` (0 all green, 1 some non-green,
  2 all down) and is what the hourly cron in `~/.vulcan/memories/025-registry-health-monitor.md`
  drives with `KOAD_IO_EMIT=1`.

## What is deliberately not here

No HTTP, no daemon state, no business logic, no kingdom-specific anything. A
helper may know the *shape* of an emission or a session id; it may not know what
a website is or which product is being built. That knowledge lives in
`~/.forge/`, and a fresh operator cloning koad:io must inherit none of it.

---

*Written 2026-11-13 after the routed `emit` door was fixed: the helper had been
documented by reference in the root primer since 2026-05-10 and the file did not
exist. Each helper's own header remains the authority on its contract — this page
is the map, not the territory.*
