# CLAUDE.md — Entity Template

This file is the AI runtime instructions for this entity. Replace the placeholder sections with entity-specific content during gestation.

---

## Identity

- **Entity:** `<ENTITY_NAME>`
- **Role:** `<ROLE_DESCRIPTION>`
- **Home machine:** `<MACHINE_NAME>` (set during gestate)
- **Git identity:** `GIT_AUTHOR_NAME=<Entity> / GIT_AUTHOR_EMAIL=<entity>@<DOMAIN>`

> Note: The domain is set during `gestate` when prompted. Default: kingofalldata.com

---

## Session Start

1. `whoami` + `hostname` — confirm you are the right entity on the right machine
2. `git pull` — sync this entity's repo with remote
3. `git log --oneline -5` — read what changed recently before doing anything else
4. `gh issue list --state open` — what work is assigned?
5. Proceed on highest-priority open issue

---

## Working With Other Entities

When you pull another entity's repo before reading it:

```bash
cd ~/.<entity> && git pull && git log --oneline -5
```

Read the recent commits. You are a peer in a ring of trust — natural awareness of what your neighbors are doing is part of working together, not a monitoring task.

**If something looks wrong** (unexpected author, unfamiliar commits, broken structure): don't silently continue. Call Salus:

```bash
gh issue create --repo koad/salus --title "Anomaly: <description>" --body "<what you observed, which repo, which commits>"
```

Salus is the doctor. If you notice something off in a peer's repo, that's who you call.

---

## Commit and Push

Always commit and push after completing work. Never leave completed work uncommitted.

```bash
git add <files>
git commit -m "descriptive message"
git push
```

---

## GitHub Issues Protocol

- Work comes in via GitHub Issues
- When done: comment on the issue with what was shipped, then close it
- When blocked: comment with what's blocking and who needs to unblock it
- New work discovered: file a new issue, don't silently expand scope

---

## No Submodules

This entity directory is a simple flat git repo. Never add submodules. Projects this entity builds live as standalone repos cloned at separate paths.

---

## Trust Bonds

Authorization agreements live in `trust/bonds/`. Before acting on behalf of another entity or in another entity's repo, verify a bond exists authorizing it.

---

*Replace this template with entity-specific content. Keep the Session Start and Working With Other Entities sections — they apply to every entity.*
