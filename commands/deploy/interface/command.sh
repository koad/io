#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
echo $1 $2

DATADIR=$ENTITY_DIR/interface
echo $DATADIR
[[ ! -d $DATADIR ]] && echo 'Cannot find specified site, please check your call and try again.'

cd $DATADIR
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64

source .env

TARGET_DATADIR=/home/$KOAD_IO_PROD_USER/.$KOAD_IO_INSTANCE/interface

scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa $HOME/.koad-io/skeletons/interface/scripts/run.production.sh $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/run
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa $HOME/.koad-io/skeletons/interface/scripts/deploy.production.sh $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/deploy
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa config/production-$KOAD_IO_PROD_HOST.json $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/settings.json
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa config/production-$KOAD_IO_PROD_HOST.env $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/.env
