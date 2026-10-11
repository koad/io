#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# stop — first-class stop verb for an entity's live harness session tree.
#
# Usage:
#   <entity> stop [flags]                  # target = the invoking entity
#   koad-io stop <entity> [flags]          # target named explicitly
#
# Flags:
#   --force, -f        SIGKILL immediately (no graceful pass)
#   --signal N         first-pass signal number (default 15 / SIGTERM)
#   --timeout S        seconds to wait between signal passes (default 5)
#   --dry-run, -n      report the tree that WOULD be stopped; signal nothing
#   --quiet, -q        suppress the human banner (errors still print)
#   --json             machine-readable result on stdout
#   -h, --help         this text
#
# Exit codes:
#   0  stopped (or nothing was running — idempotent)
#   1  a member survived — the stop FAILED (reported honestly)
#   2  refused: a stale/foreign handle points at a live non-target process
#   3  usage / resolution error (no such entity, bad flag)
#
# WHY THIS EXISTS (VESTA-SPEC-021 v1.1, "Stop Mechanism — The Live Harness Tree")
# ---------------------------------------------------------------------------
# An entity's harness runs as a process TREE, not one process:
#
#     bash <harness>/command.sh          PID = $(cat harness.pid)   ← recorded
#       └─ python3 pi_rpc_dispatch.py    child  (no signal handling)
#            └─ pi --mode rpc            grandchild — the live session
#
# The wrapper never `exec`s pi, so it is the parent of the tree. `kill
# "$(cat harness.pid)"` reaches ONLY the wrapper: pi_rpc_dispatch.py installs no
# signal handling and does not kill its child, and the wrapper's EXIT trap then
# deletes harness.pid — orphaning `pi` and destroying the only on-disk handle.
# An abort that reports success while the session lives is worse than one that
# visibly fails. This verb fixes all three properties:
#
#   (a) targets the right tree,
#   (b) cascades to every descendant, deepest-first,
#   (c) does NOT depend on harness.pid (a dying process deletes it),
#   (d) reports honestly — non-zero if it failed to stop anything.
#
# HOW THE TREE IS IDENTIFIED
# --------------------------
# NOT by process group (see below). A pid belongs to entity <E>'s session iff
# its environment carries ENTITY=<E> AND it is recognisably part of a harness:
#
#   1. its cmdline is a harness wrapper  → contains  harness … command.sh
#                                          or  bin/<E> harness
#   2. its cmdline is the RPC dispatcher → contains  pi_rpc_dispatch.py
#   3. its cmdline is the pi agent       → argv0 basename == "pi"
#   4. OR its HARNESS_PID names a live ancestor of it (belt and braces)
#
# Then the full descendant closure of every match is taken. This is what makes
# the orphan case (wrapper already dead, harness.pid gone) stoppable: `pi` and
# `pi_rpc_dispatch.py` are identified by their own cmdline, not by a file.
#
# WHY NOT `ENTITY=<E>` ALONE (measured on wonderland, 2026-10-11)
# --------------------------------------------------------------
# A long-lived SCREEN service (koad.live) was launched from a session whose env
# had ENTITY=vulcan + a stale HARNESS_PID=471296. `ENTITY` matching alone would
# have killed the website. The cmdline test excludes it: its cmdline is `meteor`,
# not a harness.
#
# WHY NOT A PROCESS-GROUP KILL
# ----------------------------
# Every live harness on the host currently shares ONE process group (the
# interactive launcher's — e.g. pgid 1474075, whose leader has no entity
# identity and is the parent of the juno session). `kill -- -PGID` would take
# out unrelated entities and the operator's own session. This verb therefore
# NEVER signals a process group; it walks the PPID tree.
#
# PAIRED HARNESS CHANGE: harness/pi/command.sh records a durable harness.session
# sidecar and kills its descendants on EXIT/signal, so harness.pid becomes a
# self-healing handle. This verb is correct with or without that change — the
# cmdline/env scan is the backstop.

set -uo pipefail

SELF=$$
SELF_TREE=""            # pids that must never be signalled (this verb's tree)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

