#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Restart = stop (if running) + start. Graceful when the session isn't running.
# Both sub-commands re-source assert/datadir; we pass "$@" through so flags
# like --local / --attach propagate to start.

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
