#!/bin/bash

NETBIRD_COMPOSE_DIR="${NETBIRD_COMPOSE_DIR:-/opt/netbird}"

echo "=== Netbird Management Server Status ==="

if [[ -f "$NETBIRD_COMPOSE_DIR/docker-compose.yml" ]]; then
    cd "$NETBIRD_COMPOSE_DIR"
    docker-compose ps
else
    echo "Not installed (no docker-compose.yml at $NETBIRD_COMPOSE_DIR)"
fi
