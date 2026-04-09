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

KOAD_IO_ENTITY_HARNESS="${KOAD_IO_ENTITY_HARNESS:-opencode}"
KOAD_IO_OPENCODE_BIN="$HOME/.koad-io/bin/opencode"

# VESTA-SPEC-067: context assembly (stdout = system prompt, stderr = log)
SYSTEM_PROMPT="$("$HOME/.koad-io/harness/startup.sh" | tee "$ENTITY_DIR/.context")"

cd "$HARNESS_WORK_DIR"

# --- Terminal title: entity on host in cwd ---
_HOST="$(hostname -s 2>/dev/null || echo unknown)"
_set_title() { printf '\033]0;%s\007' "$1"; }
_set_title "$ENTITY on $_HOST in $HARNESS_WORK_DIR"

# Restore title on exit (trap runs even after exec'd process ends... unless exec replaces)
# So we wrap instead of exec for harnesses that need cleanup.
_cleanup() { _set_title "$_HOST:$HARNESS_WORK_DIR"; }
trap _cleanup EXIT

case "$KOAD_IO_ENTITY_HARNESS" in
  claude)
    claude . --model sonnet --add-dir "$ENTITY_DIR" \
      --append-system-prompt "$SYSTEM_PROMPT"
    ;;
  opencode)
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

    "$KOAD_IO_OPENCODE_BIN" --agent "$ENTITY" --model "${OPENCODE_MODEL:-}" ./
    ;;
  *)
    echo "[error] Unknown harness: $KOAD_IO_ENTITY_HARNESS" >&2
    exit 1
    ;;
esac
