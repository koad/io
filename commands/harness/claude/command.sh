#!/usr/bin/env bash
#
# harness/claude — launch an entity through Claude Code
#
# Usage: <entity> harness claude <provider> <model> [prompt]
#
# Examples:
#   juno  harness claude anthropic opus-4-6
#   sibyl harness claude anthropic sonnet-4-6 "scan briefs"
#   alice harness claude anthropic haiku-4-5 "hi"
#
# Invariants (per VESTA-SPEC-072):
#   - CLAUDE_CONFIG_DIR = $ENTITY_DIR (entity root IS the harness config dir)
#   - credentials cascade: entity .credentials > kingdom .credentials (handled by koad-io loader)
#   - rooted vs roaming cwd honored via KOAD_IO_ROOTED
#   - interactive when no prompt; -p one-shot when prompt present

set -e

# --- Flag filter ----------------------------------------------------------
#
# Extract --continue / -c before positional parsing so the flag can appear
# anywhere (e.g. 'vesta harness claude -c' or 'vesta harness claude anthropic
# sonnet-4-6 -c "follow-up"'). Env-var CONTINUE=1 is equivalent and lets
# callers set it without touching positional args. This is the same pattern
# koad-io itself uses for --quiet.

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
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'juno harness claude ...')." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: \$ENTITY_DIR not set or not a directory: '$ENTITY_DIR'" >&2
  exit 64
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: 'claude' CLI not found on PATH. Install Claude Code first." >&2
  exit 69
fi

# --- Argument parsing -----------------------------------------------------

PROVIDER="${1:-${ENTITY_DEFAULT_PROVIDER:-${KOAD_IO_DEFAULT_PROVIDER:-anthropic}}}"
[ $# -gt 0 ] && shift

MODEL="${1:-${ENTITY_DEFAULT_MODEL:-${KOAD_IO_DEFAULT_MODEL:-opus-4-6}}}"
[ $# -gt 0 ] && shift

# Remaining positional args become the prompt (word-split by the koad-io
# dispatcher, so we rejoin with single spaces). Precedence:
#   1. $PROMPT env var     — explicit override, heredoc-friendly
#   2. stdin pipe          — `cat brief.md | ...` or heredoc with no env var
#   3. positional args     — legacy `... harness default "hi there"`
#
# Reading stdin when it's not a TTY (`[ ! -t 0 ]`) lets callers sidestep
# shell quoting entirely — nested quotes, dollar signs, backticks, newlines,
# all pass through literally because they never touch shell word-splitting.
if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi
PROMPT="${PROMPT:-$*}"

# --- Provider validation --------------------------------------------------

case "$PROVIDER" in
  anthropic)
    if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
      echo "Warning: no ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in environment." >&2
      echo "  (claude CLI may still work if it has cached credentials in \$ENTITY_DIR/.credentials.json)" >&2
    fi
    ;;
  bedrock|vertex)
    echo "Error: provider '$PROVIDER' not yet wired in this harness. Contributions welcome." >&2
    exit 65
    ;;
  *)
    echo "Error: unknown provider '$PROVIDER' for claude harness." >&2
    echo "  Supported: anthropic  (bedrock, vertex — not yet wired)" >&2
    exit 65
    ;;
esac

# --- Model name normalization --------------------------------------------
#
# Accept short names like 'opus-4-6' or full IDs like 'claude-opus-4-6'.
# Prefix 'claude-' if missing. The claude CLI resolves short→long itself
# but being explicit avoids surprises.

case "$MODEL" in
  claude-*) MODEL_RESOLVED="$MODEL" ;;
  *)        MODEL_RESOLVED="claude-$MODEL" ;;
esac

# --- SPEC-072 invariants --------------------------------------------------
#
# Entity directory IS the harness config directory. Claude state
# (.claude.json, settings.json, history.jsonl, projects/<ws>/) lives at the
# entity root alongside ENTITY.md, memories/, trust/, id/, etc.
#
# Export so child processes (hooks, bash tool subshells) can find it.

export CLAUDE_CONFIG_DIR="$ENTITY_DIR"

# --- Rooted vs roaming cwd ------------------------------------------------
#
# Rooted entities (Juno, Vesta) always work from $ENTITY_DIR regardless of
# where they were invoked. Roaming entities (Vulcan, Mercury) stay in $CWD
# so they can operate on the project the user invoked them inside.

if [ "${KOAD_IO_ROOTED:-false}" = "true" ]; then
  WORK_DIR="$ENTITY_DIR"
else
  WORK_DIR="${CWD:-$PWD}"
fi

cd "$WORK_DIR"

# --- Announce -------------------------------------------------------------

echo
echo "harness       : claude"
echo "entity        : $ENTITY"
echo "entity_dir    : $ENTITY_DIR"
echo "work_dir      : $WORK_DIR"
echo "provider      : $PROVIDER"
echo "model         : $MODEL_RESOLVED"
echo "config_dir    : $CLAUDE_CONFIG_DIR"
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot"
  echo "prompt        : $PROMPT"
else
  echo "mode          : interactive"
fi
[ "$CONTINUE" = "1" ] && echo "continue      : yes (claude -c — resume last session in this cwd)"
echo

# --- Exec -----------------------------------------------------------------
#
# Build argv explicitly. --continue (-c) resumes the most recent session for
# the current project directory. For rooted entities cwd is always
# $ENTITY_DIR, so there is exactly one persistent session per entity. For
# roaming entities there is one per (entity × project-dir) pair, which is
# the behavior you want when an entity is invoked inside a user project.

_args=(--model "$MODEL_RESOLVED")
[ "$CONTINUE" = "1" ] && _args+=(-c)
if [ -n "$PROMPT" ]; then
  _args+=(-p "$PROMPT")
fi

exec claude "${_args[@]}"