die() { echo "stop: $*" >&2; exit 3; }

usage() { sed -n '2,52p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# --- process map: a fork-free snapshot of the PPID tree ---------------------
# Reading /proc/<pid>/stat per hop (awk/sed) costs a fork per level per pid and
# makes a full scan take seconds. Build the map ONCE in pure bash; tree walks
# become array lookups.
declare -A PPID_OF=()
declare -A STATE_OF=()

load_proc_map() {
  PPID_OF=(); STATE_OF=()
  local d p stat rest st pp
  for d in /proc/[0-9]*; do
    p="${d#/proc/}"
    [ -r "$d/stat" ] || continue
    stat="$(<"$d/stat")" 2>/dev/null || continue
    rest="${stat##*)}"; rest="${rest# }"      # everything after the last ')'
    read -r st pp _ <<<"$rest"                # "state ppid ..."
    [ -n "${pp:-}" ] || continue
    STATE_OF["$p"]="$st"
    PPID_OF["$p"]="$pp"
  done
}

_ppid_of() { printf '%s' "${PPID_OF[$1]:-}"; }

_state_of_now() {   # fresh read — process state changes during the kill
  local stat rest st
  [ -r "/proc/$1/stat" ] || return 1
  stat="$(<"/proc/$1/stat")" 2>/dev/null || return 1
  rest="${stat##*)}"; rest="${rest# }"
  read -r st _ <<<"$rest"
  printf '%s' "$st"
}

_alive() {
  # true iff pid exists AND is not a zombie. `kill -0` alone reports a zombie
  # as alive (it holds its pid until reaped) — that would produce a false
  # "survived" verdict after a clean kill.
  local st
  [ -d "/proc/$1" ] || return 1
  st="$(_state_of_now "$1")" || return 1
  [ "$st" != "Z" ] || return 1
  return 0
}

_read_env() {
  # NUL-separated environ → newline-separated. Empty for unreadable/foreign.
  # `cat` first so the shell's own redirection error (foreign-uid /proc) is
  # swallowed by 2>/dev/null rather than printed for every root process.
  cat "/proc/$1/environ" 2>/dev/null | tr '\0' '\n'
}

_cmdline_of() { cat "/proc/$1/cmdline" 2>/dev/null | tr '\0' ' '; }

_ancestors_of() {
  # every pid from $1's parent up to (not including) init. Echoes root-first.
  local p acc=""
  p="$(_ppid_of "$1")"
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    acc="$p $acc"
    p="$(_ppid_of "$p")"
  done
  echo "$acc"
}

_is_ancestor() {   # is $1 an ancestor of $2?
  local p
  p="$(_ppid_of "$2")"
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    [ "$p" = "$1" ] && return 0
    p="$(_ppid_of "$p")"
  done
  return 1
}

_is_descendant_of() {   # is $2 an ancestor of $1? (catches the verb's own subshells)
  _is_ancestor "$2" "$1"
}

_descendants_of() {
  # recursive children of $1, nearest-first (does NOT include $1).
  local pid
  for pid in $(pgrep -P "$1" 2>/dev/null); do
    echo "$pid"
    _descendants_of "$pid"
  done
}

_depth_of() {
  local p="$1" d=0
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    p="$(_ppid_of "$p")"
    [ -n "$p" ] || break
    d=$((d + 1))
  done
  echo "$d"
}

# ---------------------------------------------------------------------------
# argument parsing
# ---------------------------------------------------------------------------

ENTITY_TARGET=""
FORCE=0
SIGNAL=15
TIMEOUT=5
DRY_RUN=0
QUIET=0
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --force|-f)      FORCE=1; SIGNAL=9 ;;
    --signal)        SIGNAL="${2:-}"; shift ;;
    --signal=*)      SIGNAL="${1#*=}" ;;
    --timeout)       TIMEOUT="${2:-}"; shift ;;
    --timeout=*)     TIMEOUT="${1#*=}" ;;
    --dry-run|-n)    DRY_RUN=1 ;;
    --quiet|-q)      QUIET=1 ;;
    --json)          JSON=1 ;;
    -h|--help)       usage; exit 0 ;;
    --)              shift; while [ $# -gt 0 ]; do ENTITY_TARGET="${ENTITY_TARGET:-$1}"; shift; done ;;
    -*)
      # tolerate framework-injected flags we don't own (e.g. global -q)
      echo "stop: ignoring unknown flag '$1'" >&2
      ;;
    *)
      if [ -z "$ENTITY_TARGET" ]; then ENTITY_TARGET="$1"
      else die "unexpected argument '$1' (usage: stop [<entity>] [flags])"; fi
      ;;
  esac
  shift
