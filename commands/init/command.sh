#!/usr/bin/env bash

check_entity_folders() {
    local WORKING_DIRECTORY=$1
    local -a KNOWN_DIRS=(".local" "commands" "skeletons" "desktop" "extension" "daemon")
    local SCORE=0

    for dir in "${KNOWN_DIRS[@]}"; do
        if [ -d "$WORKING_DIRECTORY/$dir" ]; then
            ((SCORE++))
        fi
    done

    echo "LIKELIHOOD SCORE: $SCORE"
    if [ $SCORE -lt 2 ] && [[ "$@" != *"--forceful"* ]]; then
        echo "This directory does not seem to be a koad:io entity or is incomplete."
        echo "Use --forceful flag to proceed anyway."
        exit 1
    fi
}

# Determine the target directory for initialization
WORKING_DIRECTORY="$1"
if [ -z "$WORKING_DIRECTORY" ]; then
    echo "Entity name not provided, using current directory: $PWD"
    WORKING_DIRECTORY="$PWD"
else
    echo "Initializing entity: $WORKING_DIRECTORY"
    WORKING_DIRECTORY="$HOME/.$WORKING_DIRECTORY"
fi

[ ! -d "$WORKING_DIRECTORY" ] && echo "directory does not exist: $WORKING_DIRECTORY" && exit 64
[ ! -f "$WORKING_DIRECTORY/.env" ] && echo "Error: .env file not found in $WORKING_DIRECTORY" && exit 64

# Call the function with the directory and any additional arguments
check_entity_folders "$WORKING_DIRECTORY" "$@"

if [ -z "$1" ]; then
    # If no argument is provided, use the name of the current directory as the ENTITY
    ENTITY=$(basename "$PWD")
    # Remove the leading dot (if present) from ENTITY
    ENTITY=${ENTITY#.}
else
    # If an argument is provided, use it as the ENTITY
    ENTITY="$1"
fi

# Check if the entity wrapper command already exists
echo "Entity set to: $ENTITY"
if [ -f "$HOME/.koad-io/bin/$ENTITY" ]; then
    echo "Error: The entity '$ENTITY' already exists."
    exit 64
fi

# all is well, lets gooo!!
echo "Creating entity wrapper command: $ENTITY"
echo '#!/usr/bin/env bash

export ENTITY="'$ENTITY'"
koad-io "$@";
' > $HOME/.koad-io/bin/$ENTITY
echo && sleep 1

echo "making '$HOME/.koad-io/bin/$ENTITY' executable"
chmod +x $HOME/.koad-io/bin/$ENTITY
echo && sleep 1
echo "Initialization of $ENTITY complete!"
sleep 1
echo "-------------------------------------------------------------------------------"
echo "ready player one -> $ENTITY"
echo