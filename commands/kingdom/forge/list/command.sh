#!/usr/bin/env bash
# kingdom forge list — list repos on the forge
#
# Usage:
#   kingdom forge list

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../forge-common.sh"

[ -z "${FORGEJO_TOKEN:-}" ] && { echo "Error: FORGEJO_TOKEN not set"; exit 1; }

echo "Repos on ${FORGE_URL}:"
echo ""

curl -s -H "Authorization: token ${FORGEJO_TOKEN}" \
    "${FORGE_URL}/api/v1/repos/search?limit=50" \
    | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data.get('data', []):
    owner = r['owner']['login']
    name = r['name']
    desc = r.get('description', '') or ''
    mirror = ' 🔄' if r.get('mirror') else ''
    private = ' 🔒' if r.get('private') else ''
    print(f'  kingdom:{owner}/{name}{mirror}{private}')
    if desc: print(f'    {desc}')
" 2>/dev/null || echo "  (API error)"
