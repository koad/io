<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/install/`

> Post-clone setup — check dependencies and add `~/.koad-io/bin` to PATH.

## What this does

`install` is the first command a new operator runs after cloning `~/.koad-io/`. It checks for required tools, adds `~/.koad-io/bin` to the shell profile, and prints a success signal with a next-step prompt. No network calls — everything runs from the local repo.

## Invocation

```bash
~/.koad-io/bin/koad-io install
```

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `opencode/command.sh` | Build branded opencode from a pinned commit (applies koad-io patches) |
| `starship/command.sh` | Install the starship shell prompt (entity-aware theme) |

## What it expects

- Called from a freshly cloned `~/.koad-io/` directory
- Shell: bash or zsh (detects automatically)

## What it produces

- PATH entry in `~/.bashrc`, `~/.zshrc`, or `~/.profile`
- Dependency check output (git, gpg, claude, gh)

## Dependencies checked

| Tool | Install hint |
|------|-------------|
| `git` | system package manager |
| `gpg` | system package manager |
| `claude` | https://claude.ai/download |
| `gh` | https://cli.github.com |

## Notes

- If `~/.koad-io/bin` is already in your PATH, `install` detects it and skips the profile update.
- Exit 1 if any dependency is missing — install them and re-run.
- Next step after `install`: `koad-io gestate <entityname>`
