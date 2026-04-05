# Hooks Directory

Hooks are shell scripts the koad:io framework calls at specific lifecycle points.
Entity hooks in `~/.$ENTITY/hooks/` override these framework defaults.

---

## `executed-without-arguments.sh`

Called when an entity command is invoked with no arguments (e.g. just typing `vulcan`).

Opens an interactive AI session for the user, or runs a non-interactive prompt
when `PROMPT=` is set (orchestration between entities).

Harness is selected via `KOAD_IO_ENTITY_HARNESS` (default: `opencode`).
See `PRIMER.md` in this directory for full documentation.

### Configuring a rooted entity

Set these in `~/.$ENTITY/.env` — no custom hook needed:

```bash
KOAD_IO_ENTITY_HARNESS=claude     # team entities use claude
ENTITY_HOST=fourty4               # hostname of the entity's home machine
REMOTE_HARNESS_BIN=claude         # harness binary name on remote host
REMOTE_NVM_INIT='export PATH=/opt/homebrew/bin:$HOME/.nvm/versions/node/v24.14.0/bin:$PATH'
```

### Overriding the hook

Most entities do not need a custom hook — put config in `.env` instead.
For genuinely different behavior, copy and edit:

```bash
cp ~/.koad-io/hooks/executed-without-arguments.sh ~/.$ENTITY/hooks/
$EDITOR ~/.$ENTITY/hooks/executed-without-arguments.sh
```

The entity hook takes precedence over this framework default.

---

## `entity-upstart.sh`

Called at system upstart. Starts the koad:io daemon and desktop UI if present.
