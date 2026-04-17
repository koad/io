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

check_required_variables() {
    if [ -z "$NETBIRD_SETUP_KEY" ] || [ -z "$NETBIRD_MGMT_URL" ]; then
        echo ""
        echo "  No kingdom mesh configured yet."
        echo ""
        echo "  A Netbird management server must be running before nodes can join."
        echo "  If you haven't set one up yet, run:"
        echo ""
        echo "    $ENTITY configure kingdom seed"
        echo ""
        echo "  Deploy that cloud-init to a VPS first, then SSH in and run:"
        echo ""
        echo "    koad-io configure daemon  ->  Netbird  ->  Install"
        echo ""
        echo "  Once the controller is running, generate a setup key and add to ~/.$ENTITY/.env:"
        echo ""
        echo "    NETBIRD_SETUP_KEY=your-setup-key"
        echo "    NETBIRD_MGMT_URL=https://zero.koad.sh"
        echo ""
        echo "  Then re-run: $ENTITY configure kingdom node"
        echo ""
        exit 1
    fi
}

check_required_variables

# One user per VPS. User name = invoker.
# If $ENTITY is set (invoked via entity launcher), use entity identity.
# Otherwise (invoked via koad-io directly), use the logged-in human.
if [ -n "$ENTITY" ] && [ "$ENTITY" != "koad-io" ]; then
    VPS_USER="$ENTITY"
    VPS_SSH_KEY_PATH="$ENTITY_DIR/id/ed25519.pub"
else
    VPS_USER="$(whoami)"
    VPS_SSH_KEY_PATH="$HOME/.ssh/id_ed25519.pub"
fi

get_ssh_key() {
    if [ ! -f "$1" ]; then
        echo "SSH key file not found at $1" >&2
        exit 1
    fi
    cat "$1"
}

VPS_SSH_KEY=$(get_ssh_key "$VPS_SSH_KEY_PATH")

CLOUD_INIT_DIR="${ENTITY_DIR:-$HOME}/.local"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_INIT_TEMPLATE="$SCRIPT_DIR/template.yaml"
CLOUD_INIT="$CLOUD_INIT_DIR/cloud-init-node.yaml"

mkdir -p "$CLOUD_INIT_DIR"

sed -e "s|<VPS_USER>|$VPS_USER|g" \
    -e "s|<VPS_SSH_KEY>|$VPS_SSH_KEY|g" \
    -e "s|<NETBIRD_SETUP_KEY>|$NETBIRD_SETUP_KEY|g" \
    -e "s|<NETBIRD_MGMT_URL>|$NETBIRD_MGMT_URL|g" \
    "$CLOUD_INIT_TEMPLATE" > "$CLOUD_INIT"

if [[ -n "$OUTPUT_PATH" ]]; then
    cp "$CLOUD_INIT" "$OUTPUT_PATH"
    rm "$CLOUD_INIT"
    echo "Node cloud-init written to: $OUTPUT_PATH"
elif [[ "$TO_STDOUT" -eq 1 ]]; then
    cat "$CLOUD_INIT"
    rm "$CLOUD_INIT"
elif command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard < "$CLOUD_INIT"
    rm "$CLOUD_INIT"
    echo "Node cloud-init copied to clipboard."
elif command -v pbcopy >/dev/null 2>&1; then
    pbcopy < "$CLOUD_INIT"
    rm "$CLOUD_INIT"
    echo "Node cloud-init copied to clipboard."
else
    cat "$CLOUD_INIT"
    rm "$CLOUD_INIT"
    echo "(no clipboard tool found — output printed above)" >&2
fi

echo "Paste into Hetzner cloud-init field. Box will boot, join Netbird mesh, and be ready for services."
