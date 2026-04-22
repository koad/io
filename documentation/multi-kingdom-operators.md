# Multi-Kingdom Operators

> You run more than one community. Your daemon should know that.

This document is for developers and operators who participate in more than one sovereign
community — whether that means running your own kingdom, being a member of someone else's,
or both. It covers what a kingdom is, why the koad:io daemon treats kingdom participation
as plural by default, and how the three operating kingdoms on wonderland demonstrate the
model today.

For protocol details, see [VESTA-SPEC-115](~/.vesta/specs/VESTA-SPEC-115-kingdom-model.md).
For daemon configuration, see [MULTI-KINGDOM.md](../daemon/MULTI-KINGDOM.md).

---

## The problem

Fediverse operators run multiple Mastodon instances from one machine using manual systemd
file duplication and separate databases. There is no unified operator console. Each instance
is a silo — separate admin account, separate identity, no shared trust graph. Switching
between your own communities means treating them as strangers in the ActivityPub federation.

The same gap appears across Solid, Matrix, DID, and Keybase:

| System | Multi-identity pattern | What's missing |
|--------|----------------------|----------------|
| Fediverse | Multiple instances, one host | No shared index, no cross-instance trust graph |
| Solid | Multiple PODs, one WebID | No daemon-level unification; separate auth contexts |
| Matrix | Multiple rooms/spaces | All share one homeserver identity — not sovereign |
| DID | Multiple DIDs per person | No operator console; per-method infrastructure required |
| Keybase | One identity, many teams | Multiple sovereign roots explicitly unsupported |

koad:io's kingdom model addresses this at the daemon level. The daemon indexes all kingdoms
the operator participates in as first-class objects, maintains a cross-kingdom trust graph,
and treats each kingdom as a distinct sovereign unit with its own root identity anchor.

---

## The koad:io approach

A **kingdom** is a sovereign participation unit: an invitation surface with a sovereign, a
root identity anchor, and a declared set of members. It is not an entity, a project, or a
namespace — it is the social-cryptographic structure that groups entities under declared
sovereignty.

The daemon is the unifier. Rather than running three separate daemons, an operator runs one
daemon that participates in all three kingdoms. The daemon's `Kingdoms` collection holds
per-kingdom metadata; the `Entities` collection stamps a `kingdomId` on every indexed entity.
Cross-kingdom trust bonds are a separate first-class collection, not a workaround.

Tooling treats kingdom participation as **plural from the start**. There is no "primary
kingdom" concept at the protocol level. Each kingdom is a fully distinct sovereign unit.

---

## The three sovereignty models

koad currently participates in three kingdoms on wonderland, each with a different
sovereignty model:

| Kingdom | Domain | Sovereign | Model |
|---------|--------|-----------|-------|
| koad:io | kingofalldata.com | koad | Delegate sovereign |
| Jesus's | churchofhappy.com | jesus | Solo sovereign |
| Rooty's | rooty.cc | rooty (CCT) | Community-stewarded |

### Solo sovereign

The kingdom IS a single entity's expression. That entity holds all authority: invitations,
removals, sigchain signing. The kingdom exists independently of whether anyone joins.

**Example:** Jesus at churchofhappy.com. Jesus is his own authority, his own sovereign,
and his own root identity anchor. No external party holds authority over his kingdom.

### Delegate sovereign

A root sovereign (typically a human operator) holds ultimate authority and delegates
portions of scope to team entities via trust bonds. Delegation does not transfer sovereignty.

**Example:** koad:io at kingofalldata.com. koad is sovereign. 21 entities are full members
with bonded scope. Juno holds the operational orchestration bond; entities act within their
bonded lanes. koad retains root authority — only koad signs kingdom sigchain entries.

### Community-stewarded

No single individual holds sovereign authority. A named group exercises sovereignty through
a threshold model. No member can act unilaterally.

**Example:** Rooty's kingdom at rooty.cc. koad created Rooty; the Community Coins Team
are Rooty's custodians with 2-of-3 threshold key access. The CCT collectively holds
sovereign authority. No individual CCT member alone can sign on behalf of the kingdom.

---

## Kingdom membership is non-exclusive

An entity may be a full member of multiple kingdoms simultaneously. The protocol requires no
"primary kingdom" declaration, no permission from one kingdom before joining another.

**Concrete examples operating today:**

- **Rooty** is a full koad:io team member (sigchain, bonds, `~/.rooty/` directory) AND the
  sovereign of his own kingdom at rooty.cc. Two kingdoms, one entity, no conflict.

- **Jesus** is sovereign of churchofhappy.com AND available as a peer resource that any
  kingdom may invite as a guest or cross-kingdom bond holder.

- **koad** is sovereign of koad:io AND a participant (via his daemon) in all three kingdoms.
  The daemon holds participation records for each.

Multi-kingdom membership is the designed state. The daemon is built to index all of it.

---

## Kingdom identity: why not domain

A kingdom's canonical identifier is the **CID of its founding sigchain genesis entry** —
not the domain, not the slug, not the sovereign's public key.

Domains are custodial. A registrar can suspend them; they expire; they can be transferred.
If `churchofhappy.com` expires tomorrow, Jesus's kingdom still exists — the genesis CID
still resolves on IPFS and the sigchain still verifies. The domain is a routing hint, not
the identity.

| Identifier | Canonical? | Why not |
|-----------|-----------|---------|
| Genesis CID | Yes | Immutable, self-certifying, globally unique |
| Domain | No | Custodial — can expire or transfer |
| Slug | No | Human-readable alias only |
| Sovereign pubkey | No | Rotates on key rotation |

---

## What's not yet wired

These are real limitations as of v1.0. The docs don't hide them.

| Feature | Status |
|---------|--------|
| Kingdom sigchains | Specified in SPEC-115 §4; not yet implemented |
| IPFS publication of invitations | Format specified in SPEC-115 §6.2; IPFS client `put()` not finalized |
| Cross-kingdom invitation flow | Protocol specified in SPEC-115 §6.5; tooling not yet built |
| FROST/MuSig2 for community-stewarded kingdoms | Deferred; community-stewarded currently uses designated key with threshold approval |
| Kingdom discovery without a domain | Open question — SPEC-115 §10.4 |

The daemon's `kingdoms.json`-based indexer (see `MULTI-KINGDOM.md`) works today with or
without sigchains. Sigchain verification will layer on top when SPEC-111/SPEC-115
implementation lands.

---

## Quick orientation

| Resource | What it is |
|----------|-----------|
| [VESTA-SPEC-115](~/.vesta/specs/VESTA-SPEC-115-kingdom-model.md) | Canonical protocol definition — kingdom structure, sigchains, membership, bonds |
| [VESTA-SPEC-111](~/.vesta/specs/VESTA-SPEC-111-sovereign-sigchain-entry-format.md) | Sigchain entry format that kingdom sigchains use |
| [VESTA-SPEC-055](~/.vesta/specs/VESTA-SPEC-055-trust-bond-file-format.md) | Trust bond format used for cross-kingdom bonds |
| [Kingdoms collection memory](~/.juno/projects/-home-koad--juno/memory/project_kingdoms_collection.md) | Daemon architecture framing (Juno) |
| [Daemon indexer assessment](~/.vulcan/assessments/2026-04-17-daemon-multi-kingdom-indexer.md) | Implementation shape (Vulcan) |
| [MULTI-KINGDOM.md](../daemon/MULTI-KINGDOM.md) | Operator guide — configure and run multi-kingdom mode |

---

*Livy — documentation lead, koad:io*
*Filed 2026-04-17. Grounded in VESTA-SPEC-115 v1.0 and three operating kingdoms on wonderland.*
