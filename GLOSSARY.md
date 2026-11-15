# The Kingdom Glossary

One file. The words this kingdom uses, defined once, by their author.

Every entry in this file was admitted by koad's word (`ratified-by: word`). No signature is part of
this kingdom's canon mechanism. Per-entry provenance is the commit that added it.

**No shard steers.** A definition that would still read true if the entity had intentions of its own
is a wrong definition.

An entry marked `retired` is a prohibition. An entry marked `open` is a word with no ruling — it is
here so that nobody invents one.

---

## The axiom

koad:io is a human consciousness tool: a substrate that lets a human mind externalize its cognitive
shards. The author is Jason Zvaniga (koad). AI is interfacing.

**Synthetic Intelligence** — composed from a person, not fabricated from a corpus. Synthetic does not
mean fake. It means assembled, and given durable external form.

Entities do not run autonomously. A session somewhere in the kingdom directs the focal point of the
moment.

### cascade

- **kind:** mechanism
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** no path — a behaviour. Observed: `koad-io touch juno` → daemon → desktop interface →
  client DDP → blaze → templates → DOM; or youtube → dark-passenger → lighthouse → daemon → disk.

> **koad:** "the mechanics *behind* the substrate, not a shard. A behaviour, and a lesson in
> kindergarten. Signals flow with no fixed end."

### command

- **kind:** shard
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** `<entity> <command> <args>` resolves to `~/.<entity>/commands/<command>/command.sh
  <args>`; framework tier `~/.koad-io/commands/<command>/command.sh`
- **class:** required

> **koad:** "a shard made runnable. The unit of sharing: one command, one repo."

### context-bubble

- **kind:** shard
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** a folder; usually a git repo. `ls` it.

> **koad:** "a shard that is portable: named, bounded, handable to someone else. Just a folder,
> usually a git repo. Bubbles contain shards; shards contain bubbles."

### device / device launcher

- **kind:** shard
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** a verb namespace — `citadel on`, `toronto`. Reach is granted, never defaulted.

> **koad:** "a place with a verb namespace, reachable as the entity that owns it. Reach is granted,
> never defaulted. Note `toronto` currently execs as rooty and thereby overrides the caller's entity
> — it needs evolving."

### entity

- **kind:** shard
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** `~/.<entity>/` and its `ENTITY.md`. The directory is the entity.

> **koad:** "a shard that contains shards."

### kindergarten

- **kind:** shard
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** `~/.koad-io/commands/` — 12 lifecycle commands (`ls`); and
  `~/.forge/websites/book.koad.sh/src/getting-started/` for the human lessons.
- **class:** required

> **koad:** "the absolute basics: the 12 lifecycle commands in `~/.koad-io/commands/` (not a
> contribution surface), and the human lessons in
> `~/.forge/websites/book.koad.sh/src/getting-started/`."

### kingdom

- **kind:** shard
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** the whole of `~/.koad-io/`, `~/.<entity>/` for every entity, and the overlays, on
  this host; `kingdom status` reports on it (SPEC-239).

> **koad:** "the totality of the sovereign instance: every device, folder, memory, model, command,
> config. The walled garden itself."

### required / example

- **kind:** shard
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** the `class` field on every entry that names a path under `~/.koad-io/` — conformance
  C-5.
- **class:** required

> **koad:** "every path in `~/.koad-io/` is one or the other. Required is the shape; example is how
> koad happens to do it. **Nothing on disk distinguishes them yet.**"

### shard

- **kind:** shard
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** no path. A shard is named; every naming resolves somewhere. The Manifest table in an
  `ENTITY.md` is where an entity lists its own — one row per shard, each row naming what it resolves
  to.

> **koad:** "a named faculty. The general unit."

### substrate

- **kind:** shard
- **status:** canonical
- **owner:** koad
- **ruled:** 2026-11-14 · flight 20261115T031422-833Z-vesta-617fab
- **mechanism:** `~/.koad-io/bin/` — the launchers. `ls ~/.koad-io/bin`.
- **class:** required

> **koad:** "`~/.koad-io/bin/`. The launchers. Bash, and only bash. The reference implementation;
> anyone may port it."

---

## Retired

### framework

- **kind:** retired-word
- **status:** retired
- **owner:** koad
- **retired:** 2026-11-14
- **why:** It was doing the work of substrate, skeleton, kindergarten and command surface at once,
  badly.
- **replaced-by:** substrate · kindergarten · command · `required | example`

> **koad:** "framework — RETIRED. Weasel word."

---

## Pending koad

Named, used, unruled. **No entry here may be defined by any entity.** The question is the entry.

### canon

Four senses live in the kingdom and none is ruled: (1) the glossary itself — Juno's working form,
not a ruling; (2) SPEC-109's "Canonical Source Standard" — an identity repo's contents; (3)
SPEC-114's "Canonical Location Pointer" — a wire format; (4) `canon.koad.sh` — a Forgejo instance
(SPEC-229), and koad ruled 2026-11-14 that it "is not meant to be a publishing place." **Question
(asked 2026-11-14):** is the glossary the canon, or does "canon" name something else?

### garden

Used by two canonical specs in two senses: SPEC-119 (*"Walled Production Space Embedded in an
Entity"*) and SPEC-164 (*"Bond-Shaped Participation Structures for Kingdom Members"*). **Question
(asked 2026-11-14):** one sense or two?

### the eight unmarked folders

`curriculum/` · `harness/` · `console/` · `helpers/` · `features/` · `daemon/` · `lighthouse/` ·
`passenger/`

Deliberately left unmarked, pending koad. No `class`.

Not named as unmarked, and not marked: `bin/` · `cache/` · `commands/` · `desktop/` · `hooks/` ·
`modules/` · `skeletons/` · `test/`. Their shape is fixed by canonical specs for four of them; that
is not a `required | example` ruling. **Question (asked 2026-11-14):** classify the eight, and say
whether silence classifies the other eight.

### tickle / tickler · flight / landing · bond / gate · emission

Used everywhere, defined nowhere in canon. Juno's `ENTITY.md` (741913e) carries working forms —
*"deferred intent with a time and an address; a dispatched session; its arrival; a signed grant of
authority; the check that enforces it; a signal on the kingdom stream."* Working forms are not
rulings. **Question (asked 2026-11-14):** rule these four, or rule that they stay working forms.
