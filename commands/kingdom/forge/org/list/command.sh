#!/usr/bin/env bash
# kingdom forge org list — list orgs on the forge
#
# Usage:
#   kingdom forge org list

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../../forge-common.sh"

forge_api GET "orgs?limit=50" "" 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('Orgs:'); print()
for org in data:
    name = org.get('username', org.get('name', '?'))
    vis = ' 🔒' if org.get('visibility', '') == 'private' else ''
    desc = org.get('description', '') or ''
    print(f'  {name}{vis}')
    if desc: print(f'    {desc}')
" 2>/dev/null || echo '  (API error)'
