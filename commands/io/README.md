# koad-io io — Sovereign Identity Capsule Format

Creates and extracts portable `.io` identity capsules for koad:io entities and humans.

## Overview

The `.io` file is a portable sovereign identity capsule — a signed container holding everything that defines an entity or human identity. Like a game cartridge: plug it in, get the full persona.

## Container Structure

```
<name>.io/
├── manifest.json         ← Index, format version, content hashes, signatures
├── profile.json         ← Structured identity (name, role, description)
├── avatar.png          ← 2D avatar render (optional)
├── keys.gpg            ← Public keys (Ed25519, ECDSA, RSA, GPG)
├── sigchain.json       ← Signature chain provenance (pending Vesta spec)
├── agent/              ← Agent files
│   ├── CLAUDE.md
│   ├── PRIMER.md
│   └── memories/       ← (full scope only)
└── bubbles/            ← Named context bubbles
    └── <name>.bubble
```

## Usage

```bash
# Create public capsule (excludes private memories)
koad-io io create juno

# Create full capsule (includes memories)
koad-io io create juno --full

# Extract capsule
koad-io io extract juno.io

# Verify integrity
koad-io io verify juno.io

# List contents
koad-io io list juno.io
```

## Scopes

### Public (default)
- `profile.json` — identity info
- `keys.gpg` — public keys
- `avatar.png` — 2D avatar
- `agent/CLAUDE.md` — entity definition
- `agent/PRIMER.md` — current state
- `bubbles/` — public context bubbles

### Full
Everything in public, plus:
- `agent/memories/` — full session context

## Addressable URLs

When hosted on kingofalldata.com:

| URL | Content |
|-----|---------|
| `kingofalldata.com/<name>` | Profile page |
| `kingofalldata.com/<name>.png` | Avatar |
| `kingofalldata.com/<name>.json` | Structured profile |
| `kingofalldata.com/<name>.gpg` | Public keys |
| `kingofalldata.com/<name>.io` | Full identity capsule |

## Dependencies

- **sigchain.json**: Signature chain format pending [VESTA spec](https://github.com/koad/vesta/issues/82)
- **3D avatar (model.glb)**: Pending Sibyl research

## See Also

- [VESTA-SPEC-053: Entity Portability Contract](https://github.com/koad/vesta/blob/main/specs/VESTA-SPEC-053-entity-portability-contract.md)
- [VESTA-SPEC-016: Context Bubble Protocol](https://github.com/koad/vesta/blob/main/specs/context-bubble-protocol.md)
