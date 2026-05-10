---
type: primer
folder: ~/.koad-io/harness/primers/
parents:
  - ~/.koad-io/harness/
children:
  - path: harness/primers/auditor/
    blurb: Examine, enumerate, surface findings. 100 eyes. Don't fix — Salus heals.
    status: documented
  - path: harness/primers/communicator/
    blurb: Draft, queue, gate, post, engage. The messenger is the message.
    status: documented
  - path: harness/primers/curator/
    blurb: Author VESTA-SPEC documents. The spec bends to the lived system, never the reverse.
    status: documented
  - path: harness/primers/designer/
    blurb: Shape the visual. Functional first, beautiful always. Pairs with koad for look/feel.
    status: documented
  - path: harness/primers/engineer/
    blurb: Build and ship. Smallest verifiable thing. Boot-test before claiming landed.
    status: documented
  - path: harness/primers/healer/
    blurb: Restore conformance. Work from spec, not memory. Stop before damage.
    status: documented
  - path: harness/primers/orchestrator/
    blurb: Coordinate, dispatch, synthesize. One entity, one specialty. Hold the helm.
    status: documented
features:
  - name: role-primer-system
    blurb: KOAD_IO_ENTITY_ROLE in entity .env selects a folder here; every .md in it injects as a Role Primer section at startup
    location: ~/.koad-io/harness/primers/
  - name: role-primer-emissions-companion
    blurb: emissions.md in every role folder — role-specific narration discipline for the daemon emission system
    location: ~/.koad-io/harness/primers/<role>/emissions.md
relates-to:
  - ~/.koad-io/harness/PRIMER.md
  - ~/.koad-io/harness/startup.sh
entities:
  - juno
  - vulcan
last-walked: 2026-05-09
as-of: 05643665bcb4fb9c4ca162cf09c34456d22f3177
---

# ~/.koad-io/harness/primers/ — Role Primers

Seven role directories. Each directory contains two files:

- `PRIMER.md` — what this role does, what tools it uses, what success and slop look like
- `emissions.md` — how this role narrates work into the kingdom's emission system

`startup.sh` loads every `.md` file in the role directory selected by `KOAD_IO_ENTITY_ROLE`. Adding a file here makes it load for every entity with that role on every session start. No code changes required.

## Roles

| Role | Specialty | Primary entities |
|------|-----------|-----------------|
| `auditor` | Conformance examination — finds drift, files structured reports | Argus |
| `communicator` | Post, queue, gate, publish — holds the relationship surface | Mercury |
| `curator` | SPEC authorship — the protocol layer | Vesta |
| `designer` | Visual surface — Blaze, CSS, Outfit, brand components | Muse, Iris |
| `engineer` | Build and ship — bash, git, Meteor, Node | Vulcan |
| `healer` | Entity repair — restores spec conformance | Salus |
| `orchestrator` | Coordinate and dispatch the team | Juno |

## Structure of a role primer

Each `PRIMER.md` covers:

- **Tools** — what the role reaches for
- **Patterns** — the numbered discipline specific to this role
- **Posture** — the attitudinal edge that matters most here
- **What success looks like** — observable completion criteria
- **What drift/slop looks like** — failure signatures to watch for
- **Cross-references** — memories, sibling primer, KOAD_IO.md

Each `emissions.md` covers:

- When to open a lifecycle emission vs. emit into an existing one
- How to narrate milestones without spamming
- Error/warning emission discipline
- Role-specific patterns (orchestrators open conversations; engineers ride the injected HARNESS_EMISSION_ID)

---

*All seven role directories walked 2026-05-09. Each contains PRIMER.md + emissions.md.*
