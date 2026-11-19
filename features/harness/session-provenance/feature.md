---
title: Session provenance — entry, tty and remote on every session record
status: landed
origin: 2026-11-10 — koad + vulcan
---

# Session provenance — how a session was entered

**Intent.** A session record answers *who is at this session and how they
arrived*, not just which entity and which path. A session left running in a
desktop terminal and one re-launched over ssh are different facts, and the
difference is load-bearing: it is the only cheap way to see that two writers
share one transcript.

**We know it works when.** `$RUNTIME/entities/<entity>/sessions/<id>/meta.json`
carries `entry` (`ssh` | `desktop` | `console` | `headless` | `other`), `tty`
(`pts/30`, `tty2`, `none`) and `remote` (the ssh client address, when there was
one); `surface` keeps its established meaning — the launch surface, a domain, or
`terminal` for a human's own shell — instead of the placeholder `unknown`; and
`koad-io list sessions` shows a `from` column reading `ssh 10.10.10.100 · pts/14`,
`desktop · pts/30`, or `headless`. `test/session-meta.test.sh` proves the three
entry paths against the real writer.

**Not this.** Not a session *identity* scheme — the folder name stays the
17-character session id and nothing here derives it. Not a transport for
authority: `entry` is descriptive and no gate reads it. Not a multiplexer
inventory: tmux and screen inherit the outer transport (`SSH_*` survives into a
pane), so a pane over ssh is `ssh` and still names the client. Not a backfill —
a record written before these fields existed renders `-` in the `from` column
rather than an inferred guess.

**Open questions.** Should `headless` split between `flight` and `detached`, now
that `origin` already carries `dispatched`? Should the live half (session.hello /
telemetry) read the exported `KOAD_IO_SESSION_ENTRY` / `_TTY` / `_REMOTE` instead
of detecting separately, so the two halves cannot disagree? Does a session resumed
across two processes deserve both writers listed in one record, or is that a lock
question rather than a provenance one?

**Status note.** Landed 2026-11-10 in `helpers/session-files.sh`; reader change in
`~/.forge/commands/list/sessions/command.sh`; verified by
`test/session-meta.test.sh` (fast tier, 14 assertions) and by a fixture runtime
rendered through the real list command.

---

## Why this is filed under `harness/`

The harness owns the session folder: it mints the id, writes `meta.json`, and
hands the prompt to the model. Provenance belongs to the same layer because it is
recorded at the same moment and for the same reader — anyone looking at a session
after the fact and asking what the machine looked like.

## The defect that earned it

On 2026-11-10 wonderland had a 12-hour session in a gnome-terminal (`pts/30`) and
a `harness throne -c` re-launch over ssh (`pts/14`). Both wrote to **one** pi
transcript with **two live processes**, and both session folders said
`"surface":"unknown"` — the field held `KOAD_IO_DOMAIN`, so every local launch
was nameless. The difference was recoverable only from `ps -o tty,sid,ppid`
ancestry and `who -T`, because sshd writes utmp and gnome-terminal does not.

A record that cannot distinguish "left running on the desktop" from "resumed over
ssh from the laptop" is not a session record; it is a row. This is the row made
honest, and the column that reads it out loud.

## What it deliberately does not fix

The `-c` behaviour itself — a second writer opening onto a live session instead of
refusing or taking over — is a separate defect and stays a defect until it is
decided. Provenance makes it *visible*; it does not prevent it.
