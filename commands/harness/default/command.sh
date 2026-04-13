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

# --- Flag filter ----------------------------------------------------------
#
# Extract --continue / -c before any other parsing so the flag can appear
# anywhere in the invocation (e.g. 'vesta harness default -c' or
# 'vesta harness default -c "follow-up prompt"'). Env-var CONTINUE=1 is
# equivalent. We export it so the delegate sub-command picks it up via its
# own filter / env read.

_filtered=()
for _arg in "$@"; do
  case "$_arg" in
    --continue|-c) CONTINUE=1 ;;
    *)             _filtered+=("$_arg") ;;
  esac
done
set -- "${_filtered[@]}"
unset _arg _filtered
if [ "${CONTINUE:-0}" = "1" ]; then
  export CONTINUE=1
fi

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
# Precedence for the delegate's PROMPT:
#   1. $PROMPT env var     — explicit override from the caller
#   2. stdin pipe          — heredoc / `cat brief.md | ...` (quoting-free path)
#   3. positional args     — legacy `harness default "hi there"`
#
# We rejoin positional args with single spaces and export so the delegate
# sees PROMPT in env. This lets us pass zero positional args to the delegate
# — otherwise the delegate's $1 would be interpreted as provider, $2 as
# model, which is exactly what this meta-harness exists to avoid.
#
# stdin is consumed HERE (not in the delegate) because `exec` would pass a
# spent pipe to the delegate anyway — better to own the read and export the
# resolved PROMPT cleanly.

if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi
if [ -z "$PROMPT" ] && [ $# -gt 0 ]; then
  PROMPT="$*"
fi
if [ -n "$PROMPT" ]; then
  export PROMPT
fi

# --- Context assembly (VESTA-SPEC-067) ------------------------------------
#
# Identity always loads. The entity wakes up knowing who it is regardless
# of whether a prompt was given, whether this is a fresh or continued
# session, or whether the caller came through the naked-entity hook or
# `harness default` directly. startup.sh assembles KOAD_IO.md → ENTITY.md
# → role primers → pre-emptive primitives. The SYSTEM_PROMPT rides under
# the user's PROMPT, not instead of it.

if [ -f "$HOME/.koad-io/harness/startup.sh" ]; then
  SYSTEM_PROMPT="$("$HOME/.koad-io/harness/startup.sh" | tee "$ENTITY_DIR/.context")" || {
    echo "Warning: startup.sh failed (exit $?), proceeding without context assembly" >&2
  }
  export SYSTEM_PROMPT
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
[ "${CONTINUE:-0}" = "1" ] && echo "continue      : yes (forward to $HARNESS)"
echo

# --- Delegate -------------------------------------------------------------

exec "$HARNESS_CMD"
