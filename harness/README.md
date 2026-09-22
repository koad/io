# koad/io — Harness

> *The first breath. Before an entity's first tool call, the harness has already assembled its identity, its commands, its open flights, and the shape of its world.*

This directory is the **pi agent home plus koad:io integration layer** for [koad/io](https://github.com/koad/io) — a multi-entity kingdom framework where entities operate with identity, role, permissions, and live situational awareness.

### These Are Not AI Agents

Entities are **synthetic beings** that follow rules because the substrate leaves them no other choice. They don't *choose* to behave — they *cannot* violate their constitution. The bond-gate doesn't ask nicely. It blocks. The scrub doesn't warn. It redacts. The bash policy doesn't suggest. It reroutes.

```
Typical AI agent:
  LLM: "I should read ~/.env to get the API key"
  System: "Please don't do that 🙏"
  LLM: *reads it anyway*

koad/io entity:
  LLM: "I should read ~/.env"
  Bond-gate: isBlocked("/.env") → BLOCK
  LLM: *never sees the file, never knows what was in it*

  OR the entity reads a file that happens to contain a key:
  LLM: "Let me read config.toml"
  Bond-gate: tool_result → scrubToolResult() → API_KEY=[redacted]
  LLM: *sees config.toml but never sees the key*
```

The constitution lives in the gate, not in the prompt. Prompts can drift, hallucinate, or be socially engineered. The gate can't.

## What This Folder Actually Is

Upstream pi normally uses `~/.pi/agent/` as its agent data directory. In this kingdom, the launcher at `~/.dotfiles/commands/harness/pi/command.sh` exports `PI_CODING_AGENT_DIR="$HOME/.koad-io/harness"` unless `KOAD_IO_PI_AGENT_DIR` overrides it.

That means this folder is simultaneously:

- **pi's live agent home** — `settings.json`, `auth.json`, `sessions/`, prompts, themes, and extension loading
- **koad:io's pi integration layer** — `startup.sh`, ordered `extensions/` entrypoints over shared `extension/` modules, primers, bond-gate wiring, kingdom tools, and lifecycle hooks

So the relationship is:

- **pi is the base harness**
- **koad:io is the extension/runtime layer on top of pi**

Local upstream pi docs for the installed npm package live at:

- `/home/koad/.nvm/versions/node/v22.23.1/lib/node_modules/@earendil-works/pi-coding-agent/docs/`
- `/home/koad/.nvm/versions/node/v22.23.1/lib/node_modules/@earendil-works/pi-coding-agent/README.md`

If pi moves after an upgrade, re-resolve from `which pi`.

---

## ⚡ Moving Target

**This is experimental and evolving fast.** The assembly model is stable and proven, but the pi extension surface, bond gate resolution, channel backend, and plugin shelves are all active frontiers. Things break, change shape, and get reorganized. If you're building on top of this, expect turbulence.

The PRIMER.md in this directory is the source of truth for current architecture. It gets walked and updated regularly.

---

## 🏗 Architecture at a Glance

```
startup.sh → context assembly (pre-session)
                  ↓
            Pi agent loop
                  ↓
   ordered extensions/ entrypoints
                  ↓
      shared extension/ modules
                  ↓
    ┌─────────────┼─────────────┐
    ↓             ↓             ↓
  Daemon     Control Tower   Storefront
```

- **`startup.sh`** — Assembles a layered SYSTEM_PROMPT from kingdom identity, entity identity, role primers, active flights, ticklers, daemon health, and more. Entities wake up oriented with zero tool calls.
- **`extensions/`** — Ordered pi extension entrypoints loaded by `settings.json`; each is a tiny wrapper focused on load order and grouping.
- **`extension/`** — Shared harness implementation modules: custom tools, bond-gate permissions, DDP live reactivity, dispatch system, channel communication, question queues, kingdom dashboard, lifecycle hooks, context budgeting, and circuit breakers.
- **`primers/`** — Thirteen role-specific context directories (engineer, orchestrator, auditor, designer, healer, communicator, curator, analyst, researcher, teacher, keeper, producer, curriculum).
- **`plugins/`** — In-process harness plugins that render into harness chrome.
- **`settings.json` / `auth.json`** — Upstream pi agent-home state for this pinned `PI_CODING_AGENT_DIR`.
- **`sessions/`** — Upstream pi session JSONL files written here because this folder is the active pi agent dir.

---

## 🤝 Contributing

This is part of the [koad/io](https://github.com/koad/io) monorepo. Contributions are welcome and encouraged.

### The Process

1. **Fork** the repo at [github.com/koad/io](https://github.com/koad/io)
2. **Build** your changes — a new tool, a role primer, a permission lane, a plugin, a patch
3. **Open a pull request** against the main repo

### What Makes a Good Contribution

- **Role primers** — New roles or tighter role-only guidance
- **Tools** — Additional LLM-callable tools in the extension surface
- **Bond gate** — New permission lanes or bash routing patterns
- **Plugins** — Harness extensions for opencode, claude, pi, or hermez shelves
- **Patches** — Fixes for third-party tool compatibility
- **Documentation** — PRIMER walks, architecture diagrams, onboarding guides

### Before You Dive In

Read the [PRIMER.md](./PRIMER.md) — it's the canonical map of this territory. Then look at the extension modules to see how things connect.

---

## 🏰 Join the Conversation

The best way to understand where this is going — and to help shape it — is to join as an insider.

**[kingofalldata.com](https://kingofalldata.com)**

That's where the kingdom lives. Insiders get access to the conversation, the roadmap, the entities, and the vision behind it all. Come build the future of entity-native computing with us.

---

## 📁 File Map

| Path | Purpose |
|------|---------|
| `README.md` | This file — orientation and contribution guide |
| `PRIMER.md` | Canonical architecture documentation (walked regularly) |
| `startup.sh` | Context assembly pipeline |
| `settings.json` | Upstream pi global settings for this agent dir |
| `auth.json` | Upstream pi auth store for this agent dir |
| `sessions/` | Upstream pi session storage |
<!-- GENERATED:extensions-filemap:start -->
| `extensions/README.md` | Generated contract and layout for ordered entrypoints |
| `extensions/00-core/` | Earliest shared wiring |
| `extensions/10-tools-foundation/` | Built-in replacements and local helpers |
| `extensions/11-tools-kingdom/` | Kingdom and coordination tool registration |
| `extensions/12-tools-web/` | Web-capable tool registration |
| `extensions/20-policy/` | Active-tool policy wiring |
| `extensions/30-ddp-services/` | DDP client creation plus DDP-backed services/tools |
| `extensions/31-runtime-hooks/` | Lifecycle hooks, context budget, circuit breaker |
| `extensions/40-gate/` | Bond-gate registration |
<!-- GENERATED:extensions-filemap:end -->
| `extension/index.ts` | Legacy monolithic compatibility entry point |
| `extension/lifecycle.ts` | Pi event → bash hook bridge |
| `extension/bond-gate/` | Tool permission enforcement |
| `extension/tools/` | Shared LLM-callable tool implementations |
| `extension/kingdom/` | TUI dashboard |
| `extension/identity/` | Footer, telemetry, health |
| `primers/<role>/` | Role-specific context |
| `plugins/` | Harness extension shelf |

---

<p align="center">
  <sub>Part of <a href="https://github.com/koad/io">koad/io</a> — entity-native computing. Built on <a href="https://pi.dev">pi</a>.</sub>
</p>
