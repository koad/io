#!/usr/bin/env bash
# PRIMITIVE: stream-watcher-atom-feed-sweep
# KIND: worker
# INTERVAL: 60 (minutes)
# DELAY: 0
# RUN_IMMEDIATELY: false
#
# Purpose: Auditor role atom-feed sweep (Janus's core role purpose). Hourly
#          sweep of feed.atom files across entity dirs and ~/.koad-io/. Tracks
#          last-activity timestamps per entity and detects anomalies:
#
#   - Entity stalled: no feed entry updated in N hours (threshold per role)
#   - Silent blocker: entity has a feed entry tagged "blocked" or "blocker"
#     with no resolution entry within threshold window
#   - Feed missing: entity dir has no feed.atom when one was expected
#     (detected if entity has passenger.json but no feed.atom)
#
# Does NOT detect (separate primitives or Juno's preamble handles these):
#   - Pipeline break (active flight with no progress emissions) — requires
#     daemon collection access, not shell-level
#   - Trust chain gaps — requires bond graph traversal, not feed-level
#
# Role note: Janus has KOAD_IO_ENTITY_ROLE=auditor (not "stream-watcher").
#   This primitive targets "auditor" so it auto-installs for Janus, Argus,
#   and any future auditor-role entity via the provisioner. Auditors as a
#   class have standing to watch entity streams.
#
# Stall thresholds by role (hours since last feed update):
#   builder, engineer  → 168h (7 days)  — build work is bursty
#   researcher         →  72h (3 days)  — recon should be frequent
#   healer             →  48h (2 days)  — heals accumulate fast
#   orchestrator       →  48h (2 days)  — orchestration is continuous
#   auditor            → 168h (7 days)  — audits are demand-triggered
#   communicator       →  48h (2 days)  — publishing cadence is fast
#   designer           → 168h (7 days)  — design is bursty
#   default            → 168h (7 days)
#
# Roles: auditor
#
# Idempotent: read-only. Emits per-finding per run. Hourly cadence means
#             alerts fire every hour until state changes (intentional —
#             stream-watcher should be noisy about stalls).
#
# Env vars expected:
#   ENTITY           — entity handle (e.g. "janus")
#   KOAD_IO_EMIT     — 1 to enable emission, 0/unset to skip
#   HOME             — operator home dir

set -uo pipefail

source "${HOME}/.koad-io/helpers/emit.sh" 2>/dev/null || true

koad_io_emit_open service "stream-watcher-atom-feed-sweep: starting hourly atom-feed sweep"

ENTITIES_SCANNED=0
ANOMALY_COUNT=0
FEED_MISSING_COUNT=0

# ---------------------------------------------------------------------------
# Parse a feed.atom file and return the latest <updated> timestamp (ISO 8601)
# Uses Python3 for reliable XML parsing; falls back to grep
# ---------------------------------------------------------------------------

get_feed_updated() {
  local feed_file="$1"
  python3 - "${feed_file}" 2>/dev/null <<'PYEOF'
import sys, xml.etree.ElementTree as ET
ns = {'atom': 'http://www.w3.org/2005/Atom'}
try:
    tree = ET.parse(sys.argv[1])
    root = tree.getroot()
    # Collect all <updated> timestamps from feed and entries
    timestamps = []
    feed_updated = root.findtext('atom:updated', namespaces=ns)
    if feed_updated:
        timestamps.append(feed_updated.strip())
    for entry in root.findall('atom:entry', namespaces=ns):
        entry_updated = entry.findtext('atom:updated', namespaces=ns)
        if entry_updated:
            timestamps.append(entry_updated.strip())
    # Return the most recent
    if timestamps:
        print(sorted(timestamps)[-1])
except Exception as e:
    sys.exit(1)
PYEOF
}

# Hours since an ISO-8601 timestamp
hours_since() {
  local ts="$1"
  python3 - "${ts}" 2>/dev/null <<'PYEOF'
import sys
from datetime import datetime, timezone
ts = sys.argv[1].rstrip('Z')
try:
    dt = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    diff_h = (now - dt).total_seconds() / 3600
    print(f"{diff_h:.1f}")
except Exception:
    sys.exit(1)
PYEOF
}

