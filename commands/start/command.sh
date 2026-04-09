#!/usr/bin/env bash

# Get the current date and time (down to seconds for log uniqueness)
CURRENTDATETIME=$(date +"%Y-%m-%d-%H-%M-%S")

# Assert valid koad:io workspace (DATADIR)
source "$HOME/.koad-io/commands/assert/datadir/command.sh"

cd $DATADIR
[[ -n "$1" ]] && KOAD_IO_TYPE=$1

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

# Set up log file in the build's folder
LOGDIR="$DATADIR/builds/latest"
LOGFILE="$LOGDIR/$CURRENTDATETIME.log"
echo "Screen: $SCREEN_NAME"
echo "Log: $LOGFILE"

# Check if the built koad/io application exists
if [[ -f ./builds/latest/bundle/main.js ]] && [[ $LOCAL_BUILD != "true" || ! -v LOCAL_BUILD ]] ; then

    [[ -z "$KOAD_IO_DOMAIN" ]] && echo "KOAD_IO_DOMAIN not set, cannot continue"
    [[ -z "$MONGO_URL" ]] && echo "MONGO_URL not set, cannot continue"

    # Built version exists: set environment variables
    export METEOR_SETTINGS=$(cat $SETTINGS_FILE)
    export ROOT_URL=https://$KOAD_IO_DOMAIN/

    # Start the service
    echo "Starting service $KOAD_IO_DOMAIN"
    cd builds/latest/bundle
    screen -dmS "$SCREEN_NAME" bash -c "BIND_IP=$KOAD_IO_BIND_IP PORT=$KOAD_IO_PORT node main.js 2>&1 | tee \"$LOGFILE\""
    echo "Started in screen: $SCREEN_NAME"

elif [[ -f ./src/.meteor/release ]]; then

    # Developing mode: start the Meteor compiler
    echo "Starting koad-io developer fixture"
    echo "Data directory: $PWD";
    echo "Source: $PWD/src";
    echo "-"

    # Start Meteor application in development mode
    cd $PWD/src
    meteor npm install
    screen -dmS "$SCREEN_NAME" bash -c "meteor --port=$KOAD_IO_BIND_IP:$KOAD_IO_PORT --settings $SETTINGS_FILE 2>&1 | tee \"$LOGFILE\""
    echo "Started in screen: $SCREEN_NAME"

else
    echo -e "\033[31mkoad/io application not found.\033[0m"
fi
