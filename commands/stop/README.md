# stop — first-class stop for an entity's harness session tree

`koad-io stop <entity>` / `<entity> stop` — stop the whole process tree of an
entity's live harness session, honestly.

Built 2026-10-11 for **VESTA-SPEC-021 v1.1** (the abort step named retired
harnesses — `opencode`/`claude` — and could not abort anything).

## Why a tree

The live runtime is `pi`. The launcher records its **own** pid in
`~/.<entity>/.local/state/harness/harness.pid` and runs `pi` as a **child**
(it never `exec`s pi):

```
bash <harness>/command.sh          pid = $(cat harness.pid)
  └─ python3 pi_rpc_dispatch.py    child  (no signal handling)
       └─ pi --mode rpc            grandchild — the live session
```

`kill $(cat harness.pid)` reaches only the wrapper. `pi_rpc_dispatch.py` does
not kill its child, and the wrapper's `EXIT` trap then deletes `harness.pid` —
**orphaning `pi` and destroying the only on-disk handle**. That is the defect
this verb exists to close.

## How it identifies the tree (no pid file required)

A pid belongs to entity `<E>`'s session iff its environment carries
`ENTITY=<E>` **and** it is recognisably harness, OR its `HARNESS_PID` names a
live ancestor:

1. cmdline is a harness wrapper — `harness … command.sh`, or `bin/<E> harness`
2. cmdline is the RPC dispatcher — `pi_rpc_dispatch.py`
3. cmdline is the pi agent — argv0 basename is `pi`
4. `HARNESS_PID` in its env names a live ancestor

The full descendant closure of every match is then killed **deepest-first**,
SIGTERM then SIGKILL, and the result is **verified** — the verb never prints
success while any member survives.

Why `ENTITY=<E>` alone is not enough: a long-lived `SCREEN` service
(`koad.live`) was launched from a session whose env had `ENTITY=vulcan` plus a
stale `HARNESS_PID`. Env-matching alone would have killed the website; the
cmdline test excludes it.

Why not a process-group kill: every live harness on wonderland currently shares
**one** process group (the interactive launcher's), so `kill -- -PGID` would
take out unrelated entities and the operator's own session. The verb never
signals a process group.

## Exit codes

| code | meaning |
|------|---------|
| 0 | stopped — or nothing was running (idempotent) |
| 1 | a member survived the kill — **honest failure** |
| 2 | refused: a stale/foreign `harness.pid` points at a live non-target pid |
| 3 | usage / resolution error |

## Flags

`--force` (SIGKILL first) · `--signal N` · `--timeout S` · `--dry-run` ·
`--quiet` · `--json`

## Tests

`/tmp/stop-test/` — sandbox suite (synthetic trees; no live session stopped):
basic stop, lost-handle recovery, orphan recovery after the old bug, honest
FAILED on a respawning harness, idempotent no-op, foreign-handle refusal,
launcher form, real-entity dry-run, and the koad.live precision case.
