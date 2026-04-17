# PRIMER: git-hooks/

## What is this directory?

Global git hook scripts for the koad:io kingdom. These hooks are installed once and fire on every git operation across every repo on the machine, enforcing kingdom-wide commit authorship and protocol compliance.

## What does it contain?

- `pre-commit` — Authorship guard. Fires before every commit. If the commit targets an entity repo (a directory matching `/home/<user>/.<entity>/`), it verifies that `GIT_AUTHOR_NAME` matches the entity's expected name from that entity's `.env`. Blocks on mismatch. Bypassed by setting `KOAD_IO_AUTHORSHIP_OVERRIDE=1`.

## Who works here?

Vulcan and Salus maintain these hooks. Juno authored the authorship guard as part of the entity sovereignty protocol. No other entity should modify these without Juno/Vulcan coordination.

## What to know before touching anything?

These hooks are global — they apply to every git repo, not just koad:io repos. The pre-commit hook bails silently on repos that do not match the entity directory pattern, so it is safe for external projects. To install globally: `git config --global core.hooksPath ~/.koad-io/git-hooks`. If a commit is legitimately cross-entity (e.g., Juno filing a document in another entity's repo with Juno authorship), set `KOAD_IO_AUTHORSHIP_OVERRIDE=1` before committing. Do not routinely bypass with `--no-verify`.
