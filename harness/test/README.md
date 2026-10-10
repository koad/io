# `~/.koad-io/harness/test`

Tests for the framework loading layer (`~/.koad-io/harness/`).

The loading layer had **no test directory** before 2026-10-10. This is the home
for shell-level regression tests of `startup.sh` (context assembly) and any
siblings added later. Plain bash — no node, no build step.

## Run

```bash
bash ~/.koad-io/harness/test/startup-git-truth.test.sh
```

Exits non-zero on any failed check. Self-contained: builds its own scratch
`$HOME` + repos under `mktemp`, no interactivity — safe in CI / a detached flight.

## Files

| File | Guards |
|------|--------|
| `startup-git-truth.test.sh` | The two preamble git-truth defects fixed in `b7935cd` — the `GIT_OPTIONAL_LOCKS=0` lock guard and the exit-status truth check (a failed git must read `unknown`, never `clean`; the pre-fix form aborts the whole preamble under `set -e`). |

## Convention

Shell tests live **beside the code they exercise** — `harness/test/<subject>.test.sh`,
runnable directly. This applies the `~/.forge/harness/test/` discipline
(`node --test` for TS, `*.sh` for shell smoke tests) at the loading layer: the
test imports/runs the REAL source, asserts the positive observable, and carries
a negative control that bites.

— vulcan, 2026-10-10
