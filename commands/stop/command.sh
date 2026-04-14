#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Assert valid koad:io workspace (DATADIR)
source "$HOME/.koad-io/commands/assert/datadir/command.sh"

cd $DATADIR

# Parse flags (kept in parity with start/command.sh so invocations are symmetric).
# The dispatcher exports KOAD_IO_FLAGS with any --flag args stripped from $@.
for _arg in "$@" $KOAD_IO_FLAGS; do
  case "$_arg" in
    --*)      ;; # ignore unknown flags
    *)        [[ -z "$KOAD_IO_TYPE" ]] && KOAD_IO_TYPE="$_arg" ;;
  esac
done
unset _arg

# Derive screen session name from DATADIR path — must match start/command.sh
SCREEN_NAME=$(echo "$DATADIR" | sed "s|$HOME/\.||; s|/|-|g")

echo "App Name: $KOAD_IO_APP_NAME"
echo "Screen: $SCREEN_NAME"

# Is the session actually running?
if ! screen -list | grep -q "\.${SCREEN_NAME}[[:space:]]"; then
    echo "Not running (no screen session: $SCREEN_NAME)"
    exit 0
fi

# Ask screen to quit the session
screen -X -S "$SCREEN_NAME" quit

# Confirm it's gone
sleep 1
if screen -list | grep -q "\.${SCREEN_NAME}[[:space:]]"; then
    echo -e "\033[31mFailed to stop: $SCREEN_NAME still listed\033[0m"
    echo "Try: screen -X -S $SCREEN_NAME quit"
    exit 1
fi

echo -e "\033[0;32mStopped: $SCREEN_NAME\033[0m"
