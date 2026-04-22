#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
echo "Parameters: $1 $2"

CREATE_DIRS=false
if [[ "$1" == "--mkdir" ]]; then
    CREATE_DIRS=true
    shift  # Shift the arguments to the left
fi

type scp >/dev/null 2>&1 || { echo >&2 "I require scp but it's not installed. Aborting."; exit 1; }
type stat >/dev/null 2>&1 || { echo >&2 "I require stat but it's not installed. Aborting."; exit 1; }

export DATADIR=$PWD
echo "Data directory: $DATADIR"
export KOAD_IO_INSTANCE=${ENTITY,,}

FILE_OR_FOLDER=$1
DESTINATION=$2

if [ -z "$FILE_OR_FOLDER" ] || [ -z "$DESTINATION" ]; then
    echo "Usage: $ENTITY upload [--mkdir] <file_or_folder> <destination>"
    echo "Example: $ENTITY upload --mkdir ./thisfileinthisfolder.png wonderland:/home/$ENTITY/some/folder/somewhere/newfilename.png"
    exit 1
fi

echo "Sending: $FILE_OR_FOLDER"
echo "To: $DESTINATION"

FILESIZE=$(stat -c%s "$FILE_OR_FOLDER")
echo "File size: ${FILESIZE} bytes ($((FILESIZE / 1024 / 1024)) megabytes)"

SSH_KEY_PATH=""
if [ -f "$ENTITY_DIR/id/ed25519" ]; then
    SSH_KEY_PATH="$ENTITY_DIR/id/ed25519"
elif [ -f "$ENTITY_DIR/id/rsa" ]; then
    SSH_KEY_PATH="$ENTITY_DIR/id/rsa"
else
    echo "No valid SSH key found in $ENTITY_DIR/id"
    exit 1
fi

REMOTE_HOST="${DESTINATION%%:*}"
REMOTE_PATH="${DESTINATION#*:}"

# Check if the directory exists and create it if not
if [ "$CREATE_DIRS" = true ]; then
    if ssh -i "$SSH_KEY_PATH" "$KOAD_IO_INSTANCE@$REMOTE_HOST" "[ -d '$REMOTE_PATH' ]"; then
        echo "Directory $REMOTE_PATH already exists on $REMOTE_HOST."
    else
        echo "Directory $REMOTE_PATH does not exist on $REMOTE_HOST. Creating directory..."
        ssh -i "$SSH_KEY_PATH" "$KOAD_IO_INSTANCE@$REMOTE_HOST" "mkdir -p '$REMOTE_PATH'"
        if [ $? -eq 0 ]; then
            echo "Directory created successfully."
        else
            echo "Failed to create directory."
            exit 1
        fi
    fi
fi

if scp -i "$SSH_KEY_PATH" "$FILE_OR_FOLDER" "$KOAD_IO_INSTANCE@$DESTINATION"; then
    echo "Transfer successful"
else
    echo "Error during file transfer"
    exit 1
fi
