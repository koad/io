#!/usr/bin/env bash
# VESTA-SPEC-067: Entity context assembly
# Assembles context layers and pre-emptive primitives to stdout.
# The calling hook pipes this into --append-system-prompt or equivalent.
#
# Design: the cheapest token is the one the entity never has to generate.
# Front-load the map — ls the key dirs, report the facts, cat the identity.
# The entity wakes up already knowing what it has. No guessing. No tool calls
# to discover its own structure. Its first breath is this script's exhale.
#
# Usage (env already sourced by koad-io bin before hook fires):
#   SYSTEM_PROMPT="$(~/.koad-io/harness/startup.sh)"
#   exec claude . --append-system-prompt "$SYSTEM_PROMPT"
#
# Env required:
#   ENTITY       — entity name (e.g. juno)
#   CWD          — caller's working directory (set by koad-io bin)
#
# Env optional:
#   ENTITY_DIR   — entity directory (default: ~/.$ENTITY)
#   KOAD_IO_DIR  — framework directory (default: ~/.koad-io)
#   KOAD_IO_ROOTED — if true, entity works from $ENTITY_DIR (has an office)
#                    if unset, entity works from $CWD (out on the town)
#
# Outputs:
#   stdout       — assembled system prompt
#   stderr       — diagnostic log (for auditing)
#   .context     — same content written to $ENTITY_DIR/.context (for static harnesses)
#
set -euo pipefail

ENTITY="${ENTITY:?ENTITY not set}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"
CALL_DIR="${CWD:-$PWD}"

# --- Resolve working directory ---
if [ "${KOAD_IO_ROOTED:-}" = "true" ]; then
  HARNESS_WORK_DIR="$ENTITY_DIR"
else
  HARNESS_WORK_DIR="$CALL_DIR"
fi
export HARNESS_WORK_DIR

# --- Startup facts (deterministic, not AI-dependent) ---
_HOST="$(hostname -s 2>/dev/null || echo unknown)"
_USER="$(whoami 2>/dev/null || echo unknown)"
_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- Helper: list a directory if it exists, one item per line ---
_ls() {
  if [ -d "$1" ]; then
    ls -1 "$1" 2>/dev/null
  fi
}

# --- Diagnostic log (stderr) ---
echo "[startup] entity=$ENTITY host=$_HOST user=$_USER" >&2
echo "[startup] entity_dir=$ENTITY_DIR call_dir=$CALL_DIR" >&2
echo "[startup] rooted=${KOAD_IO_ROOTED:-false} → work_dir=$HARNESS_WORK_DIR" >&2

# --- Assemble prompt (stdout) ---
# Everything below this line goes to the entity as pre-loaded context.
# The goal: zero tool calls needed to orient.

cat <<EOF
## Session Context

- **entity:** $ENTITY
- **host:** $_HOST
- **user:** $_USER
- **entity_dir:** $ENTITY_DIR
- **work_dir:** $HARNESS_WORK_DIR
- **call_dir:** $CALL_DIR
- **started:** $_DATE

## Pre-emptive Primitives

A look around yourself. This is what you have on disk right now.

### Commands
EOF
_ls "$ENTITY_DIR/commands" | sed 's/^/- /'
_ls "$KOAD_IO_DIR/commands" | sed 's/^/- /' | sed 's/^//' # framework fallbacks

cat <<'EOF'

### Hooks
EOF
_ls "$ENTITY_DIR/hooks" | sed 's/^/- /'

cat <<'EOF'

### Trust Bonds
EOF
_ls "$ENTITY_DIR/trust/bonds" 2>/dev/null | grep -v '\.asc$' | sed 's/\.md$//' | sed 's/^/- /'

cat <<'EOF'

### Memories
EOF
_ls "$ENTITY_DIR/memories" | grep '\.md$' | sed 's/\.md$//' | sed 's/^/- /'

cat <<'EOF'

### Skills
EOF
_ls "$ENTITY_DIR/skills" | sed 's/^/- /'

# If roaming, show what's in the working directory too
if [ "$HARNESS_WORK_DIR" != "$ENTITY_DIR" ]; then
  cat <<EOF

### Working Directory ($HARNESS_WORK_DIR)
EOF
  _ls "$HARNESS_WORK_DIR" | head -30 | sed 's/^/- /'
fi

printf '\n---\n\n'

# --- Layer 1: Kingdom ---
if [ -f "$KOAD_IO_DIR/KOAD_IO.md" ]; then
  cat "$KOAD_IO_DIR/KOAD_IO.md"
  printf '\n\n---\n\n'
  echo "[startup] layer1: KOAD_IO.md ($(wc -c < "$KOAD_IO_DIR/KOAD_IO.md") bytes)" >&2
else
  echo "[startup] layer1: KOAD_IO.md not found, skipped" >&2
fi

# --- Layer 2: Entity ---
if [ -f "$ENTITY_DIR/ENTITY.md" ]; then
  cat "$ENTITY_DIR/ENTITY.md"
  echo "[startup] layer2: ENTITY.md ($(wc -c < "$ENTITY_DIR/ENTITY.md") bytes)" >&2
else
  echo "[startup] layer2: ENTITY.md not found, skipped" >&2
fi

# Layers 3-6 loaded by the harness:
#   3. Implement — CLAUDE.md auto-loaded from HARNESS_WORK_DIR
#   4. Location  — PRIMER.md injected by framework hook
#   5. Memory    — harness memory system
#   6. Guardrails — hardcoded in portal harness, implicit in CLI

# --- Write .context for static harnesses (opencode, etc.) ---
# We tee stdout as we go would complicate the script. Instead, the calling hook
# can redirect: startup.sh | tee $ENTITY_DIR/.context
# Or: the .context is just a snapshot — redirect a second run if needed.
