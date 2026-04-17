# doors/

This directory holds per-door configuration. Each door is a public entry point the garden serves.

## Adding a Door

1. Create a subdirectory named by FQDN:

   ```
   doors/
   └── trading.astro.brokerage/
       ├── config.yaml          — door config (required)
       └── nginx.conf.tmpl      — nginx template override (optional)
   ```

2. Write `config.yaml` per the schema below.

3. Run `control/deploy-door <fqdn>` to render and activate.

## Door config.yaml Schema

```yaml
fqdn: trading.astro.brokerage
service: nginx
protocol: https
upstream: http://localhost:3000   # where nginx proxies to
cert_provider: certbot             # or: manual, self-signed
description: "Astro trading interface"
enabled: true
```

## Removing a Door

Run `control/remove-door <fqdn>` — removes the nginx vhost and reloads nginx.
The `doors/<fqdn>/` directory is preserved for reference; delete manually if retiring permanently.

## Spec

VESTA-SPEC-119 §6 — Doors Convention
