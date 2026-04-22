# Commands System

Commands are how entities do things. This document covers how commands are discovered, how to invoke them, and how to add new ones.

---

## Discovery Order

When you invoke a command, the system searches in this order (lowest to highest priority):

```
1. Global commands     ~/.koad-io/commands/      (lowest priority)
2. Entity commands     ~/.entityname/commands/   (middle)
3. Local commands      ./commands/               (highest priority)
```

**Rule 1 — Priority**: Local > Entity > Global — higher priority shadows lower priority.

**Rule 2 — Depth**: Within a priority level, deepest directory match wins.

So `juno commit self` resolves by searching entity commands first (highest priority), finding `commands/commit/self/` at depth 2, and winning immediately — even if global also has a `commit` command.

**Example:** If `~/.vesta/commands/commit/` and `~/.koad-io/commands/commit/` both exist, `vesta commit` runs the entity version because entity has priority. Within entity commands, `commands/commit/self/` beats `commands/commit/` because it's deeper.

---

## Invocation

Commands are invoked as:

```bash
<entityname> <command-name> [arguments]
```

The entity wrapper at `~/.koad-io/bin/<entityname>` handles routing.

**Examples:**

```bash
vesta commit self              # Entity command: commit ~/.vesta
vesta spec entity-model        # Entity command: draft/update a spec
alice install nodejs           # Entity command: install Node.js
koad-io spawn bare             # Global command: scaffold a bare project
koad-io gestate maya           # Global command: create new entity named maya
```

The entity name in the invocation sets `ENTITY` and `ENTITY_DIR` for the duration of the command.

---

## Command Structure

Each command lives in its own directory:

```
commands/
└── <command-name>/
    ├── command.sh      required   The executable
    └── .env            optional   Command-scoped environment variables
```

### `command.sh`

A shell script. It is executed with the following environment already set:

```bash
ENTITY=entityname
ENTITY_DIR=/home/username/.entityname
# Plus: framework .env → entity .env → command .env (cascade)
```

Minimal example:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Hello from ${ENTITY}"
```

Make it executable:

```bash
chmod +x commands/my-command/command.sh
```

### `.env` (optional)

Command-local environment variables. Loaded last in the cascade — highest priority. Use this for command-specific config that should not pollute the entity environment.

```env
MY_COMMAND_TARGET=/some/path
MY_COMMAND_FLAG=true
```

---

## Environment Cascade

Every command execution sources environment in this order:

```
~/.koad-io/.env          (framework defaults)
~/.entityname/.env       (entity overrides)
./commands/<cmd>/.env    (command-local overrides)
```

Later sources override earlier ones. A variable in the command's `.env` always wins.

---

## Global Commands

These live at `~/.koad-io/commands/` and are available to all entities:

| Command | Purpose |
|---------|---------|
| `gestate <name>` | Create a new entity with full structure and crypto keys |
| `init <name>` | Initialize a cloned entity (create wrapper, establish inheritance) |
| `spawn <skeleton>` | Scaffold a project from a skeleton template |
| `commit staged` | AI-assisted git commit |
| `build [local]` | Build a Meteor application |
| `start [local]` | Start an application |
| `shell [mongo]` | Open Meteor shell, MongoDB shell, or bash |
| `test [one]` | Run all tests or a specific test file |
| `install starship` | Install Starship prompt |
| `assert datadir` | Assert that data directory exists |

---

## Adding a Command

To add a command to your entity:

```bash
mkdir -p ~/.entityname/commands/my-command
cat > ~/.entityname/commands/my-command/command.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

# ENTITY and ENTITY_DIR are already set
echo "Running as ${ENTITY} from ${ENTITY_DIR}"
EOF
chmod +x ~/.entityname/commands/my-command/command.sh
```

It is immediately available as `entityname my-command`.

---

## Subcommands

Commands can be nested by using arguments. The convention is `<command> <subcommand>`:

```bash
vesta commit self              # commit is the command, self is an argument
alice install nodejs           # install is the command, nodejs is an argument
```

There are two valid patterns for implementing subcommands:

### Pattern 1: Directory-Based (Deepest Match)

```
~/.juno/commands/commit/self/command.sh
```

The dispatcher resolves via deepest directory match. Clean, no case logic needed. Each subcommand is its own directory with its own `command.sh`.

**Use when:** Subcommands are distinct, have minimal shared setup, or you want maximum clarity in the filesystem.

### Pattern 2: Argument-Based (Case Statement)

```
~/.koad-io/commands/commit/command.sh
```

One `command.sh` handles `$1` via a `case` statement:

```bash
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  self)
    # handle: vesta commit self
    ;;
  *)
    echo "Usage: vesta commit <self|...>"
    exit 1
    ;;
esac
```

**Use when:** Subcommands share significant setup code, or you want centralized logic in one file.

Both patterns are valid and in use. Juno uses both: directory-based for `commit self`, argument-based (if any) in global commands.

---

## Inherited Commands

When an entity is gestated from a mother entity, it inherits the mother's commands directory. Inherited commands are resolved through the discovery order — the child entity can override any inherited command by placing its own version in `~/.entityname/commands/`.

Do not modify inherited commands directly. Override them locally.
