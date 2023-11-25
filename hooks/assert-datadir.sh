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

TYPE=$1
SUBFOLDER=$2
DATADIR=

if [[ -n $TYPE && -n $SUBFOLDER ]]; then 
    # many arguments exist, enough that it might be plural
    [[ -d "$HOME/.$ENTITY/${TYPE}s/" ]] && echo "type is plural"
    [[ -f "$HOME/.$ENTITY/${TYPE}s/$SUBFOLDER/.env" ]] && echo ".env is present, DATADIR found" && DATADIR="$HOME/.$ENTITY/${TYPE}s/$SUBFOLDER"
elif [[ -n $TYPE ]]; then 
    # enough arguments exist to specify a singular
    [[ -d "$HOME/.$ENTITY/$TYPE/" ]] && echo "type is singular"
    [[ -f "$HOME/.$ENTITY/$TYPE/.env" ]] && echo ".env is present, DATADIR found" && DATADIR="$HOME/.$ENTITY/$TYPE"
else
    # arguments not exist, must be PWD
    [[ -f "$PWD/.env" ]] && echo ".env is present, DATADIR found" && DATADIR="$PWD"
fi

if [ -z "$DATADIR" ]; then
  echo "unable to find a valid koad:io workspace or fixture."
  echo "exiting... 64"
  exit 64
fi

echo "found DATADIR: $DATADIR"


# Load environment variables from .env and .credentials files
set -a
source $DATADIR/.env && echo "obsorbing $DATADIR/.env"
[[ -f $DATADIR/.credentials ]] && source $DATADIR/.credentials && echo "obsorbing $DATADIR/.credentials"
set +a


echo ""
