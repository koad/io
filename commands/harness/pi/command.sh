#!/usr/bin/env bash
#
# harness/pi — launch an entity through pi-mono
#
# pi-mono: Mario Zechner's TypeScript harness with hot-reload + ACP
# inter-agent protocol. Ollama-native (local inference default). The
# underlying harness that powers OpenClaw.
#
# Upstream: https://github.com/badlogic/pi-mono
#
# Usage: <entity> harness pi <provider> <model> [prompt]
#
# Examples:
#   sibyl harness pi ollama    deepseek-r1
#   sibyl harness pi ollama    llama3.3      "summarize briefs"
#   vesta harness pi anthropic claude-sonnet-4-6
#
# Invariants (per VESTA-SPEC-072):
#   - PI_CONFIG_DIR and XDG_CONFIG_HOME both exported to $ENTITY_DIR
#     (whichever the harness respects takes effect; setting both is safe)
#   - KOAD_IO_ROOTED honored for cwd selection
#   - interactive when no prompt; one-shot pattern is UNVERIFIED —
#     see "TESTING NOTES" below before trusting this in production
#
# --------------------------------------------------------------------------
# TESTING NOTES (first-draft harness, not yet validated on real pi-mono)
# --------------------------------------------------------------------------
#   This script was drafted from memory + SPEC-072 structural rules. The
#   SPEC-072 invariants (config dir env vars, cwd, credentials cascade)
#   are the same contract as claude/opencode and should be correct.
#
#   UNVERIFIED details (validate on fourty4 or wherever pi-mono is
#   installed, then patch the script):
#
#     1. Binary name — assumed 'pi'. Could be 'pi-mono' or something else.
#     2. Config-dir env var — assumed 'PI_CONFIG_DIR'. Could be different.
#        XDG_CONFIG_HOME is set as a fallback (standard convention).
#     3. Model flag — assumed '--model'. Could be '-m' or positional.
#     4. Model format — assumed bare model name for ollama (e.g.
#        'deepseek-r1'), 'anthropic/claude-sonnet-4-6' for cloud. pi-mono
#        may use 'provider:model' or some other delimiter.
#     5. One-shot mode — assumed 'pi run "prompt"' or 'pi -p "prompt"'.
#        Until confirmed, we emit a warning and default to interactive
#        even when a prompt is supplied, so nothing silently breaks.
#     6. Provider passthrough — pi-mono is ollama-native; cloud provider
#        support via its provider layer is assumed to work but not
#        proven here.
#
#   When pi-mono is present and the flags are confirmed, replace the
#   marked blocks below and remove this header.
# --------------------------------------------------------------------------

set -e

# --- Guard rails ----------------------------------------------------------

if [ -z "$ENTITY" ]; then
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'sibyl harness pi ...')." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: \$ENTITY_DIR not set or not a directory: '$ENTITY_DIR'" >&2
  exit 64
fi

# UNVERIFIED: binary name may be different
PI_BIN="${PI_BIN:-pi}"

if ! command -v "$PI_BIN" >/dev/null 2>&1; then
  echo "Error: '$PI_BIN' CLI not found on PATH." >&2
  echo "  pi-mono is typically installed on fourty4, not wonderland." >&2
  echo "  Override with PI_BIN=<binary-name> if the executable has a different name." >&2
  echo "  Upstream: https://github.com/badlogic/pi-mono" >&2
  exit 69
fi

# --- Argument parsing -----------------------------------------------------

PROVIDER="${1:-${ENTITY_DEFAULT_PROVIDER:-${KOAD_IO_DEFAULT_PROVIDER:-ollama}}}"
[ $# -gt 0 ] && shift

MODEL="${1:-${ENTITY_DEFAULT_MODEL:-${KOAD_IO_DEFAULT_MODEL:-deepseek-r1}}}"
[ $# -gt 0 ] && shift

PROMPT="${PROMPT:-$*}"

# --- Provider awareness ---------------------------------------------------

case "$PROVIDER" in
  ollama)
    # pi-mono's native home. No API key needed.
    if [ -z "$OLLAMA_HOST" ] && [ -z "$OLLAMA_BASE_URL" ]; then
      echo "Note: OLLAMA_HOST/OLLAMA_BASE_URL unset; pi will default to localhost:11434." >&2
    fi
    ;;
  anthropic)
    if [ -z "$ANTHROPIC_API_KEY" ]; then
      echo "Warning: no ANTHROPIC_API_KEY in environment." >&2
    fi
    ;;
  openai)
    if [ -z "$OPENAI_API_KEY" ]; then
      echo "Warning: no OPENAI_API_KEY in environment." >&2
    fi
    ;;
  *)
    echo "Note: provider '$PROVIDER' not known to this harness script." >&2
    echo "  Passing through to pi-mono; it may or may not recognize it." >&2
    ;;
esac

# --- Model assembly -------------------------------------------------------
#
# UNVERIFIED format. Current guess:
#   - ollama    → bare model name ('deepseek-r1')
#   - anthropic → 'anthropic/claude-...' or similar
#   - openai    → 'openai/gpt-...' or similar
#
# If the user supplied a slash or colon, trust them and pass through.

case "$MODEL" in
  */*|*:*) MODEL_RESOLVED="$MODEL" ;;
  *)
    case "$PROVIDER" in
      ollama) MODEL_RESOLVED="$MODEL" ;;
      *)      MODEL_RESOLVED="$PROVIDER/$MODEL" ;;
    esac
    ;;
esac

# --- SPEC-072 invariants --------------------------------------------------
#
# Export both the pi-specific env var (if it exists) and XDG_CONFIG_HOME
# as a fallback. Whichever pi-mono respects, the entity root wins.
# Setting both is harmless.

export PI_CONFIG_DIR="$ENTITY_DIR"
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
echo "harness       : pi (pi-mono)"
echo "entity        : $ENTITY"
echo "entity_dir    : $ENTITY_DIR"
echo "work_dir      : $WORK_DIR"
echo "provider      : $PROVIDER"
echo "model         : $MODEL_RESOLVED"
echo "pi_config_dir : $PI_CONFIG_DIR"
echo "xdg_config    : $XDG_CONFIG_HOME"
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot (UNVERIFIED — see TESTING NOTES)"
  echo "prompt        : $PROMPT"
else
  echo "mode          : interactive"
fi
echo

# --- Exec -----------------------------------------------------------------

if [ -n "$PROMPT" ]; then
  # UNVERIFIED: pi-mono one-shot invocation pattern.
  # Current guess: 'pi run --model X "prompt"'. Fall back to interactive
  # if user prefers to avoid the guess by setting PI_NO_ONESHOT=1.
  if [ "${PI_NO_ONESHOT:-0}" = "1" ]; then
    echo "PI_NO_ONESHOT=1 set; ignoring prompt and launching interactive." >&2
    exec "$PI_BIN"
  fi
  echo "Attempting: $PI_BIN run --model $MODEL_RESOLVED \"\$PROMPT\"" >&2
  echo "  (if this fails, patch harness/pi/command.sh with the real flags)" >&2
  exec "$PI_BIN" run --model "$MODEL_RESOLVED" "$PROMPT"
else
  # UNVERIFIED: interactive model selection. Try --model; if pi-mono
  # rejects it, the user will see the error and we patch.
  exec "$PI_BIN" --model "$MODEL_RESOLVED"
fi
