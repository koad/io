#!/bin/bash
set -e

# Check for the first argument (skeleton name)
if [ -z "$1" ]; then
  echo "Usage: koad spawn <skeleton>"
  exit 1
fi

export CURRENTDATETIME=$(date +"%Y-%m-%d-%H-%M")
export DATADIR=$CWD
export SKELETON=bare

# Define the path to the skeleton folder
SKELETON_PATH="$HOME/.koad-io/skeletons/$1"

# Check if the skeleton folder exists
if [ ! -d "$SKELETON_PATH" ]; then
  echo "Skeleton '$1' not found."
  exit 1
fi

echo "Skeleton found at $SKELETON_PATH"
# Run the controls/install script if it exists
if [ -f "$SKELETON_PATH/control/pre-install" ]; then
  echo "Running control/pre-install for skeleton '$1'..."
  echo "exec: $SKELETON_PATH/control/pre-install"
  bash "$SKELETON_PATH/control/pre-install"
else
  echo "No controls/pre-install script found for skeleton '$1'."
fi

# Run the controls/install script if it exists
if [ -f "$SKELETON_PATH/control/install" ]; then
  echo "Running control/install for skeleton '$1'..."
  echo "exec: $SKELETON_PATH/control/install"
  bash "$SKELETON_PATH/control/install"
else
  echo "No controls/install script found for skeleton '$1'."
fi

# Copy the contents of the skeleton folder to the current directory
echo "Deploying skeleton '$1'..."
cp -r "$SKELETON_PATH/skeleton/." .


# Run the controls/install script if it exists
if [ -f "$SKELETON_PATH/control/post-install" ]; then
  echo "Running control/post-install for skeleton '$1'..."
  echo "exec: $SKELETON_PATH/control/post-install"
  bash "$SKELETON_PATH/control/post-install"
else
  echo "No controls/post-install script found for skeleton '$1'."
fi

echo "Skeleton '$1' deployed successfully."
