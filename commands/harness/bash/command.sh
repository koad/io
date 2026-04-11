#!/usr/bin/env bash
#
# harness/bash — launch an entity through a plain bash shell
#
# Usage: <entity> harness bash [prompt-or-command]
#
# The "human harness." No LLM, no model, no provider — just a bash shell
# loaded with the entity's env, dropped into the right cwd, with an entity-
# tagged prompt. This is how koad:io worked before LLM harnesses existed:
# open a terminal as juno, and juno's commands, paths, keys, and identity
# are just there.
#
# Examples:
#   juno  harness bash                            # interactive shell as juno
#   vesta harness bash                            # interactive shell as vesta
#   juno  harness bash "ls commands/"             # one-shot, exit after
#   PROMPT="git status" juno harness bash         # one-shot via env
#
# Invariants:
#   - $ENTITY, $ENTITY_DIR, $ENTITY_HOST, $ENTITY_HOME remain set
#   - KOAD_IO_ROOTED honored for cwd selection (rooted → $ENTITY_DIR,
#     roaming → $CWD / $PWD)
#   - $KOAD_IO_HARNESS=bash is exported so rc files can tag the shell
#   - interactive shell uses a temp rcfile that sources ~/.bashrc first,
#     then adds an entity-tagged PS1
#   - one-shot mode runs `bash -c "$PROMPT"` and exits

set -e

# --- Flag filter ----------------------------------------------------------
#
# Accept --continue / -c for compatibility with the default meta-harness
# (which may forward it), but it is a no-op for a shell: there is no
# "session" to continue. Filter it out so `bash -c` doesn't get confused.

_filtered=()
_saw_continue=0
for _arg in "$@"; do
  case "$_arg" in
    --continue|-c) _saw_continue=1 ;;
    *)             _filtered+=("$_arg") ;;
  esac
done
set -- "${_filtered[@]+"${_filtered[@]}"}"
unset _arg _filtered

# --- Guard rails ----------------------------------------------------------

if [ -z "$ENTITY" ]; then
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'juno harness bash')." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: \$ENTITY_DIR not set or not a directory: '$ENTITY_DIR'" >&2
  exit 64
fi

if ! command -v bash >/dev/null 2>&1; then
  echo "Error: 'bash' not found on PATH. This is unexpected on a koad:io host." >&2
  exit 69
fi

# --- Prompt / one-shot resolution -----------------------------------------
#
# Precedence:
#   1. $PROMPT env var     — explicit override, heredoc-friendly
#   2. stdin pipe          — `echo 'ls' | juno harness bash`
#   3. positional args     — legacy `juno harness bash "ls"`
#
# If any of these resolve to non-empty, we run one-shot (`bash -c`) and
# exit. Otherwise we launch an interactive shell.

if [ -z "${PROMPT:-}" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi
PROMPT="${PROMPT:-$*}"

# --- Rooted vs roaming cwd ------------------------------------------------

if [ "${KOAD_IO_ROOTED:-false}" = "true" ]; then
  WORK_DIR="$ENTITY_DIR"
else
  WORK_DIR="${CWD:-$PWD}"
fi

cd "$WORK_DIR"

# --- Harness tag ----------------------------------------------------------

export KOAD_IO_HARNESS=bash

# --- Announce -------------------------------------------------------------

echo
echo "harness       : bash (human harness)"
echo "entity        : $ENTITY"
echo "entity_dir    : $ENTITY_DIR"
echo "work_dir      : $WORK_DIR"
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot"
  echo "command       : $PROMPT"
else
  echo "mode          : interactive"
fi
[ "$_saw_continue" = "1" ] && echo "continue      : ignored (no session semantics in a shell)"
echo

# --- One-shot -------------------------------------------------------------

if [ -n "$PROMPT" ]; then
  exec bash -c "$PROMPT"
fi

# --- Interactive: build an entity-tagged rcfile ---------------------------
#
# bash's --rcfile is read once at interactive-shell startup. We source the
# user's normal ~/.bashrc first (so aliases, history, completion still work)
# and then override PS1 to prepend an entity tag in bright magenta, so the
# operator always knows which entity's shell they are inside.
#
# Process substitution <(...) creates a /dev/fd FIFO that the new bash reads
# once and then releases — no temp file to clean up.

exec bash --rcfile <(cat <<'RCEOF'
# koad:io bash harness rc — sourced once on interactive shell start.
# Pulls the user's normal rc, then tags the prompt with the entity name.

if [ -f ~/.bashrc ]; then
  # shellcheck disable=SC1090
  source ~/.bashrc
fi

# Entity tag in bright magenta, then whatever PS1 the user's rc left us.
# \[ \] tell bash the bytes are non-printing so line wrapping stays correct.
if [ -n "$ENTITY" ]; then
  PS1="\[\033[1;35m\][$ENTITY]\[\033[0m\] ${PS1:-\\w \\$ }"
fi

export KOAD_IO_HARNESS=bash
RCEOF
) -i
