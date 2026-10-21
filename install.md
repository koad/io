# Install koad:io

> ## You do not need an identity to install koad:io.
>
> This document takes you from a bare machine to **an entity you can talk to**, with **no sovereign,
> no personal keys, and no trust bonds**. That is a complete and useful state.
>
> Becoming sovereign — master keys, recovery phrase, sigchain, kingdoms, bond-gated workflows — is
> a separate, later, optional procedure: **`SOVEREIGN.md`**. It used to be §6 of this file. It was
> moved because it is the Level 3 ceremony on Chiron's path, and it had no business standing between
> a newcomer and the first thing they can actually run.
>
> **Status:** parts of this are verified on clean Debian 13 boxes on 2026-10-21 (marked **✓**);
> parts remain unverified (marked **?**). The clean-room runs behind the ✓ marks are in
> `~/.forge/clean-room/runs/`. Where a claim is wrong, the correction is in the text, not quietly
> dropped.

---

## Read this first — do not install as root

**koad:io is not meant to be run as root.** A fresh VPS ships root-only, which is exactly the
machine this will fail on if you skip this.

```bash
adduser --gecos "" koad        # set a password when prompted
usermod -aG sudo koad          # needed for the apt step in §1
su - koad
```

**Why it matters:** the framework writes to `~/.koad-io/`, `~/.<entity>/`, and later `~/.forge/`.
Installed as root, those become root-owned, your keys land in `/root`, and you will hit permission
problems later that are painful to unpick.

**⚠ "Nothing here needs elevation" was wrong — corrected 2026-10-21.** §1 is `apt install`, which
requires root, and `adduser` does not add the new user to `sudo` on Debian. A literal walk of this
document hard-stopped at §1 with `Permission denied … dpkg frontend lock`. Hence the `usermod` line.
Everything from §2 onward genuinely needs no elevation — and `sudo` there causes real damage:
`sudo npm ci` in §5 leaves a root-owned `node_modules` you cannot overwrite.

**? Unverified:** whether `init` refuses to run as root. As of 2026-10-21 there is **no `EUID`
guard** anywhere in `~/.koad-io/commands/`, so it will not stop you.

---

## 1. Prerequisites

| Need | Why | How |
|---|---|---|
| **git** | clone the framework and your entities | `apt install git` |
| **bash** | everything is bash | present by default |
| **curl** + **wget** | installers fetch things | `apt install curl wget` |
| **gnupg** | identity, signing, leaf keys, trust bonds | `apt install gnupg` |
| **openssl** | key material generation | `apt install openssl` |
| **jq** | **hard requirement** — scripts parse JSON with `jq -r` and die without it | `apt install jq` |
| **Node.js + npm** | the ceremony module, the daemon, packages | `apt install nodejs npm` |

**✓ Verified 2026-10-21** on Debian 13 (trixie): `node v20.19.2` / `npm 9.2.0` from apt are
sufficient, and Node 22.23.1 also works. **? Unverified:** whether any minimum version is enforced
anywhere.

**`jq` and `node` are the easy ones to miss.**

**starship** is the prompt and is cosmetic — `koad-io install starship` sets it up if you want it.
It appends to `~/.bashrc` only (no zsh path) and needs `wget`.

---

## 2. Clone the framework

```bash
git clone https://github.com/koad/io.git ~/.koad-io
```

**✓ Verified:** the repository is public and this path is the framework root. `~/.koad-io/` is the
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

**✓ Verified:** this works in an **interactive** shell only — `bash -ic` resolves `koad-io`, plain
`bash -c` does not. Debian's stock `~/.bashrc` opens with a `case $- in *i*) ;; *) return;; esac`
guard, so the line never runs for non-interactive bash. Harnesses, cron, systemd units, and
`ssh host 'command'` will not see the framework on `PATH` unless you export it there too.

This is what gives you `koad-io` and one command per entity. **For zsh** (macOS), append the same
line to `~/.zshrc`.

---

