#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD

# Get the current date and time (down to seconds for log uniqueness)
CURRENTDATETIME=$(date +"%Y-%m-%d-%H-%M-%S")

# Assert valid koad:io workspace (DATADIR)
source "$HOME/.koad-io/commands/assert/datadir/command.sh"

cd $DATADIR

# Parse positional and flag arguments.
# Positional: build type (e.g. "local"). Flags: --local, --attach.
# The dispatcher exports KOAD_IO_FLAGS with any --flag args stripped from $@,
# but commands can also receive flags directly for backwards compatibility.
for _arg in "$@" $KOAD_IO_FLAGS; do
  case "$_arg" in
    --local)  LOCAL_BUILD=true ;;
    --attach) KOAD_IO_ATTACH=true ;;
    --*)      ;; # ignore unknown flags
    *)        [[ -z "$KOAD_IO_TYPE" ]] && KOAD_IO_TYPE="$_arg" ;;
  esac
done
unset _arg

# "local" as a positional arg also sets LOCAL_BUILD, and vice versa
[[ "$KOAD_IO_TYPE" == "local" ]] && LOCAL_BUILD=true
[[ "$LOCAL_BUILD" == "true" ]] && [[ -z "$KOAD_IO_TYPE" ]] && KOAD_IO_TYPE=local

# Array of required variables
required_vars=("KOAD_IO_BIND_IP" "KOAD_IO_PORT" "KOAD_IO_APP_NAME" "KOAD_IO_TYPE")

# Check if required variables are empty
missing_vars=()
for var in "${required_vars[@]}"; do
  if [[ -z "${!var}" ]]; then
    missing_vars+=("$var")
  fi
done

# If any required variable is missing, inform the user and exit
if [[ ${#missing_vars[@]} -gt 0 ]]; then
  echo "The following required variables are not set:"
  for var in "${missing_vars[@]}"; do
    echo "$var"
  done
  echo "Exiting..."
  exit 64
fi

# Set default settings file
[[ ! $SETTINGS_FILE ]] && SETTINGS_FILE="$PWD/config/$HOSTNAME.json";
[[ ! -f $SETTINGS_FILE ]] && echo "settings file not found: $SETTINGS_FILE" && exit 65

# Check if DB_HOST and DB_PORT are set
if [[ -z "$DB_HOST" || -z "$DB_PORT" ]]; then
  echo "DB_HOST or DB_PORT is not set. Skipping MongoDB check."
else
  echo "Waiting for MongoDB at $DB_HOST:$DB_PORT to be available..."

  # Loop until MongoDB responds
  while ! nc -z "$DB_HOST" "$DB_PORT"; do
    sleep 1
  done

  echo "MongoDB is now available!"
fi

# Print the settings being used
echo "Settings: $SETTINGS_FILE";
echo "Listening: $KOAD_IO_BIND_IP:$KOAD_IO_PORT"
echo "App Name: $KOAD_IO_APP_NAME"

# Derive screen session name from DATADIR path
SCREEN_NAME=$(echo "$DATADIR" | sed "s|$HOME/\.||; s|/|-|g")

# Check if already running — screen first, then port
if screen -list | grep -q "$SCREEN_NAME"; then
    echo "Already running: screen -r $SCREEN_NAME"
    echo "Tail log: tail -f $DATADIR/builds/latest/*.log"
    exit 0
fi

if lsof -i :$KOAD_IO_PORT -sTCP:LISTEN &>/dev/null; then
    echo "Port $KOAD_IO_PORT already in use (no screen found)"
    echo "Check: lsof -i :$KOAD_IO_PORT"
    exit 1
fi

# Set the terminal title
echo -ne "\033]0;$ENTITY $KOAD_IO_APP_NAME on $HOSTNAME\007"

# Set up log directory.
# Production: logs live alongside the built bundle in builds/latest/
# Local dev: logs go to logs/ at project root (no build exists yet)
if [[ "$LOCAL_BUILD" == "true" ]]; then
    LOGDIR="$DATADIR/logs"
else
    LOGDIR="$DATADIR/builds/latest"
fi
mkdir -p "$LOGDIR"
LOGFILE="$LOGDIR/$CURRENTDATETIME.log"
echo "Screen: $SCREEN_NAME"
echo "Log: $LOGFILE"

# Decide screen mode: detached by default, attached with --attach
if [[ "$KOAD_IO_ATTACH" == "true" ]]; then
    SCREEN_CMD="screen -S"
else
    SCREEN_CMD="screen -dmS"
fi

# If KOAD_IO_DOMAIN is set, fix ROOT_URL to the canonical HTTPS domain so
# Meteor.absoluteUrl() returns the correct value in all run modes.
# Without this, dev mode falls back to the passenger/.env default of
# http://<bind-ip>:<port>/, which breaks GitHub OAuth redirect_uri.
[[ -n "$KOAD_IO_DOMAIN" ]] && export ROOT_URL=https://$KOAD_IO_DOMAIN/

# Check if the built koad/io application exists
if [[ -f ./builds/latest/bundle/main.js ]] && [[ "$LOCAL_BUILD" != "true" ]]; then

    [[ -z "$KOAD_IO_DOMAIN" ]] && echo "KOAD_IO_DOMAIN not set, cannot continue" && exit 1
    [[ -z "$MONGO_URL" ]] && echo "MONGO_URL not set, cannot continue" && exit 1

    # Built version exists: set environment variables
    export METEOR_SETTINGS=$(cat $SETTINGS_FILE)

    # Start the service
    echo "Starting service $KOAD_IO_DOMAIN"
    cd builds/latest/bundle
    $SCREEN_CMD "$SCREEN_NAME" bash -c "BIND_IP=$KOAD_IO_BIND_IP PORT=$KOAD_IO_PORT node main.js 2>&1 | tee \"$LOGFILE\""
    [[ "$KOAD_IO_ATTACH" != "true" ]] && echo "Started in screen: $SCREEN_NAME"

elif [[ -f ./src/.meteor/release ]]; then

    # Development mode: start the Meteor compiler inside a screen
    echo "Starting koad-io developer fixture"
    echo "Data directory: $PWD"
    echo "Source: $PWD/src"
    echo "-"

    cd $PWD/src
    meteor npm install
    $SCREEN_CMD "$SCREEN_NAME" bash -c "cd \"$PWD\" && meteor --port=$KOAD_IO_BIND_IP:$KOAD_IO_PORT --settings $SETTINGS_FILE 2>&1 | tee \"$LOGFILE\""
    [[ "$KOAD_IO_ATTACH" != "true" ]] && echo "Started in screen: $SCREEN_NAME" && echo "Tail log: tail -f $LOGFILE"

else
    echo -e "\033[31mkoad/io application not found.\033[0m"
fi
