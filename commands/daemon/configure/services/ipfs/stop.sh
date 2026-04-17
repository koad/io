#!/bin/bash
#
# stop.sh — IPFS service stop
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

echo "Stopping IPFS stack (Kubo + ipfs-cluster-service)..."
cd "$SCRIPT_DIR"

if [[ -f "$ENV_FILE" ]]; then
    docker-compose --env-file "$ENV_FILE" down
else
    docker-compose down
fi

echo "IPFS stack stopped."
