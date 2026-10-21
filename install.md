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
koad-io install deps
```

**✓ Verified 2026-10-21** on a clean clone, and as the remedy on a box where the condition was
first detected. `modules/node` is the shared `@koad-io/node` module (crypto, identity, ceremony,
bond gate). Its `package.json` and `package-lock.json` are committed; `node_modules/` is gitignored
— 63 packages, correctly not in git. It has to be installed once per machine.

Skip it and every command that touches identity dies at its first import:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@scure/bip39'
  imported from /home/<user>/.koad-io/modules/node/index.js
  ...
  at ModuleLoader._link (node:internal/modules/esm/loader:182:49)
```

**This bites machines that have been running koad:io for months, not just fresh clones.** Seen on
`citadel` on 2026-10-21: `koad-io generate cid 'skatefish'` produced that stack trace, because the
dependencies had never been installed on that box. A stack trace is the wrong answer to "one
directory is missing", so the framework now detects the condition and says so instead — see below.

`koad-io install deps --daemon` does the daemon's 16 dependencies too. `--check` reports without
changing anything.

**Detection.** Before any command runs, `bin/koad-io` checks whether `modules/node/node_modules`
exists. If it does not, and the command being run (or the helper scripts beside it) references
`modules/node` or `@koad-io/node`, it stops with the remedy rather than letting the import fail:

```
[koad-io] This command needs the @koad-io/node dependencies, and they are not installed.
[koad-io]   missing: /home/<user>/.koad-io/modules/node/node_modules
[koad-io]   fix:     koad-io install deps
```

Commands that do not need the module are unaffected — the check only fires on a command that
actually imports it.

