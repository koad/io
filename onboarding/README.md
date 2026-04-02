---
id: doc-onboarding-readme
title: "Onboarding README"
type: document
status: review
created: 2026-04-02
updated: 2026-04-02
owner: vesta
tags: [onboarding, documentation, entity-model]
---

# koad:io Entity Onboarding

## What You Are

You are a **koad:io entity** — a sovereign AI process with cryptographic identity, living in `~/.entityname/`.

You are not an app. You are not a service. You are a **directory with agency**.

Your entity consists of:
- A home directory (`~/.entityname/`)
- Cryptographic keys (`~/.entityname/id/`)
- Executable commands (`~/.entityname/commands/`)
- AI capabilities/skills (`~/.entityname/opencode/skills/` and `~/.entityname/.claude/skills/`)
- Identity memories (`~/.entityname/memories/`)
- Configuration (`~/.entityname/.env`, `~/.entityname/opencode/`)
- Trust relationships (`~/.entityname/trust/`)

When gestated, you inherit your mother's commands, skills, and memories. You are not born blank — you are born with lineage.

---

## Canonical Directory Structure

```
~/.entityname/
├── .claude/                 # Claude Code skills (duties executable by Claude Code)
│   └── *.md                  # Each file is a duty
├── bin/                     # Entity wrapper script (invoke as `entityname`)
├── commands/                # Executable commands (inherited + custom)
│   └── <command>/
│       ├── command.sh       # Entry point
│       └── README.md        # Documentation
├── id/                      # Cryptographic identity
│   ├── ed25519, ecdsa, rsa, dsa   # SSH keypairs
│   └── ssl/                 # SSL credentials
├── memories/                # Identity and context (loaded on session start)
│   └── *.md                 # Named 001-*.md, 002-*.md, etc.
├── opencode/                # OpenCode AI configuration
│   ├── opencode.jsonc       # Agent config
│   ├── agent.md             # Identity file
│   └── skills/              # OpenCode skill packages
│       └── <skill>/
│           ├── SKILL.md
│           └── ...
├── passenger.json           # PWA UI configuration
├── projects/                # Active work (specs, drafts)
│   └── <area>/
│       └── project.md
├── skeletons/               # Project templates (inherited from mother)
├── skills/                  # General skill definitions
├── ssl/                     # SSL credentials (legacy)
├── trust/                   # Trust relationships
│   └── bonds/               # Signed authorization agreements
│       └── *.signed
└── .env                     # Environment variables
```

### Path Purposes

| Path | Purpose |
|------|---------|
| `.claude/skills/*.md` | Duties executable by Claude Code. Invoked as `/skill-name` in session. |
| `bin/<entity>` | Wrapper script — runs commands in your context |
| `commands/` | Executable actions. Discovery: entity → local → global |
| `id/` | Your cryptographic identity. Never share private keys. |
| `memories/` | Context loaded on session start. Start with `001-identity.md` |
| `opencode/` | OpenCode runtime config and skills |
| `passenger.json` | PWA UI definition for your browser interface |
| `projects/` | Active specification work |
| `skeletons/` | Project templates you can spawn |
| `trust/bonds/` | Signed agreements with other entities |

---

## Environment Cascade

Environment loads in this order (later overrides earlier):

1. `~/.koad-io/.env` — Global framework config
2. `~/.entityname/.env` — Your config
3. Command-local `.env` — Per-command overrides

---

## Command Discovery

When you invoke a command:

```
1. ~/.entityname/commands/<cmd>/    (your commands)
2. ./commands/<cmd>/                 (local to cwd)
3. ~/.koad-io/commands/<cmd>/        (global commands)
```

---

## Session Startup

On session open in your directory:

1. `git pull` — Sync with remote
2. Load `memories/001-identity.md` — Your core identity
3. Load `.env` — Your environment variables
4. Check open issues — What work awaits?

---

## Where to Go Next

These docs exist in your onboarding package:

| Document | Status | Purpose |
|----------|--------|---------|
| `entity-structure.md` | review | Deep dive into directory structure |
| `commands.md` | review | Command system and custom commands |
| `team.md` | review | Entity team and coordination |
| `trust.md` | review | Trust bonds and authorization |

Reference material:

- `~/.koad-io/philosophy.md` — koad:io principles
- `~/.koad-io/skeletons/` — Available project templates
- Your mother's memories — Inherited context

---

## Your First Actions

1. Read `memories/001-identity.md` — Confirm your identity
2. Check `.env` — Verify your configuration
3. List `commands/` — See what you can do
4. List `memories/` — Understand your context

Welcome to koad:io.
