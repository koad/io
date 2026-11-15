# session-files.sh — record the two inputs that made a session. Additive only.
#
# koad, 2026-11-09: "recording those two files on session start doesnt effect
# anything else." True by construction — this writes two NEW files under a path
# nothing reads yet. It does not move, rewrite, reformat or delete anything.
#
# WHERE
#   ${KOAD_IO_RUNTIME_PATH:-~/.local/share/koad-io/runtime}/entities/<entity>/sessions/<session-id>/
#     system-prompt.md   the bytes of SYSTEM_PROMPT handed to the harness
#     dispatch.md        the bytes of PROMPT, when there was one (a flight)
#
# WHY TWO FILES
#   The system prompt is context assembly — produced for every session, different
#   each time because it states live facts. The dispatch is the mission — present
#   only when something dispatched it. An interactive session has no dispatch.md,
#   and that absence is a fact, not an empty file.
#
# WHAT THIS IS NOT
#   It does not derive or change the session id. It does not read anything. It is
#   best-effort: a failure to record must never block a session from starting.
#
# THE INVARIANT THIS EXISTS TO MAKE POSSIBLE
#   cid = hash(system-prompt.md + dispatch.md), so a session folder can prove its
#   own name by re-hashing its own contents. That derivation is NOT done here —
#   it is a separate decision, and changing it changes every stored id.

koad_session_files_dir() {
  local entity="$1" session="$2"
  local runtime="${KOAD_IO_RUNTIME_PATH:-$HOME/.local/share/koad-io/runtime}"
  printf '%s/entities/%s/sessions/%s' "$runtime" "$entity" "$session"
}

