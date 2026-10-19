# Install koad:io

> ## ⚠ Status: DRAFT — not yet verified on a clean machine
>
> Written 2026-09-24 from the last known-good install guide (git `a5e8bac`, 2026-06-29, recovered
> from history) plus the current state of the framework. **No step below has been executed on a
> bare box.** Every step is marked **✓** (evidence exists for it today) or **?** (unverified).
>
> **Do not treat this as finished.** It is the draft that the clean-room walk validates — follow
> it, log every point where it is wrong, and those corrections are the deliverable. See
> `~/.forge/clean-room/SUITE.md`.

---

## Read this first — do not install as root

**koad:io is not meant to be run as root.** A fresh VPS ships root-only, which is exactly the
machine this will fail on if you skip this.

Create a normal user and run everything below as that user:

```bash
adduser --gecos "" koad
su - koad
```

**Why it matters:** the framework writes to `~/.koad-io/`, `~/.<entity>/`, and later `~/.forge/`.
Installed as root, those become root-owned, your keys land in `/root`, and you will hit permission
problems later that are painful to unpick. Nothing here needs elevation.

**? Unverified:** whether `init` currently refuses to run as root. As of 2026-09-24 there is **no
`EUID` guard** anywhere in `~/.koad-io/commands/` or `~/.forge/commands/` — so it will *not* stop
you. Guard this yourself by being a normal user.

---

## 1. Prerequisites

| Need | Why | How |
|---|---|---|
| **git** | to clone the framework and your entities | `apt install git` |
| **bash** | everything is bash | present by default |
| **curl** + **wget** | installers fetch things | `apt install curl wget` |
| **gnupg** | identity, signing, leaf keys, trust bonds | `apt install gnupg` |
| **openssl** | key material generation during gestation | `apt install openssl` |
| **jq** | **hard requirement** — the gestate script parses JSON with `jq -r` and dies without it | `apt install jq` |
| **Node.js** | the ceremony module (`commands/gestate/entity/ceremony.mjs`), the daemon, packages | ? exact version unverified — **Node 24** is what the last guide used |
| **starship** | the prompt; cascades across the framework | `koad-io install starship` (see below) |

**✓ Verified by reading the script** (2026-09-24): `gnupg`, `openssl`, `jq`, and `node` are all
required by `~/.koad-io/commands/gestate/entity/command.sh` and its `ceremony.mjs` companion.
**`jq` and `node` are the easy ones to miss.**

**? Unverified:** whether Node has a minimum version enforced anywhere. The current README states
no prerequisites at all, so this list is reconstructed from the recovered guide, the gestate
script, and the `.env.example`. Confirm each on your box.

**? Unverified:** whether `starship` is genuinely required or only cosmetic. The old guide lists it
under "Install dependencies"; `bin/PRIMER.md` does not mention it.

Install starship via the framework's own command (exists, and works — it was read on 2026-09-24):

```bash
koad-io install starship
```

That script downloads the starship installer, fetches a preconfigured `starship.toml` from a gist,
and appends `eval "$(starship init bash)"` to `~/.bashrc`.

**? Note:** it appends to `~/.bashrc` only — **no zsh path.** On macOS (zsh default) and any
zsh shell this step will silently not take effect.

**? Note:** it requires `wget`, not just `curl`. Install `wget` first or the script fails partway.

---

## 2. Clone the framework

```bash
git clone https://github.com/koad/io.git ~/.koad-io
```

**✓ Verified:** the repo is public and this path is the framework root. `~/.koad-io/` is the
convention every other path depends on.

**One-liner** (clone + PATH in a single step, bash only):

```bash
git clone https://github.com/koad/io.git ~/.koad-io && echo -e "\n\n[ -d ~/.koad-io/bin ] && export PATH=\$PATH:\$HOME/.koad-io/bin\n" >> ~/.bashrc && export PATH=$PATH:$HOME/.koad-io/bin
```

---

## 3. Put it on your PATH

```bash
echo '[ -d ~/.koad-io/bin ] && export PATH=$PATH:$HOME/.koad-io/bin' >> ~/.bashrc
source ~/.bashrc
```

**✓ Verified:** `bin/PRIMER.md` states plainly — *"Adding `~/.koad-io/bin` to `PATH` is the standard
install step; the entity launchers only work after this."*

This is what gives you `koad-io` and one command per entity.

**For zsh** (macOS): append the same line to `~/.zshrc` instead.

---

## 4. Verify

```bash
which koad-io      # should print ~/.koad-io/bin/koad-io
koad-io            # should print usage, not "command not found"
```

