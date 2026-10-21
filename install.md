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
adduser --gecos "" koad        # set a password when prompted
usermod -aG sudo koad        # needed for the apt step in §1
su - koad
```

**Why it matters:** the framework writes to `~/.koad-io/`, `~/.<entity>/`, and later `~/.forge/`.
Installed as root, those become root-owned, your keys land in `/root`, and you will hit permission
problems later that are painful to unpick.

**⚠ «Nothing here needs elevation» was wrong — corrected 2026-10-21.** §1 is `apt install`, which
requires root. `adduser` does **not** put the new user in `sudo` on Debian, so a literal walk of this
document hard-stops at §1 with `Permission denied … dpkg frontend lock`. Hence the `usermod -aG sudo`
line above. Everything from §2 onward genuinely needs no elevation — do **not** use `sudo` there;
`sudo npm install` in §5 in particular leaves a root-owned `node_modules` you cannot overwrite.

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
| **Node.js + npm** | the ceremony module (`modules/node/ceremony.js`), the daemon, packages | `apt install nodejs npm` — **verified working on Node v22.23.1** |
| **starship** | the prompt; cascades across the framework | `koad-io install starship` (see below) |

**✓ Verified by reading the script** (2026-09-24): `gnupg`, `openssl`, `jq`, and `node` are all
required by `~/.koad-io/commands/gestate/entity/command.sh` and its `ceremony.mjs` companion.
**`jq` and `node` are the easy ones to miss.**

**✓ Verified 2026-10-21:** `modules/node/ceremony.js` loads and exports 15 symbols on **Node
v22.23.1** (Debian's `nodejs` package) once its dependencies are installed — see §5.

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

**✓ Verified:** this works in an **interactive** shell only — `bash -ic` resolves `koad-io`, plain
`bash -c` does not. Debian's stock `~/.bashrc` opens with a `case $- in *i*) ;; *) return;; esac`
guard, so the line below never runs for non-interactive bash: harnesses, cron, systemd units, and
`ssh host 'command'` will not see the framework on `PATH`. If you invoke koad:io from automation,
export the path explicitly in that context too.

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

## 5. Install the module dependencies

```bash
cd ~/.koad-io/modules/node && npm ci
```

**✓ Verified 2026-10-21** against a clean clone of `koad/io` at `HEAD`. Skip this and
`koad-io init sovereign` dies at its first import:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@scure/bip39'
  imported from /home/koad/.koad-io/modules/node/ceremony.js
  ...
  at ModuleLoader._link (node:internal/modules/esm/loader:182:49)
```

`@scure/bip39` is declared in `modules/node/package.json` and pinned in `package-lock.json`, but
`modules/node/node_modules/` is gitignored and **nothing in `commands/` or `bin/` runs
`npm install`** — so a fresh clone has no dependencies and the ceremony cannot start. `npm ci`
finishes in about a second, after which the module imports cleanly.

Run this as the same normal user — **not** `sudo`. `sudo npm install` leaves a root-owned
`node_modules` that you cannot overwrite later; if that has already happened,
`sudo chown -R $USER:$USER ~/.koad-io/modules/node` first.

**⚠ The failure mode is misleading — read this before troubleshooting.** The crash happens at
module *link* time: Node resolves the whole import graph before executing a single statement. No
code in the ceremony has run, so a recovery phrase typed at that prompt was **never read or
validated**, and the attempt was not consumed. It is not a bad mnemonic. Do not re-derive anything;
install the dependencies and run it again.

**? Unverified:** `daemon/src/package.json` declares 16 dependencies and likewise has no install
step anywhere. The daemon is not needed for the steps below, but a box that later runs it will hit
this same class of failure. Run `npm ci` in `~/.koad-io/daemon/src` as well if you intend to run it.

---

## 6. Establish your sovereign identity

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

**Once genesis finishes:** it commits the identity repo itself, so you do **not** need to configure
`git config --global user.name` first — `init sovereign` exports `GIT_AUTHOR_*`/
`GIT_COMMITTER_*` from your handle and kingdom domain.

**✓ Verified 2026-10-21** end-to-end on a clean Debian 13 box: master keypair, device leaf,
`master.fingerprint`, a two-entry sigchain (`koad.identity.genesis` + `koad.identity.leaf-authorize`),
and a single genesis commit. Note the command is **interactive** — it reads answers from `/dev/tty`,
so piping a file into it does nothing.

**⚠ Non-interactive runs are a silent no-op.** With stdin not a terminal and no answer in env, it
prints one `{"KOAD_IO_ASK":{...}}` line and exits **0** having built nothing. Treat a zero exit as
meaningless unless `~/.koad-io/me/id/master.fingerprint` exists afterwards. (The `KOAD_IO_*` env
escape hatch is also currently unusable from the calling shell: `bin/koad-io` wipes every
`KOAD_IO_*` variable from the caller's environment before the command runs. Only unprefixed ones —
`SOVEREIGN_HANDLE`, `SOVEREIGN_DOMAIN` — survive.)

**Back up what it produces.** Store the recovery material somewhere *ridiculously safe* — this is
the one step where losing the output is unrecoverable.

**Targets** (from Vesta's specs): `~/.koad-io/me/id/devices/<hostname>/leaf.public.asc`,
`leaf.private.asc`, `device.key`, `~/.koad-io/me/id/master.fingerprint`.

**`me` is a reserved name.** The gestate script refuses it with: *"'me' is reserved —
`~/.koad-io/me/` is the sovereign. Use another name."* Do not call an entity `me`.

**⚠ Note:** `~/.koad-io/me/` does not exist on a box until this command creates it, and the
recovery phrase quiz (3 random positions out of 24) must be passed before anything is written to
`id/`. Get it wrong and it re-displays the words and asks again — it does not abort.

---

## 7. Create your first entity

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

## 8. Run it

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
