#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
echo $1 $2

KOAD_IO_DOMAIN=$1
DATADIR=$ENTITY_DIR/sites/$KOAD_IO_DOMAIN
ENTITY=${ENTITY,,}

echo $DATADIR
[[ ! -d $DATADIR ]] && echo 'Cannot find specified site, please check your call and try again.'

cd $DATADIR
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64
source .env

[[ -z "$KOAD_IO_SKELETON" ]] && KOAD_IO_SKELETON="meteor"

SSH_KEY_PATH=""
if [ -f "$ENTITY_DIR/id/ed25519" ]; then
    SSH_KEY_PATH="$ENTITY_DIR/id/ed25519"
elif [ -f "$ENTITY_DIR/id/rsa" ]; then
    SSH_KEY_PATH="$ENTITY_DIR/id/rsa"
else
    echo "No valid SSH key found in $ENTITY_DIR/id"
    exit 1
fi

required_vars=("KOAD_IO_PROD_HOST" "KOAD_IO_APP_NAME" "KOAD_IO_SKELETON")
missing_vars=()
for var in "${required_vars[@]}"; do
  if [[ -z "${!var}" ]]; then
    missing_vars+=("$var")
  fi
done

if [[ ${#missing_vars[@]} -gt 0 ]]; then
  echo "The following required variables are not set:"
  for var in "${missing_vars[@]}"; do
    echo "$var"
  done
  echo "Exiting..."
  exit 64
fi

# Print the settings being used
echo "App Name: $KOAD_IO_APP_NAME"
echo "App Skeleton: $KOAD_IO_SKELETON"

TARGET_DATADIR=/home/$ENTITY/.sites/$KOAD_IO_DOMAIN;
echo "TARGET_DATADIR=$TARGET_DATADIR";

TARGET=$ENTITY@$KOAD_IO_PROD_HOST:$TARGET_DATADIR
echo "TARGET=$TARGET"

SKELETON_FOLDER=$HOME/.koad-io/skeletons/$KOAD_IO_SKELETON

[ ! -f scripts/run.production.sh ] && [ ! -f $SKELETON_FOLDER/scripts/run.production.sh ] && echo "run.production.sh not exists!" && export ENDINFAILURE=true
[ ! -f scripts/deploy.production.sh ] && [ ! -f $SKELETON_FOLDER/scripts/deploy.production.sh ] && echo "deploy.production.sh not exists!" && export ENDINFAILURE=true

[ ! -f config/$KOAD_IO_PROD_HOST.json ] && echo "config/$KOAD_IO_PROD_HOST.json not exists!" && export ENDINFAILURE=true
[ ! -f config/$KOAD_IO_PROD_HOST.env ] && echo "config/$KOAD_IO_PROD_HOST.env not exists!" && export ENDINFAILURE=true

[ $ENDINFAILURE ] && exit 32

echo "ensuring directory exists: $TARGET_DATADIR"
ssh  -i $SSH_KEY_PATH $ENTITY@$KOAD_IO_PROD_HOST "mkdir -p $TARGET_DATADIR"

echo "placing files,.."

if [[ ! -f scripts/run.production.sh ]] 
then
	echo "$SKELETON_FOLDER/scripts/run.production.sh >> $TARGET/run"
	scp -i $SSH_KEY_PATH $SKELETON_FOLDER/scripts/run.production.sh $TARGET/run
else
	echo "./scripts/run.production.sh >> $TARGET/run"
	scp -i $SSH_KEY_PATH scripts/run.production.sh $TARGET/run
fi

if [[ ! -f scripts/deploy.production.sh ]] 
then
	echo "$SKELETON_FOLDER/scripts/deploy.production.sh >> $TARGET/deploy"
	scp -i $SSH_KEY_PATH $SKELETON_FOLDER/scripts/deploy.production.sh $TARGET/deploy
else
	echo "./scripts/deploy.production.sh >> $TARGET/deploy"
	scp -i $SSH_KEY_PATH scripts/deploy.production.sh $TARGET/deploy
fi

echo "./config/$KOAD_IO_PROD_HOST.json >> $TARGET/.json"
scp -i $SSH_KEY_PATH config/$KOAD_IO_PROD_HOST.json $TARGET/.json

echo "./config/$KOAD_IO_PROD_HOST.env >> $TARGET/.env"
scp -i $SSH_KEY_PATH config/$KOAD_IO_PROD_HOST.env $TARGET/.env

echo 'running deployment script on host,..'
echo "koad-io: running deploy script on host '$KOAD_IO_PROD_HOST'"
echo "--remote-exec:$KOAD_IO_PROD_HOST > $TARGET_DATADIR && ./deploy"
ssh -i $SSH_KEY_PATH -l $ENTITY $KOAD_IO_PROD_HOST "source /home/$ENTITY/.nvm/nvm.sh && cd $TARGET_DATADIR && ./deploy"

echo 'done,..'
