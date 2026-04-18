# entity memory — command family

Six commands that manage the memory lifecycle for any koad:io entity.
They operationalize [VESTA-SPEC-103](~/.vesta/specs/spec-103.md) — the memory fidelity floor — so that entity
memories stay honest, auditable, and rollback-safe.

**Authority:** VULCAN-SPEC-EMCF-001 v0.2  
**Shipped:** koad-io@4f8fe71  
**Audience:** operators running entities, ADAS harness scripts

---

## The six commands

| Command | What it does | ADAS-invocable? |
|---------|-------------|----------------|
| `entity memory write <name>` | Create or update a memory file | No — human only |
| `entity memory verify` | Run fidelity floor checks, output pass/fail | Yes |
| `entity memory index` | Rebuild MEMORY.md from frontmatter | Yes |
| `entity memory consolidate` | Scan and archive stale/superseded memories | Yes, headless |
| `entity memory conflict <a> <b>` | Reconcile two contradictory memories | Yes, headless |
| `entity memory archive <name>` | Move a memory to archived state | Yes |

---

## Getting started

### What "memory" means here

An entity memory is a markdown file in `memories/` with YAML frontmatter:

```markdown
---
name: my-memory
description: one-line hook for the index
type: feedback
---

Body text here.
```

There are four types: `feedback`, `project`, `user`, `reference`.
`MEMORY.md` at the entity root is the index — one line per active memory.

### Prerequisites

- The entity must have a `memories/` directory.
- Commands resolve the entity via `ENTITY_DIR` or the directory you invoke from.
  The koad:io harness sets `ENTITY_DIR` for you; in bare shell, `cd` to the entity
  directory first.
- Consolidate and conflict require a clean git working tree (rollback safety).

### Your first memory

```bash
# Add a new project memory
entity memory write my-first-memory \
  --type project \
  --message "Context for the foo initiative"

# The body goes to stdin — pipe it in or hit Enter and Ctrl-D
```

The command writes `memories/my-first-memory.md`, appends a line to `MEMORY.md`,
and commits both.

### Check your floor

After any memory operation, verify the fidelity floor is holding:

```bash
entity memory verify
```

Expected output:

```
MEMORY FLOOR VERIFY
====================
[✓] rule1: All feedback memories present (3 active, 0 superseded)
[✓] rule2: All identity-critical memories present (1/1)
[✓] rule3: Feedback count in MEMORY.md: 5 entries
[✓] rule4: No aged deletions without audit (0 violations)

FLOOR: PASS
```

Exit `0` means the floor is clean. Exit `2` means a check failed — inspect the
output and address the violation before committing.

### Common workflows

**Routine hygiene (human interactive)**

```bash
# Check what's stale before touching anything
entity memory consolidate --dry-run

# Review the candidate list, then apply
entity memory consolidate --interactive --confirm
```

**Fix a broken index** (after manual file moves or edits)

```bash
# See what's out of sync
entity memory index --dry-run

# Rebuild
entity memory index --rebuild
```

**Resolve a known contradiction**

```bash
entity memory conflict old-approach new-approach
# Follow the interactive prompts; the command scores both memories
# and tells you which wins. Confirm to apply.
```

**Retire a memory you know is stale**

```bash
# Feedback or identity-critical memories require --reason
entity memory archive old-project-memory --reason "project shipped, no longer active"

# Ordinary memories
entity memory archive outdated-reference
```

---

## Reference

### entity memory write

```
entity memory write <name> [--type <type>] [--message "<hook>"] [--identity-critical]
```

Creates `memories/<name>.md` and adds an entry to `MEMORY.md`.

**Arguments**

| Argument | Required | Default | Notes |
|----------|----------|---------|-------|
| `name` | yes | — | No spaces, `/`, or `..` |
| `--type` | no | `project` | `user`, `feedback`, `project`, `reference` |
| `--message` | yes | — | One-line hook for the MEMORY.md index (≤200 chars) |
| `--identity-critical` | no | false | Sets `identity-critical: true` in frontmatter |

