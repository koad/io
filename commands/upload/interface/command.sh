#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
echo $1 $2

DATADIR=$ENTITY_DIR/interface
echo $DATADIR
[[ ! -d $DATADIR ]] && echo 'Cannot find specified service, please check your call and try again.'

cd $DATADIR
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64

source .env

KOAD_IO_SOURCE=$USERNAME-on-$HOSTNAME
echo "KOAD_IO_SOURCE: $KOAD_IO_SOURCE";

TARGET_DATADIR=/home/$KOAD_IO_INSTANCE/.interface
TARGET_INBOUND=$TARGET_DATADIR/builds/inbound/$KOAD_IO_SOURCE

echo "TARGET_DATADIR=$TARGET_DATADIR";
echo "TARGET_INBOUND=$TARGET_DATADIR/builds/inbound/$KOAD_IO_SOURCE";
echo "sending build-pack to $KOAD_IO_INSTANCE on $KOAD_IO_PROD_HOST";
echo "> $TARGET_INBOUND/src.tar.gz"

FILESIZE=$(stat -c%s "builds/latest/src.tar.gz")
echo "built bundle is `echo ${FILESIZE}/1024/1024 | bc` megabytes"

ssh -i $HOME/.$KOAD_IO_INSTANCE/id/rsa $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST "mkdir -p $TARGET_INBOUND"
scp -i $HOME/.$KOAD_IO_INSTANCE/id/rsa builds/latest/src.tar.gz $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_INBOUND/
