# PRIMER: helpers/

## What is this directory?

Shell helper scripts sourced into the user's interactive shell environment. These add quality-of-life context injection to the terminal — they run on navigation events (like `cd`) and surface relevant information without being asked.

## What does it contain?

- `cd-reflex.sh` — The main context injection coordinator. Wraps `cd` so other helpers can register context injectors that fire on directory change. Multiple injectors coexist cleanly under one intercept.
- `node-tools.sh` — Node.js version reflex. On `cd`, reads the current directory's `package.json` engines field and reports whether the active Node version satisfies the requirement. Reads `.nvmrc` if present and calls `nvm use` automatically.
- `tickler-reflex.sh` — Tickler space-dimension reflex. On `cd`, surfaces path-addressed next actions filed for any enabled entity. Brings GTD-style tickler context into your current working directory.

## Who works here?

Vulcan maintains these helpers. They are sourced in the operator's shell profile (typically via `~/.koad-io/.env` or a shell rc file). Entities do not modify these directly.

## What to know before touching anything?

Each helper gates itself on its own environment variable (`KOAD_IO_NVM_REFLEX`, `KOAD_IO_TICKLER_REFLEX`, etc.) so individual reflexes can be toggled. `KOAD_IO_CD_REFLEX=0` disables the whole system. These are sourced, not executed — they must be valid bash that is safe to evaluate at shell startup. Errors here break every new terminal. Test changes in a subshell before sourcing globally.