# koad_record_session_files <entity> <session-id> [system-prompt] [prompt]
koad_record_session_files() {
  local entity="$1" session="$2" system_prompt="${3-}" prompt="${4-}"
  [ -n "$entity" ] && [ -n "$session" ] || return 0

  # THE FOLDER IS THE 17-CHARACTER ID, NEVER THE 5-CHARACTER TAIL.
  # The footer shows `…n5LFa` so a human can say it out loud; that tail is a
  # display handle, not an address. A folder named by it would collide within
  # days and could never be re-derived. Refuse the short form loudly rather than
  # quietly creating an address nothing else can find (2026-11-10).
  if [ "${#session}" -lt 6 ]; then
    echo "session-files: refusing to record a session folder named '$session' — that is a display tail, not a session id (17 chars)." >&2
    return 0
  fi

  local dir
  dir="$(koad_session_files_dir "$entity" "$session")"
  mkdir -p "$dir" 2>/dev/null || return 0

  # The clues folder: a letter dropped in here is delivered to THIS session and
  # nobody else (2026-11-09). Empty at start; the watcher treats whatever it
  # finds at boot as history, not news.
  mkdir -p "$dir/clues" 2>/dev/null || true

  # origin — how this session came to exist. The same three words the dispatch
  # record uses: a flight, a human at a terminal, or a chat surface with nobody
  # attached. Recorded here because an interactive session's origin was
  # previously written nowhere at all (2026-11-10).
  local _session_origin
  if [ -n "${HARNESS_CONTROL_FLIGHT_ID:-}" ]; then
    _session_origin="dispatched"
  elif [ -t 0 ] || [ -t 1 ]; then
    _session_origin="operator"
  else
    _session_origin="chat"
  fi

  # meta.json — the folder names itself. Needed so a sender can address a
  # session by `entity + path` without asking a server (send clue --path).
  # Values only; no secrets, no prompt text.
  {
    printf '{"entity":"%s","session":"%s","cwd":"%s","pid":%s,"host":"%s","started":"%s","flight":"%s","origin":"%s","surface":"%s"}\n' \
      "$entity" "$session" \
      "$(printf '%s' "${HARNESS_WORK_DIR:-$PWD}" | sed 's/["\\]/\\&/g')" \
      "${HARNESS_PID:-0}" \
      "$(hostname -s 2>/dev/null || hostname)" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "${HARNESS_CONTROL_FLIGHT_ID:-}" \
      "${_session_origin}" \
      "${KOAD_IO_DOMAIN:-${KOAD_IO_INSTANCE:-unknown}}"
  } > "$dir/meta.json" 2>/dev/null || true

  # ── entry, tty, remote — WHO is at this session, and HOW they arrived (2026-11-10).
  #
  # The write above is kept only because its format string is not editable by an
  # agent: it holds a session-token literal that the read surface masks, so the
  # block cannot be matched, corrected or removed from inside a session. This
  # write lands last and is the record. Deleting the block above is a five-second
  # job for an operator and is filed as a follow-up rather than guessed at.
  #
  # THE WORD "SURFACE" ALREADY MEANT SOMETHING, so it keeps that meaning: the
  # launch surface — `koad.live`, `kingofalldata.com`, or `terminal` for a human's
  # own shell. That is the vocabulary `sessions/record-origin.ts` uses for the
  # live record; the two halves of a session must not describe it differently.
  # What it *was* getting wrong: it held KOAD_IO_DOMAIN or, when that was unset
  # (every local launch), the string `unknown`. A human's terminal is not unknown-
  # anything. It is `terminal`.
  #
  # WHAT WAS MISSING is transport, and it is its own field:
  #   entry    ssh | desktop | console | headless | other — how the session began
  #   tty      the controlling terminal (pts/30, tty2) — `none` when there is none
  #   remote   the ssh client address, when there was one
  #
  # WHY IT MATTERS (the defect that earned these fields): two sessions on this
  # machine differed in exactly the way that mattered — one left running in a
  # gnome-terminal (pts/30, 12h), one re-launched over ssh (pts/14, 2h) — and
  # produced byte-identical records. They were two live `pi` processes sharing one
  # transcript. The difference was recoverable only from `ps` ancestry and
  # `who -T`, because sshd writes utmp and gnome-terminal does not.
  #
  # A multiplexer inherits its outer transport (SSH_* survives into a tmux pane),
  # so a pane over ssh still says `ssh` and still names the client. `headless`
  # means no controlling terminal at all — a flight, or a detached launcher.
  local _session_entry _session_surface_name _session_remote
  _session_tty="$(ps -o tty= -p "$$" 2>/dev/null | tr -d '[:space:]')"
  case "$_session_tty" in
    ''|'?'|'??') _session_tty="none" ;;
  esac
  if [ "$_session_tty" = "none" ]; then
    _session_entry="headless"
  elif [ -n "${SSH_CONNECTION:-}${SSH_TTY:-}" ]; then
    _session_entry="ssh"
  else
    case "$_session_tty" in
      pts/*) _session_entry="desktop" ;;   # a local terminal emulator's pty
      tty*)  _session_entry="console" ;;
      *)     _session_entry="other" ;;
    esac
  fi

  # The ssh client address, never the server's: "which machine is this coming
  # from" is the question a list of sessions gets asked. SSH_CONNECTION is
  # "client_ip client_port server_ip server_port"; SSH_CLIENT is the older form.
  _session_remote=""
  if [ "$(printf '%s' "${SSH_CONNECTION:-}")" != "" ]; then
    _session_remote="${SSH_CONNECTION%% *}"
  elif [ "$(printf '%s' "${SSH_CLIENT:-}")" != "" ]; then
    _session_remote="${SSH_CLIENT%% *}"
  fi

  # The launch surface keeps its existing meaning, and stops saying `unknown`
  # for a human at a terminal.
  #
  # WHICH TERMINAL TEST, AND WHY NOT `origin` (2026-11-15). This fallback used
  # to read `origin = operator`, so a session that inherited a real pty inside a
  # dispatched flight got surface "" — the same hole `unknown` was, one letter
  # quieter. `surface` answers WHERE and `origin` answers HOW; a flight started
  # from a terminal is still at that terminal. The test is the controlling tty,
  # the same fact `entry` is derived from. Accepted values, in precedence order:
  #   $KOAD_IO_DOMAIN | $KOAD_IO_INSTANCE | terminal (a tty exists) | "" (headless
  #   with neither set — there is no launch surface, and the absence is honest).
  if [ -n "${KOAD_IO_DOMAIN:-}" ]; then
    _session_surface_name="$KOAD_IO_DOMAIN"
  elif [ -n "${KOAD_IO_INSTANCE:-}" ]; then
    _session_surface_name="$KOAD_IO_INSTANCE"
  elif [ "$_session_tty" != "none" ]; then
    _session_surface_name="terminal"
  else
    _session_surface_name=""
  fi

  # Exported so the live half (telemetry, a DDP session doc) reads the same fact
  # the durable half records, instead of detecting it a second way.
  export KOAD_IO_SESSION_ENTRY="$_session_entry"
  export KOAD_IO_SESSION_TTY="$_session_tty"
  export KOAD_IO_SESSION_REMOTE="$_session_remote"

  {
    printf '{"entity":"%s","session":"%s","cwd":"%s","pid":%s,"host":"%s","started":"%s","flight":"%s","origin":"%s","surface":"%s","entry":"%s","tty":"%s","remote":"%s"}\n' \
      "$entity" "$session" \
      "$(printf '%s' "${HARNESS_WORK_DIR:-$PWD}" | sed 's/["\\]/\\&/g')" \
      "${HARNESS_PID:-0}" \
      "$(hostname -s 2>/dev/null || hostname)" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "${HARNESS_CONTROL_FLIGHT_ID:-}" \
      "${_session_origin}" \
      "${_session_surface_name}" \
      "${_session_entry}" \
      "${_session_tty}" \
      "${_session_remote}"
  } > "$dir/meta.json" 2>/dev/null || true

  if [ -n "$system_prompt" ]; then
    printf '%s' "$system_prompt" > "$dir/system-prompt.md" 2>/dev/null || true
  fi
  if [ -n "$prompt" ]; then
    printf '%s' "$prompt" > "$dir/dispatch.md" 2>/dev/null || true
  fi
  return 0
}

# koad_session_tmp <entity> <session-id> — this session's temp is its own folder.
#
# koad, 2026-11-09: "we can bake in a tmp folder alias as well, right in the
# startup script... but not for the whole system, just for the session itself."
#
# TMPDIR/TMP/TEMP are inherited by the whole process tree — pi, every tool it
# runs, every build it launches — and by nothing else on the machine. That is the
# session-scoped alias: anything that asks the standard where temporary files go
# gets $RUNTIME/entities/<entity>/sessions/<cid>/artifacts/temp.
#
# WHAT IT DOES NOT DO: it does not change the literal path /tmp. A tool that
# hardcodes "/tmp" still writes to the real one. A TRUE /tmp alias needs a mount
# namespace (`unshare -rm` + `mount --bind ... /tmp` before exec), which is a
# planning-session decision, not a launcher tweak: it hides the machine's shared
# /tmp from the session, including sockets other processes may own.
#
# Opt out with KOAD_IO_SESSION_TMP=0. Best-effort: never blocks a session.
koad_session_tmp() {
  local entity="$1" session="$2"
  [ "${KOAD_IO_SESSION_TMP:-1}" = "0" ] && return 0
  [ -n "$entity" ] && [ -n "$session" ] || return 0

  local dir
  dir="$(koad_session_files_dir "$entity" "$session")/artifacts/temp"
  mkdir -p "$dir" 2>/dev/null || return 0

  export TMPDIR="$dir"
  export TMP="$dir"
  export TEMP="$dir"
  return 0
}
