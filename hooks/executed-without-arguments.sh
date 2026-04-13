#!/usr/bin/env bash
set -euo pipefail

# Env already sourced by koad-io bin (framework .env → entity .env)
# CWD already exported by koad-io bin (caller's working directory)

ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
export CALL_DIR="${CWD:-$PWD}"

# Rooted = has an office (works from entity dir). Default = roaming (works from CWD).
if [ "${KOAD_IO_ROOTED:-}" = "true" ]; then
  HARNESS_WORK_DIR="$ENTITY_DIR"
else
  HARNESS_WORK_DIR="$CALL_DIR"
fi

# Resolve harness × provider × model via the canonical cascade:
#
#   ENTITY_DEFAULT_*      (~/.<entity>/.env)
#     → KOAD_IO_DEFAULT_*   (~/.koad-io/.env — framework defaults)
#     → hardcoded fallback  (last-resort, so a bare install Just Works)
#
# This matches the dispatch path (`<entity> harness default`) so the
# interactive entry and the dispatch entry resolve identically from the
# same .env pins. Legacy $KOAD_IO_ENTITY_HARNESS is still honored as a
# harness-name fallback for entities (veritas, faber) whose .env has not
# been migrated to the canonical name yet.

HARNESS="${ENTITY_DEFAULT_HARNESS:-${KOAD_IO_ENTITY_HARNESS:-${KOAD_IO_DEFAULT_HARNESS:-opencode}}}"
PROVIDER="${ENTITY_DEFAULT_PROVIDER:-${KOAD_IO_DEFAULT_PROVIDER:-}}"
MODEL="${ENTITY_DEFAULT_MODEL:-${KOAD_IO_DEFAULT_MODEL:-}}"

KOAD_IO_OPENCODE_BIN="$HOME/.koad-io/bin/opencode"

echo "[startup] entity=$ENTITY entity_dir=$ENTITY_DIR" >&2
echo "[startup] harness=$HARNESS provider=${PROVIDER:-<harness default>} model=${MODEL:-<harness default>}" >&2
echo "[startup] work_dir=$HARNESS_WORK_DIR call_dir=$CALL_DIR" >&2

# Verify entity directory exists
if [ ! -d "$ENTITY_DIR" ]; then
  echo "[error] entity directory does not exist: $ENTITY_DIR" >&2
  exit 1
fi

# VESTA-SPEC-067: context assembly (stdout = system prompt, stderr = log)
if [ ! -f "$HOME/.koad-io/harness/startup.sh" ]; then
  echo "[error] startup.sh not found: $HOME/.koad-io/harness/startup.sh" >&2
  exit 1
fi

SYSTEM_PROMPT="$("$HOME/.koad-io/harness/startup.sh" | tee "$ENTITY_DIR/.context")" || {
  echo "[error] startup.sh failed (exit $?)" >&2
  exit 1
}

# Layer 4: Location — append PRIMER.md from working directory (case-insensitive)
# A PRIMER.md is a sign on the door — orientation for whoever walks into that
# directory. The entity that lives there already knows; it wrote the sign.
# Rooted entities never read their own PRIMER. Roaming entities read the
# PRIMER of wherever they've been sent — that's the whole point of roaming.
if [ "${KOAD_IO_ROOTED:-}" = "true" ]; then
  echo "[startup] primer: skipped (rooted entity — CWD primers don't apply)" >&2
else
  PRIMER_FILE=""
  for _p in "$HARNESS_WORK_DIR"/[Pp][Rr][Ii][Mm][Ee][Rr].[Mm][Dd]; do
    if [ -f "$_p" ]; then
      PRIMER_FILE="$_p"
      break
    fi
  done
  if [ -n "$PRIMER_FILE" ]; then
    echo "[startup] primer: $PRIMER_FILE ($(wc -c < "$PRIMER_FILE") bytes)" >&2
    SYSTEM_PROMPT="$(printf '%s\n\n---\n\n# Location Context (%s)\n\n%s' "$SYSTEM_PROMPT" "$HARNESS_WORK_DIR" "$(cat "$PRIMER_FILE")")"
  fi
fi

cd "$HARNESS_WORK_DIR"

