#!/usr/bin/env bash
# forge-common.sh — shared helpers for forge sub-commands
# Source this from any forge/*/command.sh

FORGE_URL="${FORGEJO_URL:-https://git.koad.live}"
FORGE_DOMAIN=$(echo "$FORGE_URL" | sed -E 's|https?://||' | sed -E 's|/.*||')
SSH_HOST="git@${FORGE_DOMAIN}"

forge_api() {
    local method="$1" endpoint="$2" body="$3"
    [ -z "${FORGEJO_TOKEN:-}" ] && { echo "Error: FORGEJO_TOKEN not set" >&2; exit 1; }
    if [ -n "$body" ]; then
        curl -s -X "${method}" "${FORGE_URL}/api/v1/${endpoint}" \
            -H "Authorization: token ${FORGEJO_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "$body"
    else
        curl -s -X "${method}" "${FORGE_URL}/api/v1/${endpoint}" \
            -H "Authorization: token ${FORGEJO_TOKEN}"
    fi
}

forge_get_uid() {
    local name="$1"
    forge_api GET "users/${name}" "" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('id', 1))" 2>/dev/null || echo "1"
}
