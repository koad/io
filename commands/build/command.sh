#!/usr/bin/env bash

# start the runtimer
start=$(date +%s)

# Assert valid koad:io workspace (DATADIR)
source "$HOME/.koad-io/hooks/assert-datadir.sh"
if [ -z "$DATADIR" ]; then
  echo "unable to find a valid koad:io workspace or fixture."
  exit 64
fi

# Array of required variables
required_vars=("KOAD_IO_BIND_IP" "KOAD_IO_PORT" "KOAD_IO_APP_NAME" "KOAD_IO_TYPE")

# Check if required variables are empty
missing_vars=()
for var in "${required_vars[@]}"; do
  if [[ -z "${!var}" ]]; then
    missing_vars+=("$var")
  fi
done

# If any required variable is missing, inform the user and exit
if [[ ${#missing_vars[@]} -gt 0 ]]; then
  echo "The following required variables are not set:"
  for var in "${missing_vars[@]}"; do
    echo "$var"
  done
  echo "Exiting..."
  exit 64
fi

# Print the settings being used
echo "KOAD_IO_APP_NAME Name: $KOAD_IO_APP_NAME"
echo "KOAD_IO_TYPE Type: $KOAD_IO_TYPE"
echo "ENTITY: $ENTITY"
echo "DATADIR: $DATADIR"
echo
echo "LOCAL_BUILD: $LOCAL_BUILD"
echo

# Get the current date and time
CURRENTDATETIME=$(date +"%Y-%m-%d-%H-%M");

echo "Building $KOAD_IO_APP_NAME from source"
echo "Building source: $DATADIR/src"

BUILDDIR=$DATADIR/builds/$CURRENTDATETIME
[[ -d "$BUILDDIR" ]] && echo "Directory $BUILDDIR exists, removing it" && rm -rf $BUILDDIR
echo "Building to: $BUILDDIR" && mkdir -p $BUILDDIR 
echo "Entering $DATADIR/src" && cd $DATADIR/src

if [ -z "$LOCAL_BUILD" ] || [ "$LOCAL_BUILD" == "false" ]; then
  echo "building tarball"
  meteor build $BUILDDIR  # Build as a tarball package
  echo "built tarball: $BUILDDIR/src.tar.gz"
  actualsize=$(wc -c <"$BUILDDIR/src.tar.gz")
else
  echo "building local bundle"
  meteor build $BUILDDIR --directory  # Build as a local directory

  echo "compile the bundle"
  cd $BUILDDIR/bundle/programs/server/
  npm install && npm update 
  npm install --save @babel/runtime

  echo "built bundle: $BUILDDIR/"
  actualsize=$(du -sb $BUILDDIR | cut -f1)
fi

# All things are good, let's update our pointer to the current build
[[ -d $DATADIR/builds/latest ]] && rm $DATADIR/builds/latest
ln -s -f $BUILDDIR $DATADIR/builds/latest

echo -e "\033[0;32mBuild complete.\033[0m"
echo "Built bundle is $(echo ${actualsize}/1024/1024 | bc) megabytes"

end=$(date +%s)
runtime=$((end - start))
echo "Build time: $runtime seconds"