**? Unverified:** whether `koad-io --version` exists. The old guide claimed it does; it has not been
confirmed against the current CLI.

If `which koad-io` prints nothing, the PATH step did not take. Open a new shell first.

---

## 5. Establish your sovereign identity

> ### ⚠ This step is being renamed, and the flow around it is unsettled
>
> **Decided 2026-09-24: `gestate sovereign` should be the verb** — koad: *"gestate sovereign should
> be a thing."* It **does not exist yet**: `gestate` currently takes only an entity name, and running
> `koad-io gestate sovereign` today would try to gestate an entity *named* "sovereign". Being specced
> now (VESTA-SPEC-230).
>
> **What exists today is `init sovereign`.** That is what the rest of this section documents.

```bash
koad-io init sovereign
```

This is where your keys are created. Per the framework CHANGELOG (2026-05 era), `init sovereign`
covers *"unified init, mnemonic recovery, multi-device ceremony flow, sigchain filing, and
automatic post-ceremony repo commit/push."*

**✓ Verified:** the command exists — `~/.koad-io/commands/gestate/entity/command.sh` names it as the
prerequisite in **four** separate error messages (missing sovereign dir, missing master key, missing
`master.fingerprint`, missing device leaf). It is unambiguously the intended first step.

**? Unverified:** the exact interactive flow, what it asks, how long it takes, whether it needs
network access, and what it writes where.

**Back up what it produces.** Store the recovery material somewhere *ridiculously safe* — this is
the one step where losing the output is unrecoverable.

**Targets** (from Vesta's specs): `~/.koad-io/me/id/devices/<hostname>/leaf.public.asc`,
`leaf.private.asc`, `device.key`, `~/.koad-io/me/id/master.fingerprint`.

**`me` is a reserved name.** The gestate script refuses it with: *"'me' is reserved —
`~/.koad-io/me/` is the sovereign. Use another name."* Do not call an entity `me`.

**⚠ Note:** `~/.koad-io/me/` **does not exist on wonderland** as of 2026-09-24 — so the sovereign
path's preconditions are not met even on the operator's own machine.

---

## 6. Create your first entity

An "entity" is a directory with its own identity, commands, memories, and keys.

### Option 1 — Alice (the documented example)

```bash
git clone https://github.com/koad/alice.git ~/.alice
koad-io init alice
```

**✓ Verified:** the README's own `Learn More` section links `github.com/koad/alice` as *"a complete,
working entity."* Alice is the intended first entity — she is the tour guide, and she walks with you
while you explore.

### Option 2 — Gestate from scratch

```bash
koad-io gestate myentity
```

Creates an entity with keys, directories, and launcher.

### Option 3 — Gestate inheriting from an existing entity

```bash
alice gestate newentity
```

Copies skeletons, commands, and packages from the mother entity.

**? Unverified:** all three options — none has been run on a clean box.

---

## 7. Run it

```bash
alice
```

Launches the entity's harness as an interactive session. The harness is resolved from
`ENTITY_DEFAULT_HARNESS` in the entity's `.env`, falling back through `KOAD_IO_*` and finally a
hardcoded default.

**? Unverified:** the current fallback default, and whether the harness launches cleanly on a fresh
Debian box.

---

## What is not covered here

| Missing | Note |
|---|---|
| **`~/.forge/`** | The business overlay (websites, services, packages). Not needed to install. `~/.forge` is a separate repo. |
| **Packages** | The framework tree ships **no** Meteor packages as of 2026-10 (commit 53ea54c). Every koad:io-* package is its own repo under `~/.forge/packages/`, resolved via `KOAD_IO_PACKAGE_DIRS`. A bare install therefore needs the package repos cloned separately — that step is **not written yet**. |
| **`install.koad.sh`** | 0% built — a Meteor skeleton only. Intended as the manual + expanded install surface. |
| **`ppa.koad.sh`** | A 2023 hello-world `.deb`. Intended as authenticated canon delivery. |

## What changes soon — do not pre-empt

**VESTA-SPEC-229 (draft)** reorders this flow: it mints the identity credential **earlier**, before
any authenticated fetch, and splits the canon into a public bootstrap floor and an authenticated
payload. **That ordering is not implemented and must not land before the clean-room suite runs
against the ordering above.** Testing a moving target produces meaningless results.

## This file's own history

There was never a stable install document. The README carried the instructions until
`4c978a8` (2026-06-29, *"updated page copy"*) removed 498 lines of them, leaving an architecture
overview in their place. The install steps survived only in git history. This file is the
reconstruction — and it exists so that the next person does not have to dig through commits to
find out how to start.
