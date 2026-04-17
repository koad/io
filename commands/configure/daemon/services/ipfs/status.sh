#!/bin/bash
#
# status.sh — IPFS service health check
#

echo "=== IPFS Stack Status ==="
echo ""

# Kubo container
echo "-- Kubo (ipfs/kubo) --"
if docker inspect koad-ipfs-kubo >/dev/null 2>&1; then
    STATE=$(docker inspect -f '{{.State.Status}}' koad-ipfs-kubo)
    echo "  Container state: $STATE"
    if [[ "$STATE" == "running" ]]; then
        KUBO_ID=$(docker exec koad-ipfs-kubo ipfs id --format="<id>" 2>/dev/null || echo "unavailable")
        echo "  Node ID: $KUBO_ID"
        PEERS=$(docker exec koad-ipfs-kubo ipfs swarm peers 2>/dev/null | wc -l)
        echo "  Swarm peers: $PEERS"
    fi
else
    echo "  Container not found (not installed or not started)"
fi

echo ""

# Cluster container
echo "-- IPFS Cluster (ipfs/ipfs-cluster) --"
if docker inspect koad-ipfs-cluster >/dev/null 2>&1; then
    STATE=$(docker inspect -f '{{.State.Status}}' koad-ipfs-cluster)
    echo "  Container state: $STATE"
    if [[ "$STATE" == "running" ]]; then
        CLUSTER_ID=$(docker exec koad-ipfs-cluster ipfs-cluster-ctl id 2>/dev/null | head -1 || echo "unavailable")
        echo "  Cluster ID: $CLUSTER_ID"
        CLUSTER_PEERS=$(docker exec koad-ipfs-cluster ipfs-cluster-ctl peers ls 2>/dev/null | wc -l)
        echo "  Cluster peers: $CLUSTER_PEERS"
    fi
else
    echo "  Container not found (not installed or not started)"
fi

echo ""
