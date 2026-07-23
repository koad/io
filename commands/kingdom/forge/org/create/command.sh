#!/usr/bin/env bash
# kingdom forge org create — create a new org (category) on the forge
#
# Usage:
#   kingdom forge org create <name> [--full-name=<title>] [--public] [--desc=<text>]
#
# Defaults to private. Pass --public to make the org public.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../../forge-common.sh"

name="" full_name="" description="" visibility="private"

while [ $# -gt 0 ]; do
    case "$1" in
        --full-name=*) full_name="${1#*=}" ;;
        --desc=*)      description="${1#*=}" ;;
        --public)      visibility="public" ;;
        --*)           echo "Unknown: $1"; exit 1 ;;
        *)             name="$1" ;;
    esac
    shift
done

[ -z "$name" ] && { echo "Usage: kingdom forge org create <name> [--full-name=<title>] [--public]"; exit 1; }
[ -z "$full_name" ] && full_name="$name"

echo "Creating org '${name}' (${visibility})"

result=$(forge_api POST "orgs" "{
    \"username\": \"${name}\",
    \"full_name\": \"${full_name}\",
    \"description\": \"${description}\",
    \"visibility\": \"${visibility}\"
}" 2>&1)

if echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null | grep -q '[0-9]'; then
    echo "✅ Org created: ${FORGE_URL}/${name}"
else
    err=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message','unknown'))" 2>/dev/null)
    echo "❌ ${err}"
    exit 1
fi
