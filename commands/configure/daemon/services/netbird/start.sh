#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/.env" ]]; then
    source "$SCRIPT_DIR/.env"
fi

echo "Starting Netbird management server..."

# Netbird's installer places compose in /opt/netbird or current dir
NETBIRD_COMPOSE_DIR="${NETBIRD_COMPOSE_DIR:-/opt/netbird}"

if [[ -f "$NETBIRD_COMPOSE_DIR/docker-compose.yml" ]]; then
    cd "$NETBIRD_COMPOSE_DIR"
    docker-compose up -d
else
    echo "ERROR: docker-compose.yml not found at $NETBIRD_COMPOSE_DIR"
    echo "Has install.sh been run?"
    exit 1
fi

echo "Netbird management server started."
echo "Dashboard: https://${NETBIRD_DOMAIN:-unknown}"
