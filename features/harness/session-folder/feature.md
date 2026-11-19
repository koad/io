---
title: The session folder — one directory per session, one file per fact
status: landed
origin: 2026-11-09 — koad + vulcan, extended 2026-11-10
---

# The session folder — the shape every harness writes

**Intent.** A session has an address and a record on disk that outlives the
process that ran it, is readable without any harness, and says the same thing
whatever wrote it. The folder is that record:

```
${KOAD_IO_RUNTIME_PATH:-~/.local/share/koad-io/runtime}
  /entities/<entity>/sessions/<cid>/
    meta.json          identity + transport — written once, at start
    telemetry.json     counters — rewritten on every flush, while running
    timing.jsonl       one line per assistant request (measured windows)
    gate.jsonl         one line per bond-gate verdict
    errors.jsonl       one line per error the harness recorded
    dispatch.md        the mission prompt — present only when a flight signed it
    system-prompt.md   the assembled prompt, byte for byte
    todo.json          the session's own plan
    clues/             addressed mail for THIS session and nobody else
    artifacts/temp/    the session's $TMPDIR
```

**We know it works when.** Any reader that touches nothing but this folder can
answer: which entity, which machine, which directory, started when, entered how
(`ssh` / `desktop` / `console` / `headless`), from which client address, on what
model, for how many turns and tools, at what cost, against which gate verdicts,
and — for a dispatched session — under what mission. `koad-io list sessions`
answers the first six from it; musium's `SessionHistory` answers all of them from
it; neither reads a transcript. A second harness that writes the same files is
indexed by the same code without a line changing.

**Not this.** Not a transcript store — the conversation stays in the harness's own
log, and nothing here is a substitute for it. Not a lock: the folder says a session
exists, not that it is the only writer (two `-c` processes can share a transcript;
this record makes that visible, it does not prevent it). Not a required file set —
a harness that writes only `meta.json` is indexed, with the rest reported absent.
Not forward-only: `cid` is the 17-character session id, never the five-character
tail the footer shows, and the short form is refused loudly.

## `meta.json` — the keys and what each one means

| key | meaning | absent means |
|---|---|---|
| `entity` | the entity the session runs as | the folder name, minus the leading dot |
| `session` | the 17-character session id (= folder name) | not a session yet |
| `cwd` | the working directory the session was opened in | unknown |
| `pid` | the launcher's process id | unknown — not "dead" |
| `host` | the machine that ran it | unknown |
| `started` | ISO timestamp, at start | unknown |
| `flight` | the mission that dispatched it, when one did | an operator session |
| `origin` | `operator` \| `dispatched` \| `chat` | unrecorded (pre-2026-11-10) |
| `surface` | the launch surface — a domain, or `terminal` for a human's shell | unrecorded |
| `entry` | `ssh` \| `desktop` \| `console` \| `headless` \| `other` | unrecorded (pre-2026-11-10) |
| `tty` | `pts/30`, `tty2`, `none` | unrecorded |
| `remote` | the ssh **client** address, when there was one | no ssh, or unrecorded |

The rule that makes the table honest: **an absent value is `null`, never a
default.** A folder written before `entry` existed must not appear to have chosen
one. `surface` used to be filled with the string `unknown`, which is how a
12-hour desktop session and an ssh re-launch of it produced byte-identical
records while two live processes shared one transcript — see
[session-provenance](../session-provenance/feature.md), which is the narrower
feature this folder carries.

**Open questions.** Should `harness` (`pi`, `opencode`, the mcp.koad.sh console)
be a `meta.json` key so one ledger can name the writer instead of inferring it?
Should a resumed session record both writers, or is that the lock question above?
Should `status` be a file the harness writes on exit, instead of a reader
deriving it from freshness?

**Status note.** Landed 2026-11-09 as two files (`system-prompt.md`,
`dispatch.md`) in `helpers/session-files.sh`, extended 2026-11-10 with
`meta.json`'s transport fields and `clues/`; the folder layout is the contract
musium's session index reads (`features/indexers/sessions-ledger` in the musium
repo). Additive by construction: every extension so far added a file or a key and
rewrote nothing.

---

## Why additive, and why one file per fact

The folder is written by a launcher that may be interrupted at any point, read by
a planet of readers, and extended by harnesses that do not know about each other.
Three rules follow and are not negotiable:

1. **A write never rewrites another file.** telemetry churns inside its own file;
   timing and gate append; meta is written once. A reader can therefore trust a
   file it is holding while the session runs.
2. **Absence is information.** No `dispatch.md` is an operator session. No
   `gate.jsonl` is a session that made no gated call — not a zero, not a bypass.
3. **The folder is the address.** `clues/` is mail for one session; `send clue`
   resolves a cid, a prefix or a suffix to a directory, and refuses when two
   sessions answer. `meta.json` is what makes that address resolvable without a
   server.

## What it costs to have this at all

Almost nothing, which is the point: a finished session is kilobytes, and the
400 MB of transcript it replaces as an index source is not read by anything that
wants a birds-eye view. A machine can therefore carry multitudes of harnesses,
each dropping the same shape, and one reader indexes all of them.
