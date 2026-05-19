#!/usr/bin/env bash

start=`date +%s`

CURRENTDATETIME=`date +"%Y-%m-%d-%H-%M"`
DATADIR=$PWD

[[ ! -d $DATADIR ]] && 'Cannot find specified site, please check your call and try again.'

cd $DATADIR
[[ ! -f ./.env ]] && echo 'It doesnt appear to me that you are in a valid koad:io directory.' && exit 64

set -a
source .env

[[ -z "${SOURCE}" ]] && SOURCE='src'

[[ ! -d $DATADIR/bundles ]] && mkdir -p $DATADIR/bundles
[[ ! -d $DATADIR/builds ]] && mkdir -p $DATADIR/builds
[[ ! -d $DATADIR/dist ]] && mkdir -p $DATADIR/dist

BUILDDIR=$DATADIR/builds/$CURRENTDATETIME

[[ -z "${SOURCE}" ]] && echo 'SOURCE var not set' && exit 64

echo build source: $DATADIR/$SOURCE
echo build destination: $BUILDDIR

if [ -d "$BUILDDIR" ] 
then
  echo "Directory $BUILDDIR exists, removing it" 
  rm -rf $BUILDDIR
fi

mkdir -p $BUILDDIR

cd $DATADIR/$SOURCE
meteor npx update-browserslist-db@latest
meteor build $BUILDDIR --server $MOBILE_DDP_URL --directory  # Built as a directory instead of a tar package, maybe for file:// or chrome ext? or ipfs?  sweet. 

[[ -d $DATADIR/builds/latest ]] && rm $DATADIR/builds/latest
ln -s -f $BUILDDIR $DATADIR/builds/latest
echo -e "\033[0;32mbuild complete.\033[0m"


BUILDDIR=$DATADIR/bundles/$CURRENTDATETIME
[[ -z "${SOURCE}" ]] && SOURCE='src'

echo bundle source: $DATADIR/$SOURCE
echo extention destination: $BUILDDIR

if [ -d "$BUILDDIR" ] 
then
  echo "Directory $BUILDDIR exists, removing it" 
  rm -rf $BUILDDIR
fi

BUILDPACK=$DATADIR/builds/latest
echo BUILDPACK: $BUILDPACK
cd $DATADIR/$SOURCE

meteor-build-client $BUILDDIR --usebuild $DATADIR/builds/latest -p "" \
--yci --ddp https://koad.sh --url https://koad.sh -s $DATADIR/config/wonderland.json

[[ -d $DATADIR/bundles/latest ]] && rm $DATADIR/bundles/latest
ln -s -f $BUILDDIR $DATADIR/bundles/latest
echo -e "\033[0;32mextention client build complete.\033[0m"


directory="$DATADIR/bundles/latest"

extension="js"
count=$(find $directory/*.$extension -type f | wc -l)

if [ "$count" -eq 1 ]; then
    file=$(find $directory/*.$extension -type f )
    echo "stitching in logic: $file"
    cp -f $file $DATADIR/dist/calculated-logic.js
elif [ "$count" -eq 0 ]; then
    echo "No file found with extension $extension"
else
    echo "Multiple files found with extension $extension"
fi

extension="css"
count=$(find $directory/*.$extension -type f | wc -l)
if [ "$count" -eq 1 ]; then
    file=$(find $directory/*.$extension -type f )
    echo "stitching in stylesheets: $file"
    cp -f $file $DATADIR/dist/calculated-styles.css
elif [ "$count" -eq 0 ]; then
    echo "No file found with extension $extension"
else
    echo "Multiple files found with extension $extension"
fi

echo "stitching in public folder..."
cp -rf $DATADIR/src/public/* $DATADIR/dist/

echo "generating runtime config..."
json=$(cat $DATADIR/config/wonderland.json)
public_object=$(echo "$json" | jq '.public')
encoded=$(echo "$public_object" | jq -r '@uri')
echo "__meteor_runtime_config__ = JSON.parse(decodeURIComponent('$encoded'));" > $DATADIR/dist/calculated-runtime.js

echo 'creating symbolic links for alternate entrypoints'
cd $DATADIR/dist/
rm -f panel.html && ln -s index.html panel.html
rm -f popup.html && ln -s index.html popup.html
rm -f shims.html && ln -s index.html shims.html
rm -f about.html && ln -s index.html about.html
rm -f newtab.html && ln -s index.html newtab.html
rm -f devops.html && ln -s index.html devops.html
rm -f search.html && ln -s index.html search.html
rm -f workers.html && ln -s index.html workers.html
rm -f updates.html && ln -s index.html updates.html
rm -f settings.html && ln -s index.html settings.html

# Check if the src/private directory exists and then copy
if [ -d "$DATADIR/src/private" ]; then
    echo "Copying contents of src/private to dist..."
    cp -R $DATADIR/src/private/* $DATADIR/dist/
else
    echo "src/private directory does not exist, skipping..."
fi

echo 'complete, the extention has been built into the ./dist folder'

end=`date +%s`
runtime=$( echo "$end - $start" | bc -l )
echo "process took $runtime seconds."