## 4. Verify

```bash
which koad-io      # should print ~/.koad-io/bin/koad-io
koad-io            # should print usage, not "command not found"
```

If `which koad-io` prints nothing, the PATH step did not take — open a new shell first.

---

## 5. Install the module dependencies

```bash
koad-io install deps
```

`modules/node` is the shared `@koad-io/node` module (crypto, identity, ceremony, bond gate). Its
`package.json` and `package-lock.json` are committed; `node_modules/` is gitignored — 63 packages,
correctly not in git. It has to be installed once per machine.

Skip it and every command that touches identity dies at its first import:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@scure/bip39'
  imported from /home/<user>/.koad-io/modules/node/index.js
```

**✓ Verified 2026-10-21.** This bites machines that have been running koad:io for *months*, not
just fresh clones — seen on `citadel`, where `koad-io generate cid` produced that stack trace
because the dependencies had never been installed there.

**Detection.** Before any command runs, `bin/koad-io` checks whether
`modules/node/node_modules` exists. If not, and the command (or a helper script beside it)
references the module, it stops with the remedy instead of letting the import fail:

```
[koad-io] This command needs the @koad-io/node dependencies, and they are not installed.
[koad-io]   fix:     koad-io install deps
```

Commands that do not need the module are unaffected.

`koad-io install deps --daemon` also installs the daemon's 16 dependencies. `--check` reports
without changing anything.

**Manual equivalent:** `cd ~/.koad-io/modules/node && npm ci` — as your normal user, never `sudo`.

---

## 6. The commands folder

This is the system. Everything else is detail.

```bash
ls ~/.koad-io/commands/
```

You will see `generate`, `gestate`, `harness`, `init`, `install`, `kingdom`, `summarize`, `test`,
`whoami` and friends. Open one:

```bash
cat ~/.koad-io/commands/whoami/command.sh
```

**A command is a directory containing `command.sh`.** That is the whole mechanism — no plugin
registry, no framework API, no compilation step. Bash scripts in folders, discovered in cascade
order:

1. `./commands/<cmd>/command.sh` — the project you are standing in
2. `~/.koad-io/commands/<cmd>/command.sh` — the framework
3. other framework roots on `KOAD_IO_COMMANDS_DIRS`

First match wins. Which means **you can add a command by making a folder**, and override any
framework command by putting one closer to where you stand.

Run one that needs nothing else:

```bash
koad-io install deps --check
```

Directories with sub-commands are namespaces — `koad-io init entity <name>`,
`koad-io gestate entity <name>`, `koad-io harness default`. A bare namespace with no argument
prints its usage and **exits 1**.

**? Note:** several namespaces shipped without their own shim until 2026-10-21 (`init`, `gestate`,
`install`), and answered with a bare "Could not find command file" — sometimes at exit 0. If you
are on an older clone, that is why.

---

## 7. Meet Alice

An **entity** is a directory with its own identity, commands, memories, and keys. Alice is the tour
guide — a template, not a snapshot of someone's machine.

```bash
git clone https://github.com/koad/alice.git ~/.alice
koad-io init entity alice
```

**✓ Verified 2026-10-21** against the published tree: `koad/alice` is a **template**. Twelve files.
No `.env`, no `keyring/`, no `devices/`, no sigchain, no trust bonds, no wallets, no memories, no
briefs, and no private key of any kind. No `/home/koad/` paths either.

**What it does publish is Alice's *public* key** — `id/entity.public.asc` and its fingerprint,
`04ED15A3B056C900140BBB84C462E4DF7E7DC869`. A public key opens nothing and grants nothing; it only
lets you verify a signature came from her. **It is her key, not yours.**

### What happens when you run it, with no sovereign

A fresh clone carries a key you did not mint, and nothing on your machine can testify about where it
came from. So `init` refuses to guess and stops:

```
[init] Paternity: UNVERIFIABLE — no sovereign at ~/.koad-io/me on this device
[init]   Choose one, explicitly:
[init]     koad-io init alice --adopt   adopt the key in id/ as yours
[init]     koad-io init alice --re-seed  ignore it; mint a fresh keypair
exit 2
```

**Pick `--re-seed`.** It is the correct answer for a template, and it does **not** require a
sovereign — creation was never the suspect act:

```bash
koad-io init entity alice --re-seed
```

```
[init] No sovereign on this device — minting alice's own key provisionally.
[init]   wrote: id/provisional.json (unsigned — sovereign countersignature pending)
[init] Init complete: alice
```

**✓ Verified 2026-10-21:** exit 0, your own keypair, device leaf, launcher at
`~/.koad-io/bin/alice`, `AGENTS.md`, and `bonds: 0`. Alice's published key is untouched — never
adopted.

If you would rather not see the choice at all, delete the published key first and `init` mints
without asking:

```bash
rm -rf ~/.alice/id && koad-io init entity alice     # exit 0, no prompt
```

Both routes end in the same place. Alice's own README recommends the second; they now agree on the
result.

**A provisional entity is not a broken one.** `~/.alice/id/provisional.json` records
`status: provisional` and `sovereign_countersign_required: true`. An unsigned entity says it is
unsigned. `SOVEREIGN.md` covers what signing it later means.

### Two other ways to get an entity

```bash
koad-io gestate entity myentity      # from scratch (see §9)
alice gestate newentity               # inherit from an existing entity
```

**? Unverified:** the inherited form. Never run on a clean box.

---

## 8. Talk to her

```bash
cd ~/.alice && alice
```

Bare `alice` launches the entity's harness. The harness resolves from `ENTITY_DEFAULT_HARNESS` in
the entity's `.env`, then `KOAD_IO_*`, then a hardcoded `opencode`.

**⚠ No harness CLI ships with the framework.** The adapters do — `commands/harness/` carries
`opencode`, `pi`, `claude`, `codex`, `gemini`, `ollama`, `bash`, `zsh` — but not the binary. A bare
install has a working entity and nothing to run it with:

```
Error: 'opencode' CLI not found at ~/.koad-io/bin/opencode or on PATH.
  Install: curl -fsSL https://opencode.ai/install | bash