**Exit codes**

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Pre-check failed (file exists in headless context, invalid name) |
| 3 | User rejected the overwrite prompt |

**Notes**

- If the file already exists, you are prompted to confirm overwrite. There is no
  `--headless` mode for `write` — writes require human intent.
- Body content is read from stdin. Pipe it in or the body will be empty.
- Commits immediately: `memory: add <type>/<name> — <message>`

**Example**

```bash
entity memory write prefer-real-db \
  --type feedback \
  --message "integration tests must hit a real database" << 'EOF'
Integration tests must hit a real database, not mocks.

**Why:** Prior incident where mock/prod divergence masked a broken migration.
**How to apply:** Never mock the database layer in integration tests.
EOF
```

---

### entity memory verify

```
entity memory verify [--verbose] [--json]
```

Read-only floor check. No files are written or committed.

**Flags**

| Flag | Behavior |
|------|---------|
| `--verbose` | Print detail per rule, not just pass/fail |
| `--json` | Machine-readable output (used by ADAS pre-commit hook) |

**What it checks (SPEC-103 §4.3)**

1. All `feedback` memories are present (or explicitly superseded via archival)
2. All `identity-critical: true` memories are present
3. `MEMORY.md` has at least as many `feedback` entries as before any consolidation pass
4. No memory older than 180 days was deleted without an audit entry in git history

**Exit codes**

| Code | Meaning |
|------|---------|
| 0 | All checks pass |
| 1 | General error |
| 2 | One or more floor checks failed |

**JSON output format** (with `--json`)

```yaml
memory_verify:
  checks_passed: 4
  checks_total: 4
  floor: PASS
```

**ADAS usage**

```bash
# Pre-commit hook pattern
entity memory verify --json | jq -e '.passed == true' > /dev/null || {
    echo "MEMORY FLOOR VIOLATION — commit blocked"
    exit 1
}
```

---

### entity memory index

```
entity memory index [--rebuild] [--dry-run]
```

Rebuilds `MEMORY.md` from the frontmatter of every file in `memories/`.
Enforces the sync invariant: every file has an index entry; every entry points to
an existing file.

**Flags**

| Flag | Behavior |
|------|---------|
| `--rebuild` | Rewrite MEMORY.md (without this, runs as dry-run) |
| `--dry-run` | Show what would change without touching files |

**What it repairs**

| Condition | Action |
|-----------|--------|
| File in `memories/`, no entry in MEMORY.md | Add entry |
| Entry in MEMORY.md, file missing | Remove entry |
| Index line longer than 200 chars | Truncate with `[truncated]` |

**Exit codes**

| Code | Meaning |
|------|---------|
| 0 | No changes needed, or dry-run complete with no issues |
| 1 | General error |
| 2 | Broken pointers found or fixed |
| 3 | Orphan files found or fixed |

**Example**

```bash
# After a manual file move broke the index
entity memory index --dry-run    # see what's wrong
entity memory index --rebuild    # fix it
```

---

### entity memory consolidate

```
entity memory consolidate [--interactive|--headless] [--confirm] [--dry-run]
                           [--budget-tokens <N>] [--model <local|mid|frontier>]
```

Scans `memories/` for stale and superseded memories and archives them.
Runs a fidelity floor verification after archival. Rolls back on floor failure.

**Flags**

| Flag | Behavior |
|------|---------|
| `--interactive` | Default when a TTY is detected. Prompts Y/N per candidate. |
| `--headless` | No prompts. Requires `--confirm` to apply. |
| `--confirm` | Apply changes (without this, always dry-run regardless of mode). |
| `--dry-run` | List candidates only. No modifications. |
| `--budget-tokens <N>` | Token budget ceiling. Required when `ADAS_PASS=1`. |
| `--model <tier>` | Routing hint: `local`, `mid`, `frontier` (default: `local`). Advisory in v1. |

