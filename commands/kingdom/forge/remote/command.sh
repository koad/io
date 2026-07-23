#!/usr/bin/env bash
# kingdom forge remote — show CWD origin as kingdom:org/repo
#
# Usage:
#   kingdom forge remote

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../forge-common.sh"

url=$(git config --get remote.origin.url 2>/dev/null || true)
[ -z "$url" ] && { echo "no remote 'origin'"; exit 1; }

kp=$(echo "$url" | sed -E "s|ssh://git@${FORGE_DOMAIN}/(.*)\.git|\1|" \
    | sed -E "s|git@${FORGE_DOMAIN}:(.*)\.git|\1|" \
    | sed -E "s|https?://${FORGE_DOMAIN}/(.*)\.git|\1|")

[ "$kp" = "$url" ] && echo "$url" || echo "kingdom:${kp}"
