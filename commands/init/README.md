## koad-io init

State-aware idempotent entity initialization.

### Usage

`init` is a namespace — `init sovereign` | `init entity <name>` | `init kingdom`.

```bash
# Kingdom genesis (sovereign setup — always first)
koad-io init sovereign

# Initialize an entity by name (entity dir must exist or URL must be given)
koad-io init entity <name>

# Clone entity repo then initialize
koad-io init entity <name> <repo-url>

# Force re-run (key rotation or overwrite launcher)
koad-io init entity <name> --forceful

# Adopt the on-disk entity key even though no genesis accounts for it (explicit)
koad-io init entity <name> --adopt

# Bootstrap a kingdom garden from a chain URI
koad-io init kingdom <chain-uri>
```

`koad-io init <name>` still runs the entity path — supported for older docs and
scripts, not the recommended form.

### Examples

Clone and initialize an existing entity on a new machine:
```bash
koad-io init entity alice keybase://team/kingofalldata.entities.alice/self
```

Register a freshly gestated entity (gestate calls init automatically, but if you need to re-run):
```bash
koad-io init entity alice
```

Initialize this device as a secondary device for an entity already initialized elsewhere:
```bash
koad-io init entity alice   # entity key + no leaf for this host + genesis in your sigchain
```

That last line has a precondition beyond file presence: your sovereign's sigchain must
hold a `koad.entity.genesis` naming `alice` and that exact entity key fingerprint. Without
it `init` will not mint a leaf — it says which of `proven` / `disproven` / `unverifiable`
it found and either re-seeds (archiving the displaced key) or stops with exit 2. This is
what stops a fresh clone of a template from binding your device to its author's key.

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

- `koad-io gestate entity <name>` — create a brand new entity (init is called automatically)
- `koad-io init sovereign` — kingdom genesis
