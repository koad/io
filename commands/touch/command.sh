#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# touch — "this entity is here, right now."
#
# WHY THIS EXISTS (2026-11-13)
# ----------------------------
# The daemon owns the entity index, and `lastActivity` has two writers:
#
#   · the scanner, which treats a committed baseline as a FLOOR — so the row is
#     stale by however long it has been since the last commit, by construction;
#   · POST /api/entities/touch, the live writer (daemon/src/server/entity-touch.js)
#     that the entity console calls on connect for its own sessions.
#
# Nothing in a SHELL called it. Working in bash therefore left the entity's row
# showing yesterday. Measured 2026-11-13: vulcan's `lastActivity` read
# 2026-11-12T21:02Z while a live harness session was answering prompts.
#
# This command is the shell's caller. It writes nothing itself — it posts to the
# route that already owns the write, so the rules stay in one place: mesh-only,
# whitelisted fields (lastActivity + presence), merged never blanked, and a 30s
# per-handle throttle where a burst is a no-op rather than a write. That throttle
# is what makes calling this from a shell prompt cheap.
#
# NOT AN EMISSION
# ---------------
# Emissions narrate work: `helpers/emit.py` → control-tower :28283, signals or
# emission documents. Presence is a different fact with a different owner and a
# different store. A session that narrates and a session that is merely OPEN are
# not the same thing, and the boards read both: the cockpit reads sessions, the
# team card reads the entity's `lastActivity`.
#
# Usage:
#   koad-io touch                                  # this entity, door=shell
#   koad-io touch sienna                           # another handle (mesh-only)
#   koad-io touch --door bash-harness --client wonderland
#   koad-io touch --session "$HARNESS_SESSION_ID"
#
# Flags:
#   --door NAME      where this presence came from (default: $KOAD_IO_DOOR, else "shell")
#   --client NAME    who is on the line (default: the short hostname)
#   --session ID     the harness session, when there is one (default: $HARNESS_SESSION_ID)
#   --quiet          suppress the confirmation line
#
# Exit: 0 the row is fresh (written, or throttled because it already was)
#       1 the daemon did not answer, or refused the write

set -uo pipefail

_DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://${KOAD_IO_BIND_IP:-10.10.10.10}:28282}"
_DAEMON_URL="${_DAEMON_URL%/}"

_usage() {
  echo
  echo "koad-io touch"
  echo "-------------"
  echo
  echo "Move this entity's lastActivity forward in the daemon's entity index."
  echo
  echo "Usage:  koad-io touch [handle] [--door NAME] [--client NAME] [--session ID]"
  echo
  echo "Notes:"
  echo "  presence is merged, not replaced — a refresh that carries no --client"
  echo "  never blanks the client an earlier touch recorded."
  echo "  the daemon throttles to one write per handle per 30s; a faster caller"
  echo "  is told it was throttled and is already fresh."
  echo
  echo "Endpoint: ${_DAEMON_URL}/api/entities/touch"
  echo
}

HANDLE=""
DOOR="${KOAD_IO_DOOR:-shell}"
CLIENT="$(hostname -s 2>/dev/null || echo unknown)"
SESSION="${HARNESS_SESSION_ID:-}"
QUIET=false

while [ $# -gt 0 ]; do
  case "$1" in
    --door=*)     DOOR="${1#--door=}"; shift ;;
    --door)       shift; [ $# -gt 0 ] || { echo "touch: --door needs a value" >&2; exit 1; }; DOOR="$1"; shift ;;
    --client=*)   CLIENT="${1#--client=}"; shift ;;
    --client)     shift; [ $# -gt 0 ] || { echo "touch: --client needs a value" >&2; exit 1; }; CLIENT="$1"; shift ;;
    --session=*)  SESSION="${1#--session=}"; shift ;;
    --session)    shift; [ $# -gt 0 ] || { echo "touch: --session needs a value" >&2; exit 1; }; SESSION="$1"; shift ;;
    --quiet|-q)   QUIET=true; shift ;;
    -h|--help)    _usage; exit 0 ;;
    --*)          echo "touch: unknown flag '$1'" >&2; echo "      flags: --door, --client, --session, --quiet" >&2; exit 1 ;;
    *)            [ -z "$HANDLE" ] && HANDLE="$1"; shift ;;
  esac
done

# The handle is the entity you are acting as unless you name another one.
if [ -z "$HANDLE" ]; then
  HANDLE="${ENTITY:-}"
  if [ -z "$HANDLE" ] && [ -n "${ENTITY_DIR:-}" ]; then
    HANDLE="$(basename "$ENTITY_DIR" | sed 's/^\.//')"
  fi
fi
if [ -z "$HANDLE" ]; then
  echo "touch: no handle — no ENTITY in the environment, and none given." >&2
  echo "       run through the entity launcher (e.g. \`vulcan touch\`) or name one:" >&2
  echo "       koad-io touch sienna" >&2
  exit 1
fi
if [ "$HANDLE" = "koad-io" ]; then
  # An entity-less framework invocation derives nothing; refuse rather than post
  # a touch for a directory that is not an entity.
  echo "touch: refusing handle '$HANDLE' — that is the framework directory, not an entity." >&2
  echo "       run through an entity launcher: <entity> touch" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "touch: curl is required and is not on PATH" >&2
  exit 1
fi

_payload="$(jq -n --arg handle "$HANDLE" --arg door "$DOOR" --arg client "$CLIENT" --arg session "$SESSION" \
  '{handle:$handle, door:$door, client:$client, session:$session}')"

_response="$(curl -sS --max-time 3 -X POST \
  -H 'content-type: application/json' \
  -d "$_payload" \
  "${_DAEMON_URL}/api/entities/touch" 2>&1)" || _curl_rc=$?
_curl_rc="${_curl_rc:-0}"

if [ "$_curl_rc" -ne 0 ]; then
  echo "touch: the daemon did not answer — ${_DAEMON_URL}" >&2
  echo "       ${_response}" >&2
  exit 1
fi

if ! printf '%s' "$_response" | jq -e . >/dev/null 2>&1; then
  echo "touch: the daemon answered with something that is not JSON:" >&2
  printf '%s\n' "$_response" >&2
  exit 1
fi

if [ "$(printf '%s' "$_response" | jq -r '.ok // false')" != "true" ]; then
  # The route names its refusals (unknown_entity, not_here, handle_required...).
  printf 'touch: %s — %s\n' \
    "$(printf '%s' "$_response" | jq -r '.error // "refused"')" \
    "$(printf '%s' "$_response" | jq -r '.message // "the daemon refused the write"')" >&2
  exit 1
fi

if [ "$QUIET" = false ]; then
  if [ "$(printf '%s' "$_response" | jq -r '.throttled // false')" = "true" ]; then
    # Not a failure: the row is already fresh and the window has not turned over.
    printf 'touched %s · already fresh as of %s (retry in %sms)\n' \
      "$HANDLE" \
      "$(printf '%s' "$_response" | jq -r '.lastActivity // "?"')" \
      "$(printf '%s' "$_response" | jq -r '.retry_after_ms // "?"')"
  else
    printf 'touched %s · %s · door=%s client=%s\n' \
      "$HANDLE" \
      "$(printf '%s' "$_response" | jq -r '.lastActivity // "?"')" \
      "$DOOR" "$CLIENT"
  fi
fi

source "${HOME}/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint

exit 0
