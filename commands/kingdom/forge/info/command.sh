#!/usr/bin/env bash
# kingdom forge info — show forge connection info
#
# Usage:
#   kingdom forge info

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../forge-common.sh"

echo "koad:io forge"
echo "  Web:      ${FORGE_URL}"
echo "  SSH:      ${SSH_HOST}"
echo ""

instead_of=$(git config --global url."ssh://${SSH_HOST}/".insteadOf 2>/dev/null || true)
if [ -n "$instead_of" ]; then
    echo "  Shortcut: ${instead_of}org/repo  → ssh://${SSH_HOST}/org/repo"
    echo "  Status:   ✅ configured"
else
    echo "  Shortcut: not configured — run 'kingdom forge setup'"
fi

echo ""
echo "  Token:    $([ -n "${FORGEJO_TOKEN:-}" ] && echo 'available' || echo 'not set')"
