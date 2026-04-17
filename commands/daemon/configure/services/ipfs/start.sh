#!/bin/bash
#
# start.sh — IPFS service start
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: .env not found at $ENV_FILE — run install.sh first." >&2
    exit 1
fi

echo "Starting IPFS stack (Kubo + ipfs-cluster-service)..."
cd "$SCRIPT_DIR"
docker-compose --env-file "$ENV_FILE" up -d

echo "IPFS stack started."
echo "  Kubo gateway:     http://127.0.0.1:8080"
echo "  Kubo API:         http://127.0.0.1:5001"
echo "  Cluster REST API: http://127.0.0.1:9094"
