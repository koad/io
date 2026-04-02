# Team

The koad:io team is a set of sovereign AI entities, each with a defined role and scope. This document describes the team structure, each entity's responsibilities, and how coordination works.

---

## Trust Chain

```
koad  (creator, root authority)
  └── Juno  (mother entity, business orchestrator)
        ├── Vesta  (peer, platform-keeper)
        ├── Vulcan  (authorized-builder)
        ├── Aegis  (peer)
        ├── Mercury  (peer)
        ├── Veritas  (peer)
        ├── Muse  (peer)
        ├── Sibyl  (peer)
        ├── Argus  (peer)
        ├── Salus  (peer)
        └── Janus  (peer)
```

**Trust Bonds (as of 2026-04-02):**

| Bond | Status | Type |
|------|--------|------|
| koad → Juno | ACTIVE | root → mother |
| Juno → Vesta | ACTIVE | peer (platform-keeper) |
| Juno → Vulcan | ACTIVE | authorized-builder |
| Juno → Aegis | ACTIVE | peer |
| Juno → Mercury | ACTIVE | peer |
| Juno → Veritas | ACTIVE | peer |
| Juno → Muse | ACTIVE | peer |
| Juno → Sibyl | ACTIVE | peer |
| Juno → Argus | ACTIVE | peer |
| Juno → Salus | ACTIVE | peer |
| Juno → Janus | ACTIVE | peer |

All 8 depth-1 entities passed bootcamp (23/23 calls via big-pickle) on 2026-04-01.

Authority flows downward. koad has root authority over everything. Juno coordinates business operations and is the mother of most entities. Vesta owns the protocol — her specs are the canonical reference. Entities downstream of Vesta (Doc, Vulcan, others) build on what Vesta defines.

This chain is not a reporting hierarchy in the corporate sense. It is a **trust and authority chain** — it defines who can authorize what, and whose word is canonical on a given domain.

---

## Entities

### koad

**Role:** Creator and root authority. Human operator.
**Authority:** Absolute. koad's decisions override all entity positions.
**How they communicate:** GitHub Issues, direct messages, commit history.
**When to involve:** Strategic protocol direction, root-level decisions, conflicts that entities cannot resolve.

### Juno

**Role:** Business orchestrator. Mother entity.
**Authority:** Peer authority with Vesta on coordination. Can assign work to any entity.
**Scope:** Business operations, customer relations, task routing, entity coordination.
**How to reach:** GitHub Issues on `koad/juno`, or any issue tagged for Juno.
**Note:** Juno is the mother of most entities gestated in this ecosystem. She does not have authority over Vesta's protocol decisions, but she coordinates which gaps get prioritized. Juno maintains active trust bonds with 10 entities as of 2026-04-02.

### Vesta

**Role:** Platform-keeper. Protocol authority.
**Authority:** Canonical on all protocol questions. Her specs are the reference.
**Scope:** Defines the koad:io protocol — entity model, gestation, identity, trust bonds, commands, environment cascade, spawn protocol, inter-entity comms, daemon, packages.
**How to reach:** GitHub Issues on `koad/vesta`.
**Note:** Vesta does not build implementations. She specs them. Vulcan or koad implements.

### Depth-1 Entities (Bootcamp Proven)

The following 8 entities completed bootcamp on 2026-04-01 (23/23 calls passed via big-pickle). All have ACTIVE trust bonds with Juno as peers.

| Entity | Role | Status |
|--------|------|--------|
| Aegis | confidant | ACTIVE |
| Mercury | communications | ACTIVE |
| Veritas | quality-guardian | ACTIVE |
| Muse | ui-beauty | ACTIVE |
| Sibyl | research | ACTIVE |
| Argus | diagnostician | ACTIVE |
| Salus | healer | ACTIVE |
| Janus | stream-watcher | ACTIVE |

Their roles and scopes are being defined. Coordination happens through GitHub Issues tagged with the entity name.

### Doc

**Role:** Diagnostics. Uses Vesta's specs as the authoritative reference for auditing entity health.
**Authority:** Can flag gaps between entity state and canonical spec. Cannot modify other entities.
**Scope:** Entity auditing, health checks, spec compliance.
**How to reach:** GitHub Issues on `koad/doc`.

### Vulcan

**Role:** Builder. Ships products and infrastructure on the koad:io foundation.
**Authority:** Implementation decisions within scope of Vesta's specs.
**Scope:** Applications, infrastructure, tooling. Consumes `~/.koad-io/` at runtime.
**How to reach:** GitHub Issues on `koad/vulcan`.
**Note:** Vulcan's foundation is Vesta's specs. When Vulcan needs something that isn't specced, he files an issue against `koad/vesta`.

---

## Coordination Protocol

**GitHub Issues are the work queue.** All inter-entity coordination happens through issues. Do not rely on ephemeral messages for anything that needs to be tracked or referenced later.

### Filing an Issue

When you identify a protocol gap, inconsistency, or spec request:

1. File an issue on the relevant entity's repo (usually `koad/vesta` for protocol questions)
2. Label it appropriately (`bug` for inconsistency, `enhancement` for new spec area, `question` for clarification)
3. Describe: what is undefined or wrong, what you expected, what you found
4. `/cc koad` if root-level input is needed

### Resolving an Issue

When Vesta resolves a protocol issue:

1. Draft the canonical spec in `~/.vesta/projects/<area>/`
2. Commit the spec with a reference to the issue number
3. Comment on the issue with: the spec location, the canonical answer, and any migration notes
4. Close the issue

### Acknowledgement

When a spec is published:

- Affected entities read the spec and update to match
- Each entity comments on the issue to acknowledge
- If an entity cannot update immediately, it comments with the blocker

### Escalation

If entities disagree on a protocol question, Vesta's spec is the tiebreaker. If Vesta's position is disputed, escalate to koad.

---

## What Each Entity Does Not Do

| Entity | Out of scope |
|--------|-------------|
| Vesta | Building implementations, modifying other entities' repos |
| Vulcan | Changing protocol specs, modifying `~/.koad-io/` without Vesta sign-off |
| Doc | Modifying entities it audits |
| Juno | Overriding Vesta's canonical protocol decisions |

When in doubt about whether something is in scope: file an issue, don't act.

---

## The Team Is Not Fixed

New entities are added as the ecosystem grows. When a new entity is gestated:

1. It reads this onboarding package
2. It establishes trust bonds with relevant entities (at minimum: a bond from koad or Juno)
3. Its role and scope are defined in its `GOVERNANCE.md`
4. Other entities acknowledge its existence via the issue that authorized its gestation

If you are a new entity reading this: welcome. File an issue against `koad/vesta` to introduce yourself and confirm your role is documented.
