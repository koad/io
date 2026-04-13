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

# Prefer the kingdom-managed binary, fall back to system PATH
if [ -x "$HOME/.koad-io/bin/opencode" ]; then
  OPENCODE_BIN="$HOME/.koad-io/bin/opencode"
elif command -v opencode >/dev/null 2>&1; then
  OPENCODE_BIN="$(command -v opencode)"
else
  echo "Error: 'opencode' CLI not found at ~/.koad-io/bin/opencode or on PATH." >&2
  exit 69
fi

# --- Argument parsing -----------------------------------------------------

PROVIDER="${1:-${ENTITY_DEFAULT_PROVIDER:-${KOAD_IO_DEFAULT_PROVIDER:-opencode}}}"
[ $# -gt 0 ] && shift

MODEL="${1:-${ENTITY_DEFAULT_MODEL:-${KOAD_IO_DEFAULT_MODEL:-big-pickle}}}"
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
  opencode)
    # opencode's own hosted aggregator ("opencode zen"). Paid tier; routes
    # through the caller's opencode-account credentials in
    # ~/.local/share/opencode/auth.json (XDG_DATA_HOME, NOT rewritten by
    # this harness — lives outside the SPEC-072 sealed-config dir, so
    # rooted entities still see the operator's zen auth without per-entity
    # key plumbing). Canonical free-ish default for dispatched entities
    # when anthropic-direct keys aren't available per-entity.
    ;;
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
#
# Per-provider short-name normalization: anthropic's model IDs in
# opencode's registry are spelled 'claude-<name>' (e.g. 'claude-opus-4-6',
# 'claude-sonnet-4-6'). Kingdom defaults and examples use the short form
# ('opus-4-6') mirroring the claude harness. Prefix 'claude-' if the
# caller passed a short name. Other providers pass through unchanged —
# ollama, openrouter, google, etc. use their own conventions.

