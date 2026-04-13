#!/usr/bin/env bash
set -euo pipefail

# executed-without-arguments.sh — the "just type the entity name" entry point.
#
# Delegates to `harness default`. Context assembly (startup.sh, PRIMER
# layering) is owned by each leaf harness — not here. This hook is just
# the door.

ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
export CALL_DIR="${CWD:-$PWD}"

# Rooted = has an office (works from entity dir). Default = roaming (works from CWD).
if [ "${KOAD_IO_ROOTED:-}" = "true" ]; then
  HARNESS_WORK_DIR="$ENTITY_DIR"
else
  HARNESS_WORK_DIR="$CALL_DIR"
fi

# Verify entity directory exists
if [ ! -d "$ENTITY_DIR" ]; then
  echo "[error] entity directory does not exist: $ENTITY_DIR" >&2
  exit 1
fi

# --- Terminal title: entity on host in cwd ---
_HOST="$(hostname -s 2>/dev/null || echo unknown)"
_set_title() { printf '\033]0;%s\007' "$1"; }
_set_title "$ENTITY on $_HOST in $HARNESS_WORK_DIR"
_cleanup() { _set_title "$_HOST:$HARNESS_WORK_DIR"; }
trap _cleanup EXIT

cd "$HARNESS_WORK_DIR"

# --- Delegate to harness default ------------------------------------------
#
# Each leaf harness (claude, opencode, pi, ...) runs startup.sh itself and
# consumes SYSTEM_PROMPT in its own native way. default/ just routes.

HARNESS_CMD="$HOME/.koad-io/commands/harness/default/command.sh"
if [ ! -f "$HARNESS_CMD" ]; then
  echo "[error] harness default not found: $HARNESS_CMD" >&2
  exit 1
fi

exec "$HARNESS_CMD"