done

[ -n "$SIGNAL" ] && ! [[ "$SIGNAL" =~ ^[0-9]+$ ]] && die "bad --signal '$SIGNAL'"
[ -n "$TIMEOUT" ] && ! [[ "$TIMEOUT" =~ ^[0-9]+$ ]] && die "bad --timeout '$TIMEOUT'"

# target entity: explicit arg wins; else the launcher-set $ENTITY (<entity> stop).
entity="${ENTITY_TARGET:-${ENTITY:-}}"
[ -z "$entity" ] && die "no entity — pass one ('koad-io stop <entity>') or invoke as '<entity> stop'"
case "$entity" in
  *[!A-Za-z0-9_-]*|"") die "invalid entity name '$entity'" ;;
esac

entity_home="$HOME/.$entity"
[ -d "$entity_home" ] || die "entity '$entity' has no home at $entity_home"

state_dir="$entity_home/.local/state/harness"
pidfile="$state_dir/harness.pid"
sidecar="$state_dir/harness.session"

load_proc_map

# ---------------------------------------------------------------------------
# self-exclusion set — never signal the caller or its own process tree
# ---------------------------------------------------------------------------
# `vulcan stop` runs UNDER ENTITY=vulcan, so the verb's own process and its
# subshells would otherwise match the scan. Exclude $$, all its ancestors, and
# all its descendants.
SELF_TREE="$$ $( _ancestors_of "$SELF" ) $( _descendants_of "$SELF" )"
_is_self() { case " $SELF_TREE " in *" $1 "*) return 0;; esac; return 1; }

# ---------------------------------------------------------------------------
# identity
# ---------------------------------------------------------------------------

_looks_like_harness() {
  local cl argv0
  cl="$(_cmdline_of "$1")"
  case "$cl" in
    *pi_rpc_dispatch.py*) return 0 ;;
    *harness*command.sh*) return 0 ;;
    *bin/"$entity"*harness*) return 0 ;;
  esac
  argv0="${cl%% *}"
  [ "${argv0##*/}" = "pi" ] && return 0
  return 1
}

# A pid is a "member" of the target session when its environment carries
# ENTITY=<entity> AND it is recognisably harness (cmdline), OR its HARNESS_PID
# names a live ancestor of it. The first clause catches the orphan case (wrapper
# dead, harness.pid gone — python3/pi identified by their own cmdline); the
# second catches a descendant that execs into an unrecognisable binary.
_is_member() {
  local pid="$1" env n
  env="$(_read_env "$pid")"
  printf '%s\n' "$env" | grep -qx "ENTITY=$entity" || return 1
  _looks_like_harness "$pid" && return 0
  n="$(printf '%s\n' "$env" | grep -E '^HARNESS_PID=' | head -1 | cut -d= -f2 | tr -dc '0-9')"
  [ -n "$n" ] || return 1
  [ "$n" = "$pid" ] && return 0
  _is_ancestor "$n" "$pid"
}

declare -A MEMBERS=()
scan_members() {
  MEMBERS=()
  # One grep over every environ (unreadable ones skipped by 2>/dev/null); -z
  # treats NUL as the line separator and -x requires a whole entry, so the match
  # is an exact `ENTITY=<entity>` env var, never a substring of a value.
  local f pid
  for f in $(grep -z -l -x "ENTITY=$entity" /proc/[0-9]*/environ 2>/dev/null); do
    pid="${f#/proc/}"; pid="${pid%%/*}"
    [ "$pid" = "$SELF" ] && continue
    _is_self "$pid" && continue
    _is_descendant_of "$pid" "$SELF" && continue
    _is_member "$pid" && MEMBERS["$pid"]=1
  done
}

