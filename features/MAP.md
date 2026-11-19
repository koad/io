# koad:io — the feature map

**Purpose.** The framework exists so a sovereign human can operate synthetic
collaborators that hold authority, memory, and accountability — and can read back
why each of them behaved as it did.

**Surfaces.** flat — this tree is the loading layer. The daemon, desktop
interface and forge services live in their own repositories and carry their own
maps.

## Landed (3)

- [habits](./harness/lora/feature.md) — standing rules injected into the system
  prompt every session; absent folder renders an enable instruction, not silence
- [session-folder](./harness/session-folder/feature.md) — one directory per
  session, one file per fact (`meta.json`, `telemetry.json`, `timing.jsonl`,
  `gate.jsonl`, `errors.jsonl`, `dispatch.md`, `clues/`), readable without any
  harness and written the same way by every harness
- [session-provenance](./harness/session-provenance/feature.md) — the folder's
  transport half: `entry` (ssh / desktop / console / headless), `tty` and the ssh
  `remote`, so two writers on one transcript are distinguishable, and
  `list sessions` prints where each session came from

## Building (0)

## Wanted (0)

## Parked (0)

## Dropped (0)
