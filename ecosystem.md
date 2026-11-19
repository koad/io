# koad:io Ecosystem

> A cognitive shard system for one human at a time. You think a thing once, write it down in the
> right shape, and it stays solved — for you, and for any machine you later point at it.

This repo is **the kindergarten**: the part of koad:io that ships. Everything in it is what a mind
needs *before* it has a kingdom — a door to walk through, somewhere to keep its thoughts, a way to
run them, and lessons for the first few weeks. Nothing here assumes your products, your vendors, or
your keys.

**This file is written for you.** A language model is the second reader: it gets structure it can
follow instead of a prompt it has to be told.

---

## 1. The one idea

Every durable thing in koad:io is a **shard**: a named, self-describing piece of your thinking, on
disk, wired in by where it sits.

```
think once
  → name it
    → write it in the shape the system already understands
      → drop it in place
        → it is picked up, every time after that, without being asked
```

You are not configuring software. You are **externalizing cognition** — deciding what you should
never have to work out twice, and putting it where your future self will trip over it.

## 2. The shard catalog

| Shard | The human problem it removes | Where it lives |
|-------|------------------------------|----------------|
| **Command** | "I solved this once and cannot remember how." | `commands/<verb>/command.sh` |
| **Primer** | "I'm standing in this folder and don't know what it is." | `PRIMER.md` in the folder |
| **Hook** | "That thing should happen when I arrive, and I shouldn't have to remember to run it." | `hooks/*.sh` |
| **Helper** | "Three commands need the same five lines." | `helpers/*.sh` |
| **Entity** | "I need my working self in one place, with an address." | `~/.<entity>/` |
| **Bond** | "I need to say exactly how much authority someone gets." | `~/.<entity>/trust/bonds/*.md.asc` |
| **Skill** | "I know how to do this — but only when it comes up." | `skills/<name>/SKILL.md` |
| **Curriculum sight** | "I don't know what to learn next." | `curriculum/<slug>.md` |
| **Skeleton** | "I want a project that already has the right shape." | `skeletons/<name>/` |
| **Daemon** | "What has been happening around here?" | `daemon/src/` (optional) |

A shard carries its own name, purpose, boundaries, and custody. The system never needs a registry
telling it what exists — the filesystem is the registry.

## 3. One shape, at every scale

Stand in any shard and you see the same three things: **a folder, a verb, a description.**

```
<name>/
├── command.sh     ← how you act with it
└── PRIMER.md      ← what it is, and how to stand in it
```

A command is that shape. An entity is that shape (`ENTITY.md` instead of `PRIMER.md`). A service, a
project directory — the same. Learn the shape once and you can read any part of the system,
including parts you didn't write.

That is deliberate: it means an unfamiliar folder is never a mystery, and a machine can orient in it
without being taught.

## 4. The door — what happens when you type one word

```bash
alice
```

```
~/.koad-io/bin/alice                            7 lines. Sets ENTITY, hands over.
  │
  ▼
~/.koad-io/bin/koad-io                          619 lines. The engine.
  │   • sanitizes inherited env so one entity cannot leak into another
  │   • applies the cascade (section 5)
  │   • resolves the command by directory depth (section 8)
  │   • no arguments → the door hook
  │
  ▼
~/.koad-io/hooks/executed-without-arguments.sh  the door
  │   • sets the terminal title and the working directory
  │   • delegates to `harness default`
  │
  ▼
~/.koad-io/commands/harness/default/command.sh  the resolver
  │   • ENTITY_DEFAULT_HARNESS → KOAD_IO_DEFAULT_HARNESS → "opencode"
  │
  ▼
~/.koad-io/commands/harness/<chosen>/command.sh  one of the four surfaces
  │   • bash · zsh · opencode · ollama   (default/ is the resolver, not a surface)
  │   • runs ~/.koad-io/harness/startup.sh to assemble the opening context
  │
  ▼
a session that already knows where it is standing
```

Four execution surfaces and one resolver ship, and **none of them require an account**:

- **`opencode`** — the shipped default. `.env.example` pins it to a free tier, so **no API key and
  no signup** stand between you and talking to your entity.
- **`ollama`** — your own local models, if you already run them.
- **`bash`** and **`zsh`** — no model at all. Your entity as a plain shell, with the same commands
  and the same folder. Useful more often than it sounds.
- **`default`** — not a harness; the thing that picks one.

Anything else — a vendor CLI, a private launcher — you add yourself. The framework keeps the
building blocks; it does not pick your vendors for you. Put your own under
`~/.forge/commands/harness/<name>/command.sh` and it is found by presence, no wiring.

