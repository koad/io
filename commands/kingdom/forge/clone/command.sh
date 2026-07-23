#!/usr/bin/env bash
# kingdom forge clone — git clone via kingdom: shortcut
#
# Usage:
#   kingdom forge clone <path> [directory]
#   kingdom forge clone kingdom:koad/koad
#   kingdom forge clone koad/koad

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../forge-common.sh"

[ $# -lt 1 ] && { echo "Usage: kingdom forge clone <path> [dir]"; exit 1; }

target="$1"; shift
[[ "$target" != *"://"* ]] && [[ "$target" != *"@"* ]] && target="kingdom:${target}"

echo "→ git clone ${target} $*"
git clone "$target" "$@"
