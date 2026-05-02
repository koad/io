<!-- SPDX-License-Identifier: CC0-1.0 -->


> ⚠️ **Please note:** This app is under active development.  
> It is riddled with bugs. Everything is subject to change.

# 🧠 koad:io

<!-- for that whom may have an eye to see -->
**tldr:** A harness for the mind. Context mastery for the king of all data.

**koad:io** is a sovereign, local-first substrate for synthetic intelligence — a CLI toolchain that lets you externalize cognition into auditable pieces you actually own. Identity, environment, intent, and the workflows that connect them, all as composable entities living as files and folders on hardware you control.

The CLI is the synthetic logic. Every command saved is a remembered solution that no longer needs remembering. Over time, that distilled cognition compounds — the kingdom of your work accumulates as your own instruction set, in your own filesystem, on your own terms.

At its core, `koad:io` is a modular CLI toolchain designed to manage:
- ⚙️ Reusable commands and workflows — your own distilled cognition
- 🔐 Identity-backed assertions
- 📂 Project- and context-scoped environments
- 🗂️ Data and service organization across machines, devices, and personas
- 🧠 Specialized entities (containers of context) the mind orchestrates without holding their detail

Whether you're managing shell scripts, building full-stack apps, signing cryptographic login requests, or coordinating a team of synthetic intelligence harnesses — `koad:io` helps you keep the whole thing structured, shareable, and verifiable.

