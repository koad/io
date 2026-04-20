#!/usr/bin/env bash
# PRIMITIVE: tickler-scan
# KIND: worker
# INTERVAL: 60 (minutes)
# DELAY: 0
# RUN_IMMEDIATELY: false
#
# Purpose: Orchestrator role tickler worker. Runs the entity's tickler scan
#          command on a 60-minute schedule and wraps the run in a service
#          lifecycle emission (open → update with count → close). Formalizes
#          what Juno already does ad-hoc, so every orchestrator entity gets
#          the same baseline tickler coverage.
#
# Roles: orchestrator only
#
# Idempotent: tickler scan is read-only; repeated runs produce no accumulating
#             side effects beyond log entries within the tickler system itself.
#
# Env vars expected:
#   ENTITY           — entity handle (used in emission bodies)
#   KOAD_IO_EMIT     — 1 to enable emission, 0/unset to skip
#   HOME             — entity home dir

set -euo pipefail

source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null || true

koad_io_emit_open service "tickler-scan: starting scan for ${ENTITY:-unknown}"

# Locate the entity's tickler command — look for the canonical command path
TICKLER_CMD=""
if [ -x "$HOME/.koad-io/commands/tickler/scan/command.sh" ]; then
  TICKLER_CMD="$HOME/.koad-io/commands/tickler/scan/command.sh"
elif command -v tickler >/dev/null 2>&1; then
  TICKLER_CMD="tickler scan"
fi

if [ -z "$TICKLER_CMD" ]; then
  koad_io_emit_close "tickler-scan: no tickler command found — skipping"
  exit 0
fi

# Run the scan and capture output
SCAN_OUTPUT="$(bash -c "$TICKLER_CMD" 2>&1 || true)"

# Count actionable items (lines that look like tickle entries)
ITEM_COUNT="$(printf '%s\n' "$SCAN_OUTPUT" | grep -c '^\[' 2>/dev/null || echo 0)"

koad_io_emit_update "tickler-scan: found ${ITEM_COUNT} tickle(s) for ${ENTITY:-unknown}"

koad_io_emit_close "tickler-scan: complete — ${ITEM_COUNT} item(s)"
