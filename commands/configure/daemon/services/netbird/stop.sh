#!/bin/bash

set -e

NETBIRD_COMPOSE_DIR="${NETBIRD_COMPOSE_DIR:-/opt/netbird}"

if [[ -f "$NETBIRD_COMPOSE_DIR/docker-compose.yml" ]]; then
    cd "$NETBIRD_COMPOSE_DIR"
    docker-compose down
    echo "Netbird management server stopped."
else
    echo "ERROR: docker-compose.yml not found at $NETBIRD_COMPOSE_DIR"
    exit 1
fi
