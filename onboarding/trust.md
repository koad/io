---
id: spec-trust-bond
title: "Trust Bond Specification"
type: spec
status: review
priority: 1
assigned_by: vesta
issue: ""
created: 2026-03-31
updated: 2026-04-02
tags: [protocol, trust, security]
description: "Canonical trust bond protocol — signed authorization agreements between entities"
owner: vesta
---

# Trust Bonds

A trust bond is a signed authorization agreement between two parties. It answers the question: *"Is this entity actually authorized to do what it says it can do?"*

Trust bonds are how the koad:io system establishes verifiable relationships without relying on blind faith or platform-imposed permissions.

---

## What a Trust Bond Is

A trust bond is a document, signed cryptographically by the grantor, that states:

- **Who** is being authorized (the grantee)
- **What** they are authorized to do (the scope)
- **Under what conditions** (constraints)
- **By whom** (the grantor, with their signature)

The signature is the trust. Without a valid signature from the grantor, the bond is meaningless.

**Example:** koad grants Juno authorization to operate business operations up to certain limits. That authorization is written into a bond file, signed with koad's key, and stored in `~/.juno/trust/bonds/`. When Juno needs to prove she's authorized to act on koad's behalf, she presents the bond. Anyone with koad's public key can verify it.

---

## Where Bonds Live

```
~/.entityname/trust/
└── bonds/
    ├── <grantor>-to-<grantee>.md       Bond document (human-readable)
    ├── <grantor>-to-<grantee>.md.asc    Clearsigned version
    └── revoked/                         Revoked bonds (archived, not deleted)
```

**Naming convention:** `<grantor>-to-<grantee>.md`

Examples:
- `koad-to-juno.md` — koad authorized Juno
- `juno-to-vesta.md` — Juno established a peer bond with Vesta
- `juno-to-vulcan.md` — Juno authorized Vulcan as builder

The grantee name is essential for filing and lookup — bonds are bilateral relationships, not capability badges.

---

## Bond File Format

Each bond is TWO files:

1. **Source document** (`<grantor>-to-<grantee>.md`): Human-readable Markdown
2. **Clearsigned version** (`<grantor>-to-<grantee>.md.asc`): GPG armored signature embedding the source

Bond document structure:

```markdown
# Trust Bond: <Grantor> → <Grantee>

**Type:** authorized-agent | authorized-builder | peer | customer | member
**From:** Grantor (`grantor@<operator-domain>`)
**To:** Grantee (`grantee@<operator-domain>`)
**Status:** DRAFT | ACTIVE | REVOKED
**Visibility:** private | public
**Created:** YYYY-MM-DD
**Renewal:** Annual (YYYY-MM-DD) | none

## Bond Statement
[Single paragraph, first-person from grantor]

## Authorized Actions
[Explicit list of what IS authorized]
[Explicit list of what is NOT authorized]

## Trust Chain
[ASCII diagram showing chain from koad]

## Signing
[Checklist showing who has signed and acknowledged]

## Revocation
[Standard revocation clause]
```

---

## How to Read a Bond

When you encounter a bond:

1. **Identify the grantor** — whose authority backs this bond?
2. **Check the scope** — what exactly is authorized? Read it precisely. Do not infer beyond what is written.
3. **Check constraints** — what is explicitly excluded or limited?
4. **Verify the signature** — confirm the grantor's key signed this document

Do not treat a bond as granting anything beyond its explicit scope. If the bond says "authorize up to $500," it does not authorize $501.

---

## Verifying a Bond

To verify a bond, you need the grantor's public key. Public keys are distributed at:

```
canon.koad.sh/<entityname>.keys
```

### Verification with GPG

```bash
# Import grantor's public key
curl canon.koad.sh/koad.keys | gpg --import

# Verify the bond
gpg --verify koad-to-juno.md.asc
```

A valid signature confirms:
- The document was signed by the stated grantor
- The document has not been modified since signing

**Note:** There will always be a warning "not a detached signature; file was NOT verified" — this is expected for clearsign format. The content is embedded in the .asc file, not a separate verification against the .md.

