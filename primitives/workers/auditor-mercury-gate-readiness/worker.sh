#!/usr/bin/env bash
# PRIMITIVE: auditor-mercury-gate-readiness
# KIND: worker
# INTERVAL: 1440 (minutes — 24h)
# DELAY: 540 (minutes — fire at ~09:00 local if daemon starts at midnight)
# RUN_IMMEDIATELY: false
#
# Purpose: Auditor role Mercury Gate readiness checker. Scans the Mercury post
#          queue daily and identifies posts that have all gate-prerequisites
#          satisfied (Iris voice cleared, Veritas verdict rendered, structural
#          integrity confirmed) but have not yet received an Argus Mercury Gate
#          verdict. Emits an alert event per gate-ready post found.
#
# Prerequisites detected as satisfied:
#   - "Iris cleared": frontmatter argus-gate.verdict does not exist, but
#     the checklist contains evidence of iris-voice-review CLEARED
#   - "Veritas verdict": frontmatter veritas-fact-check.verdict is set
#     (cleared OR conditional — Argus should gate regardless, even HOLD)
#   - "Structural completeness": checklist.md exists and contains the required
#     gate lines (argus gate line present in checklist)
#
# Gate-ready state: veritas verdict rendered + iris cleared + no argus-gate
#   verdict in frontmatter → emit alert
#
# Roles: auditor (installs for Argus, Janus, and any future auditor entity)
#
# Idempotent: read-only scan; emits once-per-finding per run. Daily cadence
#             means duplicate alerts are one-per-day max if state doesn't change.
#
# Env vars expected:
#   ENTITY           — entity handle (e.g. "argus")
#   KOAD_IO_EMIT     — 1 to enable emission, 0/unset to skip
#   HOME             — operator home dir

set -uo pipefail

MERCURY_POSTS="${HOME}/.mercury/posts"
ARGUS_REPORTS="${HOME}/.argus/reports"

source "${HOME}/.koad-io/helpers/emit.sh" 2>/dev/null || true

koad_io_emit_open service "auditor-mercury-gate-readiness: starting daily gate scan for ${ENTITY:-unknown}"

# Guard: Mercury posts dir must exist
if [ ! -d "${MERCURY_POSTS}" ]; then
  koad_io_emit_close "auditor-mercury-gate-readiness: no Mercury posts dir at ${MERCURY_POSTS} — skipping"
  exit 0
fi

GATE_READY_COUNT=0
SCANNED_COUNT=0

for post_dir in "${MERCURY_POSTS}"/*/; do
  [ -d "${post_dir}" ] || continue
  checklist="${post_dir}checklist.md"
  [ -f "${checklist}" ] || continue

  SCANNED_COUNT=$((SCANNED_COUNT + 1))
  post_slug="$(basename "${post_dir}")"

  # --- Check 1: Does argus-gate verdict already exist in frontmatter? ---
  # If verdict is set (any value), Argus has already weighed in — skip.
  if grep -q "^argus-gate:" "${checklist}" 2>/dev/null; then
    if grep -A5 "^argus-gate:" "${checklist}" 2>/dev/null | grep -q "verdict:"; then
      continue  # Already has verdict — no-op
    fi
  fi

  # --- Check 2: Does Veritas verdict exist? ---
  # veritas-fact-check.verdict must be set (cleared, conditional, or hold)
  has_veritas_verdict=false
  if grep -q "^veritas-fact-check:" "${checklist}" 2>/dev/null; then
    if grep -A5 "^veritas-fact-check:" "${checklist}" 2>/dev/null | grep -q "verdict:"; then
      has_veritas_verdict=true
    fi
  fi

  if [ "${has_veritas_verdict}" = "false" ]; then
    continue  # Veritas hasn't rendered yet — not gate-ready
  fi

  # --- Check 3: Iris voice review cleared? ---
  # Look for "CLEARED" in the iris line or within checklist text
  has_iris_cleared=false
  if grep -qi "iris.*CLEARED\|iris-voice-review CLEARED\|\[x\].*iris" "${checklist}" 2>/dev/null; then
    has_iris_cleared=true
  fi

  if [ "${has_iris_cleared}" = "false" ]; then
    continue  # Iris hasn't cleared yet — not gate-ready
  fi

  # --- Check 4: Is there an argus report already for this post? ---
  # Cross-reference ~/.argus/reports/ — if a report file mentions this post slug, skip
  if [ -d "${ARGUS_REPORTS}" ]; then
    if grep -rl "${post_slug}" "${ARGUS_REPORTS}" 2>/dev/null | grep -q .; then
      continue  # Argus has a report for this post already
    fi
    # Also check for naming convention: <date>-mercury-gate-<slug>.md
    if ls "${ARGUS_REPORTS}"/*"${post_slug}"* 2>/dev/null | grep -q .; then
      continue
    fi
  fi

  # --- Gate-ready: emit alert ---
  GATE_READY_COUNT=$((GATE_READY_COUNT + 1))

  koad_io_emit_update "auditor-mercury-gate-readiness: GATE READY — ${post_slug} (Iris cleared, Veritas verdict rendered, no Argus gate yet)"

done

koad_io_emit_close "auditor-mercury-gate-readiness: scan complete — ${SCANNED_COUNT} posts scanned, ${GATE_READY_COUNT} gate-ready (awaiting Argus verdict)"
