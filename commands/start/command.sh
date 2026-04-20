#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD

source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null

# Lifecycle emission for the start process
koad_io_emit_open service "start: initializing"

# Get the current date and time (down to seconds for log uniqueness)
CURRENTDATETIME=$(date +"%Y-%m-%d-%H-%M-%S")

# Assert valid koad:io workspace (DATADIR)
source "$HOME/.koad-io/commands/assert/datadir/command.sh"

cd $DATADIR

# Parse positional and flag arguments.
# Positional: build type (e.g. "local"). Flags: --local, --attach, --tail.
# The dispatcher exports KOAD_IO_FLAGS with any --flag args stripped from $@,
# but commands can also receive flags directly for backwards compatibility.
#
# --tail       After starting, wait 5s then tail -f the log in the foreground.
# --tail=N     Wait N seconds (or 30s / 2m / 1h) before tailing.
#              Ctrl-C stops the tail — the daemon keeps running in its screen.
#
# Note: the `--tail N` space form is NOT supported because upstream helpers
# (assert/datadir and the dispatcher) strip --tail but then treat N as a
# positional argument, which breaks workspace resolution. Always use the
# equals form when specifying a value.
KOAD_IO_TAIL=""
KOAD_IO_TAIL_WAIT="5"
for _arg in "$@" $KOAD_IO_FLAGS; do
  case "$_arg" in
    --local)   LOCAL_BUILD=true ;;
    --attach)  KOAD_IO_ATTACH=true ;;
    --tail)    KOAD_IO_TAIL=true ;;
    --tail=*)
      KOAD_IO_TAIL=true
      _t="${_arg#--tail=}"
      case "$_t" in
        *s) KOAD_IO_TAIL_WAIT="${_t%s}" ;;
        *m) KOAD_IO_TAIL_WAIT="$(( ${_t%m} * 60 ))" ;;
        *h) KOAD_IO_TAIL_WAIT="$(( ${_t%h} * 3600 ))" ;;
        *)  KOAD_IO_TAIL_WAIT="$_t" ;;
      esac
      ;;
    --*)       ;; # ignore unknown flags
    *)         [[ -z "$KOAD_IO_TYPE" ]] && KOAD_IO_TYPE="$_arg" ;;
  esac
done
unset _arg _t

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

koad_io_emit_update "validated: $KOAD_IO_APP_NAME on $KOAD_IO_BIND_IP:$KOAD_IO_PORT"

# Derive screen session name from DATADIR path
SCREEN_NAME=$(echo "$DATADIR" | sed "s|$HOME/\.||; s|/|-|g")

# Check if already running — screen first, then port
if screen -list | grep -q "$SCREEN_NAME"; then
    echo "Already running: screen -r $SCREEN_NAME"
    echo "Tail log: tail -f $DATADIR/builds/latest/*.log"
    koad_io_emit_close "start: already running (screen $SCREEN_NAME)"
    exit 0
fi

if lsof -i :$KOAD_IO_PORT -sTCP:LISTEN &>/dev/null; then
    echo "Port $KOAD_IO_PORT already in use (no screen found)"
    echo "Check: lsof -i :$KOAD_IO_PORT"
    koad_io_emit_close "start: port $KOAD_IO_PORT already in use"
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
[[ -n "$KOAD_IO_DOMAIN" ]] && export ROOT_URL=https://$KOAD_IO_DOMAIN

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
    koad_io_emit_update "started $KOAD_IO_DOMAIN on :$KOAD_IO_PORT (screen $SCREEN_NAME)"

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
    koad_io_emit_update "started dev on :$KOAD_IO_PORT (screen $SCREEN_NAME)"

else
    echo -e "\033[31mkoad/io application not found.\033[0m"
    koad_io_emit_close "start: application not found in $DATADIR"
    exit 1
fi

# --- Optional tail ------------------------------------------------------
# With --tail, wait for the app to warm up then tail the log in the
# foreground. The screen keeps running after Ctrl-C ends the tail.
if [[ "$KOAD_IO_TAIL" == "true" ]] && [[ "$KOAD_IO_ATTACH" != "true" ]]; then
  echo "Waiting ${KOAD_IO_TAIL_WAIT}s for startup, then tailing ($LOGFILE)..."
  echo "  (Ctrl-C to stop the tail — the daemon keeps running in screen $SCREEN_NAME)"
  sleep "$KOAD_IO_TAIL_WAIT"
  exec tail -F "$LOGFILE"
fi
