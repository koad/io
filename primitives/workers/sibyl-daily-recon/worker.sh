#!/usr/bin/env bash
# PRIMITIVE: sibyl-daily-recon
# KIND: worker
# INTERVAL: 1440 (minutes — 24h)
# DELAY: 0
# RUN_IMMEDIATELY: false
#
# Purpose: Researcher role daily recon worker. Runs Sibyl's morning
#          intelligence sweep (hooks/daily-recon.sh) and wraps the run in a
#          service lifecycle emission (open -> update -> close).
#
# Schedule: M-F at 09:00 local time. The daemon worker-loader is responsible
#           for enforcing day-of-week gating when it invokes this script.
#           Until the loader exists, use the screen-loop interim path documented
#           in ~/.sibyl/workers/README.md.
#
# Roles: researcher only
#
# Idempotent: recon hook is read-only; repeated runs accumulate signal briefs,
#             each dated. No destructive side effects.
#
# Env vars expected:
#   ENTITY           — entity handle (used in emission bodies)
#   KOAD_IO_EMIT     — 1 to enable emission, 0/unset to skip
#   ENTITY_DIR       — entity home dir (set by daemon to ~/.sibyl)

set -euo pipefail

ENTITY_DIR="${ENTITY_DIR:-$HOME/.sibyl}"
HOOK="$ENTITY_DIR/hooks/daily-recon.sh"

source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null || true

koad_io_emit_open service "sibyl-daily-recon: starting morning intelligence sweep"

if [ ! -x "$HOOK" ]; then
  koad_io_emit_close "sibyl-daily-recon: hook not found or not executable at $HOOK — skipping"
  exit 0
fi

# Day-of-week gate: M-F only (1=Mon ... 5=Fri)
DOW="$(date +%u)"
if [ "$DOW" -gt 5 ]; then
  koad_io_emit_close "sibyl-daily-recon: weekend — skipping (day $DOW)"
  exit 0
fi

koad_io_emit_update "sibyl-daily-recon: running hook"

# Run the recon hook; capture exit code without aborting (hook may fail gracefully)
set +e
bash "$HOOK" >> "$ENTITY_DIR/LOGS/daily-recon.log" 2>&1
HOOK_EXIT=$?
set -e

if [ "$HOOK_EXIT" -eq 0 ]; then
  koad_io_emit_close "sibyl-daily-recon: sweep complete"
else
  koad_io_emit_close "sibyl-daily-recon: hook exited $HOOK_EXIT — see LOGS/daily-recon.log"
fi