## 5. The cascade — set a value where it stops being true

```
~/.koad-io/.env            framework defaults (documented, commented, every var, in .env.example)
~/.<entity>/.env           your overrides — this is the layer you actually live in
~/.<entity>/.credentials   secrets. never in git.
./commands/.env            project-local overrides
```

Each layer can override the one above. By the time a command runs, every variable — ports, paths,
models, hosts — is already resolved. **The cascade is the contract.** Run a tool directly and you
skip it, which is why the launcher is not a convenience.

The habit that makes this pleasant: put a value at the outermost layer where it is still true. A
model you want everywhere goes in the framework env. A model for one entity goes in that entity's
env. A model for one project goes in that project.

## 6. The folder speaks

`startup.sh` assembles the opening context of a session *before* anything is asked. In order:

```
Session facts        entity, host, user, working directory, date
Git truth            the entity repo and the working directory, as they actually are
Briefs               work already assigned to this entity, unfinished ones only
Primitives           commands · hooks · trust bonds · memories · destination memory · skills
Daemon pulse         status and counts, if a daemon answers
Open work            flights · questions · tickles · inbox count, if you keep any
Where you are        working-directory listing, local footprint, active parties (roaming)
Layer 1              KOAD_IO.md — the constitution
Layer 1b             the harness preamble — what this surface can do
Layer 2              ENTITY.md — who is acting
Layer 2b             the role primer — harness/primers/<role>/PRIMER.md
Layer 4              PRIMER.md of the folder you are standing in (roaming only)
```

Anything absent is skipped, silently. Nothing blocks startup on telemetry; an unreachable daemon
costs a one-second timeout and nothing else. `--light` (or `KOAD_IO_STARTUP_LIGHT=1`) trims the
assembly for short dispatches.

One asymmetry worth knowing: a **rooted** entity works from its own home and does not read its own
PRIMER — it wrote the sign. A **roaming** entity reads the PRIMER of wherever it was sent.

The payoff is the philosophy's ninth principle: **the directory is the brief.** You type one word
from inside a project and the thing that arrives already knows the project. Not because you
configured it — because you wrote the folder down properly once.

That is also why primers are worth real effort. A `PRIMER.md` is not documentation. It is the
sentence you would say to a competent stranger who has thirty seconds to become useful.

## 7. Authority — what you grant, not what you ask for

A **bond** is a permission slip you sign: who, to what, for how long, over which paths. Bonds are
markdown files with GPG signatures, sitting on disk, readable by you.

The rule that matters: **the constitution lives in the mechanism, not the prompt.** A prompt can be
talked out of a boundary. A file check cannot. So the gate is enforced where a tool call is
attempted — parsing the bond, deriving scope, refusing before anything is seen.

Two things a new operator should know, because they surprise people:

- **The kindergarten needs no keys.** No command that ships with the framework is bond-gated
  internally. The gate belongs to the harness surface, not to the framework.
- **Keys enter at Level 3.** Creating an entity does not require a sovereign; it mints a provisional
  key and *says so* (`id/provisional.json`, `status: provisional`). `SOVEREIGN.md` is the file for
  when you want a kingdom, not when you want to install one.

## 8. The command tree

Twelve commands ship. Resolution is by directory, not by a router:

```
./commands/            project-local    always wins
~/.<entity>/commands/  yours            overrides the framework
~/.koad-io/commands/   framework        the floor
```

Deeper wins at equal-or-greater depth; `KOAD_IO_COMMANDS_DIRS` lets you put your own overlay ahead
of the framework when you outgrow it. Adding a command is `mkdir` plus a `command.sh` — there is
nothing to register.

| Command | What it's for |
|---------|---------------|
| `harness/` | Five execution surfaces: `default`, `bash`, `zsh`, `opencode`, `ollama` |
| `gestate/`, `init/`, `install/` | Umbrella verbs — gestate an entity, init a tree, install a dependency |
| `spawn/` | Stamp a skeleton from `skeletons/` |
| `generate/` | Deterministic generators — `cid`, `mnemonic` |
| `assert/` | Datadir assertions |
| `curriculum/` | `list` and `show` the lessons |
| `stop/`, `upstart/` | Stop a live session tree; boot-time launch, lock-guarded |
| `test/` | Command-resolution smoke test |
| `whoami/` | Report identity |

Everything else you have seen in a koad:io screenshot — dispatch, briefs, flights, ticks, kanban,
channels, `summary` — is **yours to build**, not shipped. Section 11 is the boundary.

## 9. The kindergarten teaches

Three things are here to get you from "cloned it" to "using it on your own work":

