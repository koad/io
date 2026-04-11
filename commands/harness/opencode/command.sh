#!/usr/bin/env bash
#
# harness/opencode — launch an entity through opencode
#
# Usage: <entity> harness opencode <provider> <model> [prompt]
#
# Examples:
#   sibyl harness opencode anthropic  claude-sonnet-4-6
#   vesta harness opencode ollama     deepseek-r1
#   juno  harness opencode openrouter google/gemini-2.5-pro "summarize issues"
#   alice harness opencode openai     gpt-5                  "hi"
#
# Invariants (per VESTA-SPEC-072):
#   - XDG_CONFIG_HOME = $ENTITY_DIR  (opencode reads global config from
#     $ENTITY_DIR/opencode/ — coexists with entity files at the same root)
#   - workspace config: opencode.jsonc at $ENTITY_DIR (or $CWD for roaming)
#   - credentials cascade via koad-io loader: entity > kingdom
#   - KOAD_IO_ROOTED honored for cwd selection
#   - interactive TUI when no prompt; 'opencode run' one-shot when given

set -e

# --- Flag filter ----------------------------------------------------------
#
# Extract --continue / -c before positional parsing so the flag can appear
# anywhere. Env-var CONTINUE=1 is equivalent. Same pattern as the claude
# sibling; opencode's own CLI uses the same -c/--continue spelling.

_filtered=()
for _arg in "$@"; do
  case "$_arg" in
    --continue|-c) CONTINUE=1 ;;
    *)             _filtered+=("$_arg") ;;
  esac
done
set -- "${_filtered[@]}"
unset _arg _filtered
CONTINUE="${CONTINUE:-0}"

# --- Guard rails ----------------------------------------------------------

if [ -z "$ENTITY" ]; then
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'sibyl harness opencode ...')." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: \$ENTITY_DIR not set or not a directory: '$ENTITY_DIR'" >&2
  exit 64
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "Error: 'opencode' CLI not found on PATH. Install opencode first." >&2
  exit 69
fi

# --- Argument parsing -----------------------------------------------------

PROVIDER="${1:-${ENTITY_DEFAULT_PROVIDER:-${KOAD_IO_DEFAULT_PROVIDER:-anthropic}}}"
[ $# -gt 0 ] && shift

MODEL="${1:-${ENTITY_DEFAULT_MODEL:-${KOAD_IO_DEFAULT_MODEL:-claude-sonnet-4-6}}}"
[ $# -gt 0 ] && shift

# Remaining positional args become the prompt (word-split by the koad-io
# dispatcher, so we rejoin). Precedence:
#   1. $PROMPT env var     — explicit override, heredoc-friendly
#   2. stdin pipe          — `cat brief.md | ...` or heredoc with no env var
#   3. positional args     — legacy `... harness opencode ... "hi there"`
#
# Reading stdin when it's not a TTY (`[ ! -t 0 ]`) lets callers sidestep
# shell quoting entirely — nested quotes, dollar signs, backticks, newlines,
# all pass through literally because they never touch shell word-splitting.
if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi
PROMPT="${PROMPT:-$*}"

# --- Provider awareness ---------------------------------------------------
#
# opencode is provider-agnostic and supports many backends. We don't
# gatekeep providers — we warn about missing credentials for the common
# ones and let opencode handle the rest via its own 'opencode auth'.

case "$PROVIDER" in
  anthropic)
    if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
      echo "Warning: no ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in environment." >&2
      echo "  (opencode may still work if credentials are cached via 'opencode auth')" >&2
    fi
    ;;
  openai)
    if [ -z "$OPENAI_API_KEY" ]; then
      echo "Warning: no OPENAI_API_KEY in environment." >&2
    fi
    ;;
  ollama)
    # Local inference — no key needed, but warn if the host looks unset.
    if [ -z "$OLLAMA_HOST" ] && [ -z "$OLLAMA_BASE_URL" ]; then
      echo "Note: OLLAMA_HOST/OLLAMA_BASE_URL unset; opencode will default to localhost:11434." >&2
    fi
    ;;
  openrouter)
    if [ -z "$OPENROUTER_API_KEY" ]; then
      echo "Warning: no OPENROUTER_API_KEY in environment." >&2
    fi
    ;;
  google|gemini)
    if [ -z "$GEMINI_API_KEY" ] && [ -z "$GOOGLE_GENERATIVE_AI_API_KEY" ]; then
      echo "Warning: no GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY in environment." >&2
    fi
    ;;
  *)
    # Pass-through — opencode supports more providers than we enumerate here.
    echo "Note: provider '$PROVIDER' not known to this harness script." >&2
    echo "  Passing through to opencode; it may or may not recognize it." >&2
    ;;
esac

# --- Model assembly -------------------------------------------------------
#
# opencode expects --model in 'provider/model' format (e.g.
# 'anthropic/claude-opus-4-6', 'ollama/deepseek-r1'). If the user already
# supplied a slash, trust them; otherwise assemble provider/model.

case "$MODEL" in
  */*) MODEL_RESOLVED="$MODEL" ;;
  *)   MODEL_RESOLVED="$PROVIDER/$MODEL" ;;
esac

# --- SPEC-072 invariants --------------------------------------------------
#
# opencode uses XDG_CONFIG_HOME for its global config lookup
# ($XDG_CONFIG_HOME/opencode/). Pointing it at the entity root means
# opencode's global config dir becomes $ENTITY_DIR/opencode/ — per-entity
# sovereign config that coexists with entity identity files at the same
# root, exactly as SPEC-072 prescribes.
#
# Workspace-local 'opencode.jsonc' at $ENTITY_DIR is the project-level
# config layer and is picked up automatically by cwd.

export XDG_CONFIG_HOME="$ENTITY_DIR"

# --- Rooted vs roaming cwd ------------------------------------------------

if [ "${KOAD_IO_ROOTED:-false}" = "true" ]; then
  WORK_DIR="$ENTITY_DIR"
else
  WORK_DIR="${CWD:-$PWD}"
fi

cd "$WORK_DIR"

# --- Announce -------------------------------------------------------------

echo
echo "harness       : opencode"
echo "entity        : $ENTITY"
echo "entity_dir    : $ENTITY_DIR"
echo "work_dir      : $WORK_DIR"
echo "provider      : $PROVIDER"
echo "model         : $MODEL_RESOLVED"
echo "xdg_config    : $XDG_CONFIG_HOME  (opencode global config → \$ENTITY_DIR/opencode/)"
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot"
  echo "prompt        : $PROMPT"
else
  echo "mode          : interactive"
fi
[ "$CONTINUE" = "1" ] && echo "continue      : yes (opencode -c — resume last session)"
echo

# --- Exec -----------------------------------------------------------------
#
# opencode 'run' is the one-shot. Both 'run' and the interactive TUI accept
# -c/--continue. For rooted entities cwd is always $ENTITY_DIR, so there is
# exactly one persistent session per entity; for roaming entities, one per
# (entity × project-dir) pair.

if [ -n "$PROMPT" ]; then
  _args=(run --model "$MODEL_RESOLVED" --dir "$WORK_DIR")
  [ "$CONTINUE" = "1" ] && _args+=(-c)
  _args+=("$PROMPT")
  exec opencode "${_args[@]}"
else
  if [ "$CONTINUE" = "1" ]; then
    exec opencode -c "$WORK_DIR"
  else
    exec opencode "$WORK_DIR"
  fi
fi
