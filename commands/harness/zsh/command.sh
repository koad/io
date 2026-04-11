#!/usr/bin/env bash
#
# harness/zsh — launch an entity through a plain zsh shell
#
# Usage: <entity> harness zsh [prompt-or-command]
#
# The "human harness" for the Mac hosts (fourty4, flowbie) where zsh is
# the default shell. Mirror of harness/bash — no LLM, no model, no
# provider — just a zsh shell loaded with the entity's env, dropped into
# the right cwd, with an entity-tagged prompt.
#
# On Linux hosts where bash is default, use `harness bash` instead.
#
# Examples:
#   juno  harness zsh                             # interactive zsh as juno
#   vesta harness zsh                             # interactive zsh as vesta
#   juno  harness zsh "ls commands/"              # one-shot, exit after
#   PROMPT="git status" juno harness zsh          # one-shot via env
#
# Invariants:
#   - $ENTITY, $ENTITY_DIR, $ENTITY_HOST, $ENTITY_HOME remain set
#   - KOAD_IO_ROOTED honored for cwd selection
#   - $KOAD_IO_HARNESS=zsh is exported so rc files can tag the shell
#   - interactive shell uses a per-entity ZDOTDIR with a .zshrc that
#     sources the user's real ~/.zshrc and adds an entity-tagged PROMPT
#   - one-shot mode runs `zsh -c "$PROMPT"` and exits

set -e

# --- Flag filter ----------------------------------------------------------
#
# Accept --continue / -c for compatibility with the default meta-harness.
# No-op for a shell — there is no session to continue.

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
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'juno harness zsh')." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: \$ENTITY_DIR not set or not a directory: '$ENTITY_DIR'" >&2
  exit 64
fi

if ! command -v zsh >/dev/null 2>&1; then
  echo "Error: 'zsh' not found on PATH. Install zsh or use 'harness bash' instead." >&2
  exit 69
fi

# --- Prompt / one-shot resolution -----------------------------------------

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

export KOAD_IO_HARNESS=zsh

# --- Announce -------------------------------------------------------------

echo
echo "harness       : zsh (human harness)"
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
  exec zsh -c "$PROMPT"
fi

# --- Interactive: build a per-entity ZDOTDIR ------------------------------
#
# zsh reads its rc chain from $ZDOTDIR (falling back to $HOME). We set
# ZDOTDIR to a per-entity cache directory, write a minimal .zshrc that
# sources the user's real ~/.zshrc first, then prepends an entity tag to
# PROMPT. This keeps history, completions, aliases, theme, and oh-my-zsh
# (if any) working normally — we just layer on top of the operator's
# existing shell.
#
# Cache location: ~/.cache/koad-io/harness/<entity>/zsh/
# Self-contained, overwritten each invocation, outside the entity repo.

KOAD_IO_ZDOTDIR="$HOME/.cache/koad-io/harness/$ENTITY/zsh"
mkdir -p "$KOAD_IO_ZDOTDIR"

# Preserve the user's original ZDOTDIR so the rc file can source the right
# .zshrc — under normal conditions this is just $HOME.

export KOAD_IO_ORIG_ZDOTDIR="${ZDOTDIR:-$HOME}"

cat > "$KOAD_IO_ZDOTDIR/.zshrc" <<'ZRCEOF'
# koad:io zsh harness rc — sourced once on interactive shell start.
# Pulls the user's normal .zshrc, then tags PROMPT with the entity name.

_orig_zdotdir="${KOAD_IO_ORIG_ZDOTDIR:-$HOME}"
if [ -f "$_orig_zdotdir/.zshrc" ]; then
  # shellcheck disable=SC1090
  source "$_orig_zdotdir/.zshrc"
fi
unset _orig_zdotdir

# Entity tag in bright magenta, then whatever PROMPT the real rc left us.
# %{ %} wrap non-printing bytes so zsh's line-length math stays correct.
if [ -n "$ENTITY" ]; then
  PROMPT="%{$'\e[1;35m'%}[$ENTITY]%{$'\e[0m'%} ${PROMPT:-%~ %# }"
fi

export KOAD_IO_HARNESS=zsh
ZRCEOF

export ZDOTDIR="$KOAD_IO_ZDOTDIR"
exec zsh -i
