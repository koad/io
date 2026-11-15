#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Contract: helpers/session-files.sh `meta.json` must record HOW a session was
# entered — `entry` (ssh | desktop | console | headless), `tty`, and the ssh
# `remote` — while `surface` keeps its established meaning (the launch surface:
# a domain, or `terminal` for a human's own shell).
#
# THE DEFECT (2026-11-10, live on wonderland):
#   `surface` held KOAD_IO_DOMAIN and read `unknown` for every locally-launched
#   session. So two sessions that differed in exactly the way that mattered —
#   one left running in a gnome-terminal (pts/30, 12h), one re-launched over ssh
#   (pts/14, 2h) — produced byte-identical records, sharing one pi transcript
#   with two live writers. The record could not answer the only question it
#   looked built to answer, and the answer had to be reconstructed from `ps`
#   ancestry and `who -T`. This test is the contract that keeps it answerable.
#
# WHAT IS ASSERTED
#   Three entry paths, each a real one on this machine:
#     pty, no SSH_*      -> entry=desktop,  tty=pts/N, section surface=<launch surface>
#     pty, SSH_CONNECTION-> entry=ssh,      tty=pts/N, remote=<client ip>
#     no controlling tty -> entry=headless, tty=none
#   plus: the file parses as JSON, carries domain separately, and no value is
#   the old placeholder `unknown`.
#
# THE ACCEPTED VALUE SET FOR `surface` (2026-11-15)
#   `surface` answers WHERE the session was launched, `origin` answers HOW it came
#   to exist. In precedence order: $KOAD_IO_DOMAIN, then $KOAD_IO_INSTANCE, then
#   `terminal` when a controlling tty exists, then "" for a headless session with
#   neither set (no launch surface — an honest absence, not `unknown`). A session
#   launched with KOAD_IO_INSTANCE legitimately records that instance; the
#   assertion is therefore NOT-UNKNOWN, which is what this test's own name has
#   always said, rather than the stricter `terminal` it used to enforce.
#
# THIS SUITE MUST PASS INSIDE A DISPATCHED FLIGHT
#   A commit only ever happens inside a flight, so a gate that goes green only
#   outside one never passes. A flight sets HARNESS_CONTROL_FLIGHT_ID, and that
#   is the first thing the recorder reads for `origin`: the session is
#   `dispatched` regardless of whether a human is at the tty. The expected origin
#   below is therefore computed from the same environment the probe inherits.
#
# Run:
#   bash ~/.koad-io/test/session-meta.test.sh
#
# Fault injection (against the old writer):
#   git -C ~/.koad-io stash helpers/session-files.sh && bash test/session-meta.test.sh
#   -> the three surface assertions fail with `unknown`.

set -uo pipefail

KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"
HELPER="$KOAD_IO_DIR/helpers/session-files.sh"
SESSION="PROBEmeta01"

pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$name"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n       expected: %q\n       actual:   %q\n' "$name" "$expected" "$actual"
  fi
}

check_re() {
  local name="$1" re="$2" actual="$3"
  if [[ "$actual" =~ $re ]]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$name"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n       expected match: %s\n       actual:         %q\n' "$name" "$re" "$actual"
  fi
}

if [[ ! -f "$HELPER" ]]; then
  echo "FATAL: helper missing: $HELPER" >&2
  exit 2
fi
for tool in script setsid node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FATAL: $tool not found (cannot probe ttys)" >&2; exit 2; }
done

RUNTIME="$(mktemp -d "${TMPDIR:-/tmp}/session-meta.XXXXXX")"
cleanup() { rm -rf "$RUNTIME"; }
trap cleanup EXIT
META="$RUNTIME/entities/probe/sessions/$SESSION/meta.json"

# probe <pty|notty> — run the real recorder on that kind of terminal, return the
# meta.json it wrote. Env is inherited (exported by the caller's prefix).
probe() {
  local mode="$1"
  rm -f "$META"
  local cmd
  cmd="source '$HELPER'; KOAD_IO_RUNTIME_PATH='$RUNTIME' koad_record_session_files probe '$SESSION' 'a prompt'"
  case "$mode" in
    pty)   script -qec "bash -c $(printf '%q' "$cmd")" /dev/null >/dev/null 2>&1 || true ;;
    notty) setsid bash -c "$cmd" >/dev/null 2>&1 </dev/null || true ;;
    *)     echo "FATAL: bad probe mode $mode" >&2; exit 2 ;;
  esac
  cat "$META" 2>/dev/null
}

json_get() {
  node -e '
    let raw = "";
    process.stdin.on("data", d => raw += d).on("end", () => {
      try { const o = JSON.parse(raw); process.stdout.write(String(o[process.argv[1]] ?? "")); }
      catch { process.stdout.write("<unparseable>"); }
    });
  ' "$1" <<<"$2"
}

# The probe inherits this environment, so the expectations are read from it:
#   * origin  — dispatched when a flight dispatched this session, else operator
#               (a tty) / chat (no tty).
#   * surface — the launch surface: domain, then instance, then `terminal` for a
#               session that has a controlling tty.
if [[ -n "${HARNESS_CONTROL_FLIGHT_ID:-}" ]]; then
  PTY_ORIGIN="dispatched"
  NOTTY_ORIGIN="dispatched"
else
  PTY_ORIGIN="operator"
  NOTTY_ORIGIN="chat"
fi
SURFACE_EXPECTED="${KOAD_IO_DOMAIN:-${KOAD_IO_INSTANCE:-terminal}}"

# ── 1. a local terminal emulator: a pty with no ssh behind it ────────────────
unset SSH_CONNECTION SSH_TTY SSH_CLIENT
meta="$(probe pty)"
check "pty: parses as JSON" "true" "$(node -e 'try{JSON.parse(process.argv[1]);process.stdout.write("true")}catch{process.stdout.write("false")}' "$meta")"
check "pty without ssh: entry" "desktop" "$(json_get entry "$meta")"
check_re "pty without ssh: tty is a pty" '^pts/[0-9]+$' "$(json_get tty "$meta")"
check "pty without ssh: surface is the launch surface, not unknown" "$SURFACE_EXPECTED" "$(json_get surface "$meta")"
check "pty without ssh: no remote" "" "$(json_get remote "$meta")"
check "pty: origin still recorded" "$PTY_ORIGIN" "$(json_get origin "$meta")"

# ── 2. the same pty, reached over ssh ───────────────────────────────────────
# Exported deliberately: a `VAR=x probe pty` prefix does not reach the pty child
# bash spawns, and the first version of this test failed exactly there.
export SSH_CONNECTION="10.10.10.100 51234 10.10.10.10 22"
meta="$(probe pty)"
check "pty over ssh: entry" "ssh" "$(json_get entry "$meta")"
check_re "pty over ssh: tty is a pty" '^pts/[0-9]+$' "$(json_get tty "$meta")"
check "pty over ssh: names the client, not the server" "10.10.10.100" "$(json_get remote "$meta")"
unset SSH_CONNECTION

# ── 3. no controlling terminal: a flight, or a detached launcher ─────────────
meta="$(probe notty)"
check "no tty: entry" "headless" "$(json_get entry "$meta")"
check "no tty: tty" "none" "$(json_get tty "$meta")"
check "no tty: no remote" "" "$(json_get remote "$meta")"
check "no tty: origin is not operator" "$NOTTY_ORIGIN" "$(json_get origin "$meta")"

# ── 4. the old placeholder never comes back ─────────────────────────────────
check "no field says 'unknown'" "" "$(grep -o 'unknown' <<<"$meta" || true)"

printf '\n── session-meta: %d passed, %d failed ──\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]] || exit 1
