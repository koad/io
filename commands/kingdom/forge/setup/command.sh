#!/usr/bin/env bash
# kingdom forge setup — configure git insteadOf for kingdom: shortcut
#
# Usage:
#   kingdom forge setup

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../forge-common.sh"

echo "Configuring git insteadOf for kingdom: → ssh://${SSH_HOST}/"
git config --global url."ssh://${SSH_HOST}/".insteadOf "kingdom:"
echo "✅ Done. Use: git clone kingdom:koad/koad"
echo "To change URL later: git config --global kingdom.url <url> && kingdom forge setup"
