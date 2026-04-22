#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
start=`date +%s`

echo $1 $2 $3 $4 $5 $6
CURRENTDATETIME=`date +"%Y-%m-%d-%H-%M"`
source .env


KOAD_IO_PROD_HOST=$1
KOAD_IO_UNUSED=$2 $3 $4 $5 $6
DATADIR=$ENTITY_DIR/lighthouse

echo $DATADIR
[[ ! -d $DATADIR ]] && echo 'Cannot find specified service, please check your call and try again.'

cd $DATADIR
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64


[[ -z "${KOAD_IO_PROD_HOST}" ]] && echo 'KOAD_IO_PROD_HOST var not set' && exit 64
[[ -z "${ENTITY}" ]] && echo 'ENTITY var not set' && exit 64

[[ -z "${USERNAME}" ]] && echo 'USERNAME var not set' && exit 64
[[ -z "${HOSTNAME}" ]] && echo 'HOSTNAME var not set' && exit 64

KOAD_IO_SOURCE=$USERNAME-on-$HOSTNAME
echo "KOAD_IO_SOURCE: $KOAD_IO_SOURCE";

[[ -z "${KOAD_IO_SOURCE}" ]] && echo 'KOAD_IO_SOURCE var not set' && exit 64

[[ -z "${KOAD_IO_PROD_USER}" ]] && KOAD_IO_PROD_USER=$ENTITY
[[ -z "${KOAD_IO_PROD_USER}" ]] && echo 'KOAD_IO_PROD_USER var not set' && exit 64
[[ -z "${KOAD_IO_PROD_HOST}" ]] && echo 'KOAD_IO_PROD_HOST var not set' && exit 64

TARGET_DATADIR=/home/$KOAD_IO_PROD_USER/.$ENTITY/lighthouse
TARGET_INBOUND=$TARGET_DATADIR/builds/inbound/$KOAD_IO_SOURCE

echo "TARGET_DATADIR=$TARGET_DATADIR";
echo "TARGET_INBOUND=$TARGET_INBOUND";
echo "sending build-pack to $ENTITY on $KOAD_IO_PROD_HOST";
echo "> $TARGET_INBOUND/src.tar.gz"

FILESIZE=$(stat -c%s "builds/latest/src.tar.gz")
echo "built bundle is `echo ${FILESIZE}/1024/1024 | bc` megabytes"

ssh -i $ENTITY_DIR/id/rsa $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST "mkdir -p $TARGET_INBOUND"
scp -i $ENTITY_DIR/id/rsa builds/latest/src.tar.gz $KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_INBOUND/
