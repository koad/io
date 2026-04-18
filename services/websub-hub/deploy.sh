#!/usr/bin/env bash
# deploy.sh — build and install the WebSub hub on zero.koad.sh
#
# Run this from a machine with Go 1.21+ installed, or directly on zero.koad.sh.
# Requires: go, ssh access to zero.koad.sh as root, nginx, certbot.
#
# Usage:
#   ./deploy.sh [remote_host]
#
# Default remote: root@87.99.156.250 (zero.koad.sh)
# Override:       ./deploy.sh root@zero.koad.sh

set -euo pipefail

REMOTE="${1:-root@87.99.156.250}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Building websub-hub binary (linux/amd64, static)"
cd "$SCRIPT_DIR"

# Resolve real module version — run tidy if go.sum is absent.
if [[ ! -f go.sum ]]; then
  echo "==> go.sum absent — running go mod tidy to resolve versions"
  GOFLAGS=-mod=mod go mod tidy
fi

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags="-s -w" -o websub-hub ./cmd/hub

echo "==> Binary built: $(du -sh websub-hub | cut -f1) at $SCRIPT_DIR/websub-hub"

echo "==> Uploading binary to $REMOTE"
scp websub-hub "$REMOTE:/usr/local/bin/websub-hub"
ssh "$REMOTE" chmod 755 /usr/local/bin/websub-hub

echo "==> Creating websub system user (if absent)"
ssh "$REMOTE" 'id websub &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin websub'

echo "==> Creating /var/lib/websub data directory"
ssh "$REMOTE" 'install -d -o websub -g websub -m 750 /var/lib/websub'

echo "==> Installing systemd unit"
scp "$SCRIPT_DIR/hub-koad-io.service" "$REMOTE:/etc/systemd/system/hub-koad-io.service"
ssh "$REMOTE" systemctl daemon-reload

echo "==> Installing nginx vhost"
scp "$SCRIPT_DIR/nginx-hub.koad.io.conf" "$REMOTE:/etc/nginx/sites-available/hub.koad.io"
ssh "$REMOTE" 'ln -sf /etc/nginx/sites-available/hub.koad.io /etc/nginx/sites-enabled/hub.koad.io'
ssh "$REMOTE" nginx -t

echo "==> Enabling and starting hub-koad-io service"
ssh "$REMOTE" systemctl enable hub-koad-io
ssh "$REMOTE" systemctl restart hub-koad-io
ssh "$REMOTE" systemctl status hub-koad-io --no-pager

echo ""
echo "==> Next manual steps:"
echo "    1. DNS: add A record   hub.koad.io → 87.99.156.250"
echo "       (wait for propagation — check: dig hub.koad.io A)"
echo "    2. TLS: ssh $REMOTE certbot --nginx -d hub.koad.io"
echo "    3. Reload nginx: ssh $REMOTE systemctl reload nginx"
echo "    4. Smoke test:"
echo "       curl -s -o /dev/null -w '%{http_code}' https://hub.koad.io/hub"
echo "       (expect 200 or 400 — not 502)"
echo ""
echo "==> Deploy complete."
