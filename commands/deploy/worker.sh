#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
echo $1 $2

DATADIR=$ENTITY_DIR/workers/$1
echo $DATADIR
[[ ! -d $DATADIR ]] && 'Cannot find specified service, please check your call and try again.'

cd $DATADIR
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64
source .env

TARGET_DATADIR=/home/$KOAD_IO_PROD_USER/.$KOAD_IO_INSTANCE/workers/$1

echo "TARGET_DATADIR=$TARGET_DATADIR"
exit
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa $HOME/.koad-io/skeletons/worker/scripts/run.sh $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/run
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa $HOME/.koad-io/skeletons/worker/scripts/deploy.sh $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/deploy

scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa config/$KOAD_IO_PROD_HOST/settings.json $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/settings.json
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa config/$KOAD_IO_PROD_HOST/.env $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/.env