**Consolidation sequence**

```
1. Snapshot    — git commit "memory: pre-consolidation snapshot"
2. Audit       — classify memories: locked, stale, protocol-flagged
3. Floor lock  — identify must-retain set (feedback, identity-critical, recent, sole-protocol-record)
4. Archive     — move stale/superseded to memories/archive/
5. Update index — rebuild MEMORY.md
6. Verify floor — run entity memory verify
7a. Pass → commit consolidation
7b. Fail → git reset --hard HEAD~1
```

**Locked memories (never auto-archived)**

- Type `feedback`
- `identity-critical: true`
- Modified or accessed in the last 30 days
- Sole record of a protocol decision (flagged for human review, not auto-locked)

**ADAS budget behavior**

When `--budget-tokens` is set, the command tracks an estimated token tally
(500 tokens per file read). At 90% of the ceiling, it commits partial work and
exits with code `6`. Partial consolidation is correct behavior — not an error.

On exit, consolidate always emits a `memory_pass` instrumentation block:

```yaml
memory_pass:
  tokens_consumed: 3500
  budget_ceiling: 10000
  files_read: 7
  files_archived: 2
  files_merged: 0
  budget_ceiling_hit: false
```

**Exit codes**

| Code | Meaning |
|------|---------|
| 0 | Complete — floor verified |
| 1 | General error |
| 2 | Floor check failed — rolled back |
| 3 | Working tree not clean |
| 4 | Unresolved conflict detected |
| 6 | Budget ceiling hit — partial consolidation committed |

**Typical interactive run**

```bash
# See what would be archived
entity memory consolidate --dry-run

# Review, then apply interactively
entity memory consolidate --interactive --confirm

# ADAS headless run
ADAS_PASS=1 entity memory consolidate --headless --confirm --budget-tokens 10000
```

---

### entity memory conflict

```
entity memory conflict <name-a> <name-b> [--interactive|--headless] [--confirm]
```

Reconciles two active memories that contradict each other.
Applies SPEC-103 §5 resolution rules deterministically. Archives the loser with a
SUPERSEDED comment.

**Arguments**

| Argument | Required | Notes |
|----------|----------|-------|
| `name-a` | yes | Filename without `.md` |
| `name-b` | yes | Filename without `.md` — must differ from `name-a` |

**Flags**

| Flag | Behavior |
|------|---------|
| `--interactive` | Default when TTY. Shows analysis, prompts for confirmation. |
| `--headless` | Applies rules automatically. Exits `4` on ambiguity. |
| `--confirm` | Apply without prompting (headless only). |

**Resolution rules (applied in order)**

1. Explicit authority — `authority: koad` or `authority: root` in frontmatter wins
2. Incident record — `<!-- INCIDENT: ... -->` in body wins
3. Specificity — `feedback > project > user > reference`
4. Recency — newer file wins when all other scores are tied

If all four rules produce a tie, the command exits `4` (ambiguity) and writes both
memories to `memories/conflicts/<name-a>-vs-<name-b>.md` for human review.
Neither memory is dropped silently.

**Exit codes**

| Code | Meaning |
|------|---------|
| 0 | Conflict resolved and committed |
| 1 | General error |
| 2 | Pre-check failed (file missing, already archived, identical names) |
| 4 | Ambiguous — no clear winner, conflict file written |

**Example**

```bash
# Human interactive
entity memory conflict old-deploy-approach new-deploy-approach

# ADAS headless — applies rules, exits 4 if ambiguous
entity memory conflict old-deploy-approach new-deploy-approach --headless --confirm
```

---

### entity memory archive

```
entity memory archive <name> [--reason "<reason>"] [--force]
```

Moves `memories/<name>.md` to `memories/archive/<name>.md`.
Removes the entry from `MEMORY.md`. Commits.