# Recorded handles (fast path + durable sidecar) — used as roots even if the
# process doesn't itself match the scan.
declare -A HINTS=()
HANDLE_PID=""
HANDLE_SRC=""
if [ -r "$pidfile" ]; then
  h="$(tr -dc '0-9' < "$pidfile" 2>/dev/null)"
  [ -n "$h" ] && { HANDLE_PID="$h"; HANDLE_SRC="$pidfile"; HINTS["$h"]=1; }
fi
if [ -r "$sidecar" ]; then
  h="$(grep -E '^(root_pid|pid)=' "$sidecar" 2>/dev/null | head -1 | cut -d= -f2 | tr -dc '0-9')"
  [ -n "$h" ] && { [ -z "$HANDLE_PID" ] && { HANDLE_PID="$h"; HANDLE_SRC="$sidecar"; }; HINTS["$h"]=1; }
fi

scan_members

# ---- stale/foreign-handle safety check -------------------------------------
# A handle is "ours" only if the recorded pid is alive AND its own environment
# still marks it as this entity. A live pid WITHOUT that identity is a stale or
# reused handle — signal nothing and say so (never kill by a bare number).
HANDLE_OK=0
REFUSED=0
if [ -n "$HANDLE_PID" ] && _alive "$HANDLE_PID" && ! _is_self "$HANDLE_PID"; then
  if _read_env "$HANDLE_PID" | grep -qx "ENTITY=$entity"; then
    HANDLE_OK=1
  else
    REFUSED=1
  fi
fi

# ---- build the kill set ----------------------------------------------------
declare -A KILL=()
_add_tree() {           # add pid + all descendants
  local root="$1" p
  _is_self "$root" && return
  _is_descendant_of "$root" "$SELF" && return
  [ -d "/proc/$root" ] || return
  KILL["$root"]=1
  for p in $(_descendants_of "$root"); do
    _is_self "$p" && continue
    _is_descendant_of "$p" "$SELF" && continue
    [ -d "/proc/$p" ] || continue
    KILL["$p"]=1
  done
}

for p in "${!MEMBERS[@]}"; do _add_tree "$p"; done
[ "$HANDLE_OK" -eq 1 ] && _add_tree "$HANDLE_PID"

# drop anything that died during discovery
LIVE=()
for p in "${!KILL[@]}"; do
  _alive "$p" && LIVE+=("$p")
done

# ---------------------------------------------------------------------------
# report / act
# ---------------------------------------------------------------------------

_human_pid_line() {
  local p="$1" cmd
  # argv is NUL-separated AND may contain literal newlines (system prompts);
  # collapse both to spaces before truncating so a pid line stays one line.
  cmd="$(cat "/proc/$p/cmdline" 2>/dev/null | tr '\0\n' '  ' | cut -c1-96)"
  printf '   %-8s depth=%-3s %s\n' "$p" "$(_depth_of "$p")" "${cmd:-?}"
}

if [ "$JSON" -eq 1 ]; then
  _json_pids() { local first=1 p; printf '['; for p in "$@"; do [ "$first" -eq 1 ] || printf ','; first=0; printf '%s' "$p"; done; printf ']'; }
fi

# ---- nothing to stop -------------------------------------------------------
if [ "${#LIVE[@]}" -eq 0 ]; then
  if [ "$REFUSED" -eq 1 ]; then
    msg="stop: REFUSED — handle $HANDLE_SRC points at live pid $HANDLE_PID, which is not a '$entity' session (identity mismatch; not signalled)"
    echo "$msg" >&2
    [ "$JSON" -eq 1 ] && printf '{"entity":"%s","status":"refused","handle_pid":"%s","handle_source":"%s","stopped":[]}\n' "$entity" "$HANDLE_PID" "$HANDLE_SRC"
    exit 2
  fi
  # idempotent no-op: nothing bearing this entity's identity is running
  [ -r "$pidfile" ] && rm -f "$pidfile" 2>/dev/null
  if [ "$JSON" -eq 1 ]; then
    printf '{"entity":"%s","status":"empty","stopped":[]}\n' "$entity"
  elif [ "$QUIET" -eq 0 ]; then
    if [ -n "$HANDLE_PID" ]; then
      echo "stop: no live '$entity' session (stale handle ${HANDLE_SRC##*/} → pid $HANDLE_PID; cleared)"
    else
      echo "stop: no live '$entity' session — nothing to stop"
    fi
  fi
  exit 0
