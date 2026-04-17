#!/bin/bash

set -e

# Parse flags
OUTPUT_PATH=""
TO_STDOUT=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stdout)
            TO_STDOUT=1
            shift
            ;;
        --output)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        --output=*)
            OUTPUT_PATH="${1#*=}"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

HUMAN_SSH_KEY_PATH="$HOME/.ssh/id_ed25519.pub"
ENTITY_SSH_KEY_PATH="$ENTITY_DIR/id/ed25519.pub"

get_ssh_key() {
    if [ ! -f "$1" ]; then
        echo "SSH key file not found at $1" >&2
        exit 1
    fi
    cat "$1"
}

HUMAN_SSH_KEY=$(get_ssh_key "$HUMAN_SSH_KEY_PATH")
ENTITY_SSH_KEY=$(get_ssh_key "$ENTITY_SSH_KEY_PATH")

CLOUD_INIT_DIR="$ENTITY_DIR/.local"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_INIT_TEMPLATE="$SCRIPT_DIR/template.yaml"
CLOUD_INIT="$CLOUD_INIT_DIR/cloud-init-seed.yaml"

mkdir -p "$CLOUD_INIT_DIR"

sed -e "s|<LOGGED_IN_HUMAN>|$(whoami)|g" \
    -e "s|<HUMAN_SSH_KEY>|$HUMAN_SSH_KEY|g" \
    -e "s|<ENTITY_USER>|$ENTITY|g" \
    -e "s|<ENTITY_SSH_KEY>|$ENTITY_SSH_KEY|g" \
    "$CLOUD_INIT_TEMPLATE" > "$CLOUD_INIT"

if [[ -n "$OUTPUT_PATH" ]]; then
    cp "$CLOUD_INIT" "$OUTPUT_PATH"
    rm "$CLOUD_INIT"
    echo "Controller cloud-init written to: $OUTPUT_PATH"
elif [[ "$TO_STDOUT" -eq 1 ]]; then
    cat "$CLOUD_INIT"
    rm "$CLOUD_INIT"
elif command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard < "$CLOUD_INIT"
    rm "$CLOUD_INIT"
    echo "Controller cloud-init copied to clipboard."
elif command -v pbcopy >/dev/null 2>&1; then
    pbcopy < "$CLOUD_INIT"
    rm "$CLOUD_INIT"
    echo "Controller cloud-init copied to clipboard."
else
    cat "$CLOUD_INIT"
    rm "$CLOUD_INIT"
    echo "(no clipboard tool found — output printed above)" >&2
fi

echo ""
echo "After pasting into Hetzner and VPS boots:"
echo "  1. Get the VPS IP from Hetzner dashboard"
echo "  2. Point zero.koad.sh A record -> VPS IP"
echo "  3. Wait for DNS propagation"
echo "  4. SSH in: ssh zero.koad.sh"
echo "  5. Run:  koad-io configure daemon    (Netbird mgmt + IPFS + services)"
