# websub-hub

WebSub hub for koad:io sovereign atom feed distribution.

Wraps [`tystuyfzand/websub-server`](https://github.com/tystuyfzand/websub-server) (Go, ISC license) with BoltDB embedded storage. Runs as a single static binary behind nginx on `hub.koad.io` (zero.koad.sh, 87.99.156.250).

## Architecture

```
Publisher (build-feed.sh ping)
  │
  └─► POST https://hub.koad.io/hub  (hub.mode=publish, hub.url=<feed-url>)
        │
        └─► Hub fetches feed.atom from raw.githubusercontent.com
              │
              └─► POST verbatim feed bytes to each subscriber callback URL
```

The hub is signature-agnostic. Ed25519 signatures embedded in feed XML by Sibyl pass through unchanged (W3C WebSub spec §5 — verbatim delivery). No Phase 2 changes required.

## Files

| File | Purpose |
|------|---------|
| `cmd/hub/main.go` | Go binary wrapper — BoltDB store, stdlib HTTP |
| `go.mod` | Module definition; run `go mod tidy` to resolve |
| `hub-koad-io.service` | systemd unit — User=websub, restart on failure |
| `nginx-hub.koad.io.conf` | nginx vhost — proxy to :8080, certbot-ready |
| `deploy.sh` | One-shot build + deploy to zero.koad.sh |

## Deploy

```bash
# Requires Go 1.21+ and ssh access to zero.koad.sh as root.
./deploy.sh

# Then manually (once DNS propagates):
ssh root@87.99.156.250 certbot --nginx -d hub.koad.io
ssh root@87.99.156.250 systemctl reload nginx

# Smoke test:
curl -s -o /dev/null -w '%{http_code}' https://hub.koad.io/hub
# expect 200 or 400, not 502
```

## Publisher integration

Add to `build-feed.sh` after signing (Phase 2 output):

```bash
curl -s -X POST https://hub.koad.io/hub \
  -d "hub.mode=publish" \
  -d "hub.url=https://raw.githubusercontent.com/koad/sibyl/main/feed.atom"
```

Add to `feed.atom` header:

```xml
<link rel="hub"  href="https://hub.koad.io/hub"/>
<link rel="self" href="https://raw.githubusercontent.com/koad/sibyl/main/feed.atom"/>
```

Optional fallback hub (multiple `<link rel="hub">` allowed by spec):

```xml
<link rel="hub" href="https://websubhub.com"/>
```

## Blockers before Phase 3 goes live

- DNS: `hub.koad.io` A record → 87.99.156.250 (koad must add)
- Vesta SPEC-101 response on blob-hash canonical URLs (koad/sibyl#31) — hub can be tested before this resolves, but `<link rel="alternate">` URLs in feed should not be finalized until Vesta responds

## Research

`~/.sibyl/research/2026-04-18-websub-hub-deployment-options.md`
