#!/usr/bin/env bash
# ~/.koad-io/commands/shell/command.sh

# Parse arguments
USE_TERMINAL=false
if [[ "$1" == "--terminal" ]]; then
  USE_TERMINAL=true
fi

# Check if KOAD_IO_SHELL_DIRECTORY is set, otherwise use the 'daemon' directory
SHELL_DIRECTORY="$ENTITY_DIR/daemon"
[[ -v KOAD_IO_SHELL_DIRECTORY ]] && SHELL_DIRECTORY="$ENTITY_DIR/$KOAD_IO_SHELL_DIRECTORY"

# Check if the specified shell directory exists
if [ ! -d "$SHELL_DIRECTORY" ]; then
  echo -e "\033[31mThe specified shell directory does not exist: $SHELL_DIRECTORY\033[0m"
  [[ ! -v KOAD_IO_SHELL_DIRECTORY ]] && echo -e "\033[31mYou can set the 'KOAD_IO_SHELL_DIRECTORY' environment variable to specify a different shell directory.\033[0m"
  exit 1
fi

# Define the shell to use
SHELL_TO_USE="${ENTITY_SHELL:-${SHELL:-/bin/bash}}"

# Check if there's a Meteor app in the src directory
METEOR_APP_EXISTS=false
if [ -d "$SHELL_DIRECTORY/src/.meteor" ] && [ -f "$SHELL_DIRECTORY/src/.meteor/release" ]; then
  METEOR_APP_EXISTS=true
fi

# Decide which shell to launch
if [ "$METEOR_APP_EXISTS" = true ] && [ "$USE_TERMINAL" = false ]; then
  # Change to the src directory and start Meteor shell
  cd "$SHELL_DIRECTORY/src"
  echo "Starting Meteor shell in $SHELL_DIRECTORY/src"
  exec meteor shell
else
  # Use the regular shell
  cd "$SHELL_DIRECTORY/src" 2>/dev/null || cd "$SHELL_DIRECTORY"
  echo "Starting $SHELL_TO_USE"
  exec "$SHELL_TO_USE"
fi
