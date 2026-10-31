<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/test/`

> Smoke test — verify the entity command dispatcher is working.

## What this does

`test` is a minimal command that confirms the koad:io command dispatch chain is functioning. It prints the `EXEC_FILE` path (the resolved command) and any arguments passed. Useful after install or entity setup to confirm everything is wired correctly.

## Invocation

```bash
<entity> test                        # Basic smoke test
<entity> test one two three four     # Pass args to confirm dispatch is working
<entity> test one                    # Routes to test/one/ sub-command if it exists
```

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `one/command.sh` | Test nested command dispatch with one level of depth |
| `modes/command.sh` | Assert every `command.sh` in a commands tree is committed `100755` (an assertion — exits 1) |

## Expected output

```
test command!
command file: /home/koad/.koad-io/commands/test/command.sh
command arguments: one two three
```

## `test modes` — the one sub-command that asserts

```bash
koad-io test modes              # every commands tree in the cascade
koad-io test modes ~/repo/commands
```

The cascade resolves a command by directory, then **execs** the shim inside it.
Git records the executable bit in the index, so a `command.sh` committed `100644`
arrives non-executable at every fresh clone and dies with a bare
`Permission denied`. On 2026-10-21 a real sovereign install opened with
`chmod +x ~/.koad-io/commands/curriculum/command.sh` for exactly this reason —
the only `command.sh` in the tree committed `644`. The mode bit blocked the map
(`curriculum list`), so he rebuilt the 27-note index by hand and handed it in.

`test modes` reads the **index**, not the working tree — the defect only
reproduces on a fresh clone, so a working-tree check would have passed on the
operator's box while every clone broke. Exits `1` on any `command.sh` not
committed `100755` and prints the `git update-index --chmod=+x` line for each.

The runtime half of the same guard lives in `~/.koad-io/bin/koad-io`: a
non-executable shim is refused before `exec`, naming the file, the committed
mode, and the fix — instead of the shell's `Permission denied`.

## Notes

- Bare `test` is a sanity check, not a test suite — no assertions, no pass/fail.
  `test modes` is the exception: it asserts and it fails.
- If `<entity> test` fails, the dispatch chain is broken — check PATH, `~/.koad-io/bin/<entity>`, and `koad-io` itself.
- The `one` sub-command demonstrates nested dispatch (`test/one/command.sh`).
