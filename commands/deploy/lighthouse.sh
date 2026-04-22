#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
echo $1 $2

KOAD_IO_TYPE=lighthouse
DATADIR=$ENTITY_DIR/lighthouse

echo $DATADIR
[[ ! -d $DATADIR ]] && echo 'Cannot find specified site, please check your call and try again.'

cd $DATADIR
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64
source .env

[[ $1 ]] && KOAD_IO_PROD_HOST=$1 
echo "KOAD_IO_PROD_HOST=$KOAD_IO_PROD_HOST"

[[ ! $KOAD_IO_PROD_USER ]] && KOAD_IO_PROD_USER=$ENTITY 
echo "KOAD_IO_PROD_USER=$KOAD_IO_PROD_USER"

TARGET_DATADIR=/home/$KOAD_IO_PROD_USER/.$ENTITY/lighthouse;
echo "TARGET_DATADIR=$TARGET_DATADIR";

[ ! -f scripts/run.production.sh ] && echo "./scripts/run.production.sh not exists!" && export ENDINFAILURE=true
[ ! -f scripts/deploy.production.sh ] && echo "./scripts/deploy.production.sh not exists!" && export ENDINFAILURE=true
[ ! -f config/$KOAD_IO_PROD_HOST.json ] && echo "config/$KOAD_IO_PROD_HOST.json not exists!" && export ENDINFAILURE=true
[ ! -f config/$KOAD_IO_PROD_HOST.env ] && echo "config/$KOAD_IO_PROD_HOST.env not exists!" && export ENDINFAILURE=true

[ $ENDINFAILURE ] && exit 32



echo "making target directory,.."
ssh -i $ENTITY_DIR/id/rsa $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST "mkdir -p $TARGET_DATADIR"

echo "placing files,.."
# echo "./scripts/run.production.sh >> $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/run"
scp -i $ENTITY_DIR/id/rsa scripts/run.production.sh $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/run

# echo "./scripts/deploy.production.sh >> $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/deploy"
scp -i $ENTITY_DIR/id/rsa scripts/deploy.production.sh $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/deploy

# echo "./config/$KOAD_IO_PROD_HOST.json >> $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/settings.json"
scp -i $ENTITY_DIR/id/rsa config/$KOAD_IO_PROD_HOST.json $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/settings.json

# echo "./config/$KOAD_IO_PROD_HOST.env >> $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/.env"
scp -i $ENTITY_DIR/id/rsa config/$KOAD_IO_PROD_HOST.env $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/.env

echo 'done,..'

echo "this command 'deploy' only needs to ran once, each time you update and of the files listed above." 
echo "you can now send your build to $KOAD_IO_PROD_HOST";
echo "example:";
echo "$ENTITY upload lighthouse $KOAD_IO_PROD_HOST ";