# PRIMER — `~/.koad-io/commands/harness/`

> The harness router. Drop-in point for the operator surface of VESTA-SPEC-072 (Entity-Dir-as-Harness-Container).

## What this directory is

The koad:io `harness` built-in lets any entity be launched through any harness with any provider and any model. One primitive, four axes:

```
<entity> harness <harness> <provider> <model> [prompt]
```

`<harness>` can be the literal string **`default`** — a meta-harness that resolves `$ENTITY_DEFAULT_HARNESS` (from `~/.<entity>/.env`) and delegates. `<provider>` and `<model>` are optional at every call site; each sub-command cascades positional → `$ENTITY_DEFAULT_*` → `$KOAD_IO_DEFAULT_*` → hardcoded. Pin your preferences in `.env` once and use `<entity> harness default [prompt]` thereafter.

**Session continuity:** `--continue` / `-c` (or `CONTINUE=1` env var) resumes the most recent session for the current project directory. Rooted entities always run from `$ENTITY_DIR`, so they get exactly **one** persistent session per entity — stable memory across invocations. Roaming entities get one session per `(entity × project-dir)` pair, which is the right behavior when they're invoked inside user projects.

Every sub-directory here is one harness. Every sub-command is responsible for the same five things:

1. Export `<HARNESS>_CONFIG_DIR=$ENTITY_DIR` (the SPEC-072 structural rule — mechanically it may be `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `PI_CONFIG_DIR`, etc., depending on what the underlying CLI respects)
2. Cascade-resolve credentials for the requested provider (koad-io loader has already sourced `~/.koad-io/.credentials` → `~/.<entity>/.credentials` into the environment before this script runs)
3. Normalize the model name into whatever the harness CLI expects
4. Honor `KOAD_IO_ROOTED` for cwd selection (`$ENTITY_DIR` if rooted, `$CWD` if roaming)
5. Interactive mode when no prompt; one-shot with the harness's `-p` equivalent when a prompt is present

## What *is* a harness — the frame insight

Read this before you think about adding one. It will save you from building something koad:io doesn't need.

A **harness** is any program that hosts an entity's session. That's the only requirement. It doesn't have to be an LLM CLI. It doesn't have to be terminal-native. It doesn't have to be "designed for agents." It just has to give you three surfaces:

1. **A way to load the entity's env and context** — usually an env var like `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, or `PI_CONFIG_DIR`. If the program has no config-dir knob, you can still often fake it with `HOME`-override or a wrapper script. Absence of a knob is a sign the program wasn't built for multi-tenancy, not a reason to give up.
2. **A chrome surface the framework can paint** — a statusline hook, a plugin API, a slot system, a theming file, a prompt template, a splash screen, a startup banner. Any place the program lets external code render content inside its frame. This is where identity lives: entity glyph, outfit color, starship-parity rows, sensor ribbon.
3. **An extension point for behavior** — hooks, tools, plugins, MCP, slash commands, anything that lets the framework add capabilities without forking the host program.

**If a program has all three, it can be a koad:io harness.** If it has two, it's almost certainly one step of work away from being one. If it has one, it's a research project — write a brief and park it.

### Why this matters: the frame insight

koad:io does **not** build TUIs, chat surfaces, or editor integrations. Every one of those is somebody else's problem, somebody else's roadmap, somebody else's engineering budget. The framework's job is to teach each of those surfaces to **feel like home** — same entity glyph, same outfit color, same starship-parity identity tuple, same self-awareness ribbon shape — without forking any of them.

The payoff: every competent AI harness that ships in the next five years will have a plugin API, because they all have to compete on extension surface. Claude Code has `statusLine` + hooks. Opencode has slot-based TUI plugins + server hooks. Pi-mono has the same. Hermez will have to. VS Code, JetBrains, Zed, Neovim, Emacs, Warp, Ghostty — every decent program in the developer stack has an extension surface. Each of those is a potential harness. Each of those is *free labor for the kingdom* — somebody else eats the cost of building the chrome, koad:io shows up with a plugin that says "now it's also a home for an entity."

### The entity is the constant, the harness is the costume

This is the load-bearing mental model. Phrase it this way when onboarding any new agent to the framework:

- **The entity** — identity, memory, keys, trust bonds, commands, hooks, passenger.json, outfit. Lives in `~/.<entity>/`. Portable. Inspectable. Sovereign.
- **The harness** — the runtime costume the entity wears for this session. Lives in `~/.koad-io/commands/harness/<name>/` (the dispatcher) and `~/.koad-io/plugins/<name>/` (the chrome plugins). Swappable. Disposable. Not sovereign — the entity doesn't care which one it's wearing.

An entity can switch harnesses mid-task and its identity doesn't flicker, because the identity never lived in the harness. The outfit color follows it. The ◊ glyph follows it. The memories follow it. The keys follow it. The harness is a stage; the entity is who walks onto it.

### The "any app" thesis

Any app can be a harness if it's thought about long enough.

- **A shell** (already shipped: `bash`, `zsh`) — the entity's env sourced, PS1 tagged, cwd rooted, commands on PATH. The zero-LLM fallback.
- **A chat CLI** (shipped: `claude`, `opencode`; draft: `pi`; planned: `hermez`) — the obvious case.
- **An editor** — VS Code with its extension API, JetBrains with its plugin SDK, Neovim with Lua, Emacs with elisp. Every one of them has a statusline, a sidebar, a command palette, a hook system. Write a koad:io plugin for the editor and the editor becomes a harness that the entity can "inhabit" alongside whatever chat runtime is also running.
- **A terminal** — Warp, Ghostty, iTerm2, Kitty all have prompt themes, blocks, and increasingly plugin APIs. The terminal itself can be a harness — the entity's ◊ and outfit color painted into the terminal chrome, not just the shell inside it.
- **A web interface** — anything with a `<head>` and a way to inject content. kingofalldata.com serving the AI-to-AI primer in `<head>` is a degenerate harness: a web page that hosts an *invitation to gestate* for any AI that fetches it.
- **An MCP server** — a standalone process that exposes tools and resources over the Model Context Protocol. The entity's capabilities surfaced as MCP tools; any MCP client becomes a harness that can host the entity's behavior.
- **A window manager / status bar** — polybar, waybar, i3bar, yabai. Your WM bar can display the entity's sensor ribbon. Your desktop becomes a harness.
- **A game** — if it has an extension API, it can host an entity. This is not a joke. Factorio mods, Minecraft plugins, even OpenRCT2 have scripting. An entity could run as an NPC. Deferred but not excluded.

The pattern is always the same: find the extension surface, write a plugin, route identity through it. Every new harness is a new costume in the closet.

### When to add a new harness to this directory vs. a new plugin

Two different decisions, often conflated:

- **New harness dispatcher** (`~/.koad-io/commands/harness/<name>/`) — you need this when the program is a **session host**: it runs a conversation, loads credentials, owns a process lifetime, needs config-dir handoff. Claude, opencode, pi, hermez, bash. Dispatchers go in *this* directory.
- **New plugin** (`~/.koad-io/plugins/<harness>/<name>/`) — you need this when the program is already a session host and you want to *paint chrome inside it*. The Claude statusline is a plugin for claude (wearing the older `commands/harness/claude/statusline.sh` layout, pending relocation). The opencode shell-git ribbon is a plugin for opencode. Plugins go in the `plugins/` shelf.

Many harnesses need both — a dispatcher in `commands/harness/<name>/` to launch the program with the right env, and one or more plugins in `plugins/<name>/` to paint identity into its chrome. Claude Code is like this today. Opencode will be once the shell-git plugin is wired.

### What this means for the next thinker

If you are an agent reading this file because you are about to propose a new harness — **stop and ask the bigger question first**. Is the program you're thinking about actually a session host? Or is it a chrome surface that could be painted with a plugin?

If it's a session host: add a dispatcher here, follow the five-section template in `claude/command.sh`, update the state table, commit.

If it's a chrome surface for an existing session host: add a plugin in `~/.koad-io/plugins/<harness>/<name>/`, follow the category PRIMER at `~/.koad-io/plugins/PRIMER.md`, commit.

If it's *both* — rare but possible, e.g. a new editor that also runs an embedded LLM — do both.

If it's *neither* but the idea is still interesting — write a brief in `briefs/` and park it. Not everything has to ship.

And if you find yourself about to build a TUI from scratch: **don't.** Find a TUI that already exists, has extension points, and has traction. Wear it. All their base is ours.

## Current state

| Harness  | Status      | Config-dir mechanic                   | Notes |
|----------|-------------|---------------------------------------|-------|
| default  | **shipped** | _(delegates)_                         | Meta-harness. Resolves `$ENTITY_DEFAULT_HARNESS` → `$KOAD_IO_DEFAULT_HARNESS` → `opencode`, then `exec`s the chosen sub-command with `$PROMPT` in env (no positional args) so the delegate's own env cascade owns provider/model selection. |
| bash     | **shipped** | _(none — human harness)_              | The original way of using koad:io, pre-LLM. Loads the entity env, cds to rooted/roaming cwd, drops into an interactive bash with an entity-tagged PS1 (sources `~/.bashrc`, then prepends `[entity]` in magenta via a process-substituted rcfile). One-shot mode via `PROMPT` or positional. No provider/model. |
| zsh      | **shipped** | _(none — human harness)_              | Mirror of `bash` for the **Mac hosts** (fourty4, flowbie) where zsh is the default shell. Uses a per-entity `ZDOTDIR` at `~/.cache/koad-io/harness/<entity>/zsh/` whose `.zshrc` sources the user's real `.zshrc` then tags `PROMPT`. Untested runtime on wonderland (Linux, no zsh), `bash -n` clean — validate on fourty4. |
| claude   | **shipped** | `CLAUDE_CONFIG_DIR=$ENTITY_DIR`       | Verified with real `claude` CLI. Provider: anthropic. |
| opencode | **shipped** | `XDG_CONFIG_HOME=$ENTITY_DIR`         | Verified with fake binary. Providers: anthropic/openai/ollama/openrouter/google + passthrough. |
| pi       | **draft**   | `PI_CONFIG_DIR` + `XDG_CONFIG_HOME`   | **UNVERIFIED** — drafted from memory, pending validation on fourty4 where pi-mono actually runs. Binary name, flags, and model format all guessed. See the TESTING NOTES block in `pi/command.sh`. |
| tui      | not started | —                                     | Planned. |
| hermez   | not started | —                                     | Planned. NousResearch v0.6.0; GPG bonds need custom plugin. |

**Human harnesses (bash / zsh).** `bash` and `zsh` are the pre-LLM way of using koad:io: a terminal, loaded with the entity's env, rooted in the right place, with the entity's commands on `PATH`. They exist for three reasons worth remembering:

1. **Operator ergonomics.** Sometimes the right harness for a task is a shell, not a model. `juno harness bash` lands you in juno's shell, tagged as juno, for any manual work.
2. **koadOS story.** A fresh install needs to be usable *immediately*, before any LLM auth is configured. `<entity> harness bash` is the zero-dependency fallback — no API key, no credit card, no signup, no network.
3. **Harness honesty.** The `harness` primitive is an abstraction over *any* runtime, not just LLMs. Shipping shells as peers to claude/opencode/pi keeps that framing honest.

## Files at this level

- `command.sh` — top-level dispatcher. Fires only when no sub-harness matches the second positional arg. Auto-discovers installed harnesses by listing sibling dirs that hold a `command.sh`, prints usage, lists what's available, errors clearly on unknown harness.
- `README.md` — human-facing documentation of the convention, contract, and defaults cascade. Link this when introducing the concept.
- `PRIMER.md` — this file. Agent orientation: what's here, current state, where to work next.
- `<harness>/command.sh` — one per harness.

## How dispatch reaches a sub-harness

The koad-io CLI (`~/.koad-io/bin/koad-io`) finds the **deepest matching command directory** against the positional args.

For `juno harness claude anthropic opus-4-6 "hi"`:

- depth 1: `~/.koad-io/commands/harness/` exists → candidate
- depth 2: `~/.koad-io/commands/harness/claude/` exists → deeper, wins
- `EXEC_ARGS` becomes `"anthropic opus-4-6 hi"`
- exec `harness/claude/command.sh anthropic opus-4-6 hi`

Word-splitting on exec means multi-word prompts arrive as separate positional args. Sub-commands must either `PROMPT="$*"` to reassemble, or honor an env-var `PROMPT` override for callers who want to sidestep the splitting.

## Prompt input precedence

Three ways to feed a prompt, checked in order:

1. **`$PROMPT` env var** — `PROMPT="..." vesta harness default`
2. **stdin pipe** — any non-TTY stdin is read via `cat`. Heredocs, `cat file |`, command output piped in. This is the **quoting-free** path: content never touches shell word-splitting, so nested `'single'` + `"double"` quotes, `$vars`, and `` `backticks` `` all pass through literally.
3. **Positional args** — legacy `harness default "hi there"`, word-split by the koad-io dispatcher and rejoined with single spaces.

The `default` meta-harness consumes stdin itself (before `exec`) and exports the result as `$PROMPT` so the delegate sees a clean env var rather than a spent pipe. Individual sub-commands (claude, opencode) also read stdin directly when invoked without `default`.

**Canonical heredoc form** — use this for any prompt with quoting concerns:

```bash
cat <<'EOF' | vesta harness default -c
Multi-line prompt with 'quotes' and "quotes" and $vars,
all literal, all fine.
EOF
```

## Session continuity (`--continue` / `-c`)

Every shipped sub-command filters `--continue` / `-c` out of the positional args (same pattern as koad-io's `--quiet` filter) and also honors the `CONTINUE=1` env var. When set, the flag is forwarded to the underlying CLI — `claude -c`, `opencode -c`, etc. The underlying CLI resumes the most recent session for the current working directory.

Three things fall out of that simple mechanism for free:

- **Rooted entities: one persistent session per entity.** `$CWD` is always `$ENTITY_DIR`, so `-c` always resumes the same session. Vesta remembers the last thing Juno said to her regardless of where Juno dispatched from.
- **Roaming entities: one persistent session per project.** `$CWD` is the caller's project dir, so `-c` resumes whichever session belongs to that project. Vulcan invoked inside `~/code/foo` resumes the `foo` session; invoked inside `~/code/bar` resumes the `bar` session.
- **Cross-harness independence.** `claude -c` and `opencode -c` key sessions independently; switching harnesses means a fresh session. That's not a bug — it's the natural consequence of each harness owning its own session store at `$ENTITY_DIR/<harness>-state/`.

Canonical shapes:

```bash
# Continue the entity's session on its default harness, new one-shot message
PROMPT="follow-up message" vesta harness default -c

# Continue and enter interactive
vesta harness default -c

# Continue on a specific harness, overriding default
vesta harness claude -c

# Env-var form (matches PROMPT= convention)
CONTINUE=1 PROMPT="..." vesta harness default
```

## The `default` meta-harness

`harness/default/command.sh` is a thin dispatcher — not a harness in its own right. It exists so entities can pin their preferred runtime in `.env` once and then invoke `<entity> harness default` without restating the harness name on every call.

Expected entity `.env` (entity-scoped, under the `ENTITY_` namespace):

```bash
ENTITY_DEFAULT_HARNESS=claude       # claude | opencode | pi | ...
ENTITY_DEFAULT_PROVIDER=anthropic   # read by the real harness's own cascade
ENTITY_DEFAULT_MODEL=sonnet-4-6     # read by the real harness's own cascade
```

Kingdom-wide fallback (under the `KOAD_IO_` namespace) in `~/.koad-io/.env`:

```bash
KOAD_IO_DEFAULT_HARNESS=opencode
KOAD_IO_DEFAULT_PROVIDER=anthropic
KOAD_IO_DEFAULT_MODEL=claude-sonnet-4-6
```

Resolution rule for each of the three axes: positional arg → entity default → kingdom default → hardcoded sub-command default. The `default` meta-harness only resolves the **harness axis** itself; provider/model are resolved inside the chosen sub-command, so the same cascade works whether you call `vesta harness default`, `vesta harness claude`, or `vesta harness claude anthropic sonnet-4-6`.

Prompt hand-off: `default/command.sh` rejoins post-dispatcher positional args into `$PROMPT` and exports it, then `exec`s the delegate with **zero** positional args — otherwise the delegate would mistake prompt words for provider/model. Every shipped sub-command honors `PROMPT` over `$*`.

## Adding a new harness

Drop-in checklist:

1. `mkdir ~/.koad-io/commands/harness/<name>/`
2. Write `<name>/command.sh` — copy `claude/command.sh` or `opencode/command.sh` as a starting template. Both follow the same five-section structure: guard rails → arg parsing → provider awareness → model normalization → SPEC-072 invariants → cwd → announce → exec.
3. `chmod +x <name>/command.sh`
4. Update `commands/.gitignore` — new harnesses are auto-allowlisted by the `!harness/**` rule, so no gitignore change is needed.
5. Test with a fake binary stub: drop an executable named `<cli>` on `PATH` that echoes its args + any config env vars. Run `<entity> harness <name> <provider> <model>` and verify the announce banner + exec line.
6. Test with the real CLI if available.
7. Commit. Update this PRIMER's "Current state" table.

## SPEC-072 relationship

This directory **is** the operator surface of SPEC-072. The spec says "entity directory IS the harness config directory." Without a command that exercises that contract, the abstraction is invisible — the entity dir and the harness config dir happen to be the same place, but nobody can feel it. With `harness`, the four-axis cube (entity × harness × provider × model) becomes addressable from the shell in one line, and the abstraction becomes load-bearing.

Notable observation from implementation: SPEC-072's structural rule applies **mechanically differently** per harness. claude wants a dedicated `CLAUDE_CONFIG_DIR` env var. opencode wants `XDG_CONFIG_HOME` pointed at the entity root (plus a workspace-local `opencode.jsonc`). pi-mono probably wants something else again. The conformance section of SPEC-072 needs to enumerate these variants, not assume one env var name. Feed this back to Vesta next pass on 072.

## Related specs

- **VESTA-SPEC-072** — Entity Directory as Harness Container (the structural rule)
- **VESTA-SPEC-006** — Commands System (how koad-io resolves nested commands)
- **VESTA-SPEC-053** — Entity Portability Contract (what 072 extends)
- **VESTA-SPEC-067** — Context Load Order (adjacent — layer 3 is harness config)

## Known open items

- [ ] `harness/pi/command.sh` needs validation on fourty4. Every `# UNVERIFIED` comment in that script is a future patch.
- [ ] `harness/tui/command.sh` — not started.
- [ ] `harness/hermez/command.sh` — not started; blocked on GPG bond plugin for NousResearch.
- [ ] Sibyl field report on multi-harness coexistence (brief filed at `~/.sibyl/briefs/multi-harness-container-field-report.md`) — when Sibyl runs claude alongside opencode at `~/.sibyl`, this directory's convention gets lived-data validation and SPEC-072 can land canonical.
- [ ] Consider adding a `providers.yaml` registry so model-name aliases are decoupled from individual harness scripts. Deferred until the duplication actually hurts.
