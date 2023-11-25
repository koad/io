#!/usr/bin/env bash

# Print the arguments received
echo $1 $2

# Get the current date and time
CURRENTDATETIME=`date +"%Y-%m-%d-%H-%M"`


# Assert valid koad:io workspace (DATADIR)
source "$HOME/.koad-io/hooks/assert-datadir.sh"
if [[ -z "$DATADIR" ]]; then
  echo "."
    echo -e "\033[31mkoad/io: unable to find a valid koad:io workspace or fixture\033[0m"
  exit 64
fi

echo "ENTITY: $ENTITY"
echo "LOCAL_BUILD: $LOCAL_BUILD"

echo "entering DATADIR: $DATADIR"
cd $DATADIR

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

# Print the settings being used
echo "Settings: $SETTINGS_FILE";
echo "Listening: $KOAD_IO_BIND_IP:$KOAD_IO_PORT"
echo "App Name: $KOAD_IO_APP_NAME"

# Set the terminal title
echo -ne "\033]0;${ENTITY^} $KOAD_IO_APP_NAME on $HOSTNAME\007"

# Check if the built koad/io application exists
if [[ -f ./builds/latest/bundle/main.js ]] && [[ $LOCAL_BUILD != "true" || ! -v LOCAL_BUILD ]] ; then

    [[ -z "$KOAD_IO_DOMAIN" ]] && echo "KOAD_IO_DOMAIN not set, cannot continue"
    [[ -z "$MONGO_URL" ]] && echo "MONGO_URL not set, cannot continue"

    # Built version exists: set environment variables
    export METEOR_SETTINGS=$(cat $SETTINGS_FILE)
    export ROOT_URL=https://$KOAD_IO_DOMAIN/

    # Start the service
    echo "Starting service $KOAD_IO_DOMAIN"
    cd builds/latest/bundle && BIND_IP=$KOAD_IO_BIND_IP PORT=$KOAD_IO_PORT node main.js

elif [[ -f ./src/.meteor/release ]]; then

    # Developing mode: start the Meteor compiler
    echo "Starting koad-io developer fixture"
    echo "Data directory: $PWD";
    echo "Source: $PWD/src";

    # Start Meteor application in development mode
    cd $PWD/src && meteor --port=$KOAD_IO_BIND_IP:$KOAD_IO_PORT --settings $SETTINGS_FILE

else
    echo -e "\033[31mkoad/io application not found.\033[0m"
fi
