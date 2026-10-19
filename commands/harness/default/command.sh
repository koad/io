#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
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
_grab_resume=""
for _arg in "$@"; do
  if [ "$_grab_resume" = "1" ]; then
    RESUME_ID="$_arg"
    _grab_resume=""
    continue
  fi
  case "$_arg" in
    --continue|-c) CONTINUE=1 ;;
    --resume|-r)   _grab_resume=1 ;;
    --resume=*)    RESUME_ID="${_arg#*=}" ;;
    *)             _filtered+=("$_arg") ;;
  esac
done
set -- "${_filtered[@]}"
unset _arg _filtered _grab_resume
if [ "${CONTINUE:-0}" = "1" ]; then
  export CONTINUE=1
fi
if [ -n "${RESUME_ID:-}" ]; then
  export RESUME_ID
fi

# --- Guard rails ----------------------------------------------------------

if [ -z "$ENTITY" ]; then
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'vesta harness default')." >&2
  exit 64
fi

# --- Resolve harness name -------------------------------------------------

HARNESS="${ENTITY_DEFAULT_HARNESS:-${KOAD_IO_DEFAULT_HARNESS:-opencode}}"

# Sub-harnesses (claude, opencode, pi, bash, zsh, ...) live beside `default/`
# in whatever dir this script was invoked from. Using BASH_SOURCE ensures the
# resolver works regardless of whether the harness tree lives in the framework
# or in an override dir pointed at by $KOAD_IO_HARNESS.
#
# Kingdom launchers (throne) may live in a DIFFERENT tree (e.g.
# ~/.forge/commands/harness/). So resolution searches the full command
# cascade: the local tree first, then every dir in $KOAD_IO_COMMANDS_DIRS
# (forge > ecoincore > koad-io). First hit wins.
HARNESS_ROOT="$(dirname "$(dirname "${BASH_SOURCE[0]}")")"
HARNESS_CMD=""
HARNESS_SEARCH_DIRS=("$HARNESS_ROOT")
if [ -n "${KOAD_IO_COMMANDS_DIRS:-}" ]; then
  # Split on ':' directly — no newline substitution (the \n trick produces
  # a literal backslash-n and fails to split).
  IFS=':' read -r -a _cmd_dirs <<< "$KOAD_IO_COMMANDS_DIRS"
  for _d in "${_cmd_dirs[@]}"; do
    [ -n "$_d" ] && HARNESS_SEARCH_DIRS+=("$_d/harness")
  done
  unset _cmd_dirs
fi
for _root in "${HARNESS_SEARCH_DIRS[@]}"; do
  if [ -f "$_root/$HARNESS/command.sh" ]; then
    HARNESS_CMD="$_root/$HARNESS/command.sh"
    break
  fi
done
unset _root

if [ -z "$HARNESS_CMD" ] || [ ! -f "$HARNESS_CMD" ]; then
  echo "Error: resolved harness '$HARNESS' has no command script." >&2
  echo "  Searched:" >&2
  for _root in "${HARNESS_SEARCH_DIRS[@]}"; do
    echo "  - $_root/$HARNESS/command.sh" >&2
  done
  echo >&2
  echo "Available harnesses:" >&2
  for _root in "${HARNESS_SEARCH_DIRS[@]}"; do
    for _d in "$_root"/*/; do
      [ -f "$_d/command.sh" ] || continue
      _name="$(basename "$_d")"
      [ "$_name" = "default" ] && continue
      echo "  - $_name ($_root/$_name)" >&2
    done
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
[ -n "${RESUME_ID:-}" ] && echo "resume        : $RESUME_ID (forward to $HARNESS)"
echo

# --- Delegate -------------------------------------------------------------

echo "exec: $HARNESS_CMD"
exec "$HARNESS_CMD"
