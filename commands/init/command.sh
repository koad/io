#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later

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
    if [[ "$@" == *"--forceful"* ]]; then
        echo "Warning: entity wrapper for '$ENTITY' already exists — overwriting (--forceful)"
    else
        echo "Error: The entity '$ENTITY' already exists."
        exit 64
    fi
fi

# all is well, lets gooo!!
echo "Creating entity wrapper command: $ENTITY"
echo '#!/usr/bin/env bash

export ENTITY="'$ENTITY'"
export KOAD_IO_VIA_LAUNCHER=1
koad-io "$@";
' > $HOME/.koad-io/bin/$ENTITY
echo && sleep 1

echo "making '$HOME/.koad-io/bin/$ENTITY' executable"
chmod +x $HOME/.koad-io/bin/$ENTITY
echo && sleep 1

# Device key provisioning — generate ed25519 if missing
ID_DIR="$WORKING_DIRECTORY/id"
PRIVATE_KEY="$ID_DIR/ed25519"
if [ ! -f "$PRIVATE_KEY" ]; then
    echo "Device key missing — generating Ed25519 keypair for $ENTITY@$HOSTNAME"
    mkdir -p "$ID_DIR"
    ssh-keygen -t ed25519 -f "$PRIVATE_KEY" -C "$ENTITY@$HOSTNAME" -N ""

    PUBKEY=$(cat "$PRIVATE_KEY.pub")
    echo
    echo "Device key generated for $ENTITY@$HOSTNAME."
    echo "Public key: $PUBKEY"
    echo
    echo "Next step on the AUTHORIZING device (the one that holds the entity's"
    echo "sigchain tip / root key):"
    echo
    echo "    $ENTITY profile device-key add \\"
    echo "        --device-id $HOSTNAME \\"
    echo "        --device-pubkey \"$PUBKEY\" \\"
    echo "        --description \"Fresh install on $HOSTNAME\""
    echo
    echo "Until this device is authorized, it can read but not sign on behalf"
    echo "of $ENTITY."
    echo
else
    echo "Device key present — $PRIVATE_KEY"
fi

# Ensure id/.gitignore protects private keys from accidental commits
GITIGNORE_PATH="$ID_DIR/.gitignore"
if [ ! -f "$GITIGNORE_PATH" ]; then
    echo "Writing $GITIGNORE_PATH to protect private keys from accidental commits"
    mkdir -p "$ID_DIR"
    cat > "$GITIGNORE_PATH" << 'GITIGNORE'
# Private keys — never commit
ed25519
ecdsa
rsa
dsa
kbpgp_key
wonderland
*.key
# Keep public keys
!*.pub
# Keep this file
!.gitignore
GITIGNORE
    echo "wrote: $GITIGNORE_PATH"
fi

echo "Initialization of $ENTITY complete!"
sleep 1
echo "-------------------------------------------------------------------------------"
echo "ready player one -> $ENTITY"
echo