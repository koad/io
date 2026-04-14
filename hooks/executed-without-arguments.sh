#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail

# executed-without-arguments.sh — the "just type the entity name" entry point.
#
# Delegates to `harness default`. Context assembly (startup.sh, PRIMER
# layering) is owned by each leaf harness — not here. This hook is just
# the door.
#
# Behavior is driven entirely by the entity's .env cascade — this script
# is identical for every entity. See ~/.koad-io/hooks/PRIMER.md for the
# env-var contract:
#
#   ENTITY_DEFAULT_HARNESS       claude | opencode | pi | hermez
#   ENTITY_DEFAULT_PROVIDER      anthropic | opencode | ollama | ...
#   ENTITY_DEFAULT_MODEL         opus-4-6 | big-pickle | ...
#   ENTITY_SKIP_PERMISSIONS      true (Juno-only) — --dangerously-skip-permissions
#   KOAD_IO_ROOTED               true → works from $ENTITY_DIR, unset → from $CWD
#   ENTITY_HOST                  rooted entity's home host (ssh'd into by framework)
#
# Entity .env values win over framework ~/.koad-io/.env defaults. Hardcoded
# fallbacks live inside the leaf harness scripts (commands/harness/<name>/).

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

# --- CWD PRIMER auto-injection --------------------------------------------
#
# If the caller's $CWD has a PRIMER.md, prepend it to PROMPT so the entity
# wakes up oriented to the project it was invoked inside. Auto-detect by
# file presence — no env var needed. Consumes stdin here if PROMPT isn't
# already set, since we need a concrete value to prepend to.
#
# This runs BEFORE delegation so every downstream harness (claude, opencode,
# pi, hermez) gets the injected prompt for free via the PROMPT export.

# Skip if CALL_DIR is the entity's own dir — that PRIMER already loads via
# the identity cascade in startup.sh; re-injecting would double-context.
if [ -f "$CALL_DIR/PRIMER.md" ] && [ "$CALL_DIR" != "$ENTITY_DIR" ]; then
  if [ -z "${PROMPT:-}" ] && [ ! -t 0 ]; then
    PROMPT="$(cat)"
  fi
  _primer="$(cat "$CALL_DIR/PRIMER.md")"
  if [ -n "${PROMPT:-}" ]; then
    PROMPT="$(printf 'Project context (from %s/PRIMER.md):\n%s\n\n---\n\n%s' "$CALL_DIR" "$_primer" "$PROMPT")"
  else
    PROMPT="$(printf 'Project context (from %s/PRIMER.md):\n%s' "$CALL_DIR" "$_primer")"
  fi
  export PROMPT
  unset _primer
fi

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
