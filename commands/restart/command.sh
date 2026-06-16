#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Restart = stop (if running) + start. Graceful when the session isn't running.
# Both sub-commands re-source assert/datadir; we pass "$@" through so flags
# like --local / --attach propagate to start.
#
# When DISPLAY is unavailable (headless / harness / non-interactive), falls
# back to the daemon's POST /api/service/restart endpoint.

# ── Daemon fallback (no DISPLAY) ──────────────────────────────────────
if [[ -z "${DISPLAY:-}" ]]; then
  SERVICE_NAME="${1:-}"
  if [[ -z "$SERVICE_NAME" ]]; then
    echo "restart: service name required (headless mode)" >&2
    exit 1
  fi

  DAEMON_URL="${KOAD_IO_CONTROL_URL:-http://${KOAD_IO_BIND_IP:-10.10.10.10}:${KOAD_IO_CONTROL_PORT:-28283}}"
  echo "restart: headless → ${DAEMON_URL}/api/service/restart (${SERVICE_NAME})"

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${DAEMON_URL}/api/service/restart" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${SERVICE_NAME}\"}" \
    --max-time 10 2>&1)

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" -ge 200 ]] && [[ "$HTTP_CODE" -lt 300 ]]; then
    echo "✓ restarted ${SERVICE_NAME}"
    exit 0
  else
    echo "✗ restart failed: ${HTTP_CODE} ${BODY}" >&2
    exit 1
  fi
fi

# ── Interactive path (DISPLAY available) ──────────────────────────────
echo "Restarting..."
echo "-"

"$HOME/.koad-io/commands/stop/command.sh" "$@"
STOP_EXIT=$?

# Only bail on hard stop failures; "not running" exits 0 and is fine.
if [[ $STOP_EXIT -ne 0 ]]; then
    echo -e "\033[31mStop failed (exit $STOP_EXIT); aborting restart\033[0m"
    exit $STOP_EXIT
fi

echo "-"
exec "$HOME/.koad-io/commands/start/command.sh" "$@"
