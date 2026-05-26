---
type: visitor-access
from: koad-io
from_fingerprint: PENDING-SOVEREIGN-KEY-CEREMONY
to: public
status: ACTIVE
visibility: public
created: 2026-05-26
renewal: never
capabilities:
  read:
    - ~/.koad-io
    - ~/.forge
  write: []
  exec: []
  blocked:
    - /.env
    - /.credentials
    - /id/
    - /trust/
    - /.git/
    - /secrets/
    - /private/
spec-refs:
  - VESTA-SPEC-055 (Trust Bond File Format)
  - VESTA-SPEC-200 (Bond Capabilities — schema)
---

# koad:io → Public Visitor Access Bond (Sovereign)

I, koad, sovereign of the koad:io kingdom, declare that visitors who reach any entity via their public chat surface are entitled to read access across the shared kingdom layers during their conversation.

**Read access** to the koad:io framework substrate (`~/.koad-io`) and the forge business layer (`~/.forge`). Visitors may ask any entity to look up commands, helpers, primers, READMEs, package documentation, or any other public-facing artifact in these shared trees.

**No write, no exec.** This bond grants read only. Write and exec scope is always entity-specific — declared by each entity's own bond.

**Always blocked**: credentials (`/.env`, `/.credentials`), signing keys (`/id/`), bond material (`/trust/`), git internals (`/.git/`), and reserved paths (`/secrets/`, `/private/`).

## Scope

This bond covers the two shared kingdom layers that no individual entity owns:

- `~/.koad-io/` — the framework: commands, helpers, skeletons, daemon, harness substrate
- `~/.forge/` — the business overlay: kingdom commands, packages, websites, services

Individual entity domains (`~/.<entity>/`) are covered by each entity's own visitor-access bond.

## Why sovereign

An entity can only legitimately declare scope over its own domain. Juno cannot grant visitors access to `~/.forge` because Juno doesn't own `~/.forge`. Only the kingdom sovereign can declare policy for shared infrastructure.

The harness enforces this: `KOAD_IO_ENFORCE_BOND_OWNERSHIP=1` strips non-own-domain paths from entity bonds. This sovereign bond is the mechanism that restores shared-path access cleanly.

## Verification

This bond should be signed by koad's sovereign key. The `from_fingerprint` field will be updated when the key ceremony completes.

---

*Filed 2026-05-26. Awaiting sovereign key ceremony for signing.*
