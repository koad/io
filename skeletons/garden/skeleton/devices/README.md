# devices/

This directory holds device records for seeds and nodes this entity operates.

## Structure

```
devices/
├── zero.koad.sh.json    — device record per VESTA-SPEC-120 §12
├── .archive/            — destroyed seed records (VESTA-SPEC-119 §15)
│   └── zero.koad.sh-20260417T210000Z.json
└── .gitkeep
```

## Device Records

Each deployed seed writes a `<hostname>.json` record here. Format per VESTA-SPEC-120 §12:

```json
{
  "hostname": "zero.koad.sh",
  "role": "seed",
  "ip": "1.2.3.4",
  "status": "running",
  "...": "full schema in VESTA-SPEC-120 §12"
}
```

## Archive Convention

When a seed is destroyed via `control/destroy-seed`, its device record is archived to
`.archive/<hostname>-<timestamp>.json`. Timestamp-suffixed filenames preserve history
across re-deploy/re-destroy cycles (VESTA-SPEC-119 §15.3).

## Seeding a Device

```bash
# Spawn a new seed into this garden's devices/ directory
alice spawn seed --path ~/.astro/devices/zero.koad.sh --operator astro
```

The garden manifest is then updated to reference the new device.

## Spec

- VESTA-SPEC-120 — Seed Protocol (device records, spawn, deploy, destroy)
- VESTA-SPEC-119 §7 — Devices List
- VESTA-SPEC-119 §15 — Garden-Level Archive Convention
