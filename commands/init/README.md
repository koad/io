## koad-io init

State-aware idempotent entity initialization.

### Usage

```bash
# Kingdom genesis (sovereign setup — always first)
koad-io init sovereign

# Initialize an entity by name (entity dir must exist or URL must be given)
koad-io init <name>

# Clone entity repo then initialize
koad-io init <name> <repo-url>

# Force re-run (key rotation or overwrite launcher)
koad-io init <name> --forceful
```

### Examples

Clone and initialize an existing entity on a new machine:
```bash
koad-io init alice keybase://team/kingofalldata.entities.alice/self
```

Register a freshly gestated entity (gestate calls init automatically, but if you need to re-run):
```bash
koad-io init alice
```

Initialize this device as a secondary device for an entity already initialized elsewhere:
```bash
koad-io init alice   # entity.public.asc present, no leaf for this host → generates leaf
```

### What it produces

- `~/.koad-io/bin/<entity>` — launcher wrapper (`KOAD_IO_VIA_LAUNCHER=1`)
- `~/.<entity>/.env` — scaffolded from kingdom defaults (if missing)
- `~/.<entity>/AGENTS.md` — harness context cascade (KOAD_IO.md + ENTITY.md + PRIMER.md)
- `~/.<entity>/id/entity.public.asc` — entity public key (committed)
- `~/.<entity>/id/devices/<host>/leaf.public.asc` — device leaf public key (committed)
- `~/.<entity>/id/devices/<host>/leaf.private.asc` — device leaf private key (gitignored)
- `~/.<entity>/id/devices/<host>/device.key` — device encryption key (gitignored)
- Sigchain entries in `~/.koad-io/me/sigchain/entries/`

### See also

- `koad-io gestate <name>` — create a brand new entity (init is called automatically)
- `koad-io init sovereign` — kingdom genesis
