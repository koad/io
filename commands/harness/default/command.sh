#!/usr/bin/env bash
#
# harness/default — meta-harness: resolve and delegate to the entity's
# configured default harness.
#
# Usage: <entity> harness default [prompt]
#
# Lets every entity pick its own harness × provider × model in its .env
# without having to restate them on every invocation.
#
#   vesta harness default                     # interactive
#   alice harness default "hi"                # one-shot
#   PROMPT="..." juno harness default         # one-shot, multi-line prompt
#
# Resolution cascade (first hit wins):
#
#   harness:  $ENTITY_DEFAULT_HARNESS   (~/.<entity>/.env)
#          →  $KOAD_IO_DEFAULT_HARNESS  (~/.koad-io/.env)
#          →  opencode                  (hardcoded framework default)
#
# Provider and model are NOT resolved here — we delegate that to the
# underlying harness script, which already cascades:
#
#   positional
#     → $ENTITY_DEFAULT_PROVIDER / $ENTITY_DEFAULT_MODEL
#     → $KOAD_IO_DEFAULT_PROVIDER / $KOAD_IO_DEFAULT_MODEL
#     → its own hardcoded default
#
# We pass no positional args to the delegate so its env cascade is the
# single source of truth. Any prompt from our caller is handed off via the
# PROMPT env var (every shipped harness honors PROMPT over $*).

set -e

# --- Guard rails ----------------------------------------------------------

if [ -z "$ENTITY" ]; then
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'vesta harness default')." >&2
  exit 64
fi

# --- Resolve harness name -------------------------------------------------

HARNESS="${ENTITY_DEFAULT_HARNESS:-${KOAD_IO_DEFAULT_HARNESS:-opencode}}"

HARNESS_DIR="$HOME/.koad-io/commands/harness/$HARNESS"
HARNESS_CMD="$HARNESS_DIR/command.sh"

if [ ! -f "$HARNESS_CMD" ]; then
  echo "Error: resolved harness '$HARNESS' has no command script at:" >&2
  echo "  $HARNESS_CMD" >&2
  echo >&2
  echo "Available harnesses:" >&2
  for d in "$HOME/.koad-io/commands/harness"/*/; do
    [ -f "$d/command.sh" ] || continue
    name="$(basename "$d")"
    [ "$name" = "default" ] && continue
    echo "  - $name" >&2
  done
  echo >&2
  echo "Set ENTITY_DEFAULT_HARNESS in ~/.$ENTITY/.env, or KOAD_IO_DEFAULT_HARNESS in ~/.koad-io/.env." >&2
  exit 66
fi

# --- Prompt hand-off ------------------------------------------------------
#
# Remaining positional args (post-dispatcher word-split) become the prompt.
# We rejoin with single spaces and export so the delegate sees PROMPT in env.
# This lets us pass zero positional args to the delegate — otherwise the
# delegate's $1 would be interpreted as provider, $2 as model, which is
# exactly what this meta-harness exists to avoid.

if [ $# -gt 0 ]; then
  export PROMPT="${PROMPT:-$*}"
fi

# --- Announce -------------------------------------------------------------

echo
echo "harness       : default → $HARNESS"
echo "entity        : $ENTITY"
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot"
else
  echo "mode          : interactive"
fi
echo

# --- Delegate -------------------------------------------------------------

exec "$HARNESS_CMD"
