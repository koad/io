#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# probe — naked-LLM context testing
#
# Runs opencode in a sealed, entity-less mode with a hand-picked context
# slice + prompt. The LLM sees ONLY the files you attach and the prompt —
# no ENTITY.md, no memories, no harness loadout, no cwd-inherited
# AGENTS.md, no external plugins. This makes entity context segments
# falsifiable:
#
#   - A/B test whether a memory actually shapes answers
#   - Bisect a loadout to find which file caused a behavior
#   - Regression-test behavior before/after memory edits
#   - Reproduce a past decision from its context slice (audit trail)
#
# Layer 1 of the probe primitive. Layers 2 (audit: sign + log) and
# 3 (test: assertion suites) can grow on top of this.
#
# Usage:
#   probe [options] "prompt"
#   echo "prompt" | probe [options]
#
# Options:
#   -c, --context <file>    Context file to attach (repeatable). Relative
#                           paths resolve against $ENTITY_DIR when set,
#                           otherwise $PWD. Forwarded to opencode as -f.
#   -m, --model <id>        Model in provider/model format
#                           (default: opencode/big-pickle)
#   -n, --dry-run           Print what would be sent, don't call the LLM
#   -h, --help              Show this help
#
# Environment:
#   PROBE_MODEL             Override default model
#
# Examples:
#   # Does the GTD-alignment feedback memory actually shape answers?
#   juno probe -c memories/feedback_gtd_alignment.md \
#     "should we build a speculative analytics dashboard?"
#
#   # Bisect a slice
#   juno probe -c ENTITY.md -c memories/feedback_commit_push.md \
#     "should I push this commit to GitHub right now?"
#
#   # Pipe the prompt in
#   cat question.txt | juno probe -c memories/feedback_pr_protocol.md
#
#   # Dry-run to see the exact context being sent
#   juno probe -n -c ENTITY.md "who are you?"

set -euo pipefail

DEFAULT_MODEL="${PROBE_MODEL:-opencode/big-pickle}"

MODEL="$DEFAULT_MODEL"
PROMPT=""
DRY_RUN=false
CONTEXT_FILES=()

usage() {
  sed -n '3,46p' "$0" | sed 's/^# \{0,1\}//'
}

# --- Arg parsing ----------------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    -c|--context)
      [ $# -ge 2 ] || { echo "probe: --context needs a file argument" >&2; exit 64; }
      CONTEXT_FILES+=("$2"); shift 2 ;;
    -m|--model)
      [ $# -ge 2 ] || { echo "probe: --model needs a value" >&2; exit 64; }
      MODEL="$2"; shift 2 ;;
    -n|--dry-run)
      DRY_RUN=true; shift ;;
    -h|--help|help)
      usage; exit 0 ;;
    --)
      shift; PROMPT="$*"; break ;;
    -*)
      echo "probe: unknown option: $1" >&2; usage >&2; exit 64 ;;
    *)
      if [ -z "$PROMPT" ]; then PROMPT="$1"; else PROMPT="$PROMPT $1"; fi
      shift ;;
  esac
done

# Read stdin as prompt if none given and stdin is piped
if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi

if [ -z "$PROMPT" ]; then
  echo "probe: no prompt provided" >&2
  usage >&2
  exit 64
fi

# --- Context file resolution ---------------------------------------------
#
# Relative paths resolve against $ENTITY_DIR when set (convenient for
# `juno probe -c memories/foo.md`). Falls back to $PWD for naked callers.

_resolve_base="${ENTITY_DIR:-$PWD}"
_resolved_files=()
_total_bytes=0

for _f in "${CONTEXT_FILES[@]+"${CONTEXT_FILES[@]}"}"; do
  case "$_f" in
    /*) _abs="$_f" ;;
    *)  _abs="$_resolve_base/$_f" ;;
  esac
  if [ ! -r "$_abs" ]; then
    echo "probe: context file not readable: $_abs" >&2
    exit 66
  fi
  _resolved_files+=("$_abs")
  _sz=$(stat -c%s "$_abs" 2>/dev/null || echo 0)
  _total_bytes=$((_total_bytes + _sz))
done

# --- Guard rails ----------------------------------------------------------

if ! command -v opencode >/dev/null 2>&1; then
  echo "probe: 'opencode' CLI not found on PATH" >&2
  exit 69
fi

# --- Naked execution environment -----------------------------------------
#
# Strip every mechanism by which an entity loadout could leak in:
#
#   - XDG_CONFIG_HOME  rooted entities point this at $ENTITY_DIR so
#                      opencode would pick up entity-flavored config.
#                      Unset to fall back to ~/.config (user-default,
#                      where auth lives — we keep auth, drop flavor).
#   - cwd              opencode walks up from cwd looking for AGENTS.md.
#                      --dir /tmp sidesteps that entirely.
#   - plugins          --pure disables external plugins on this run.
#   - agent            no --agent, so opencode uses its default.

unset XDG_CONFIG_HOME

# --- Announce -------------------------------------------------------------

{
  echo
  echo "probe         : naked opencode (--pure)"
  echo "model         : $MODEL"
  echo "context files : ${#_resolved_files[@]}  (${_total_bytes} bytes)"
  for _f in "${_resolved_files[@]+"${_resolved_files[@]}"}"; do
    echo "              - $_f"
  done
  echo "prompt bytes  : ${#PROMPT}"
  [ "$DRY_RUN" = true ] && echo "mode          : dry-run (no LLM call)"
  echo
} >&2

if [ "$DRY_RUN" = true ]; then
  echo "--- prompt ---" >&2
  printf '%s\n' "$PROMPT" >&2
  exit 0
fi

# --- Exec -----------------------------------------------------------------

_args=(run --pure --dir /tmp -m "$MODEL")
for _f in "${_resolved_files[@]+"${_resolved_files[@]}"}"; do
  _args+=(--file="$_f")
done
_args+=(-- "$PROMPT")

exec opencode "${_args[@]}"