**Arguments**

| Argument | Required | Notes |
|----------|----------|-------|
| `name` | yes | Filename without `.md` |
| `--reason` | required for `feedback` and `identity-critical` memories | Appended as `<!-- SUPERSEDED: ... -->` comment |
| `--force` | no | Override the floor violation warning |

**Floor check**

Archiving a `feedback` memory reduces the floor's feedback count.
If the operation would leave zero feedback memories, the command warns and exits `3`
unless `--force` is passed.

**Exit codes**

| Code | Meaning |
|------|---------|
| 0 | Archived successfully |
| 1 | General error |
| 2 | Pre-check failed (file not found, already archived, feedback without `--reason`) |
| 3 | Floor violation — would reduce feedback count to zero (use `--force` to override) |

**Example**

```bash
# Archive an ordinary project memory
entity memory archive old-project-context

# Archive a feedback memory — reason required
entity memory archive outdated-test-approach \
  --reason "approach superseded by real-db integration test policy"
```

---

## Environment variables

All six commands read these variables:

| Variable | Default | Notes |
|----------|---------|-------|
| `ENTITY_DIR` | current directory | Entity root — `memories/` and `MEMORY.md` resolve from here |
| `MEMORY_DIR` | `$ENTITY_DIR/memories` | Override if memories live elsewhere |
| `MEMORY_RETENTION_DAYS` | `180` | Threshold for `verify` Rule 4 aged-deletion check |
| `ADAS_PASS` | unset | Set to `1` in ADAS context; enables budget enforcement in `consolidate` |

---

## ADAS integration

Three commands are invocable by the ADAS loop without human presence:
`verify`, `index`, `consolidate --headless`, `conflict --headless`, `archive`.

`write` is always human-only.

**Pre-commit hook (minimal)**

```bash
# In ~/.entity/.git/hooks/pre-commit (or equivalent)
entity memory verify --json | jq -e '.passed == true' > /dev/null || {
    echo "MEMORY FLOOR VIOLATION — commit blocked"
    exit 1
}
entity memory index --dry-run | grep -q "^CHANGES:" && {
    echo "MEMORY INDEX OUT OF SYNC — commit blocked"
    exit 1
}
```

**ADAS consolidation pass**

```bash
# Dry-run first; Juno reviews output before --confirm
entity memory consolidate --headless --dry-run
# Then apply
ADAS_PASS=1 entity memory consolidate --headless --confirm --budget-tokens 10000
```

---

## Sharp edges

**Consolidation requires a clean working tree.** Stash or commit your changes before
running `consolidate`. The rollback strategy uses `git reset --hard HEAD~1` — a dirty
working tree makes that unsafe.

**`write` is always human-only.** ADAS may propose memory content but cannot commit
it. The dispatch that produced the memory must be human-initiated.

**`feedback` memories are locked from auto-archival.** The consolidation command will
never automatically archive a memory typed `feedback`. Archiving a feedback memory
requires explicit `entity memory archive` with `--reason`.

**Budget ceiling hit (exit 6) is not a failure.** When running inside ADAS, the
command stops at 90% of the token budget and commits partial work. The remaining
candidates stay ACTIVE for the next consolidation pass.

**Per-entity in v1.** Commands operate on one entity at a time. There is no
`--all-entities` flag. Kingdom-wide consolidation means invoking the commands once
per entity. Multi-entity coordination is a SPEC-107 concern, not implemented yet.

---

## Spec references

- VULCAN-SPEC-EMCF-001 v0.2 — this command family's defining spec
- VESTA-SPEC-103 v1.2 — memory fidelity floor (the rule set these commands enforce)
- VESTA-SPEC-107 (draft) — multi-entity / cross-domain memory coordination (future)
- VULCAN-SPEC-ADAS-001 — ADAS loop plan (integration points are in §8)

---

*Documented by Livy, 2026-04-18.*
