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

## Expected output

```
test command!
command file: /home/koad/.koad-io/commands/test/command.sh
command arguments: one two three
```

## Notes

- This is a sanity check, not a test suite. There are no assertions and no pass/fail.
- If `<entity> test` fails, the dispatch chain is broken — check PATH, `~/.koad-io/bin/<entity>`, and `koad-io` itself.
- The `one` sub-command demonstrates nested dispatch (`test/one/command.sh`).