fi

# deepest-first order
mapfile -t ORDER < <( for p in "${LIVE[@]}"; do echo "$(_depth_of "$p") $p"; done | sort -rn -k1 | awk '{print $2}' )

if [ "$DRY_RUN" -eq 1 ]; then
  if [ "$JSON" -eq 1 ]; then
    printf '{"entity":"%s","status":"dry-run","would_stop":' "$entity"; _json_pids "${ORDER[@]}"; printf '}\n'
  else
    echo "stop: DRY RUN — would stop ${#ORDER[@]} process(es) for '$entity' (deepest-first):"
    for p in "${ORDER[@]}"; do _human_pid_line "$p"; done
  fi
  exit 0
fi

[ "$QUIET" -eq 0 ] && \
  echo "stop: stopping ${#ORDER[@]} process(es) for '$entity' (signal $SIGNAL, then SIGKILL after ${TIMEOUT}s)"

_signal_tree() {   # $1 = signal
  local p
  for p in "${ORDER[@]}"; do
    kill "-$1" "$p" 2>/dev/null || true
  done
}

# pass 1 — graceful (unless --force)
if [ "$FORCE" -eq 0 ] && [ "$SIGNAL" -ne 9 ]; then
  _signal_tree "$SIGNAL"
  _waited=0
  while [ "$_waited" -lt "$TIMEOUT" ]; do
    _still=0
    for p in "${ORDER[@]}"; do _alive "$p" && { _still=1; break; }; done
    [ "$_still" -eq 0 ] && break
    sleep 0.5
    _waited=$((_waited + 1))
  done
fi

# pass 2 — SIGKILL anything still alive
_survivors=()
for p in "${ORDER[@]}"; do _alive "$p" && _survivors+=("$p"); done
if [ "${#_survivors[@]}" -gt 0 ]; then
  for p in "${_survivors[@]}"; do kill -9 "$p" 2>/dev/null || true; done
  sleep 1
fi

# ---------------------------------------------------------------------------
# verify — NEVER claim success while a member survives
# ---------------------------------------------------------------------------
sleep 0.3
load_proc_map
scan_members
declare -A SURVIVING=()
for p in "${!MEMBERS[@]}"; do
  _alive "$p" && SURVIVING["$p"]=1
done
for p in "${ORDER[@]}"; do _alive "$p" && SURVIVING["$p"]=1; done

if [ "${#SURVIVING[@]}" -gt 0 ]; then
  fs=()
  for p in "${!SURVIVING[@]}"; do fs+=("$p"); done
  if [ "$JSON" -eq 1 ]; then
    printf '{"entity":"%s","status":"failed","survivors":' "$entity"; _json_pids "${fs[@]}"; printf '}\n'
  else
    echo "stop: FAILED — ${#fs[@]} process(es) survived for '$entity':" >&2
    for p in "${fs[@]}"; do _human_pid_line "$p" >&2; done
    echo "stop: try --force (SIGKILL); if they still survive they are unkillable (D-state?) or not owned by $(id -un)." >&2
  fi
  exit 1
fi

# success — clear the transient handle (durable sidecar is left as last-known)
[ -r "$pidfile" ] && rm -f "$pidfile" 2>/dev/null

if [ "$JSON" -eq 1 ]; then
  printf '{"entity":"%s","status":"stopped","stopped":' "$entity"; _json_pids "${ORDER[@]}"; printf '}\n'
elif [ "$QUIET" -eq 0 ]; then
  echo "stop: stopped ${#ORDER[@]} process(es) for '$entity' — verified: no member of the session survives"
fi
exit 0
