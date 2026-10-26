# session-identity.sh — one session identity for every harness launcher.
#
# THE RULE: a session id must be unique to one launch and never handed out twice.
#
# The old identity across the launchers was "${ENTITY}-$$" — a process id. It fails the
# second half of that rule: the kernel recycles pids, so a fresh harness can inherit the
# identity of a dead one, and every consumer that trusts the id (control-tower's session
# index, the questions board's liveness test, session-watchers) then treats the dead session
# as running. Observed 2026-10-26: a leaked harness held a stale 'active' row that made two
# 47-day-old questions look attended, and the board could not tell them from live work.
#
# So identity is a CONTENT ID over the launch itself — the facts the startup sequence
# establishes — via koad.generate.cid (SHA-256 → 17 chars of EASILY_RECOGNIZABLE, the same
# function the kingdom uses for handles and bonds). Same launch, same id; different launch,
# different id; no pid anywhere in it.
#
# Usage (from a launcher, after the conversation id, model and spirit are known):
#
#   . "$KOAD_IO_DIR/helpers/session-identity.sh"
#   HARNESS_SESSION_ID="$(koad_session_identity "$ENTITY" "$_conv_id" pi "$PROVIDER/$MODEL" "$KOAD_IO_SPIRIT" "${HARNESS_CONTROL_FLIGHT_ID:-}")"
#
# Args: <entity> <conversation_id> [harness] [model] [spirit] [flight] [host]
# Prints: "<entity>-<17-char cid>"
#
# The entity prefix is deliberate and load-bearing: ~/.forge/commands/message derives its
# entity hint as ${HARNESS_SESSION_ID%-*}, and the CID alphabet contains no dash, so exactly
# one '-' survives as the separator.
#
# The pid stays a pid. Launchers should keep exporting HARNESS_PID for orphan detection and
# telemetry — it is a fact about a process, which is all it ever was.

# Nanoseconds, not seconds. Every session of an entity shares one conversation id unless it
# is launched with --new-conversation, so two dispatches of the same entity in the same second
# would otherwise derive the SAME session id — the exact collision this is here to end. The
# launch instant at ns precision is the one thing two launches cannot share.
koad_session_started_at() {
  if [ -n "${KOAD_SESSION_STARTED:-}" ]; then
    printf '%s' "$KOAD_SESSION_STARTED"   # replay/inspection hook
  else
    date -u +%Y-%m-%dT%H:%M:%S.%NZ
  fi
}

# The seed. Fields are LABELLED because koad.generate.cid normalises by stripping
# non-alphanumerics: without labels, "vulcan wonderland" and "vulcanwonderland" would hash
# identically. Labels survive normalisation as distinct text.
koad_session_seed() {
  local entity="$1" conversation="$2" harness="${3:-pi}" model="${4:-}" spirit="${5:-}" flight="${6:-}" host="${7:-}"
  [ -n "$host" ] || host="$(hostname -s 2>/dev/null || hostname)"
  [ -n "$flight" ] || flight="standalone"
  printf 'entity=%s host=%s conversation=%s started=%s harness=%s model=%s spirit=%s flight=%s' \
    "$entity" "$host" "$conversation" "$(koad_session_started_at)" "$harness" "$model" "$spirit" "$flight"
}

# koad.generate.cid over the seed, via @koad-io/node (the canonical implementation).
# Fallback: a plain sha256 prefix — cruder, still unique per launch, and never a pid.
koad_session_cid() {
  local seed="$1" cid="" koad_io_dir="${KOAD_IO_DIR:-$HOME/.koad-io}"
  if command -v node >/dev/null 2>&1 && [ -f "$koad_io_dir/modules/node/index.js" ]; then
    cid="$(node --input-type=module -e \
      "import { koad } from '$koad_io_dir/modules/node/index.js'; process.stdout.write(koad.generate.cid(process.argv[1]));" \
      "$seed" 2>/dev/null || true)"
  fi
  if [ -z "$cid" ]; then
    cid="$(printf '%s' "$seed" | sha256sum 2>/dev/null | cut -c1-16 || true)"
  fi
  [ -n "$cid" ] || cid="$(date -u +%s%N)"    # last resort: still per-launch, never a pid
  printf '%s' "$cid"
}

koad_session_identity() {
  local entity="$1" conversation="$2"
  shift 2 || true
  local seed cid
  seed="$(koad_session_seed "$entity" "$conversation" "${1:-pi}" "${2:-}" "${3:-}" "${4:-}" "${5:-}")"
  cid="$(koad_session_cid "$seed")"
  printf '%s-%s' "$entity" "$cid"
}
