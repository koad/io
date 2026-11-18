<!-- SPDX-License-Identifier: CC0-1.0 -->

> ⚠️ **Please note:** This app is under active development. It is riddled with bugs. Everything is subject to change.

# 🧠 koad:io

> **tldr:** An organizational tool for your mind's eye.

**koad:io** is a sovereign, local-first command-and-control framework for
automating your digital life. It keeps identity, environment, and intent as files
and folders you own, so your scripts, your services, and your notes stay
composable, auditable, and yours to move.

The rule underneath it is one sentence: **think once per idea, encode it as a
named shard, wire it in — and never think about the mechanics of it again.** The
system remembers so you don't have to.

> "Your systems need to be faster than you (can) think."
> — adapted from [Getting Things Done](https://gettingthingsdone.com/)

> **Fork it before you clone it.** This repository is a moving target: the thing you
> clone *is* the framework on a running machine, it changes shape often, and local
> edits will eventually meet a rewrite. A fork is yours to steer; `upstream` is
> yours to pull from when you want what changed.

---

## 🧭 Reason

By saving a task as a `command`, and saving its working context as an `entity`,
I can:

- 📜 Remember *how* you did a thing
- 🔁 Replay it later, identically
- ⏳ Audit your decisions and assumptions
- 🗃 Keep your stuff together as simple files and folders
- 🧠 Internalize the structure of your work
- 📦 Package or pass projects on as-is
- 👁 Visualize the state and focus areas of your system

That list is the whole product. Everything below it exists to make one of those
seven lines true on a machine you own.

## 🔍 koad:io at a glance

- 🧱 **Entities** — containers for env variables, commands, and keys
- 🧾 **Commands** — repeatable tasks saved as scripts
- 🧠 **Context-aware execution** — auto-loads `.env`, keys, and project scopes
- 📜 **Identity-backed assertions** — sign, verify, and log in with your own keys
- 🗂 **Everything is a file** — readable, diffable, yours, and on your disk
- 🧰 **No cloud required** — no service holds your mind for you

## 🧩 The parts

Everything in koad:io is a **named shard** at a different scale:

| Shard type | What it is |
|------------|-----------|
| **Commands** | Named operational verbs — remembered procedures |
| **Entities** | Containers of identity, context, and capability |
| **Primers** | Orientation documents — how a folder works, for a person or a program |
| **Packages** | Portable application components — composable building blocks |
| **Bonds** | Signed capability grants — explicit trust declarations |
| **Harnesses** | Named execution surfaces — how an entity runs |
| **Skills** | On-demand capability packages |

The apps themselves are **thin shells**. The real system lives in packages — each
one an independent repository, resolved through `KOAD_IO_PACKAGE_DIRS`:

```bash
KOAD_IO_PACKAGE_DIRS=$HOME/where/you/keep/packages
```

An entity may also keep packages of its own in `~/.<entity>/packages/`. The
framework tree ships no Meteor packages of its own, so the skeleton you clone
contains structure and runtime — never someone else's product code.

Each package declares its own scope. Each command declares its own contract. Each
entity declares its own identity. And the system wires them together through a
deterministic cascade.

This means:

- You never have to remember how things get wired together
- Each part can be read, and understood, on its own
- Each component is auditable, portable, and replaceable
- Adding capability means dropping in a shard, not refactoring an app

---

## Why This Exists

koad:io was born in **2014** — long before AI agents, before "coding assistants," before the current wave of synthetic intelligence. But the game it plays started in **1997** — when social networks and public statements started piling up, and a choice emerged:

> **Publish to the public surface, or maintain your own rights.**

Rights are responsibilities. And the responsibility of sovereignty is this: everything you put on a platform you don't control becomes permanent, searchable, and weaponizable. Not by you. By whoever owns the database.

koad:io rejects that at the foundation. Instead:

- The **filesystem is your cognitive prosthetic**
- **Commands are remembered procedures**
- **Entities are externalized working patterns**
- **Bonds are explicit trust, not implicit permission**
- **Packages are portable components, not monolithic apps**
- **Silence is a feature** — you build, the system remembers, nobody else gets a copy

Synthetic intelligence arrived later, and it did not change what koad:io is. It
changed who else can operate it — an afterthought in the honest sense, which is why
it is documented near the end of this page rather than at the top.

---

## Architecture at a Glance

```
~/.koad-io/          ← Framework: cascade, commands, hooks, helpers, harness, daemon
~/.<entity>/         ← Entity: identity, keys, memories, commands, trust bonds
```

### The Cascade

Every command runs through the entity launcher (`<entity> <cmd> [args]`). The launcher fires the env cascade before any script executes:

```
~/.koad-io/.env       ← Framework defaults
~/.<entity>/.env      ← Entity overrides
~/.<entity>/.credentials   ← Entity secrets — never in git
./commands/.env       ← Command-local overrides
```

By the time a command runs, every variable — ports, bind addresses, database URLs, domain names — is already resolved. **The cascade is the contract.** Running a tool directly (skipping the launcher) breaks it.

### Example

```bash
alice whoami
```

Expands to:

```bash
set -a
source ~/.koad-io/.env
source ~/.alice/.env
source ~/.alice/.credentials
~/.koad-io/commands/whoami/command.sh
```

Run the same verb outside the launcher and it degrades to the system `whoami` —
there is no entity to report. That is the contract, visible in one command.

No guessing. No configuration drift. No remembering.

---

## 🧱 Entities

Entities are **containers of context** — each one holds:

- Identity (GPG keys, SSH keys, fingerprints)
- Environment (`.env`, `.credentials`)
- Commands (entity-specific operational verbs)
- Memories (saved context, destination notes)
- Trust bonds (signed capability grants from other entities)
- Skills (on-demand capabilities)
- Briefs, flights, and operational state

An entity is a **working persona** — a projection of how one part of your work
happens. You keep one for yourself, and one for each role you want held apart: a
builder, an auditor, a correspondent, a set of hands for the machine. It is a place
to keep that role's identity, environment, and commands together, so the work can be
replayed, audited, or handed over.

How many you keep, and what you call them, is yours.

---

## 🤝 When you want a collaborator

koad:io was not built for a synthetic intelligence. It was built so that a person
could keep their own memory in files. But a substrate that already knows where your
identity, your commands, and your context live is exactly what a synthetic
collaborator needs in order to be useful — and exactly what makes it dangerous to
hand over carelessly. Two halves make that safe.

### What a collaborator may attempt

- Tool visibility follows resolved bond scope
- Tool execution is refused by path, extension, and grant checks
- Read, write, and exec lanes are scoped per bond
- Commands can be granted one at a time, not as the whole cascade
- Dispatch targets are restricted by bond
- Shell calls are rerouted to typed, auditable tools
- Results are scrubbed — secrets never reach the model

### What happened, and who did it

The gate answers what a collaborator may attempt. What it did is a different
question, and one the framework does not answer on its own: attribution starts here —
every action is taken as an entity, under a bond, inside a session — and the
surfaces that keep the record run beside the framework rather than inside it.

Together: **constrained embodiment, auditable custody.** A collaborator does not get
to act unattributed.

---

## ⚡ Status

> **[BUG SALAD]**  
> Use at your own curiosity. It works. But only mostly. Maybe.

koad:io is a living system. The substrate (commands, entities, cascade, packages) is stable. The AI integration layer (pi harness, bond gate, control surface) is evolving fast. Things break, change shape, and get reorganized.

---

## 🧪 Tests

The framework carries a contract suite. Each file exists because a real defect
reached a live install, and the suite is what stops it coming back:

```bash
bash ~/.koad-io/test/all          # everything, ~100s
bash ~/.koad-io/test/all --fast   # the shell contracts only, ~2s
bash ~/.koad-io/test/all --list   # what runs, and how it is tiered
```

The runner discovers `test/*.test.sh` and `test/*.test.mjs` — a new suite runs
the day it lands, without editing the runner. It exits non-zero on any
**unrecorded** failure. Paths resolve from the runner itself, so every mode is
cwd-independent except `--staged`, which reads the git index of the repository
that contains your *current* directory — run it from inside `~/.koad-io`.

**Committing to the shared root runs the suite first.** Fast tier always, the
slow acceptance suites only when a staged path falls in that suite's declared
surface (`test/all --staged`). A red suite that is not in the known-failing set
refuses the commit. An unmapped slow suite also refuses rather than being
silently skipped. The gate has no per-commit override of its own.

### The known-failing set

`test/known-failing.txt` is a dated, owned, reasoned list of failures the gate
tolerates while they are being fixed. **An entry is an admission, not a
dismissal.** A red suite that is recorded there does not block a commit; a red
suite that is not recorded does. The file's header carries the full eight-rule
contract; two rules matter most in daily use:

- **Rule 6 — the tolerance is withdrawn for the surface you touch.** If a staged
  path falls in an entry's declared surface, that suite must pass for *this*
  commit. You cannot edit around a known failure.
- **Rule 4 — a recorded failure that starts passing is announced, never silent**,
  so entries cannot rot into permanent lies. Delete the entry once it is fixed.

An entry whose suite no longer exists is flagged stale, and one older than 30
days warns on every run. The whole set is printed on every run: a standing
confession, not a mute.

### Two doors, one gate

`~/.koad-io` is not a checkout of the framework — on a running machine it *is*
the framework, and there is no deploy step between "committed" and every
entity's next command. So the gate is wired at both doors that reach it:

| Door | Gate |
|------|------|
| `koad-io git commit` (and `commit`, which hands off to it) | `test/all --staged`, scoped to the framework repo |
| plain `git commit` | the `test/pre-commit` hook |

The hook exists because the command path is bond-scoped: an entity whose bond
grants read but not write on `~/.koad-io` can only reach the framework through
plain git. Gating the command path alone would gate the entities that least
need it and miss the one that commits most.

```bash
# once per clone — a symlink, so an update to the hook takes effect
ln -sf ../../test/pre-commit ~/.koad-io/.git/hooks/pre-commit
```

The hook steps aside for a rebase/merge/cherry-pick/revert in progress — those
re-apply commits that already ran the suite when they were authored, and the
post-rewrite tree gets gated at the next ordinary commit.

`git commit --no-verify` skips the hook because git never invokes it. That is git's
own flag, not the gate's; `koad-io git commit` deliberately does not honour it.

---

## 🛠 Directory Layout

### What is in the root

The root is two things at once: a tree you can clone, and — on a running machine —
the place where the console, the desktop widget, the passenger metadata, the
workspace skeletons, the lighthouse, and the sovereign's own `me/` are checked out
beside it as separate repositories. The listing therefore differs machine to
machine, and a diagram of it goes stale by the next commit.

**The inventory that knows the answer is [`PRIMER.md`](./PRIMER.md)** — walked,
dated, and corrected against the disk. Trust it over any tree drawn here.

### Entity home (`~/.<entity>/`)

```
.alice/
├── id/             # GPG keys, SSH keys, fingerprints
├── commands/       # Entity-specific commands
├── memories/       # Saved context
├── trust/bonds/    # Signed capability grants (.md.asc)
├── skills/         # On-demand capabilities
├── briefs/         # Active briefings
├── destinations/   # Prior-visit notes per host/path
├── packages/       # Entity-specific packages
├── .env            # Entity identity + config
├── .credentials    # Entity credentials
├── hooks/          # Entity lifecycle hooks
└── .local/         # Local state (harness sessions, runtime)
```

---

## ✍️ Example Usage

```bash
# Who is on the line
alice whoami

# Derive a stable content id from a human name
alice generate cid "Addison Cameron-Huff"

# Deploy a skeleton into an empty directory
cd ~/Workspace
mkdir my-project && cd my-project
alice spawn bare
```

> `koad:io` ships a small set of plumbing verbs. The rest — the ones your work
> actually runs on — you name and write yourself.

---

## 🌐 Philosophy

- **No cloud, ever.** Your keys, your data, and your substrate stay on hardware you control.
- **Identity-first.** Bonds are explicit and auditable. The constitution lives in the gate, never in the prompt.
- **Modular, file-based, reproducible.** Files and folders are the external mind. Locality makes memory at scale possible.
- **Think once, encode forever.** Every saved command, entity, package, and bond is an idea you never have to think about again.
- **Silence is a feature.** Everything you put on a platform you don't control becomes permanent and weaponizable. Build on your own hardware. Nobody else gets a copy.
- **Rights are responsibilities.** The responsibility of sovereignty is choosing what to publish and what to keep.
- **Designed for thinkers, hackers, and sovereign operators.** A $200 laptop, harnessed correctly, is enough to throne up.

---

## 📚 Learn More

- [`install.md`](./install.md) — stand a kingdom up: prerequisites, gestation, first entity
- [`GLOSSARY.md`](./GLOSSARY.md) — the words this system uses, defined once
- [`KOAD_IO.md`](./KOAD_IO.md) — the layer every entity loads before anything else
- [`PRIMER.md`](./PRIMER.md) — the framework inventory: what is here, walked and dated
- [Commands guide](https://kingofalldata.com/cheatsheets/bourn-again-scripting)
- [kingofalldata.com](https://kingofalldata.com) — the public storefront
- [alice repo](https://github.com/koad/alice) — a complete, working entity

---

## 💬 Community

[`#io:koad.sh` on Matrix](https://matrix.to/#/#io:koad.sh?via=koad.sh)

Come hang out in the `#io:koad.sh` room — share flows, scripts, bugs, ideas.

---

## 🪪 License

**Four tiers, one thesis:** AGPL-3.0 at the core, 0BSD at the outskirts, the
Kingdom License on published entity templates, CC0 on documentation.
[`LICENSING.md`](./LICENSING.md) owns the terms — this page only points at it.

> "I am an amateur. This might all be shit. It's too early to tell."
> — @you, wisely
