# Garden Skeleton

A garden embeds into an existing entity directory, turning the entity into a complete
operational unit: identity, memory, commands, and the production surface (doors, devices,
projects) all in one place.

**Spec:** VESTA-SPEC-119 (Garden Protocol v1.1)
**Sibling:** VESTA-SPEC-120 (Seed Protocol) — devices in a garden are seeds per SPEC-120.

---

## What Gets Added

Running the garden install embeds these into the target entity dir (non-destructively):

```
~/<entity>/
├── manifest.yaml          — garden config (name, operator, purpose, doors, devices)
├── GARDEN.md              — human-readable garden description
├── doors/                 — per-door config directories
│   └── README.md
├── devices/               — device records for deployed seeds
│   ├── .archive/          — destroyed seed records (timestamped, history-preserving)
│   └── README.md
├── projects/              — the actual work (freeform; skeleton only creates the dir)
│   └── README.md
├── control/
│   ├── status             — show garden state
│   ├── deploy-door        — wire up a door (nginx vhost + cert)
│   ├── remove-door        — take a door down
│   ├── sync-doors         — make nginx state match manifest
│   ├── verify-doors       — HTTP(S) reachability check for all enabled doors
│   └── list-seeds         — enumerate devices (active + archived)
└── nginx/
    └── door.conf.template — per-door nginx vhost template
```

Existing entity files (ENTITY.md, commands/, memories/, id/, trust/, GOVERNANCE.md,
PRIMER.md) are **never touched**.

---

## How to Spawn

### Interactive

```bash
ENTITY=astro TARGET=~/.astro SKELETON=~/.koad-io/skeletons/garden \
  bash ~/.koad-io/skeletons/garden/control/install
```

Whiptail prompts for missing fields.

### Non-Interactive (Alice-friendly)

All required flags provided — no prompts, fully silent:

```bash
ENTITY=astro TARGET=~/.astro SKELETON=~/.koad-io/skeletons/garden \
  bash ~/.koad-io/skeletons/garden/control/install \
    --path ~/.astro \
    --name astro-production \
    --operator astro \
    --purpose "Astro trading interface and market data" \
    --doors trading.astro.brokerage,market.astro.brokerage \
    --devices zero.koad.sh
```

### Test Spawn (Throwaway)

```bash
mkdir /tmp/test-garden && echo "# Test" > /tmp/test-garden/ENTITY.md
TARGET=/tmp/test-garden ENTITY=test SKELETON=~/.koad-io/skeletons/garden \
  bash ~/.koad-io/skeletons/garden/control/install \
    --name test-garden --purpose "skeleton test"
cat /tmp/test-garden/manifest.yaml
/tmp/test-garden/control/status
rm -rf /tmp/test-garden
```

---

## After Spawning

```bash
# Review and edit
vi ~/.astro/manifest.yaml

# Check status
~/.astro/control/status

# Add a door
mkdir -p ~/.astro/doors/trading.astro.brokerage
cat > ~/.astro/doors/trading.astro.brokerage/config.yaml <<EOF
fqdn: trading.astro.brokerage
service: nginx
protocol: https
upstream: http://localhost:3000
cert_provider: certbot
description: "Astro trading interface"
enabled: true
EOF
~/.astro/control/deploy-door trading.astro.brokerage

# Spawn a seed into this garden's devices/
alice spawn seed --path ~/.astro/devices/zero.koad.sh --operator astro
```

---

## Idempotency

- Spawning again on a dir that already has `manifest.yaml` exits cleanly with no changes.
- All `control/` scripts are idempotent (running twice = same result as once).
- `deploy-door` is safe to re-run; it skips cert issuance if cert already exists.

---

## Spec References

- **VESTA-SPEC-119** — Garden Protocol (this skeleton)
- **VESTA-SPEC-120** — Seed Protocol (devices in a garden are seeds per SPEC-120)
- **VESTA-SPEC-066** — Skeleton Spawn Convention (this skeleton follows this convention)
- **VESTA-SPEC-102** — No Hardcoded Values (manifest-driven config)
