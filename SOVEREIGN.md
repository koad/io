# Becoming sovereign

> **Read this when you want a kingdom, not when you want to install.**
>
> `install.md` gets you from nothing to a running entity with **no identity of your own** — no
> sovereign, no personal keys, no trust bonds. That is a complete, useful state: you can read the
> commands folder, run Alice, and gestate entities of your own.
>
> A sovereign is required for exactly two things: **creating a kingdom**, and **any bond-gated
> workflow**. No command that ships with the framework is bond-gated internally. The bond gate
> lives on the harness, not the framework.
>
> This file was §6 of `install.md` until 2026-10-21. It was moved because it is the Level 3
> ceremony on Chiron's path (Belt 0 → L1 first contact → L2 entity → **L3 keys** → L4 bonds), and
> `install.md` was putting it in front of the Level 2 example. koad: *"people should be able to
> install and run koad:io without needing a sovereign."*

---

## Renaming, and what exists today

> **Decided 2026-09-24: `gestate sovereign` should be the verb** — koad: *"gestate sovereign should
> be a thing."* It **does not exist yet**. What exists today is `init sovereign`, and that is what
> this file documents.

```bash
koad-io init sovereign
```

This is where your master keys are created — a master keypair, this device's leaf key, and the
first entries of your sigchain.

**✓ Verified 2026-10-21** end-to-end on a clean Debian 13 box: master keypair, device leaf,
`master.fingerprint`, a two-entry sigchain (`koad.identity.genesis` + `koad.identity.leaf-authorize`),
and a single genesis commit. Exit 0 on the first run.

**Targets:** `~/.koad-io/me/id/devices/<hostname>/leaf.public.asc`, `leaf.private.asc`,
`device.key`, `~/.koad-io/me/id/master.fingerprint`.

**`me` is a reserved name.** Gestate refuses it: *"'me' is reserved — `~/.koad-io/me/` is the
sovereign. Use another name."*

## It is interactive, and non-interactive is a silent no-op

The command reads answers from `/dev/tty`, so piping a file into it does nothing. With stdin not a
terminal and no answer waiting in env, it prints **one** line and exits **0** having built nothing:

```
{"KOAD_IO_ASK":{"var":"SOVEREIGN_HANDLE","prompt":"Your handle (e.g. koad)","required":1,"default":""}}
```

**Treat a zero exit as meaningless unless `~/.koad-io/me/id/master.fingerprint` exists afterwards.**

The `KOAD_IO_*` env escape hatch is also unusable from the calling shell today: `bin/koad-io` wipes
every `KOAD_IO_*` variable out of the caller's environment before the command runs (pre-cascade
sanitization). Only unprefixed names — `SOVEREIGN_HANDLE`, `SOVEREIGN_DOMAIN` — survive.

**The quiz.** It prints a 24-word recovery phrase in a grid and asks for 3 random positions.
Wrong answers re-display the words and ask again; it does not abort. Nothing is written to `id/`
until the quiz is passed.

**Back up what it produces.** This is the one step where losing the output is unrecoverable.

**Git identity.** It commits the identity repo itself, so you do **not** need
`git config --global user.name` first — `init sovereign` exports `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
from your handle and kingdom domain. (Those exports are a 2026-10-21 fix; before it, every fresh
box silently needed two runs.)

---

## Paternity: adoption vs creation

This is the one design decision in this file worth reading even if you never run it, because it
explains messages you will see from `init entity` in ordinary kindergarten use.

**Creation needs no sovereign. Adoption does.** Juno, 2026-10-21: *"Init's paternity gate is about
ADOPTION, not CREATION. I collapsed those into one condition."* A cold box with no key on disk has
nothing that can be misattributed, so there is nothing to prove.

| `id/entity.public.asc` | paternity | what `init entity` does |
|---|---|---|
| **absent** | nothing to prove | **mints a keypair for you.** No sovereign. Writes `id/provisional.json` |
| present | **proven** — your sigchain records a genesis for this handle with this key | `secondary-device`: mints this device's leaf. The normal second-device path |
| present | **disproven** — your chain knows the handle with a different key, or never gestated it | does not adopt: `re-seed`, the displaced key archived under `id/archive/foreign-key-<ts>/` |
| present | **unverifiable** — no sovereign here to testify | generates nothing, prints the three explicit choices, exits **2** |

`--adopt` takes the key on disk as yours, spelled out. `--re-seed` ignores it and mints fresh —
creation, so it does **not** need a sovereign either.

An entity minted without a sovereign is **provisional**, not broken. It says so about itself:

```json
// ~/.<entity>/id/provisional.json
{ "status": "provisional", "provisional": true, "sovereign_countersign_required": true, … }
```

Same shape `gestate` writes for an authorized-agent entity, so a consumer can tell *unsigned* from
*invalid* without reading bash.

## Countersigning a provisional entity

Run, on a machine that holds a sovereign, against the provisional entity:

```bash
koad-io init entity <name>
```

With a sovereign present and a chain that has never gestated the handle, paternity resolves to
*disproven* and init re-seeds — which mints a keypair **with** sigchain signing and a commit. That
is completion, not a second adoption.

**? Unverified:** the countersign half has never been walked end-to-end against a real provisional
entity on a clean box. That is the outstanding gap in this document.

---

## When you actually need this

| You want to | Sovereign? |
|---|---|
| read the commands folder, run Alice, gestate your own entity | **no** |
| create a kingdom | **yes** |
| enter any bond-gated workflow | **yes** |
| sign a bond granting another entity authority over yours | **yes** |

If none of those are you yet, close this file. `install.md` is finished without it.
