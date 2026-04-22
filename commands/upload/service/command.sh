#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
echo $1 $2

DATADIR=$ENTITY_DIR/services/$1
echo $DATADIR
[[ ! -d $DATADIR ]] && 'Cannot find specified service, please check your call and try again.'

cd $DATADIR
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64

source .env

TARGET_DATADIR=/home/$KOAD_IO_PROD_USER/.$KOAD_IO_INSTANCE/$KOAD_IO_TYPE\s/$KOAD_IO_DOMAIN
TARGET_INBOUND=$TARGET_DATADIR/builds/inbound/$KOAD_IO_SOURCE

echo "sending build-pack to $KOAD_IO_INSTANCE on $KOAD_IO_PROD_HOST";
echo "> $TARGET_INBOUND";

ssh -i $HOME/.$KOAD_IO_INSTANCE/id/rsa $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST "mkdir -p $TARGET_INBOUND"
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa builds/latest/src.tar.gz $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_INBOUND/