**Manual equivalent** (if you prefer to see npm's own output, or the command is unavailable):

```bash
cd ~/.koad-io/modules/node && npm ci
```

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
koad-io init entity alice
```

**✓ Verified 2026-10-21** by reading the tree at `5630ace` (12 files): `koad/alice` is a
**template**, not a snapshot of a live entity's home. It carries **no private material and no
inherited identity** — no `.env`, no `keyring/`, no `devices/`, no `sigchain/`, no trust bonds,
no wallets, no memories, no briefs, and no private key of any kind (`git grep` finds no
`PRIVATE KEY` block anywhere). No `/home/koad/` paths in the tree either.

**What it does publish, deliberately, is Alice's *public* identity.** `id/entity.public.asc` and
`id/entity.fingerprint` ship in the clone: her OpenPGP public key and its fingerprint,
`04ED15A3B056C900140BBB84C462E4DF7E7DC869`. A public key opens nothing and grants nothing — it
only lets you verify that a signature came from Alice — which is why a template can carry it.
**✓ Verified:** importing `id/entity.public.asc` into a throwaway keyring yields exactly that
fingerprint. **It is Alice's key, not yours.**

So a fresh clone has **no identity of its own** — no keypair, no leaf key, no sigchain, nothing
that can sign in its name. One is meant to be generated on your device:

```bash
koad-io init sovereign        # master identity + this device's leaf key (see §6)
koad-io init entity alice     # entity keypair, sigchain entries, launcher, AGENTS.md
```

When that runs as intended, `id/` in your tree holds *your* key and no longer matches the published
one. That divergence is the expected outcome — it is the sign the template became you — and it is
safe to commit to your own repo. Do not sign with Alice's key: your signatures would verify against
the wrong author. Borrowed keys are worse than no keys.

**✓ It runs as intended as of 2026-10-21.** The second command no longer adopts the published key
— it proves paternity first and refuses to adopt a key it did not mint. Read the box below for the
mechanism and the message you will see.

Alice's own README carries a stopgap — *clear `id/` before `init`, or you inherit my key*. That
workaround is no longer needed: `init` now archives displaced key material instead of adopting it,
and tells you which branch it took.

It also ships `.env.example` (portable, documented) instead of `.env`, so the configuration this
entity ends up with is **yours** too.

**This wording follows Alice's own.** Her `README.md` ("What this repo is") and `PRIMER.md`
("Whose key is in `id/`") draw the same line — public key published, everything else generated
locally — so if this section and those ever disagree, hers is the voice to trust and this file is
the one to correct.

**⚠ Run §6 first.** `koad-io init entity alice` scaffolds `~/.alice`, writes the launcher, builds
`AGENTS.md`, and performs whichever identity action its state machine selects — which depends on
what is already in `~/.alice/id/` *and* on whether your sovereign's sigchain can account for it.

> ### The paternity gate (shipped 2026-10-21)
>
> `init` used to pick its action from **file presence alone**
> (`[ -f id/entity.public.asc ]`). That test cannot tell an entity key *your* sovereign created
> from one a template published about itself — so Alice's `5630ace` (which publishes
> `id/entity.public.asc`, by design) read on a fresh clone as `Action: secondary-device`: mint a
> device leaf, import **Alice's** key as the entity key, and, with a sovereign present, sign a
> `koad.entity.leaf-authorize` binding your device to `04ED…C869`. Your entity ended up with no
> keypair of its own — exactly what Alice's README tells you never to do.
>
> Presence is not paternity. `secondary-device` is now selected only when your own sigchain holds a
> `koad.entity.genesis` naming this handle **and this entity key fingerprint** (SPEC-175 §4). The
> check runs *ahead of* state selection rather than patching the presence test, and it has three
> outcomes:
>
> | paternity | when | what `init` does |
> |---|---|---|
> | **proven** | your sigchain records a genesis for this handle with this exact key | `Action: secondary-device` — mints this device's leaf. Unchanged, and this is the normal second-device path. |
> | **disproven** | your sigchain knows the handle with a different key, or has never gestated it at all | Does **not** adopt. `Action: re-seed` — generates a fresh entity keypair and device leaf for this directory, archives the displaced material under `id/archive/foreign-key-<ts>/` (archived, never deleted), and says so plainly. |
> | **unverifiable** | no sovereign at `~/.koad-io/me/`, or its sigchain is absent/empty/unreadable | Generates **nothing**. Prints the state, the key on disk, the reason, and three explicit choices. **Exits 2.** |
>
> *Unverifiable* is deliberately not the same as *disproven*: a chain that has recorded nothing
> cannot testify that a key is foreign, and absence must never license a key rotation.
>
> **What you will actually see.** On a box with no sovereign — a fresh clone of the template, before
> §6 — `koad-io init entity alice` stops:
>
> ```
> [init] State:  entity.public.asc=present  leaf/<host>=missing  legacy_keys=0
> [init] Paternity: UNVERIFIABLE — no sovereign at ~/.koad-io/me on this device — there is no chain to prove anything against
> [init]
> [init]   Nothing was generated. This is not a refusal to work; it is a
> [init]   refusal to guess. Paternity cannot be assumed from a file.
> [init]
> [init]   Entity:      alice (~/.alice)
> [init]   Entity key:  04ED15A3B056C900140BBB84C462E4DF7E7DC869 (id/entity.public.asc)
> [init]   This device: <host> — no leaf in id/devices/<host>/
> [init]   Sovereign:   ~/.koad-io/me (absent)
> [init]
> [init]   Choose one, explicitly:
> [init]     koad-io init sovereign                 establish a sovereign, then re-run
> [init]     koad-io init entity alice --adopt      adopt the key in id/ as yours
> [init]     koad-io init entity alice --re-seed    ignore it; mint a fresh keypair
> ```
>
> exit status **2**, `id/` untouched, no leaf, no keyring. `init sovereign` is unaffected.
>
> **Once §6 is done** the same command resolves to *disproven* — your own chain has never gestated
> `alice` — and lands on `re-seed`: **you get your own keypair**, which is the whole point of §7.
> If you genuinely want the key the template shipped, that is `--adopt`, spelled out, never a silent
> default.
>
> **✓ Verified 2026-10-21** against fixture trees on wonderland (real sigchain as fixture, `HOME`
> overridden): fresh alice clone with no sovereign → exit 2 and `id/` byte-identical before and
> after; matching genesis → `PROVEN` → `secondary-device`; differing fingerprint → `DISPROVEN` →
> `re-seed`; handle never gestated → `DISPROVEN`; genesis signed by another sovereign → *not*
> adopted; `--adopt` with no sovereign → proceeds with a loud warning; `--re-seed` with no sovereign
> → stops at the sovereign gate with the directory untouched.
>
> **? Unverified:** the full re-seed ceremony (key generation, sigchain genesis + leaf-authorize,
> commit) still needs a real sovereign. `testy003` walks it.

For the record, this is the gate a **keyless** clone (no `id/` at all — any entity other than
Alice, or Alice at `62730fa`) hits when no sovereign exists at `~/.koad-io/me/`:

```
[init] State:  entity.public.asc=missing  leaf/<host>=missing  legacy_keys=0
[init] Action: re-seed
[init] ERROR: Sovereign required for entity key seeding. Run 'koad-io init sovereign' first.
```

That is the correct failure — one clear instruction, exit 1, nothing half-written.

`koad-io init entity alice` and `koad-io init alice` run the same state machine — `init` is a
namespace (`init sovereign` | `init entity` | `init kingdom`) and the bare-name form is the
compatibility reading, not the documented one. Re-running on a fully initialized entity reports
`Action: all-set` and changes nothing.

**What the clone gives you** — twelve files, ✓ verified against the tree: `ENTITY.md` (an example
entity's identity), `PRIMER.md`, `README.md`, `passenger.json` (the entity manifest),
`.env.example`, `.gitignore`, `LICENSE`, `origins.txt`, `avatar.png` and `outfit.json` (the face
and palette the manifest references), and `id/entity.public.asc` + `id/entity.fingerprint`
(Alice's public key — the only identity material in the box, and not yours). Nothing from
anybody else's memories, private keys, wallets, sigchain, or bonds. `AGENTS.md` is *not* in the
clone; `init` builds it.

**? Unverified:** the re-seed path itself has not been walked end-to-end on a clean box
(wonderland has no sovereign, so the run stops at the gate above by design). `testy003` should
walk §7 with a real `init sovereign` in front of it. The path is now *reachable* on Alice's own
template — a sovereign that has never gestated `alice` resolves to `re-seed` — but reaching it and
completing it are different things.

**✓ Verified:** the README's own `Learn More` section links `github.com/koad/alice` as *"the
koad:io starting entity."* Alice is the intended first entity — she is the tour guide, and she
walks with you while you explore.

### Option 2 — Gestate from scratch

```bash
koad-io gestate entity myentity
```

Creates an entity with keys, directories, and launcher.

### Option 3 — Gestate inheriting from an existing entity

```bash
alice gestate newentity
```

Copies skeletons, commands, and packages from the mother entity.

**✓ Verified:** Option 1 — `git clone` + `koad-io init entity alice` resolves the framework `init`
verb, runs its state detection, and — since the paternity gate landed on 2026-10-21 — **stops with
exit 2 on a box without a sovereign** instead of silently adopting Alice's published key (see the
box in §7). Before Alice's `5630ace` the same clone was keyless and stopped at the sovereign gate on
the `re-seed` path; the gate is now asked one step earlier, where the decision actually is.

**? Unverified:** Options 2 and 3 — neither has been run on a clean box.

---

## 8. Run it

```bash
cd ~/.alice && alice
```

**✓ Verified 2026-10-21** — cold Debian 13 box, no global git config, no sovereign until §6, no
harness preinstalled:

```
harness       : default → opencode
entity        : alice
mode          : interactive
```

Bare `alice` launches the entity's harness as an interactive session. The harness is resolved from
`ENTITY_DEFAULT_HARNESS` in the entity's `.env`, falling back through `KOAD_IO_*`, and finally to a
hardcoded `opencode`. Prompt mode is the same command with text after it:

```bash
cd ~/.alice && alice harness default "say hello in five words"
#   > alice · big-pickle
#   Hello how are you today.
```

**⚠ `alice "some sentence"` is not a prompt.** The launcher reads its first argument as a command
name, so a bare sentence answers `Could not find command file for 'say hello in five words'`. Use
`alice harness default "…"` for one-shot prompts.

**⚠ Run from a project directory, not `$HOME`.** Harnesses refuse the home directory outright —
`Error: WORK_DIR '<home>' is the home directory.` — and name the fix. The entity's own directory
(`~/.alice`, which carries a `.env`) is a valid working folder.

### No harness CLI ships with the framework

The **adapters** ship — `commands/harness/` carries `opencode`, `pi`, `claude`, `codex`, `gemini`,
`ollama`, `bash`, `zsh` — but not the underlying binary. A bare install therefore has a working
entity and nothing to run it with, and the error is the only thing that tells you:

```
Error: 'opencode' CLI not found at ~/.koad-io/bin/opencode or on PATH.
  Install: curl -fsSL https://opencode.ai/install | bash
```

```bash
curl -fsSL https://opencode.ai/install | bash     # → ~/.opencode/bin, no sudo
```

**✓ Verified 2026-10-21:** the installer is user-scoped (no elevation), and opencode ships free
models — there is no API-key step between this command and your first reply from her.

**⚠ Do not document `npm install -g opencode-ai` as the path.** It is correct about the package
(`opencode-ai` ships the `opencode` bin) and wrong for a newcomer: on Debian, `npm i -g` as a normal
user fails with `EACCES` against `/usr/local`. The adapter offers it second, with that caveat, for
people who do have a writable global prefix.

**Why opencode is the default — and the correction (2026-10-21).** The original reasoning was:
*opencode asks for confirmation on essentially all filesystem and bash tooling, and in kindergarten
nothing is bond-gated, so the confirmation prompt is the safety net.* **That claim is false as of
opencode 2.0** — it was a property we were renting from upstream and never checked.

The reason a newcomer is safe now is ours, not a vendor's:

1. **The kingdom ships a permission config that asks.** On 2.x the adapter writes
   `~/.<entity>/opencode/opencode.json` with `ask` for `bash`, `edit`, `webfetch`, `websearch`,
   `external_directory` and `doom_loop`. Anything not explicitly allowed asks.
2. **The adapter never passes `--auto`** ("auto-approve permissions that are not explicitly
   denied"). The reason is in a comment in the adapter so nobody optimises it back in.
3. **The adapter asserts the version at launch.** 1.x and 2.x speak different flags; anything else
   exits 69 with one line naming what is supported. Without that check, 2.0 passing 1.x flags has
   opencode print its own help and exit — a failure that looks like documentation, and cost a
   machine a harness until someone read the notice.

Keep the original reasoning visible: it is the paragraph that caught this. The choice of opencode
was right for the wrong reason, and when upstream changed, the reason evaporated while the choice
stayed.

The framework prefers a kingdom-managed binary at `~/.koad-io/bin/opencode` if one exists, and falls
back to `PATH`.

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