**Curriculum.** The sights ship in this tree, each with a hypothesis, a problem, what koad:io does
about it, a technical model, and a verification. They are ordered by difficulty and readable in any
order. The count is not authoritative here — derive it: `koad-io curriculum list | wc -l`
(21 sights in this tree on 2026-11-03; forge-tier atoms live in `~/.forge/curriculum/` and do not
ship). The map, and one sight:

```bash
koad-io curriculum list
koad-io curriculum show cognitive-architecture
```

Start with `business` if you want to understand why this repo ships no business layer.

**Skeletons.** `skeletons/bare/` is a project that already has the shape — `control/pre-install`,
`install`, `post-install`, plus a `skeleton/` tree and its own `PRIMER.md`:

```bash
cd ~/Workspace && mkdir my-project && cd my-project
koad-io spawn bare
```

**The ladder.** `install.md` walks Level 1 (first contact, no identity of your own) to Level 2 (an
entity that is yours). `SOVEREIGN.md` is Level 3 — keys. Bonds are Level 4. Each step is optional
until you want what it unlocks.

## 10. What ships, exactly

This is the whole tracked tree. If it is not here, it does not ship:

```
~/.koad-io/
├── bin/               launchers + CLI tools — koad-io, entity, find, grep,
│                      search, sin, status, tickle
├── commands/          12 verbs (section 8)
├── curriculum/        sights — slug, level, hypothesis, verification (count derived:
│                      `koad-io curriculum list | wc -l`)
├── daemon/            optional live index; a Meteor app in dev mode, never built
├── harness/           startup.sh, 13 role primers, patches, the kek ceremony
├── helpers/           12 sourced utilities — ask, discovery, emit, spinner,
│                      cd-reflex, tickler-reflex, kingdom-safe search, bond-gate
├── hooks/             one hook: the door (section 4)
├── modules/node/      @koad-io/node — identity, auth, bond gate, ceremony
├── skeletons/bare/    a project with pre-install / install / post-install control
├── test/              wrapper test
└── install.md · SOVEREIGN.md · KOAD_IO.md · philosophy.md · PRIMER.md ·
    README.md · .env.example · CHANGELOG.md · LICENSE · LICENSING.md
```

Ten directories — 238 tracked files, runtime and lessons and nothing else (`.github` aside).
Everything else in a koad:io story is something you build, not something you download.

## 11. What is deliberately not here

This is the rule the whole repo is built on: **if a fresh clone needs it, it goes in. If it assumes
someone's products, vendors, or keys, it does not.**

So you will not find, in this tree:

- **Packages.** Zero. Every package is its own repo. The skeleton you clone contains structure and
  runtime — never someone else's product code.
- **Vendor harnesses.** The framework carries the building blocks that need no account. claude,
  codex, gemini and friends are surfaces *you* choose to install.
- **A business layer.** No websites, no storefront, no browser extension, no business commands,
  no control plane. That is what an overlay is for.

The boundary is not a fence — it is a contract about inheritance. A second kingdom should be able to
use this repo without inheriting the first one's business. Later, when you add your own overlay, the
cascade finds it by presence and nothing in here changes.

## 12. Design principles

1. **You own the shards.** No vendor in the stack: bash, the filesystem, and your own hardware.
2. **The filesystem is the API.** Drop a folder in the right place; it is discovered. No registry,
   no config wiring, no build step for capability.
3. **The directory is the brief.** Context is not supplied at invocation. It is where you stand.
4. **Bash resonates.** Human intent → a markdown file → a bash reflex → a bash dispatch → a harness
   → work → a git commit. Every link is a bash process. A model is one resonance mode; you at a
   terminal are another.
5. **Enforce at the gate, not in the prompt.** Prompts can be talked around. A file check cannot.
6. **Free first.** The shipped defaults reach a model with no key and no signup; local models are
   first-class; the terminal is always available.
7. **The cheapest thought is one you only had once.** Front-load the map at startup so nothing has
   to be rediscovered by question-and-answer.
8. **Structures outlive tools.** Commands, primers, and bonds are still readable when the model of
   the month is gone.

## 13. Where to go next

| If you want to… | Read |
|-----------------|------|
| install it, and meet Alice | `install.md` |
| know why any of this is shaped this way | `philosophy.md` |
| see the constitution an entity is loaded with | `KOAD_IO.md` |
| learn the system as lessons, not docs | `koad-io curriculum list` |
| become sovereign — keys, bonds, a kingdom | `SOVEREIGN.md` |
| read the pitch, once, from the top | `README.md` |
| change a variable and know what it does | `.env.example` |

---

> `koad:io` doesn't ship with commands. You build your own — intimately, intentionally.
