#!/usr/bin/env bash
# kingdom forge mirror — mirror an external repo into the forge
#
# Usage:
#   kingdom forge mirror <source-url> [--name=<name>] [--org=<org>] [--public] [--desc=<text>]
#
# Defaults to private. Pass --public to make the mirrored repo public.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../forge-common.sh"

source_url="" repo_name="" org="" private="true" description=""

while [ $# -gt 0 ]; do
    case "$1" in
        --name=*)    repo_name="${1#*=}" ;;
        --org=*)     org="${1#*=}" ;;
        --public)    private="false" ;;
        --desc=*)    description="${1#*=}" ;;
        --*)         echo "Unknown: $1"; exit 1 ;;
        *)           source_url="$1" ;;
    esac
    shift
done

[ -z "$source_url" ] && { echo "Usage: kingdom forge mirror <url> [--name=<name>] [--org=<org>] [--public] [--desc=<text>]"; exit 1; }
[ -z "$repo_name" ] && repo_name=$(basename "$source_url" .git)

# Detect service
service="git"
echo "$source_url" | grep -qi "github.com" && service="github"
echo "$source_url" | grep -qi "gitlab.com" && service="gitlab"
echo "$source_url" | grep -qi "bitbucket.org" && service="bitbucket"

uid=1
[ -n "$org" ] && uid=$(forge_get_uid "$org") && echo "Org '${org}' → uid ${uid}"

echo "Mirroring → ${FORGE_URL}/${org:-koad}/${repo_name} (private: ${private})"

result=$(forge_api POST "repos/migrate" "{
    \"clone_addr\": \"${source_url}\",
    \"repo_name\": \"${repo_name}\",
    \"mirror\": true,
    \"uid\": ${uid},
    \"service\": \"${service}\",
    \"private\": ${private},
    \"description\": \"${description}\"
}" 2>&1)

if echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null | grep -q '[0-9]'; then
    clone_url=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('clone_url',''))" 2>/dev/null)
    ssh_url=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ssh_url',''))" 2>/dev/null)
    echo "✅ Mirror created"
    echo "  SSH:  ${ssh_url}"
    echo "  Short: kingdom:${org:-koad}/${repo_name}"
else
    err=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message','unknown'))" 2>/dev/null)
    echo "❌ ${err}"
    exit 1
fi
