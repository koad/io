# trust/ — Sovereign Trust Surface

This folder holds bonds signed by the kingdom sovereign (koad). These bonds declare policy for shared infrastructure that no individual entity owns.

## What lives here

- **`bonds/`** — sovereign-level bonds. Currently: the kingdom-wide visitor-access bond granting read on `~/.koad-io` and `~/.forge` to all entity chat surfaces.

## Why here and not in an entity dir

Entity bonds cover entity domains. `~/.juno/trust/bonds/juno-to-public-visitor.md` declares what visitors to Juno get within `~/.juno`. But `~/.forge` and `~/.koad-io` don't belong to any entity — they belong to the framework and the kingdom.

Only the sovereign can declare policy for shared paths. This folder is where that policy lives.

## How the harness uses this

The harness loads sovereign bonds alongside entity bonds in `resolveScope()`. The visitor's effective scope is the merge of both — entity-specific access from the entity's bond, shared-path access from the sovereign bond.

When `KOAD_IO_ENFORCE_BOND_OWNERSHIP` is set, entity bonds that declare paths outside their own domain are silently stripped. The sovereign bond is the only way to restore access to shared paths.