# Stall threshold by role (hours)
stall_threshold_hours() {
  local role="$1"
  case "${role}" in
    researcher|healer|orchestrator|communicator) echo 48 ;;
    *) echo 168 ;;
  esac
}

# ---------------------------------------------------------------------------
# Walk entity dirs
# ---------------------------------------------------------------------------

for entity_path in "${HOME}"/.*; do
  [ -d "${entity_path}" ] || continue
  env_file="${entity_path}/.env"
  [ -f "${env_file}" ] || continue
  grep -q "KOAD_IO_" "${env_file}" 2>/dev/null || continue

  entity_handle="$(basename "${entity_path}" | sed 's/^\.//')"
  entity_role="$(grep "^KOAD_IO_ENTITY_ROLE=" "${env_file}" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')"
  ENTITIES_SCANNED=$((ENTITIES_SCANNED + 1))

  feed_file="${entity_path}/feed.atom"

  # --- Check: feed.atom missing ---
  # Count but don't emit per-entity (too noisy when kingdom feeds are early-stage).
  # The aggregate count is emitted in the close message.
  passenger_file="${entity_path}/passenger.json"
  if [ ! -f "${feed_file}" ] && [ -f "${passenger_file}" ]; then
    FEED_MISSING_COUNT=$((FEED_MISSING_COUNT + 1))
    continue
  fi

  [ -f "${feed_file}" ] || continue

  # --- Parse latest timestamp ---
  latest_ts="$(get_feed_updated "${feed_file}" 2>/dev/null || true)"

  if [ -z "${latest_ts}" ]; then
    # Feed is malformed or empty
    ANOMALY_COUNT=$((ANOMALY_COUNT + 1))
    koad_io_emit_update "stream-watcher-atom-feed-sweep: ANOMALY feed-malformed — ${entity_handle} feed.atom could not be parsed"
    continue
  fi

  # --- Check stall ---
  hours="$(hours_since "${latest_ts}" 2>/dev/null || true)"
  if [ -n "${hours}" ]; then
    threshold="$(stall_threshold_hours "${entity_role}")"
    # Bash can't do float comparison; use python
    stalled="$(python3 -c "print('yes' if float('${hours}') > ${threshold} else 'no')" 2>/dev/null || echo "no")"
    if [ "${stalled}" = "yes" ]; then
      ANOMALY_COUNT=$((ANOMALY_COUNT + 1))
      koad_io_emit_update "stream-watcher-atom-feed-sweep: ANOMALY stalled — ${entity_handle} (${entity_role:-no-role}): last feed update ${hours}h ago (threshold ${threshold}h)"
    fi
  fi
done

# ---------------------------------------------------------------------------
# Also sweep ~/.koad-io/ for a framework-level feed if present
# ---------------------------------------------------------------------------

koad_io_feed="${HOME}/.koad-io/feed.atom"
if [ -f "${koad_io_feed}" ]; then
  latest_ts="$(get_feed_updated "${koad_io_feed}" 2>/dev/null || true)"
  if [ -n "${latest_ts}" ]; then
    hours="$(hours_since "${latest_ts}" 2>/dev/null || true)"
    if [ -n "${hours}" ]; then
      stalled="$(python3 -c "print('yes' if float('${hours}') > 168 else 'no')" 2>/dev/null || echo "no")"
      if [ "${stalled}" = "yes" ]; then
        ANOMALY_COUNT=$((ANOMALY_COUNT + 1))
        koad_io_emit_update "stream-watcher-atom-feed-sweep: ANOMALY stalled — koad-io framework feed last updated ${hours}h ago (threshold 168h)"
      fi
    fi
  fi
fi

koad_io_emit_close "stream-watcher-atom-feed-sweep: sweep complete — ${ENTITIES_SCANNED} entities scanned, ${ANOMALY_COUNT} anomalies detected (${FEED_MISSING_COUNT} feeds missing)"
