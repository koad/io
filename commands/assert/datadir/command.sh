# SPDX-License-Identifier: AGPL-3.0-or-later
# assert/datadir — resolve a koad:io workspace path from a name or PWD.
# Entity-agnostic. The only requirement: the resolved directory must contain
# a .env file. Callers that need entity-scoped resolution do it upstream.

LOCAL_BUILD=false
# --print-env: after resolving and absorbing, dump the KOAD_IO_* set this workspace
# resolves to. Same purpose as the archived `inspect/env.sh`, which is where it was
# learned: answering "which cascade actually won for this target" without guessing.
PRINT_ENV=false
for _a in "$@"; do [[ "$_a" == "--print-env" ]] && PRINT_ENV=true; done

[[ -v KOAD_IO_LOCAL_ONLY ]] && echo "Local build specified with KOAD_IO_LOCAL_ONLY" && LOCAL_BUILD=true

# Strip flags and legacy "local" positional from args before resolving DATADIR.
_positional=()
for _arg in "$@"; do
  case "$_arg" in
    --local)  LOCAL_BUILD=true ;;
    --*)      ;;  # skip flags — they're for the calling command, not for us
    local)    LOCAL_BUILD=true ;;
    *)        _positional+=("$_arg") ;;
  esac
done
set -- "${_positional[@]}"
unset _positional _arg

echo "asserting valid datadir"

NAME=$1
SUBFOLDER=$2
DATADIR=

if [[ -n $NAME && -n $SUBFOLDER ]]; then
    # plural form: <type>s/<name> (e.g. "websites" "kingofalldata.com")
    [[ -f "$PWD/${NAME}s/$SUBFOLDER/.env" ]] && DATADIR="$PWD/${NAME}s/$SUBFOLDER"
    [[ -z "$DATADIR" && -f "$NAME/$SUBFOLDER/.env" ]] && DATADIR="$NAME/$SUBFOLDER"
elif [[ -n $NAME ]]; then
    # Absolute path passed directly
    [[ -f "$NAME/.env" ]] && DATADIR="$NAME"
    # Name relative to CWD
    [[ -z "$DATADIR" && -f "$PWD/$NAME/.env" ]] && DATADIR="$PWD/$NAME"
    # Entity handle — entities live at ~/.<handle>, so `assert datadir vulcan` should mean
    # ~/.vulcan without the caller knowing the dot convention.
    [[ -z "$DATADIR" && -f "$HOME/.$NAME/.env" ]] && DATADIR="$HOME/.$NAME"
else
    # No args — use PWD
    [[ -f "$PWD/.env" ]] && DATADIR="$PWD"
fi

# Fallback: services registry (process-control) maps names → datadir for
# forge services that live outside any entity directory.
if [ -z "$DATADIR" ] && [ -n "$NAME" ]; then
  SERVICES_FILE="${KOAD_IO_RUNTIME_PATH:-$HOME/.local/share/koad-io/runtime}/services.jsonl"
  if [ -f "$SERVICES_FILE" ]; then
    MATCH=$(grep "\"name\":\"$NAME\"" "$SERVICES_FILE" | head -1)
    if [ -n "$MATCH" ]; then
      SVC_DATADIR=$(echo "$MATCH" | python3 -c "import sys,json; print(json.loads(sys.stdin.readline()).get('datadir',''))" 2>/dev/null)
      if [ -n "$SVC_DATADIR" ] && [ -f "$SVC_DATADIR/.env" ]; then
        DATADIR="$SVC_DATADIR"
        echo "DATADIR resolved from services registry: $DATADIR"
      fi
    fi
  fi
fi

if [ -z "$DATADIR" ]; then
    echo -e "\033[31mkoad/io: not a valid koad:io project folder (no .env found)\033[0m" >&2
    exit 64
fi

echo "DATADIR: $DATADIR"

# Load environment variables from .env and .credentials files
set -a
source $DATADIR/.env && echo "absorbing $DATADIR/.env"
[[ -f $DATADIR/.credentials ]] && source $DATADIR/.credentials && echo "obsorbing $DATADIR/.credentials"
set +a

echo "-"

if [ "$PRINT_ENV" = true ]; then
  # The absorbed set, sorted and labelled with where it came from — an env dump without
  # provenance is the thing that made this command necessary in the first place.
  echo "# KOAD_IO_* as resolved by DATADIR=$(cd "$DATADIR" 2>/dev/null && pwd || echo "$DATADIR")"
  env | grep '^KOAD_IO_' | sort
  echo "# end"
fi
