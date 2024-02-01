# Function to find the right DATADIR based on the command and its parameters

LOCAL_BUILD=false

[[ -v KOAD_IO_LOCAL_ONLY ]] && echo "Local build specified with KOAD_IO_LOCAL_ONLY" && LOCAL_BUILD=true

# Get the total number of arguments
TOTAL_ARGS=$#

# Get the last argument
LAST_ARG=${!TOTAL_ARGS}

# Check if the last argument is "local"
if [[ "$LAST_ARG" == "local" ]]; then
  # Remove the last argument from the list of arguments
  set -- "${@:1:$((TOTAL_ARGS - 1))}"
  LOCAL_BUILD=true
fi

# Now the arguments in "${@}" don't include the last "local" argument, if it existed.

echo "asserting valid datadir"

KOAD_IO_TYPE=$1
SUBFOLDER=$2
DATADIR=

if [[ -n $KOAD_IO_TYPE && -n $SUBFOLDER ]]; then 
    # many arguments exist, enough that it might be plural
    [[ -d "$ENTITY_DIR/${KOAD_IO_TYPE}s/" ]] && echo "type is plural"
    [[ -f "$ENTITY_DIR/${KOAD_IO_TYPE}s/$SUBFOLDER/.env" ]] && echo ".env is present, DATADIR found" && DATADIR="$ENTITY_DIR/${KOAD_IO_TYPE}s/$SUBFOLDER"
elif [[ -n $KOAD_IO_TYPE ]]; then 
    # enough arguments exist to specify a singular
    [[ -d "$ENTITY_DIR/$KOAD_IO_TYPE/" ]] && echo "type is singular"
    [[ -f "$ENTITY_DIR/$KOAD_IO_TYPE/.env" ]] && echo ".env is present, DATADIR found" && DATADIR="$ENTITY_DIR/$KOAD_IO_TYPE"
else
    # no arguments, must be PWD
    if [[ -f "$PWD/.env" ]]; then
        DATADIR="$PWD"
        
        # Attempt to detect the type
        DIRNAME=$(basename "$PWD")
        PARENTDIR=$(basename "$(dirname "$PWD")")

        if [[ $PARENTDIR == ${DIRNAME}s ]]; then
            # Previous folder ends in "s", indicating plural form
            KOAD_IO_TYPE=${DIRNAME}
        elif [[ -d "$ENTITY_DIR/$DIRNAME/" ]]; then
            # Folder exists in the entity's folder, indicating type
            KOAD_IO_TYPE=${DIRNAME}
        fi
    fi
fi

if [ -z "$DATADIR" ]; then
    echo -e "\033[31mkoad/io: $DATADIR is not a valid koad:io workspace or fixture\033[0m"
    echo "exiting... 64"
    exit 64
fi

echo "DATADIR: $DATADIR"

# Load environment variables from .env and .credentials files
set -a
source $DATADIR/.env && echo "absorbing $DATADIR/.env"
[[ -f $DATADIR/.credentials ]] && source $DATADIR/.credentials && echo "obsorbing $DATADIR/.credentials"
set +a


echo "-"
