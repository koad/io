#!/bin/bash

set -e

# Parse flags
OUTPUT_PATH=""
TO_STDOUT=0
DOMAIN_FLAG=""

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
        --domain)
            DOMAIN_FLAG="$2"
            shift 2
            ;;
        --domain=*)
            DOMAIN_FLAG="${1#*=}"
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

# Domain for the seed node — used in nginx config and certbot.
# Source priority: --domain flag > env KOAD_IO_DOMAIN > interactive prompt.
# If the domain resolves to empty or "kingdom.local", certbot is skipped.
CERTBOT_DOMAIN="${DOMAIN_FLAG:-${KOAD_IO_DOMAIN:-}}"

if [ -z "$CERTBOT_DOMAIN" ] && [ -t 0 ]; then
    read -r -p "Domain for this seed node (e.g. zero.example.com) [leave blank to skip TLS]: " CERTBOT_DOMAIN
fi

# Email for certbot ACME registration.
# Source priority: env KOAD_IO_CERTBOT_EMAIL > creator default.
CERTBOT_EMAIL="${KOAD_IO_CERTBOT_EMAIL:-koad@koad.sh}"

CLOUD_INIT_DIR="$ENTITY_DIR/.local"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_INIT_TEMPLATE="$SCRIPT_DIR/template.yaml"
CLOUD_INIT="$CLOUD_INIT_DIR/cloud-init-seed.yaml"

mkdir -p "$CLOUD_INIT_DIR"

sed -e "s|<LOGGED_IN_HUMAN>|$(whoami)|g" \
    -e "s|<HUMAN_SSH_KEY>|$HUMAN_SSH_KEY|g" \
    -e "s|<ENTITY_USER>|$ENTITY|g" \
    -e "s|<ENTITY_SSH_KEY>|$ENTITY_SSH_KEY|g" \
    -e "s|<KOAD_IO_DOMAIN>|${CERTBOT_DOMAIN:-kingdom.local}|g" \
    -e "s|<CERTBOT_EMAIL>|$CERTBOT_EMAIL|g" \
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
echo "  2. Point <KOAD_IO_DOMAIN> A record -> VPS IP  (if using a real domain)"
if [ -n "$CERTBOT_DOMAIN" ] && [ "$CERTBOT_DOMAIN" != "kingdom.local" ]; then
    echo "  2. Point $CERTBOT_DOMAIN A record -> VPS IP"
fi
echo "  3. Wait for DNS propagation"
echo "  4. SSH in: ssh ${CERTBOT_DOMAIN:-zero.koad.sh}"
echo "  5. Run:  koad-io configure daemon    (Netbird mgmt + IPFS + services)"
