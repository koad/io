#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
echo $1 $2

DATADIR=$ENTITY_DIR/services/$1
echo $DATADIR
[[ ! -d $DATADIR ]] && echo 'Cannot find specified service, please check your call and try again.'

cd $DATADIR
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64
source .env

TARGET_DATADIR=/home/$KOAD_IO_PROD_USER/.$KOAD_IO_INSTANCE/$KOAD_IO_TYPE\s/$KOAD_IO_DOMAIN

scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa $HOME/.$KOAD_IO_INSTANCE/skel/meteor/scripts/run.production.sh $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/run
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa $HOME/.$KOAD_IO_INSTANCE/skel/meteor/scripts/deploy.production.sh $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/deploy
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa config/production-$KOAD_IO_PROD_HOST.json $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/settings.json
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa config/production-$KOAD_IO_PROD_HOST.env $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_DATADIR/.env
