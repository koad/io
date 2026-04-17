<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/io/`

> Create, extract, and verify `.io` sovereign identity capsules.

## What this does

`io` packages an entity's public identity into a portable `.io` container: profile metadata, public keys, agent context files (CLAUDE.md, PRIMER.md), and optional context bubbles. The container is a ZIP archive with a `manifest.json` integrity index.

## Invocation

```bash
<entity> io create <entity>              # Create public capsule (excludes private context)
<entity> io create <entity> --full       # Include memories/ and all agent context
<entity> io extract <file.io>            # Extract to ./
<entity> io extract <file.io> --dry-run  # Preview contents without extracting
<entity> io verify <file.io>             # Verify container integrity via manifest
<entity> io list <file.io>               # List container contents
```

## Container structure

```
<name>.io   (ZIP archive)
├── manifest.json       — content hashes, version, creation timestamp
├── profile.json        — handle, role, description, URLs
├── keys.gpg            — public keys (GPG, ed25519, ecdsa, rsa)
├── avatar.png          — 2D avatar (if present)
├── agent/
│   ├── CLAUDE.md
│   ├── PRIMER.md
│   └── memories/       — full scope only
└── bubbles/            — public .bubble files (if present)
```

## What it expects

- `<entity>` — entity directory must exist at `~/.<entity>/`
- `CLAUDE.md` — required in the entity directory
- `zip`, `unzip` — available on PATH

## Notes

- Output is written to `~/<entity>.io`.
- `--full` scope includes `memories/` — may contain sensitive session context.
- `sigchain.json` is a placeholder pending VESTA-SPEC (koad/vesta#82).
- Public bubbles (`.bubble` files without `.private.bubble` suffix) are included by default.
