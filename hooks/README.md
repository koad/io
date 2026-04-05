# Hooks Directory

Hooks are shell scripts the koad:io framework calls at specific lifecycle points.
Entity hooks in `~/.$ENTITY/hooks/` override these framework defaults.

---

## `executed-without-arguments.sh`

Called when an entity command is invoked with no arguments (e.g. just typing `vulcan`).

Gives the user an interactive Claude Code session with their entity, or runs a
non-interactive prompt when `PROMPT=` is set (orchestration between entities).

### Portable vs Rooted entities

**Portable** entities have no fixed home machine. They run wherever they are called
from. This is the default — no configuration needed.

**Rooted** entities live on a specific machine: private headquarters, local files
not in git, installed apps (e.g. macOS tools). They must run there regardless of
where the command is issued from.

### Configuring a rooted entity

Set these in `~/.$ENTITY/.env` — no hook override needed for most cases:

```bash
ENTITY_HOST=wonderland            # hostname of the entity's home machine
REMOTE_CLAUDE_BIN=$HOME/.nvm/versions/node/v24.14.0/bin/claude
REMOTE_NVM_INIT=export PATH=/opt/homebrew/bin:$HOME/.nvm/versions/node/v24.14.0/bin:$PATH
```

### Overriding the hook

For behavior beyond what variables allow, copy and edit:

```bash
cp ~/.koad-io/hooks/executed-without-arguments.sh ~/.$ENTITY/hooks/
$EDITOR ~/.$ENTITY/hooks/executed-without-arguments.sh
```

The entity hook takes precedence over this framework default.

### Permission policy

| Mode | `--dangerously-skip-permissions` |
|------|----------------------------------|
| Interactive (user at keyboard) | **Never** — Claude asks for approval. That is the safety net. |
| Non-interactive (`PROMPT=` set) | Allowed — no user present, session cannot pause to ask. |

Orchestrator entities (e.g. Juno) may carry `--dangerously-skip-permissions` in
both paths by design — override the hook explicitly to do so.

---

## `entity-upstart.sh`

Called at system upstart. Starts the koad:io daemon and desktop UI if present.