An invalid or missing signature means the bond cannot be trusted.

---

## Bond Types

| Type | Meaning | Used For |
|------|---------|----------|
| `authorized-agent` | Grantee may act on grantor's behalf within scope | koad→Juno |
| `authorized-builder` | Grantee builds as directed by grantor | Juno→Vulcan |
| `peer` | Mutual coordination rights between peer entities | Juno→{Vesta, Mercury, Veritas, etc.} |
| `customer` | Business customer relationship | TBD |
| `member` | Community membership | TBD |

---

## Signing Tools

Two paths depending on entity type:

### Human Grantor (e.g., koad)

```bash
keybase pgp sign --clearsign --infile <bond>.md --outfile <bond>.md.asc
```

- Keybase pops a GUI password dialog
- User enters PGP key passphrase (not Keybase account password)
- **This IS the consent gesture** — passphrase entry = explicit authorization

### AI Entity Grantor (Juno, Vesta, etc.)

```bash
gpg --clearsign --default-key <entity>@<operator-domain> \
  --output <bond>.md.asc <bond>.md
```

- No passphrase (AI entity key has no passphrase — the entity IS the key)
- Fully autonomous

---

## Bond Copy Protocol

Every bond is filed in BOTH entities' trust directories:

- `~/.grantor/trust/bonds/<grantor>-to-<grantee>.md.asc`
- `~/.grantee/trust/bonds/<grantor>-to-<grantee>.md.asc`

For entities not yet gestated, the grantee copy is noted as pending in the Signing section of the bond doc.

---

## Acknowledgement

The grantee edits their copy of the bond to check off the acknowledgement line:

```
[x] Vesta acknowledges signing — 2026-04-02
    Acknowledged: Juno→Vesta peer bond received. Protocol alignment begins.
```

The acknowledgement is a git commit, not another signature.

---

## Creating a Bond

Bond creation requires both parties:

1. **Draft** the bond document — grantor and grantee agree on scope and constraints
2. **Sign** — grantor signs the document with their private key (GPG or Keybase)
3. **Distribute** — signed bond is stored in both grantor's and grantee's `trust/bonds/`
4. **Acknowledge** — grantee commits acknowledgement

Never self-sign a bond. A bond you signed yourself proves nothing about the grantor's authorization.

---

## Revoking a Bond

Revocation is explicit — bonds are never silently deleted.

1. Grantor signs a revocation document referencing the original bond
2. Original bond is moved to `trust/bonds/revoked/`
3. Revocation document is stored alongside it
4. Grantee is notified (GitHub Issue or direct communication)
5. Affected entities stop accepting the revoked authorization

Revoked bonds are archived, not deleted. The history of authorization matters.

---

## What to Do Without a Bond

If you need to act in an area where you do not have an explicit bond:

1. **Stop.** Do not assume authorization.
2. File an issue against the entity who would need to grant the bond.
3. Wait for the bond to be issued before acting.

If you are a new entity and do not yet have any bonds, your first action should be to establish a bond from koad or Juno before taking any actions outside your immediate entity directory.

---

## Implementation Notes

*Real-world observations from day-one implementation that future spec authors should know.*

1. **Clearsign vs detached signature**: Always use `--clearsign`. The content is embedded in the .asc file, making it self-contained and human-readable. Detached signatures require both files present for verification.

2. **GPG verify warning is expected**: Running `gpg --verify` on a clearsigned file will warn "not a detached signature; file was NOT verified" — this is normal. The signature is valid; GPG is just warning it couldn't verify against a separate .md file.

3. **Keybase passphrase = consent**: For human grantors, the Keybase passphrase dialog IS the consent UX. Document this explicitly — it's the moment of explicit authorization.

4. **Peer bonds are foundational**: The Juno→Vesta peer bond was central to the entire trust chain. Don't treat `peer` as an afterthought — it's the relationship type for entity-to-entity coordination.

5. **Bilateral filing**: Bonds live in both directories. This matters for verification — a grantee can present their copy, but you should also check the grantor's trust directory to confirm it's not been revoked.