```

```bash
curl -fsSL https://opencode.ai/install | bash     # → ~/.opencode/bin, no sudo
```

**✓ Verified 2026-10-21:** user-scoped, no elevation, and opencode ships free models — there is no
API-key step between that command and her first reply.

**⚠ Do not use `npm install -g opencode-ai` as a normal user.** It is correct about the package and
wrong for a newcomer: on Debian it fails `EACCES` against `/usr/local`.

One-shot, once the binary is there:

```bash
cd ~/.alice && alice harness default "say hello in five words"
#   > alice · big-pickle
#   Hello how are you today.
```

**⚠ `alice "some sentence"` is not a prompt.** The launcher reads its first argument as a command
name. Use `alice harness default "…"`.

**⚠ Run from a project directory, not `$HOME`.** Harnesses refuse the home directory outright —
`Error: WORK_DIR '<home>' is the home directory.` The entity's own directory carries a `.env` and
is a valid working folder.

**Why opencode is the default — and the correction (2026-10-21).** The original reasoning was:
*opencode asks for confirmation on essentially all filesystem and bash tooling, and in kindergarten
nothing is bond-gated, so the confirmation prompt is the safety net.* **That claim is false as of
opencode 2.0** — it was a property we were renting from upstream and never checked.

What makes a newcomer safe now is ours, not a vendor's:

1. **The adapter writes a permission config that asks** — `~/.<entity>/opencode/opencode.json`, with
   `ask` for `bash`, `edit`, `webfetch`, `websearch`, `external_directory` and `doom_loop` **when the
   session is interactive**. It flips to `allow` for one-shot runs, because a dispatched flight has
   nobody at the keyboard to answer an approval: asking there does not make the system safer, it
   makes the flight hang until it times out. Dispatched work is bounded by the bond gate and the
   flight's lane instead — the layer that can actually see it.

   **✓ Verified 2026-10-21** on both postures: `alice harness default "…"` writes
   `permission.bash: allow`; bare `alice` writes `permission.bash: ask`. Same file, same agent.
2. **The adapter never passes `--auto`.** Its meaning — *auto-approve permissions that are not
   explicitly denied* — is the whole posture in one flag, and it would silently override the mode
   split above.
3. **The adapter asserts the harness version at launch.** 1.x and 2.x speak different flags;
   anything else exits with one line naming what is supported. Before this check, a 2.x binary
   receiving 1.x flags printed its own help and exited — a failure that looks like documentation.

**⚠ This was never a rented guarantee — it was ours, and it was generous.** The 1.x adapter
*generated* its permission block inline, and it allowed `bash`, `edit`, `glob`, `grep`, `skill` and
`task` outright for the entity agent. That is what auto-approved, not an upstream default: the
kingdom never shipped a config file, but the adapter always wrote one in memory. If you want to know
why an agent acted without asking, that block is the answer.

The original reasoning stays visible: it is the paragraph that caught the change.

---

## 9. Your own entity

```bash
koad-io gestate entity myentity
```

Creates `~/.myentity` with its own keypair, directories, launcher, and manifest. Names are 3–12
lowercase letters; `me` is reserved for the sovereign.

**✓ Verified 2026-10-21** with no sovereign anywhere: exit 0, launcher written,
`myentity whoami` runs. The entity is marked provisional and says so — `gestate` has never forced
sovereign keys onto a device that does not have them.

---

## You do not need a sovereign to use koad:io

At this point you have: the framework, a readable commands folder, an entity you can talk to, and
the ability to make more. **No keys of your own. No bonds.**

A sovereign is required for exactly two things: **creating a kingdom**, and **any bond-gated
workflow**. No command that ships with the framework is bond-gated internally.

When you want one → **`SOVEREIGN.md`**.

---

## What is not covered here

| Missing | Note |
|---|---|
| **`~/.forge/`** | The business overlay (websites, services, packages). Not needed to install. Separate repo. |
| **Packages** | The framework ships **no** Meteor packages as of 2026-10. Each koad:io-* package is its own repo under `~/.forge/packages/`, resolved via `KOAD_IO_PACKAGE_DIRS`. A bare install needs those cloned separately — **that step is not written**. |
| **The daemon** | `koad-io install deps --daemon` installs its dependencies, but running it is not covered here. |
| **`install.koad.sh`** | 0% built — a Meteor skeleton only. |
| **`ppa.koad.sh`** | A 2023 hello-world `.deb`. |

## What changes soon — do not pre-empt

**VESTA-SPEC-229 (draft)** reorders this flow: it mints the identity credential **earlier**, before
any authenticated fetch, and splits the canon into a public bootstrap floor and an authenticated
payload. That ordering is not implemented. **Do not land it before the clean-room suite runs against
the ordering above** — testing a moving target produces meaningless results.

Note the tension this document now embodies: SPEC-229 wants identity earlier, and the 2026-10-21
restructure moved it later. That is not a contradiction yet — 229 is about *fetching canon*, this is
about *running an entity* — but whoever implements 229 has to reconcile the two.

## This file's own history

There was never a stable install document. The README carried the instructions until `4c978a8`
(2026-06-29) removed 498 lines of them. The steps survived only in git history, and this file was
reconstructed from it on 2026-09-24.

**2026-10-21 — restructured into kindergarten + `SOVEREIGN.md`.** koad: *"the idea of sovereign is
level 5+ … people should be able to install and run koad:io without needing a sovereign."* Nine
clean-room walks on cold Debian 13 boxes (`testy001`–`testy010`) produced every ✓ above, and the
corrections are dated rather than silent. The pattern those walks kept finding: things that work on
a machine with years of accumulated local state, and fail on a clean one.