# --- Terminal title: entity on host in cwd ---
_HOST="$(hostname -s 2>/dev/null || echo unknown)"
_set_title() { printf '\033]0;%s\007' "$1"; }
_set_title "$ENTITY on $_HOST in $HARNESS_WORK_DIR"

# Restore title on exit (trap runs even after exec'd process ends... unless exec replaces)
# So we wrap instead of exec for harnesses that need cleanup.
_cleanup() { _set_title "$_HOST:$HARNESS_WORK_DIR"; }
trap _cleanup EXIT

echo "[startup] launching harness: $HARNESS" >&2

case "$HARNESS" in
  claude)
    # claude defaults: provider=anthropic, model=opus-4-6. Accept short
    # names ('opus-4-6') or full IDs ('claude-opus-4-6') — prefix when
    # missing so the CLI sees the canonical form either way.
    CLAUDE_MODEL="${MODEL:-opus-4-6}"
    case "$CLAUDE_MODEL" in
      claude-*) CLAUDE_MODEL_RESOLVED="$CLAUDE_MODEL" ;;
      *)        CLAUDE_MODEL_RESOLVED="claude-$CLAUDE_MODEL" ;;
    esac
    if ! command -v claude &>/dev/null; then
      echo "[error] claude binary not found in PATH" >&2
      exit 1
    fi
    echo "[startup] exec: claude . --model $CLAUDE_MODEL_RESOLVED --add-dir $ENTITY_DIR" >&2
    claude . --model "$CLAUDE_MODEL_RESOLVED" --add-dir "$ENTITY_DIR" \
      --append-system-prompt "$SYSTEM_PROMPT"
    ;;
  opencode)
    # opencode defaults: provider=opencode, model=big-pickle. opencode
    # expects '--model provider/model'; if the entity's .env supplied a
    # bare model name, prefix it with the provider.
    OPENCODE_PROVIDER="${PROVIDER:-opencode}"
    OPENCODE_MODEL_NAME="${MODEL:-big-pickle}"
    case "$OPENCODE_MODEL_NAME" in
      */*) OPENCODE_MODEL_RESOLVED="$OPENCODE_MODEL_NAME" ;;
      *)   OPENCODE_MODEL_RESOLVED="$OPENCODE_PROVIDER/$OPENCODE_MODEL_NAME" ;;
    esac
    if [ ! -x "$KOAD_IO_OPENCODE_BIN" ]; then
      echo "[error] opencode binary not found or not executable: $KOAD_IO_OPENCODE_BIN" >&2
      exit 1
    fi
    # --- Opencode: entity context via env, CWD is clean ---
    export OPENCODE_DISABLE_CLAUDE_CODE=true
    export OPENCODE_DISABLE_LSP_DOWNLOAD=true
    export OPENCODE_DISABLE_TERMINAL_TITLE=true

    # Load entity's opencode.jsonc as template, inject assembled prompt
    # Look in: entity dir root, then entity/opencode/, then framework default
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
      echo "[startup] opencode template: $OPENCODE_TEMPLATE" >&2
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
            '
            if .agent[$entity] then
              .agent[$entity].prompt = $prompt
            elif .mode[$entity] then
              .mode[$entity].prompt = $prompt
            else . end
            '
      )
      export OPENCODE_CONFIG_CONTENT
    else
      # No template — build minimal config inline
      echo "[startup] opencode template: none found, building minimal" >&2
      export OPENCODE_CONFIG_CONTENT
      OPENCODE_CONFIG_CONTENT=$(jq -n \
        --arg entity "$ENTITY" \
        --arg desc "${PURPOSE:-$ENTITY entity}" \
        --arg prompt "$SYSTEM_PROMPT" \
        --arg entity_dir "$ENTITY_DIR" \
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
        }')
    fi

    echo "[startup] exec: opencode --agent $ENTITY --model $OPENCODE_MODEL_RESOLVED ./" >&2
    "$KOAD_IO_OPENCODE_BIN" --agent "$ENTITY" --model "$OPENCODE_MODEL_RESOLVED" ./
    ;;
  *)
    echo "[error] unknown harness: $HARNESS (expected 'claude' or 'opencode')" >&2
    echo "[error] set ENTITY_DEFAULT_HARNESS in ~/.$ENTITY/.env to fix" >&2
    exit 1
    ;;
esac
