---
audience: users who understand sovereign sigchains (VESTA-SPEC-111) and want to understand kingdoms as the next layer up
see-also:
  - docs/multi-kingdom-operators.md  (conceptual overview — read this first if you're new to the topic)
  - daemon/MULTI-KINGDOM.md          (operator guide — configuring kingdoms.json)
  - VESTA-SPEC-115 v1.4              (canonical protocol definition)
---

# Kingdom Model

A kingdom is a sovereign participation unit. It is the answer to: *what does a community look like when it is built out of sovereign sigchains?*

This doc explains the data model — what a kingdom is as a structure, how the three sovereignty models behave differently, how membership works, and why genesis CID is the identifier.

---

## What a kingdom is (as a structure)

A kingdom has three required parts:

| Part | What it is |
|------|-----------|
| **Sovereign** | A single entity (or defined multi-custodian arrangement) that holds root authority: who may join, who may be removed, what the kingdom stands for |
| **Invitation surface** | A public interface through which the kingdom can extend invitations — a domain, a URL, a genesis CID |
| **Root identity anchor** | The `koad.kingdom-genesis` sigchain entry that establishes the kingdom's cryptographic identity — immutable, self-certifying, globally unique |

A group without a sovereign is a collective. A sovereign without an invitation surface is a private entity. Without the root identity anchor, there is no protocol-level verifiability. All three are required.

The kingdom's own sigchain (kingdom-level) is a separate chain from the sovereign's personal sigchain. The sovereign entity (e.g., koad, jesus) has their own sigchain. The kingdom they govern has a distinct chain, signed with the same key but recording kingdom-level state: member additions, member removals, state updates.

---

## Genesis CID as canonical identifier

The kingdom's permanent canonical identifier is the **CID of the `koad.kingdom-genesis` entry** — not the domain, not the slug, not the sovereign's public key.

**Why not domain:** Domains are custodial. A registrar can suspend them; they expire; they transfer. If `churchofhappy.com` expires tomorrow, Jesus's kingdom still exists. The genesis CID still resolves on IPFS. The sigchain still verifies. The domain is a routing hint; the genesis CID is the identity.

**Why not sovereign pubkey:** The sovereign can rotate their key. VESTA-SPEC-111 `koad.key-rotation` entries handle this. If the sovereign pubkey were the kingdom identifier, every key rotation would appear to create a new kingdom — which is wrong. The genesis CID is computed once and never changes.

**Concrete example:**

```
Kingdom: koad:io
Domain: kingofalldata.com        ← routing hint, may change
Slug: koad-io                    ← human alias, permanent but not the identity
Canonical identifier: <CID of the koad.kingdom-genesis entry>
```

The genesis CID is what a verifier uses when it needs to ask "is this the same kingdom I indexed last month?"

---

## Pre-sigchain kingdoms

Every kingdom starts in **pre-sigchain state**: the sovereign has declared the kingdom (slug, domain, sovereignty model) but hasn't yet published the `koad.kingdom-genesis` sigchain entry.

This is not an error state. It is the normal starting condition. Every operating kingdom on wonderland is currently in pre-sigchain state.

In pre-sigchain state:
- The slug is the provisional identifier (`_id` in the Kingdoms collection is the slug)
- `kingdom_genesis_cid` in invitations and membership entries is `null` — valid but binds membership by slug only, not by cryptographic anchor
- Membership records are provisional until the genesis sigchain establishes the CID-anchored identity

When a kingdom publishes its genesis entry, the slug migrates to an alias and the genesis CID becomes the permanent `_id`. This migration is defined in SPEC-115 §2.6.

---

## The three sovereignty models

### Solo sovereign

One entity holds all authority. Invitations, removals, and sigchain signing are that entity's alone. The kingdom exists independently of whether anyone joins.

**Behavioral signature:** No one can act on the kingdom's behalf. No delegation, no deputies. The sovereign's personal Ed25519 key signs every kingdom sigchain entry.

**Current example:** Jesus at `churchofhappy.com`. Jesus is his own authority. His kingdom exists whether or not anyone is invited into it.

### Delegate sovereign

A root sovereign holds ultimate authority and delegates portions of scope to team entities via trust bonds (VESTA-SPEC-055). Delegation does not transfer sovereignty — only the sovereign signs kingdom-level sigchain entries.

**Behavioral signature:** The kingdom has a team. That team acts within bonded scope (orchestration, documentation, security review, etc.). But only the root sovereign can add or remove members from the kingdom sigchain, and only the root sovereign's key signs those entries.

**Current example:** koad:io at `kingofalldata.com`. koad is sovereign. 21 entities are full members with bonded scope. Juno holds the orchestration bond; Vulcan the build bond; Livy the documentation bond. koad's key signs kingdom sigchain entries. Juno's key does not.

### Community-stewarded

No single individual holds sovereign authority. A named group holds it collectively through a threshold arrangement (VESTA-SPEC-112 §5).

**Behavioral signature:** Unilateral action by any one member is not sufficient to sign kingdom sigchain entries. The CCT's 2-of-3 threshold governs decisions. Before FROST threshold cryptography is implemented, a designated CCT key holder acts as the physical signer on behalf of the group — but the authority is the CCT's, not the individual's.

**Current example:** Rooty's kingdom at `rooty.cc`. koad created Rooty; the Community Coins Team are Rooty's custodians with 2-of-3 threshold key access. No individual CCT member is the sovereign; the CCT collectively is.

---

## How membership works

Membership is bilateral. Both sides must record it.

**The two records:**

1. **Kingdom-side:** The sovereign publishes a `koad.kingdom-member-add` entry in the kingdom sigchain, naming the new member and referencing the invitation artifact.
2. **Entity-side:** The joining entity publishes a `koad.kingdom-join` entry in their own personal sigchain, naming the kingdom (by genesis CID when available, by slug in pre-sigchain state) and referencing the invitation CID.

A kingdom-side record without an entity-side record is a pending invitation, not membership. An entity-side record without a kingdom-side record is unilateral and not recognized.

**Joining:**

1. Sovereign issues a signed invitation artifact (published to IPFS, obtaining a CID)
2. Invitee verifies the invitation's signature against the sovereign's current key
3. Invitee publishes `koad.kingdom-join` in their personal sigchain
4. Invitee communicates the acceptance CID to the sovereign (out-of-band)
5. Sovereign publishes `koad.kingdom-member-add` in the kingdom sigchain

Membership is effective from the kingdom-side record.

**Leaving:**

An entity leaves voluntarily by publishing `koad.kingdom-leave` in their personal sigchain. The sovereign acknowledges with `koad.kingdom-member-remove` in the kingdom sigchain. Historical membership records are preserved — departure doesn't erase the record of having joined.

The sovereign may also remove a member unilaterally via `koad.kingdom-member-remove`. The entity may publish a `koad.kingdom-leave` entry for completeness; they are not required to.

---

## Entity identity vs. kingdom identity

An entity's identity — their Ed25519 keypair, their personal sigchain — is entirely theirs. It does not belong to the kingdom. A kingdom is a scope the entity participates in, not the entity's identity container.

Concrete behavior this produces: **membership is non-exclusive**. An entity may be a full member of multiple kingdoms simultaneously. No kingdom can veto another's invitation. No entity needs to declare a "primary kingdom."

**Current examples:**

- Rooty is a full koad:io team member (bonded scope, `~/.rooty/` directory) AND the sovereign of `rooty.cc`. Two kingdoms, one entity, no conflict.
- Jesus is sovereign of `churchofhappy.com` AND available as a peer resource that any kingdom may invite or cross-bond with.
- koad is sovereign of koad:io AND participant in all three kingdoms via his daemon.

The daemon treats kingdom participation as plural from the start. There is no "primary kingdom" concept at the protocol level.

---

## Querying kingdoms in the daemon

When multi-kingdom mode is enabled (`KOAD_IO_INDEX_KINGDOMS=true`), the Kingdoms collection holds one record per kingdom:

```js
// All kingdoms the daemon indexes
Kingdoms.find().fetch()

// Entities in a specific kingdom
Entities.find({ kingdomId: 'koad-io' }).fetch()

// Verify a specific entity's membership context
Entities.findOne({ handle: 'rooty' })
// { handle: 'rooty', kingdomId: 'rooty', sovereignKingdom: 'rooty', ... }

// Cross-kingdom bonds
CrossKingdomBonds.find({ fromEntity: 'jesus' }).fetch()
```

The `_id` in the Kingdoms collection is currently the slug (pre-sigchain state). When kingdom genesis sigchains are established, `_id` migrates to the genesis CID per SPEC-115 §2.6.

For setup instructions, see [daemon/MULTI-KINGDOM.md](../daemon/MULTI-KINGDOM.md).

---

## Current state

| Feature | Status |
|---------|--------|
| `kingdoms.json`-based indexer | Operational — see `daemon/MULTI-KINGDOM.md` |
| Kingdom sigchains (genesis, member-add, member-remove) | Specified in SPEC-115 §4; not yet published for any kingdom |
| IPFS publication of invitation artifacts | Format specified in SPEC-115 §6.2; IPFS client `put()` not finalized |
| Bilateral invitation acceptance flow | Protocol specified in SPEC-115 §6.3–6.4; tooling not yet built |
| Sigchain-verified membership | Will replace `kingdoms.json` declaration when sigchain indexer ships |
| FROST threshold signing for community-stewarded | Deferred — see SPEC-115 §8.3 and §10 |

For the full protocol definition and all entry type schemas, see VESTA-SPEC-115 v1.4.

---

*Livy — documentation lead, koad:io*
*Filed 2026-04-17. Grounded in VESTA-SPEC-115 v1.4 and three operating kingdoms on wonderland.*
*Audience: users who have read or used SPEC-111 sigchains and want to understand kingdoms as the next layer up.*
