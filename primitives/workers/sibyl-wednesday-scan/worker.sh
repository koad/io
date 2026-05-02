#!/usr/bin/env bash
# PRIMITIVE: sibyl-wednesday-scan
# KIND: worker
# INTERVAL: 10080 (minutes — 7 days)
# DELAY: 0
# RUN_IMMEDIATELY: false
#
# Purpose: Researcher role weekly external behavior scan. Runs Sibyl's
#          Wednesday research scan (hooks/wednesday-scan.sh) and wraps the
#          run in a service lifecycle emission (open -> update -> close).
#
# Schedule: Every Wednesday at 10:00 local. The daemon worker-loader enforces
#           day-of-week gating. Until the loader exists, use the screen-loop
#           interim path documented in ~/.sibyl/workers/README.md.
#
# Roles: researcher only
#
# Idempotent: scan hook is read-only; produces one dated brief per run.
#             No destructive side effects.
#
# Env vars expected:
#   ENTITY           — entity handle (used in emission bodies)
#   KOAD_IO_EMIT     — 1 to enable emission, 0/unset to skip
#   ENTITY_DIR       — entity home dir (set by daemon to ~/.sibyl)

set -euo pipefail

ENTITY_DIR="${ENTITY_DIR:-$HOME/.sibyl}"
HOOK="$ENTITY_DIR/hooks/wednesday-scan.sh"

source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null || true

koad_io_emit_open service "sibyl-wednesday-scan: starting weekly external behavior scan"

if [ ! -x "$HOOK" ]; then
  koad_io_emit_close "sibyl-wednesday-scan: hook not found or not executable at $HOOK — skipping"
  exit 0
fi

# Day-of-week gate: Wednesday only (3=Wed)
DOW="$(date +%u)"
if [ "$DOW" -ne 3 ]; then
  koad_io_emit_close "sibyl-wednesday-scan: not Wednesday (day $DOW) — skipping"
  exit 0
fi

koad_io_emit_update "sibyl-wednesday-scan: running hook"

set +e
bash "$HOOK" >> "$ENTITY_DIR/LOGS/wednesday-scan.log" 2>&1
HOOK_EXIT=$?
set -e

if [ "$HOOK_EXIT" -eq 0 ]; then
  koad_io_emit_close "sibyl-wednesday-scan: scan complete"
else
  koad_io_emit_close "sibyl-wednesday-scan: hook exited $HOOK_EXIT — see LOGS/wednesday-scan.log"
fi
