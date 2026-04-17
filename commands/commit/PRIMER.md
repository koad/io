<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/commit/`

> Entity-aware git commit flow — guards against bulk commits and helps write meaningful messages.

## What this does

`commit` provides two modes:

- **No args** (or bulk attempt): prints a warning and refuses to commit blindly. Encourages reviewing staged changes first.
- **`staged`**: opens an opencode session that reviews staged changes and writes a meaningful commit message focused on the *why*, then commits. Does not push.

## Invocation

```bash
<entity> commit              # Warns and exits — do not blindly commit
<entity> commit staged       # AI-assisted commit: review staged files, write message, commit
```

## What it expects

- Must be run inside a git repository.
- `commit staged` requires `opencode` on PATH and `OPENCODE_MODEL` set (or uses `opencode/big-pickle` as default).
- Files should already be staged with `git add` before calling `commit staged`.

## Notes

- `commit staged` uses opencode, not Claude Code — it's an opencode party-line turn.
- The model used for commit messages can be overridden via `OPENCODE_MODEL` env var.
- This command does not push — push separately after reviewing the commit.
