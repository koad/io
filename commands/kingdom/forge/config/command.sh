#!/usr/bin/env bash
# kingdom forge config — show current forge URL config
#
# Usage:
#   kingdom forge config

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../forge-common.sh"

current=$(git config --global kingdom.url 2>/dev/null || echo "(not set)")
echo "Current forge URL: ${FORGE_URL}"
echo "Global git config: ${current}"
