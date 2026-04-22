#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
CURRENTDATETIME=`date +"%Y-%m-%d-%H-%M"`

set -a
source .env

cwd=$PWD
export SOURCE=src
export DATADIR=$PWD
export BUILDDIR=$DATADIR/builds/$CURRENTDATETIME

echo "-> $DATADIR/builds/latest/src.tar.gz";
[ ! -f $DATADIR/builds/latest/src.tar.gz ] && echo "No inbound package found, not deploying..." && exit 1
cd $DATADIR/builds/latest/ && tar -xvzf src.tar.gz
cd $DATADIR/builds/latest/bundle/programs/server/ && npm install && npm update && npm install --save @babel/runtime

cd $DATADIR
[[ ! -d archive ]] && echo 'Archive directory not found, creating it now...' && mkdir archive

cd $DATADIR/builds/latest/
mv bundle $BUILDDIR

mv src.tar.gz $DATADIR/archive/$KOAD_IO_SOURCE-$CURRENTDATETIME.tar.gz

[[ -d $DATADIR/builds/latest ]] && rm $DATADIR/builds/latest

ln -s -f $BUILDDIR $DATADIR/builds/latest

echo 'Your built package is linked to $BUILDDIR $DATADIR/builds/latest'
echo 'enjoy!'
echo 
echo './run to run the package'
