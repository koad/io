#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD

KOAD_IO_PROD_DOMAIN=$1
DATADIR="$ENTITY_DIR/sites/$KOAD_IO_PROD_DOMAIN"
ENTITY=${ENTITY,,}
KOAD_IO_ENTITY=${ENTITY,,}

echo "KOAD_IO_ENTITY:$KOAD_IO_ENTITY"
echo "KOAD_IO_PROD_DOMAIN:$KOAD_IO_PROD_DOMAIN"
echo "DATADIR:$DATADIR"
[[ ! -d $DATADIR ]] && echo 'Cannot find specified service, please check your call and try again.'

cd "$DATADIR" || { echo "Failed to change directory. Exiting."; exit 1; }
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64
[ -f ./.env ] && echo "loading ./.env" && set -a && source ./.env 

if [ -n "$KOAD_IO_PROD_ENTITY" ]; then
    ENTITY_DIR="$HOME/.$KOAD_IO_PROD_ENTITY"
fi
echo "KOAD_IO_PROD_ENTITY:$KOAD_IO_PROD_ENTITY"
echo "ENTITY_DIR:$ENTITY_DIR"








echo $DATADIR
[[ ! -d $DATADIR ]] && echo 'Cannot find specified service, please check your call and try again.'

cd "$DATADIR" || { echo "Failed to change directory. Exiting."; exit 1; }
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64

source .env

[[ -z "${KOAD_IO_PROD_DOMAIN}" ]] && echo 'KOAD_IO_PROD_DOMAIN var not set' && exit 64
[[ -z "${ENTITY}" ]] && echo 'ENTITY var not set' && exit 64

[[ -z "${USERNAME}" ]] && echo 'USERNAME var not set' && exit 64
[[ -z "${HOSTNAME}" ]] && echo 'HOSTNAME var not set' && exit 64

KOAD_IO_SOURCE=$USERNAME-on-$HOSTNAME
echo "KOAD_IO_SOURCE: $KOAD_IO_SOURCE";

[[ -z "${KOAD_IO_SOURCE}" ]] && echo 'KOAD_IO_SOURCE var not set' && exit 64

[[ -z "${KOAD_IO_PROD_USER}" ]] && KOAD_IO_PROD_USER=$ENTITY
[[ -z "${KOAD_IO_PROD_USER}" ]] && echo 'KOAD_IO_PROD_USER var not set' && exit 64
echo "KOAD_IO_PROD_USER: $KOAD_IO_PROD_USER";

[[ -z "${KOAD_IO_PROD_HOST}" ]] && echo 'KOAD_IO_PROD_HOST var not set' && exit 64
echo "KOAD_IO_PROD_HOST: $KOAD_IO_PROD_HOST";


TARGET_DATADIR="/home/$KOAD_IO_PROD_USER/.sites/$KOAD_IO_PROD_DOMAIN"
[[ -n "${KOAD_IO_PROD_DEST}" ]] && TARGET_DATADIR=$KOAD_IO_PROD_DEST
echo "TARGET_DATADIR:$TARGET_DATADIR"

TARGET_INBOUND="$TARGET_DATADIR/builds/inbound/$KOAD_IO_SOURCE"
echo "TARGET_INBOUND:$TARGET_INBOUND"

echo "sending build-pack to $ENTITY on $KOAD_IO_PROD_HOST";
echo "> $TARGET_INBOUND/src.tar.gz"

FILESIZE=$(stat -c%s "builds/latest/src.tar.gz")
echo "built bundle is `echo ${FILESIZE}/1024/1024 | bc` megabytes"

IDENTITY=$ENTITY_DIR/id/ed25519
[ ! -f $IDENTITY ] && IDENTITY=$ENTITY_DIR/id/rsa
[ ! -f $IDENTITY ] && echo "identity not found!" && exit 64

ssh -i "$IDENTITY" "$KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST" "mkdir -p $TARGET_INBOUND"
if [ $? -ne 0 ]; then
    echo "Failed to create directory $TARGET_INBOUND on remote host."
    exit 1
else
    echo "Successfully created directory $TARGET_INBOUND on remote host."
fi

scp -i "$IDENTITY" builds/latest/src.tar.gz "$KOAD_IO_PROD_USER@$KOAD_IO_PROD_HOST:$TARGET_INBOUND/"
if [ $? -ne 0 ]; then
    echo "Failed to transfer file to $TARGET_INBOUND on remote host."
    exit 1
else
    echo "Successfully transferred file to $TARGET_INBOUND on remote host."
fi