> “Your systems need to be faster than you (can) think.”  
> — adapted from [Getting Things Done](https://gettingthingsdone.com/)

---

## 🧭 Reason

By saving a task as a `command`, and saving its working context as an `entity`, I can:

- 📜 Remember *how* I did a thing
- 🔁 Replay it later, identically
- ⏳ Audit my decisions and assumptions
- 🗃 Keep my stuff together as simple files and folders
- 🧠 Internalize the structure of my work
- 📦 Package or pass projects on as-is
- 👁 Visualize the state and focus areas of my system

---

## ⚡ Status

> **[BUG SALAD]**  
> Use at your own curiosity. It works. But only mostly. Maybe.

---

## 🔍 koad:io at a glance

- 🧱 **Entities** = containers for env variables, commands, and keys
- 🧾 **Commands** = repeatable tasks saved as bash scripts
- 🧠 **Context-aware execution** = auto-loads `.env`, keys, and project scopes
- 📜 **PGP assertion system** = sign/verify/login flows via GPG
- 🔗 **Meteor integration** = talk to local/remote daemons with verifiable identity
- 🧰 **No cloud required** = all data is stored locally

---

## 🛠 Directory layout (typical)

```bash
.koad-io/
├── bin/            # Entrypoint commands (alice, koad, etc.)
├── commands/       # Global command templates
├── packages/       # Local Meteor packages
├── skeletons/      # Project templates
├── hooks/          # Execution hooks
├── .env            # Global koad-wide vars
├── .credentials   # Private credentials (not in git)
└── .aliases       # Optional alias layer
````

Each entity has its own world:

```bash
.alice/
├── id/             # GPG keys (pub+priv), SSH keys
├── commands/       # Persona-level commands
├── skills/         # opencode skills
├── memories/       # Context memories
├── skeletons/      # Custom project templates
├── packages/       # Entity-specific Meteor packages
├── .env            # Local config
├── .credentials    # Entity credentials
├── hooks/          # Optional pre/post exec scripts
└── .local/        # Local data (minimongo if no MongoDB)
```

---

## 📦 Local Meteor Packages

koad:io supports local Meteor packages via `KOAD_IO_PACKAGE_DIRS`.

Set in `~/.koad-io/.env`:
```bash
KOAD_IO_PACKAGE_DIRS=$HOME/.ecoincore/packages:$HOME/.koad-io/packages
METEOR_PACKAGE_DIRS=$KOAD_IO_PACKAGE_DIRS  # DEPRECATED: Meteor compat shim
```

This allows:
- Custom packages in `~/.koad-io/packages/`
- eCoinCore packages in `~/.ecoincore/packages/`
- Entity-specific packages in `~/.alice/packages/`

---

## 🗄️ MongoDB Modes

### With MongoDB (Centralized)
Set `MONGO_URL` in entity's `.env`:
```bash
MONGO_URL=mongodb://localhost:3001/mydb
```
- All apps share same database
- Single login via Meteor Accounts + OAuth
- Apps can share data

### Without MongoDB (Isolated)
Each Meteor app creates **minimongo** in `.local/meteor/`
- App is isolated from other apps
- No shared data
- Good for testing/prototyping

---

## ✍️ Example usage

```bash
# Login via SSH to a different device
alice ssh crapple

# Sign a message with alice's key
alice sign "I am the sovereign."

# Generate a login assertion for a domain
alice generate login wonderland.koad.sh

# Generate a login assertion for a domain and deliver it
alice login wonderland.koad.sh [session id]
```

Or pipe anything into a clipboarded GPG clearsign:

```bash
echo "hello world" | alice sign
```

---

## 🌐 Philosophy

* 🚫 **Anti-fragmentation, not anti-AI.** Cloud architectures fragment cognition by design — every operation a network call, every workflow rented, every lesson learned trapped in someone else's database. That's "a computer with no cache." We reject this at the foundation.
* 🔐 **Identity-first.** Sovereignty over your own keys, your own data, your own substrate. Bonds are explicit and auditable.
* 🧱 **Modular, file-based, reproducible.** Files and folders are the external mind. The filesystem is your cognitive prosthetic. Locality is what makes cognition at scale possible.
* 🧠 **Designed for thinkers, hackers, and sovereign operators.** A $200 laptop, harnessed in correctly, is enough to throne up. Sovereignty isn't enterprise-priced — it's gated only by the discipline of externalizing cognition into auditable pieces.

> **Synthetic intelligence connected via files and folders. On hardware you own.**

---

## 💬 Community

[![Matrix](assets/matrix.svg)](https://matrix.to/#/#io:koad.sh?via=koad.sh)
Come hang out in the `#io:koad.sh` room — share flows, scripts, bugs, ideas.

---

## 🪪 License

MIT — Yours to fork, break, and rebuild.

> “I am an amateur. This might all be shit. It's too early to tell.”
> — @you, wisely

---


## 🐇 Want to See How Deep the Rabbit Hole Goes?

### Commands

Some folks fear the command line. But we know the truth:

> [The magic lives here.](https://kingofalldata.com/cheatsheets/bourn-again-scripting)

If you're comfortable with `bash`, `koad:io` will make perfect sense.
If not — well, maybe someone will build a UI for you. Eventually.

---

### 🧠 Example: Potential koad\:io Commands

Start a site:

```bash
alice start site kingofalldata.com
```

Open Element (Matrix) as Alice:

```bash
alice open element
```

SSH into "toronto" as Alice:

```bash
alice ssh toronto
```

> `koad:io` doesn’t ship with commands.
> You build your own — intimately, intentionally.

📚 [Read more](https://kingofalldata.com)

---

## 🔗 Chain Reactions: How a Command is Processed

Every command execution goes through a deterministic path of evaluation:

1. **Call an entity wrapper**
   → `alice start`, `alice hello`, etc.

2. **No arguments?**
   → Run `hooks/executed-without-arguments.sh`
   → Harness selected by `KOAD_IO_ENTITY_HARNESS` (default: `opencode`, team entities set `claude`)
   → Opens the entity as an interactive AI session — or runs non-interactively when `PROMPT=` is set
   → See `hooks/PRIMER.md` for full documentation

3. **Set environment:**

   * `ENTITY=alice`
   * `CWD=$PWD`

4. **Call core CLI wrapper:**
   → `~/.koad-io/bin/koad-io $@`

5. **Load environments (if present):**

   * `~/.koad-io/.env`
   * `~/.$ENTITY/.env`
   * `~/.$ENTITY/.credentials`

6. **Find the command script:**

   * `~/.koad-io/commands/`
   * `~/.$ENTITY/commands/`
   * `$CWD/commands/`
   * `./$COMMAND.sh`

7. **Load local env (if needed):**

   * `$CWD/.env`
   * `$CWD/.credentials`

8. **Execute command.sh** with full context.

---

### 🧪 Examples

**Example 1:**

```bash
alice probe domain koad.sh
```

Breaks down to:

```bash
set -a
source ~/.koad-io/.env
source ~/.alice/.env
~/.koad-io/commands/probe/domain/command.sh koad.sh
```

**Example 2:**

```bash
alice archive video https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

Breaks down to:

```bash
set -a
source ~/.koad-io/.env
source ~/.alice/.env
~/.koad-io/commands/archive/video.sh https://www.youtube.com/watch?v=...
```

> Will store output in `~/.alice/archive/inbound` or the path in `KOAD_IO_ARCHIVE_FOLDER`.

```env
KOAD_IO_ARCHIVE_FOLDER=$HOME/.alice/archive/inbound
```

---

## ⚙️ Install `koad:io`

1. Install dependencies:

   * [starship](https://kingofalldata.com/cheatsheets/starship-cross-shell-prompt)
   * [node-volume-manager](https://kingofalldata.com/cheatsheets/node-volume-manager)

2. Clone the repo:

```bash
git clone https://github.com/koad/io.git ~/.koad-io
```

3. Add it to your `PATH` (append to `~/.bashrc`):

```bash
[ -d ~/.koad-io/bin ] && export PATH=$PATH:$HOME/.koad-io/bin
```

One-liner install:

```bash
git clone https://github.com/koad/io.git ~/.koad-io && echo -e "\n\n[ -d ~/.koad-io/bin ] && export PATH=\$PATH:\$HOME/.koad-io/bin\n" >> ~/.bashrc && export PATH=$PATH:$HOME/.koad-io/bin
```

---

### macOS Install (zsh)

macOS uses **zsh** by default. Profile file is `~/.zshrc`, not `~/.bashrc`.

**1. Install nvm (Node Version Manager):**

```zsh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

nvm appends itself to `~/.zshrc` automatically. Reload your shell:

```zsh
source ~/.zshrc
```

**2. Install Node.js and Claude Code:**

```zsh
nvm install 24
nvm use 24
npm install -g @anthropic-ai/claude-code
```

Claude Code will be available at `~/.nvm/versions/node/<version>/bin/claude`.

**3. Clone koad:io and add to PATH:**

```zsh
git clone https://github.com/koad/io.git ~/.koad-io
echo '\n[ -d ~/.koad-io/bin ] && export PATH=$PATH:$HOME/.koad-io/bin' >> ~/.zshrc
source ~/.zshrc
```

One-liner install (macOS/zsh):

```zsh
git clone https://github.com/koad/io.git ~/.koad-io && echo '\n[ -d ~/.koad-io/bin ] && export PATH=$PATH:$HOME/.koad-io/bin' >> ~/.zshrc && export PATH=$PATH:$HOME/.koad-io/bin
```

**4. Verify the install:**

```zsh
which koad-io       # should show ~/.koad-io/bin/koad-io
koad-io --version
claude --version    # confirm Claude Code is accessible
```

**macOS gotchas:**

- **Homebrew PATH**: If you use Homebrew (`/opt/homebrew/bin`), it's added to `~/.zshrc` by the Homebrew installer. No manual action needed, but ensure it appears before the nvm block.
- **Apple Silicon (M1/M2/M3)**: Homebrew installs to `/opt/homebrew/` (not `/usr/local/`). This is already handled by the Homebrew installer.
- **nvm + zsh**: If `nvm` isn't found after install, check that `~/.zshrc` contains the nvm init block and run `source ~/.zshrc`.
- **System node conflict**: macOS may ship a system Node.js or have one from Homebrew. Always use `nvm use <version>` to ensure the correct Node.js is active. Run `which node` to confirm you're using the nvm-managed version.

---

## 👤 Create Your First Entity

### Option 1: Clone Alice (Recommended)

```bash
git clone https://github.com/koad/alice.git ~/.alice
koad-io init alice
```

Creates the `alice` command, skips key generation.

### Option 2: Gestate New Entity (Full)

```bash
koad-io gestate myentity
```

Creates from scratch with keys, directories, and wrapper.

### Option 3: Gestate from Entity (Inherits)

If running from an existing entity:
```bash
alice gestate newentity
```

Copies skeletons, commands, packages from mother entity!

---

**Back this up.** Store it somewhere *ridiculously safe.*

---

## 🛠 Create Commands

Start here:

* [Bash Cheatsheet](https://kingofalldata.com/cheatsheets/bourn-again-scripting)
* Browse `./commands/` for prototypes

### 🔄 Global Command Example

```bash
mkdir ~/.koad-io/commands/hello
cd ~/.koad-io/commands/hello
cat <<EOF > command.sh
#!/usr/bin/env bash
echo "hi there, \$ENTITY here!"
echo "args: \$@"
EOF
chmod +x command.sh
```

Run from anywhere:

```bash
alice hello
alice hello arg1 arg2
```

---

### 👤 Entity-Specific Command

```bash
mkdir ~/.alice/commands/hello
cd ~/.alice/commands/hello
cat <<EOF > command.sh
#!/usr/bin/env bash
echo "hi there, \$ENTITY here!"
echo "args: \$@"
EOF
chmod +x command.sh
```

Run only with Alice:

```bash
alice hello
```

---

### 📁 Folder-Specific Command

```bash
cd ~/some/random/folder/
cat <<EOF > hello.sh
#!/usr/bin/env bash
echo "hi there, \$ENTITY here!"
echo "args: \$@"
EOF
chmod +x hello.sh
```

Then:

```bash
alice hello
```

---

> `koad:io` isn’t just CLI automation — it’s a system for embedding memory into code, and shaping your tools around your mental model.

**Now go build yours.**
Your entity is listening.

---




## 🔹 Preloaded Commands

Check the `commands/` folder — there's not a lot preloaded. And that's intentional.

You're meant to build this your way. But here's what's included by default:

### 📦 Base Commands

* [gestate](/commands/gestate/README.md) — create new entity (full: keys + dirs + wrapper)
* [init](/commands/init/README.md) — initialize existing folder (skip keys, create wrapper)
* [spawn](/commands/spawn/README.md) — deploy skeleton to current folder
* [whoami](/commands/whoami/README.md) — introspect the current environment
* [example](/commands/example/README.md) — explore supported patterns

---

### 💬 Language-Specific Examples

Use these to see how to write `koad:io` commands in different languages:

* [bash](/commands/example/bash/README.md)
* [javascript](/commands/example/javascript/README.md)
* [python](/commands/example/python/README.md)
* [rust](/commands/example/rust/README.md)
* [go](/commands/example/go/README.md)

---

### 🔍 Try It: Example Command

Run the base example:

```bash
alice example
```

Sample output:

```
see how these examples work by taking a peek into the ~/.koad-io/commands/example folder

this output is created by the file ~/.koad-io/commands/example/command.sh
```

Run language-specific demos:

```bash
alice example bash
alice example javascript
alice example python
alice example rust
alice example go
```

Each one is a minimal, working prototype in its language — meant to inspire your own tools.

---

## 💀 Skeletons: Project Templates

Skeletons provide **precise, reproducible** starting points for projects.

### How It Works

1. Create skeleton in `~/.koad-io/skeletons/<name>/`
2. Structure: `skeleton/` folder + `control/` scripts
3. Run `alice spawn <name>` to deploy to current folder

### Available Skeletons

* **bare** — Minimal Meteor app
* **interface** — UI-focused project
* **lighthouse** — Lighthouse-related

### Control Scripts

- `control/pre-install` — runs before copying
- `control/install` — main setup
- `control/post-install` — runs after copying

### Meteor is Swappable

Meteor is the default compiler, but you can replace it with:
- Vite
- webpack
- Any build tool

Just modify the skeleton's install script. Skeletons bring context — not random starts, but precise ones.

---

## 🧠 Example Entity: `Alice`

Need inspiration? Explore the [Alice repo](https://github.com/koad/alice) — a complete, working entity built with `koad:io`.

Alice is designed to showcase the real-world utility and creativity behind the `koad:io` approach.

> 🛰 Check it out, fork it, remix it — and build your own synthetic intelligence system.



### Contributing

koad-io is an open-source project, and contributions are always welcome. If you'd like to contribute to koad-io, please take a look at our contributing guidelines for more information.

### 🤝 Support

As mentioned above, I am an amateur; 

I have been using computers for a long time, programming for a long time; but, I totally suck in a lot of ways.  

> I'd appreciate any feedback from any seasoned `bash` users out there!  

Contributions, issues, and feature requests are welcome!  

Give a ⭐️ if you like this project!


P.S.  somebody somewhere, sometime, will create a voice controller for this,. so keep that in mind when creating commands.  You have full control, imagine if you were able to teach siri over time (for yourself);  it would be amazing.  


/koad
