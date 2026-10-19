#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# harness inject — inject a command into a running entity's opencode session
#
# Usage:
#   <cmd> harness inject <entity> "text to inject"
#   <cmd> harness inject <entity> "text to append" --no-submit
#   <cmd> harness inject <entity> --ping
#   <cmd> harness inject <entity> --pause
#   <cmd> harness inject <entity> --resume
#   <cmd> harness inject <entity> "text" --session <sessionId>
#
# Discovers the active session for the entity via the daemon, then POSTs
# a command to /harness/commands/:entity/:sessionId.
#
# See VESTA-SPEC-191 §9 for the full CLI surface specification.

set -e

DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://10.10.10.10:28282}"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

INJECT_ENTITY=""
INJECT_TEXT=""
INJECT_CMD=""       # inject | append | ping | pause | resume
INJECT_SESSION=""   # optional --session <id>

_args=("$@")
_positional=()

i=0
while [ $i -lt ${#_args[@]} ]; do
  arg="${_args[$i]}"
  case "$arg" in
    --no-submit)
      # Text must already be in _positional; cmd becomes append
      INJECT_CMD="append"
      ;;
    --ping)
      INJECT_CMD="ping"
      ;;
    --pause)
      INJECT_CMD="pause"
      ;;
    --resume)
      INJECT_CMD="resume"
      ;;
    --session=*)
      INJECT_SESSION="${arg#--session=}"
      ;;
    --session)
      i=$(( i + 1 ))
      INJECT_SESSION="${_args[$i]:-}"
      ;;
    --*)
      echo "Error: unknown flag '$arg'" >&2
      exit 1
      ;;
    *)
      _positional+=("$arg")
      ;;
  esac
  i=$(( i + 1 ))
done

# First positional is the entity
INJECT_ENTITY="${_positional[0]:-}"
INJECT_TEXT="${_positional[1]:-}"

if [ -z "$INJECT_ENTITY" ]; then
  echo "Error: entity argument required" >&2
  echo "Usage: harness inject <entity> [\"text\"] [flags]" >&2
  exit 1
fi

# Determine command type if not set by flags
if [ -z "$INJECT_CMD" ]; then
  if [ -n "$INJECT_TEXT" ]; then
    INJECT_CMD="inject"
  else
    echo "Error: text argument required (or use --ping / --pause / --resume)" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Discover active session for this entity
# ---------------------------------------------------------------------------

if [ -z "$INJECT_SESSION" ]; then
  # Query daemon for active sessions
  _sessions_json="$(curl -sf "${DAEMON_URL}/api/sessions?entity=${INJECT_ENTITY}&status=active" 2>/dev/null)" || true

  if [ -z "$_sessions_json" ]; then
    echo "Error: could not reach daemon at ${DAEMON_URL}" >&2
    exit 1
  fi

  # Parse the most recent session ID using jq
  INJECT_SESSION="$(echo "$_sessions_json" | jq -r '
    (if type == "array" then . else (.sessions // .items // []) end) |
    map(select(.status == "active" or .status == null)) |
    sort_by(.lastSeen // .started // "") | reverse |
    .[0] | (.sessionId // ._id // .id // "")
  ' 2>/dev/null)" || true

  if [ -z "$INJECT_SESSION" ]; then
    echo "Error: no active session found for entity '${INJECT_ENTITY}'" >&2
    echo "  (checked: ${DAEMON_URL}/api/sessions?entity=${INJECT_ENTITY}&status=active)" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Build the command payload and POST to daemon
# ---------------------------------------------------------------------------

_payload="{}"
case "$INJECT_CMD" in
  inject)
    _payload="$(jq -n --arg text "$INJECT_TEXT" '{text: $text, submit: true}' 2>/dev/null || echo '{"text":"'"${INJECT_TEXT}"'","submit":true}')"
    ;;
  append)
    _payload="$(jq -n --arg text "$INJECT_TEXT" '{text: $text}' 2>/dev/null || echo '{"text":"'"${INJECT_TEXT}"'"}')"
    ;;
  ping|pause|resume)
    _payload="{}"
    ;;
esac

_post_body="{\"cmd\":\"${INJECT_CMD}\",\"payload\":${_payload}}"

_response="$(curl -sf -X POST \
  -H 'Content-Type: application/json' \
  -d "$_post_body" \
  "${DAEMON_URL}/harness/commands/${INJECT_ENTITY}/${INJECT_SESSION}" 2>/dev/null)" || {
  echo "Error: failed to POST command to daemon" >&2
  exit 1
}

if [ -z "$_response" ]; then
  echo "Error: empty response from daemon" >&2
  exit 1
fi

# Print the command ID and status
echo "$_response" | jq -r --arg session "$INJECT_SESSION" '"cmd_id  : \(._id // "?")\nstatus  : \(.status // "?")\nsession : \($session)"' 2>/dev/null || echo "$_response"
