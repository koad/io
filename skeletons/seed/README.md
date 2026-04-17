# Seed Skeleton

A seed is a deployed VPS that serves as infrastructure for kingdom members' doors.
This skeleton scaffolds the local operator workspace for a seed deployment.

**Spec:** VESTA-SPEC-120 (Seed Protocol)

---

## What a Seed Is

The seed is the first server of an operator's or kingdom's deployed infrastructure.
It typically runs: nginx, certbot, Netbird management, IPFS gateway, STUN/TURN.

Spawn creates the local workspace. Deploy creates the actual server on Hetzner.

---

## Spawn a Seed

### Interactive (whiptail walkthrough)

```bash
alice spawn seed --path ~/seeds/zero
```

The installer prompts for name, domain, datacenter, and services.

### Non-interactive (Alice-friendly, all flags pre-filled)

```bash
alice spawn seed \
  --path ~/.juno/devices/zero.koad.sh \
  --operator juno \
  --name zero \
  --domain zero.koad.sh \
  --datacenter ash-dc1 \
  --services netbird_management,ipfs_gateway,stun_turn,nginx,certbot
```

No TUI fires when all required fields are present. Safe for automation and Alice curricula.

### Path cases

- If `--path` points to an entity dir (has `ENTITY.md`): seed embeds into `<path>/devices/<name>/`
- Otherwise: seed scaffolds at `--path` directly

---

## After Spawn

```
1. Review manifest:      $WORKDIR/manifest.yaml
2. Reserve your IP:      $WORKDIR/control/provision-ip
3. Deploy seed:          $WORKDIR/control/deploy
4. Verify:               $WORKDIR/control/verify
5. Install hook:         $WORKDIR/control/install-device-hook
6. Pull DH params back:  $WORKDIR/control/pull-dh-back   (if generated on-box)
```

---

## File Tree After Spawn

```
$WORKDIR/
├── manifest.yaml          — source of truth; all control scripts read this
├── README.md              — this file (with your seed's values substituted)
├── devices/
│   ├── .gitkeep
│   ├── .spawn.json        — spawn log
│   └── <domain>.json      — device record (written by control/deploy)
├── cloud-init/
│   ├── seed.yaml.template — cloud-init template
│   └── <domain>-cloud-init.yaml — generated at deploy time (audit copy)
├── nginx/
│   └── seed.conf.template — nginx vhost template
└── control/
    ├── provision-ip
    ├── deploy
    ├── verify
    ├── install-device-hook
    ├── pull-dh-back
    ├── destroy-server
    └── destroy-seed        (stub — SPEC-120 §15.1)
```

---

## Device Hook

After `control/install-device-hook`:

```bash
zero.koad.sh screen -ls
zero.koad.sh df -h
```

Routes to `juno@zero.koad.sh` via `~/.juno/id/ed25519`. Precedent: `~/.koad-io/bin/missouri`.

---

## Reference

- [VESTA-SPEC-120](~/.vesta/specs/VESTA-SPEC-120-seed-protocol.md) — canonical spec
- [VESTA-SPEC-119](~/.vesta/specs/VESTA-SPEC-119-garden-protocol.md) — garden protocol (sibling)
- `~/.koad-io/skeletons/bare/` — skeleton pattern reference
