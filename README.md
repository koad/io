
> ⚠️ **Please note:** This app is under active development.  
> It is riddled with bugs. Everything is subject to change.

# 🧠 koad:io

<!-- for that whom may have an eye to see -->
**tldr:** An organizational tool for your mind's eye.  

**koad:io** is a sovereign, local-first command-and-control framework for automating your digital life. It encapsulates identity, environment, and intent — letting you structure your scripts, services, and thoughts as composable, auditable entities.

At its core, `koad:io` is a modular CLI toolchain designed to manage:
- ⚙️ Reusable commands and workflows
- 🔐 Identity-backed assertions
- 📂 Project- and context-scoped environments
- 🗂️ Data and service organization across machines, devices, and personas

Whether you're managing shell scripts, building full-stack apps, or signing cryptographic login requests — `koad:io` helps you keep the whole thing structured, shareable, and verifiable.

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
├── .env            # Global koad-wide vars
└── .aliases        # Optional alias layer
````

Each entity has its own world:

```bash
.alice/
├── id/             # GPG keys (pub+priv)
├── commands/       # Persona-level commands
├── .env            # Local config
├── sites/          # Per-domain overrides
├── hooks/          # Optional pre/post exec scripts
```

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

* 🚫 No cloud, ever
* 🔐 Identity-first
* 🧱 Modular, file-based, reproducible
* 🧠 Designed for thinkers, hackers, and sovereign operators

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

2. **No args?**
   → Run `hooks/executed-without-arguments.sh`.

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

## 👤 Create Your First Entity

> Your first `koad:io` entity — congrats!

```bash
koad-io gestate alice
```

Check it:

```bash
ls -la ~/.alice
```

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

Check the `commands/` folder — there’s not a lot preloaded. And that’s intentional.

You’re meant to build this your way. But here’s what’s included by default:

### 📦 Base Commands

* [gestate](/commands/gestate/README.md) — create new entities
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


### License

koad-io is licensed under the GPL License.