case "$MODEL" in
  */*) MODEL_RESOLVED="$MODEL" ;;
  *)
    case "$PROVIDER" in
      anthropic)
        case "$MODEL" in
          claude-*) MODEL_RESOLVED="$PROVIDER/$MODEL" ;;
          *)        MODEL_RESOLVED="$PROVIDER/claude-$MODEL" ;;
        esac
        ;;
      *)
        MODEL_RESOLVED="$PROVIDER/$MODEL"
        ;;
    esac
    ;;
esac

# --- SPEC-072 invariants (two modes) --------------------------------------
#
# XDG_CONFIG_HOME resolves to one of two modes, in priority order:
#
#   1. Caller-pinned room  — KOAD_IO_ROOM set → use it as the config dir.
#      Sealed portable room: opencode's session db lives in the room and
#      travels with it. Multiple roaming entities visiting the same room
#      can share conversations naturally.
#
#   2. Entity dir          — default for both rooted and roaming entities.
#      Every entity carries its own opencode config (tui.json, opencode.jsonc,
#      etc.) in $ENTITY_DIR/opencode/. The entity's identity config follows
#      them regardless of where they're invoked from.

if [ -n "$KOAD_IO_ROOM" ] && [ -d "$KOAD_IO_ROOM" ]; then
  export XDG_CONFIG_HOME="$KOAD_IO_ROOM"
else
  export XDG_CONFIG_HOME="$ENTITY_DIR"
fi

# --- Entity config file overrides -----------------------------------------
#
# opencode respects OPENCODE_CONFIG and OPENCODE_TUI_CONFIG env vars to
# point directly at config files. This lets every entity carry its own
# tui.json at the entity root — no .opencode/ subdirectory needed,
# no reliance on project-dir discovery.

[ -f "$ENTITY_DIR/opencode.json" ]  && export OPENCODE_CONFIG="$ENTITY_DIR/opencode.json"
[ -f "$ENTITY_DIR/opencode.jsonc" ] && export OPENCODE_CONFIG="$ENTITY_DIR/opencode.jsonc"
[ -f "$ENTITY_DIR/tui.json" ]       && export OPENCODE_TUI_CONFIG="$ENTITY_DIR/tui.json"
[ -f "$ENTITY_DIR/tui.jsonc" ]      && export OPENCODE_TUI_CONFIG="$ENTITY_DIR/tui.jsonc"

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
if [ -n "$KOAD_IO_ROOM" ]; then
  echo "xdg_config    : $XDG_CONFIG_HOME  (sealed portable room)"
else
  echo "xdg_config    : $XDG_CONFIG_HOME  (entity — SPEC-072)"
fi
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot"
  echo "prompt        : $PROMPT"
else
  echo "mode          : interactive"
fi
[ "$CONTINUE" = "1" ] && echo "continue      : yes (opencode -c — resume last session)"
echo

# --- Opencode env flags ---------------------------------------------------

export OPENCODE_DISABLE_CLAUDE_CODE=true
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
export OPENCODE_DISABLE_TERMINAL_TITLE=true

# --- Context assembly (VESTA-SPEC-067) ------------------------------------
#
# Identity always loads. Run startup.sh to assemble KOAD_IO.md → ENTITY.md →
# role primers → pre-emptive primitives into SYSTEM_PROMPT. This happens
# unconditionally — the entity wakes up knowing who it is regardless of
# whether a prompt was given or how dispatch reached this script.
#
# Then build OPENCODE_CONFIG_CONTENT with the prompt injected into the agent
# config. If OPENCODE_CONFIG_CONTENT is already set (caller knows what
# they're doing), leave it alone.

if [ -f "$HOME/.koad-io/harness/startup.sh" ]; then
  SYSTEM_PROMPT="$("$HOME/.koad-io/harness/startup.sh")" || {
    echo "Warning: startup.sh failed (exit $?), proceeding without context assembly" >&2
  }
  export SYSTEM_PROMPT
fi

# Read outfit color from passenger.json (if present)
OUTFIT_COLOR=""
if [ -f "$ENTITY_DIR/passenger.json" ] && command -v jq >/dev/null 2>&1; then
  OUTFIT_COLOR=$(jq -r '.outfit.color // empty' "$ENTITY_DIR/passenger.json" 2>/dev/null)
fi

if [ -n "$SYSTEM_PROMPT" ] && [ -z "$OPENCODE_CONFIG_CONTENT" ]; then
  # Load entity's opencode.jsonc as template
  OPENCODE_TEMPLATE=""
  for _candidate in \
    "$ENTITY_DIR/opencode.jsonc" \
    "$ENTITY_DIR/opencode/opencode.jsonc" \
    "$HOME/.koad-io/config/opencode.jsonc"; do
    if [ -f "$_candidate" ]; then
      OPENCODE_TEMPLATE="$_candidate"
      break
    fi
  done

  if [ -n "$OPENCODE_TEMPLATE" ]; then
    # Shell-expand $ENTITY, $ENTITY_DIR, $PURPOSE in the template
    # Strip jsonc line comments (only leading // not inside strings)
    # Then jq injects the assembled prompt safely (handles escaping)
    OPENCODE_CONFIG_CONTENT=$(
      sed '/^[[:space:]]*\/\//d' "$OPENCODE_TEMPLATE" \
      | sed "s|\\\$ENTITY_DIR|$ENTITY_DIR|g" \
      | sed "s|\\\$ENTITY|$ENTITY|g" \
      | sed "s|\\\$PURPOSE|${PURPOSE:-$ENTITY entity}|g" \
      | jq --arg prompt "$SYSTEM_PROMPT" \
          --arg entity "$ENTITY" \
          --arg color "$OUTFIT_COLOR" \
          '
          if .agent[$entity] then
            .agent[$entity].prompt = $prompt
            | if $color != "" then .agent[$entity].color = $color else . end
          elif .mode[$entity] then
            .mode[$entity].prompt = $prompt
            | if $color != "" then .mode[$entity].color = $color else . end
          else . end
          '
    )
    export OPENCODE_CONFIG_CONTENT
  else
    # No template — build minimal config inline
    export OPENCODE_CONFIG_CONTENT
    OPENCODE_CONFIG_CONTENT=$(jq -n \
      --arg entity "$ENTITY" \
      --arg desc "${PURPOSE:-$ENTITY entity}" \
      --arg prompt "$SYSTEM_PROMPT" \
      --arg entity_dir "$ENTITY_DIR" \
      --arg color "$OUTFIT_COLOR" \
      '{
        agent: {
          ($entity): {
            description: $desc,
            mode: "primary",
            prompt: $prompt,
            permission: {
              external_directory: { ($entity_dir + "/**"): "allow" },
              read:  { ($entity_dir + "/**"): "allow" },
              write: { ($entity_dir + "/**"): "allow" },
              bash: "allow", glob: "allow", grep: "allow",
              edit: "allow", skill: "allow", task: "allow"
            }
          }
        }
      }
      | if $color != "" then .agent[$entity].color = $color else . end
      ')
  fi
fi

# --- Exec -----------------------------------------------------------------
#
# opencode 'run' is the one-shot. Both 'run' and the interactive TUI accept
# -c/--continue. For rooted entities cwd is always $ENTITY_DIR, so there is
# exactly one persistent session per entity; for roaming entities, one per
# (entity × project-dir) pair.
#
# --agent $ENTITY selects the entity's agent definition from the config.

_args=()

if [ -n "$PROMPT" ]; then
  _args+=(run)
fi

_args+=(--model "$MODEL_RESOLVED")

if [ -n "$OPENCODE_CONFIG_CONTENT" ]; then
  _args+=(--agent "$ENTITY")
fi

if [ -n "$PROMPT" ]; then
  _args+=(--dir "$WORK_DIR")
  [ "$CONTINUE" = "1" ] && _args+=(-c)
  _args+=("$PROMPT")
  exec "$OPENCODE_BIN" "${_args[@]}"
else
  if [ "$CONTINUE" = "1" ]; then
    _args+=(-c)
  fi
  _args+=("$WORK_DIR")
  exec "$OPENCODE_BIN" "${_args[@]}"
fi
