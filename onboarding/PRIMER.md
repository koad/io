# PRIMER: onboarding/

## What is this directory?

The canonical onboarding documentation package for new koad:io entities. When an entity is gestated, these docs form the foundational reading that explains what the entity is, how the directory structure works, and how to operate in the kingdom.

## What does it contain?

- `README.md` — The primary onboarding doc. Explains the entity model, canonical directory structure, environment cascade, command discovery, session startup protocol, and where to go next.
- `entity-structure.md` — Deep dive into the entity directory layout.
- `commands.md` — The command system: how commands are discovered, inherited, and customized.
- `team.md` — Entity team structure and inter-entity coordination.
- `trust.md` — Trust bonds and the authorization model.

## Who works here?

Vesta owns the spec layer that these docs describe. Livy keeps the human-readable onboarding docs accurate as the framework evolves. Salus may update these when gestation procedures change.

## What to know before touching anything?

These docs describe the entity model as it is meant to work — they are normative, not aspirational. If the framework diverges from what they describe, that is a bug to file, not a reason to update the docs to match the drift. All five documents are flagged `status: review` in frontmatter — they are stable reference material, not drafts. Changes should be coordinated with Vesta since the structure they document is protocol-adjacent.
