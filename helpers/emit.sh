# emit.sh — bash interface to the koad:io emit module
#
# All wire I/O lives in ~/.koad-io/helpers/emit.py — this file is just thin
# bash function wrappers around the Python CLI. One source of truth for the
# emission protocol; both bash and Python hooks call the same code.
#
# Source this file and call koad_io_emit_* from any command:
#
#   source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null
#
#   # Fire-and-forget
#   koad_io_emit notice "started on :${KOAD_IO_PORT}"
#   koad_io_emit warning "port already in use"
#
#   # Lifecycle (open → updates → close)
#   koad_io_emit_open session "harness opened: claude opus-4-6"
#   koad_io_emit_update "context assembly complete"
#   koad_io_emit_close "clean exit"
#
#   # Resume an existing emission (-c on Claude Code, etc.)
#   export HARNESS_EMISSION_ID_FILE="/path/to/file"
#   koad_io_emit_resume "resumed"
#
# Optional metadata as a JSON string on open/update/resume:
#   koad_io_emit_open session "..." '{"harness":"claude","model":"opus-4-6"}'
#
# Gate:
#   KOAD_IO_EMIT=1     opt-in (default disabled)
#
# Valid types:
#   session, flight, service, conversation, hook,
#   notice, warning, error, request

_KOAD_IO_EMIT_PY="$HOME/.koad-io/helpers/emit.py"

HARNESS_EMISSION_ID="${HARNESS_EMISSION_ID:-}"

# koad_io_emit <type> <body>
#   Fire-and-forget emission. Backgrounded so callers never wait.
koad_io_emit() {
  [ "${KOAD_IO_EMIT:-0}" = "1" ] || return 0
  local _type="${1:-notice}"
  local _body="${2:-}"
  [ -z "$_body" ] && return 0
  ( python3 "$_KOAD_IO_EMIT_PY" emit "$_type" "$_body" >/dev/null 2>&1 ) &
}

# koad_io_emit_sync <type> <body>
#   Same as koad_io_emit but waits. Use when the emit must land before exit.
koad_io_emit_sync() {
  [ "${KOAD_IO_EMIT:-0}" = "1" ] || return 0
  local _type="${1:-notice}"
  local _body="${2:-}"
  [ -z "$_body" ] && return 0
  python3 "$_KOAD_IO_EMIT_PY" emit "$_type" "$_body" >/dev/null 2>&1 || true
}

# koad_io_emit_open <type> <body> [meta_json]
#   Open a lifecycle emission. Sync — captures _id into HARNESS_EMISSION_ID
#   and persists to HARNESS_EMISSION_ID_FILE if set.
koad_io_emit_open() {
  [ "${KOAD_IO_EMIT:-0}" = "1" ] || return 0
  local _type="${1:-session}"
  local _body="${2:-}"
  local _meta="${3:-}"
  [ -z "$_body" ] && return 0

  local _args=(open "$_type" "$_body")
  [ -n "$_meta" ] && _args+=(--meta "$_meta")
  [ -n "${HARNESS_EMISSION_ID_FILE:-}" ] && _args+=(--id-file "$HARNESS_EMISSION_ID_FILE")

  HARNESS_EMISSION_ID=$(python3 "$_KOAD_IO_EMIT_PY" "${_args[@]}" 2>/dev/null)
  export HARNESS_EMISSION_ID
}

# koad_io_emit_resume [body] [meta_json]
#   Load _id from HARNESS_EMISSION_ID_FILE and post a resume update.
koad_io_emit_resume() {
  [ "${KOAD_IO_EMIT:-0}" = "1" ] || return 0
  local _body="${1:-resumed}"
  local _meta="${2:-}"
  [ -z "${HARNESS_EMISSION_ID_FILE:-}" ] && return 0
  [ ! -f "$HARNESS_EMISSION_ID_FILE" ] && return 0

  local _args=(resume "$_body" --id-file "$HARNESS_EMISSION_ID_FILE")
  [ -n "$_meta" ] && _args+=(--meta "$_meta")
  HARNESS_EMISSION_ID=$(python3 "$_KOAD_IO_EMIT_PY" "${_args[@]}" 2>/dev/null)
  export HARNESS_EMISSION_ID
}

# koad_io_emit_update <body> [meta_json]
#   Append an update to the current lifecycle emission. Backgrounded.
koad_io_emit_update() {
  [ "${KOAD_IO_EMIT:-0}" = "1" ] || return 0
  [ -z "$HARNESS_EMISSION_ID" ] && return 0
  local _body="${1:-}"
  local _meta="${2:-}"
  [ -z "$_body" ] && return 0

  local _args=(update "$_body" --id "$HARNESS_EMISSION_ID")
  [ -n "$_meta" ] && _args+=(--meta "$_meta")
  ( python3 "$_KOAD_IO_EMIT_PY" "${_args[@]}" >/dev/null 2>&1 ) &
}

# koad_io_emit_close [body]
#   Close the current lifecycle emission. Sync. Cleans up the ID file.
koad_io_emit_close() {
  [ "${KOAD_IO_EMIT:-0}" = "1" ] || return 0
  [ -z "$HARNESS_EMISSION_ID" ] && return 0
  local _body="${1:-closed}"

  local _args=(close "$_body" --id "$HARNESS_EMISSION_ID")
  [ -n "${HARNESS_EMISSION_ID_FILE:-}" ] && _args+=(--id-file "$HARNESS_EMISSION_ID_FILE")
  python3 "$_KOAD_IO_EMIT_PY" "${_args[@]}" >/dev/null 2>&1 || true

  HARNESS_EMISSION_ID=""
}
