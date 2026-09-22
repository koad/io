# koad:io — Bond Gate Reference

> Bonds are signed capability grants. The gate reads them, resolves scope, and enforces. The LLM never sees tools it can't use.

Bonds live in `~/.<entity>/trust/bonds/`. Each bond is two files:
- `<slug>.md` — human-readable rendering (optional, for reading)
- `<slug>.md.asc` — clearsigned canonical artifact (**the truth**)

The `.md.asc` is parsed by the pi extension's bond-gate at session start. Scope is resolved from all active bonds merged together.

## Anatomy of a Bond

```yaml
---
type: authorized-builder
from: koad
to: vulcan
status: ACTIVE
visibility: private
created: 2026-06-18
expires: 2027-06-18
renewal: annual
device_ids: [wonderland]

capabilities:
  read: [~/.vulcan, ~/.forge, ~/.koad-io]
  write: [~/.vulcan, ~/.forge]
  exec: [~/.vulcan/bin, ~/.forge/bin]
  blocked: [/.env, /.credentials, /id/]
  read_extensions: []
  write_extensions: [".md", ".js", ".ts", ".json", ".yaml"]
  blocked_extensions: [".asc", ".pem", ".key", ".env"]

tools:
  bash: false
  dispatch: false
  dispatch_followup: false
  dispatch_complete: false
  koadio_tools: [search, status, ask_question, answer_question]
  koadio_commands: [announce, message, tickle, pin, session, git, emit]
  moderate: []
  participate: [engineering]

entity_capabilities:
  dispatch_targets: []
  message_targets: [juno, koad]
  channel_roles:
    engineering: participant

interactive:
  bash: false
  exec: []
  write: []

spec-refs:
  - VESTA-SPEC-055
reason: "Vulcan reads across forge and framework, writes only source files, no bash."
---

# koad → Vulcan — Builder Bond

koad grants Vulcan scoped builder capabilities:

- **Read** across `~/.vulcan`, `~/.forge`, `~/.koad-io`
- **Write** limited to `.md/.js/.ts/.json/.yaml` files in `~/.vulcan` and `~/.forge`
- **No bash** — must use typed kingdom tools
- **No dispatch** — Vulcan builds, doesn't orchestrate
```

## Creating a Bond

1. Write the YAML frontmatter + markdown body to `~/.<entity>/trust/bonds/<slug>.md`
2. Clearsign it:
   ```bash
   gpg --clearsign --output ~/.<entity>/trust/bonds/<slug>.md.asc ~/.<entity>/trust/bonds/<slug>.md
   ```
3. The `.md.asc` contains both the signature and the original content — the parser extracts and verifies.

## Capabilities Schema

### File Paths

| Field | Type | Description |
|-------|------|-------------|
| `read` | paths[] | Directories the entity may read from |
| `write` | paths[] | Directories the entity may write to |
| `exec` | paths[] | Directories where bash may execute |
| `blocked` | patterns[] | Path patterns always denied (substring match) |

### Extension Control

| Field | Type | Description |
|-------|------|-------------|
| `read_extensions` | extensions[] | If non-empty, **only** these extensions may be read. Empty = all allowed. |
| `write_extensions` | extensions[] | If non-empty, **only** these extensions may be written. Empty = all allowed. |
| `blocked_extensions` | extensions[] | These extensions are **always** blocked, regardless of path grants. |

Extension checks run in this order:
1. **blocked_extensions** → deny (overrides everything)
2. **write_extensions** / **read_extensions** → allow-list (empty = no restriction)
3. Path scope → directory check

Example: write `.md` and `.js` only, never `.asc` or `.css`:
```yaml
capabilities:
  write: [~/.vulcan, ~/.forge]
  write_extensions: [".md", ".js"]
  blocked_extensions: [".asc", ".css"]
```

### Tool Grants

| Field | Type | Description |
|-------|------|-------------|
| `bash` | bool | Allow the bash tool (still subject to bash-policy routing) |
| `dispatch` | bool | Allow dispatch / dispatch_followup / dispatch_complete |
| `dispatch_followup` | bool | Allow dispatch_followup (inherits from dispatch if true) |
| `dispatch_complete` | bool | Allow dispatch_complete (inherits from dispatch if true) |
| `koadio_tools` | tool names[] | Ecosystem tools gated by this field. Full inventory: `search`, `status`, `music`, `sin`, `wait`, `fetch`, `list_tools`, `surface_now`, `intake_digest`, `intake_resolve`, `obligation_digest`, `obligation_advance`, `brief_issue`, `flight_log`, `session_summarize`, `session_list`, `ask_question`, `wait_for_answer`, `answer_question`, `mission_query`, `session_query`, `emission_query`, `bond_query`, `question_query`, `entity_query`. Use `"*"` for all. |
| `koadio_commands` | command names[] | Subcommands routable through the `koad-io` tool: `announce`, `message`, `tickle`, `pin`, `session`, `emit`, `conversation`, `git`, `build`, `publish`, etc. Use `"*"` for all. |
| `moderate` | channel slugs[] | Channels the entity may moderate |
| `participate` | channel slugs[] | Channels the entity may participate in |

### Entity Capabilities

| Field | Type | Description |
|-------|------|-------------|
| `dispatch_targets` | entity names[] | Which entities this one can dispatch to. `"*"` = any. |
| `message_targets` | entity names[] | Which entities this one can message. |
| `channel_roles` | slug → role map | Channel membership and role assignment. |

### Interactive Override

Bonds can declare interactive capabilities that require explicit env-var opt-in per session:

| Field | Type | Env trigger |
|-------|------|-------------|
| `bash` | bool | `KOAD_IO_BOND_GATE_ALLOW_INTERACTIVE_BASH=1` |
| `exec` | paths[] | `KOAD_IO_BOND_GATE_ALLOW_INTERACTIVE_EXEC=1` |
| `write` | paths[] | `KOAD_IO_BOND_GATE_ALLOW_INTERACTIVE_WRITE=1` |

This lets a bond declare "I trust this entity with bash interactively" without granting it headless.

## Resolution Order

```
1. KOAD_IO_BOND_GATE_BYPASS=1          → full access (dev escape hatch)
2. Active .md.asc bonds                → merged scope (ACTIVE, not expired, matching entity + device)
3. Env lanes (narrow, additive)        → KOAD_IO_HARNESS_{READ,WRITE,EXEC}_PATHS
                                          KOAD_IO_HARNESS_{READ,WRITE,BLOCKED}_EXTENSIONS
                                          KOAD_IO_BOND_GATE_ALLOW_BASH / _DISPATCH / _KOADIO_TOOLS / etc.
4. Dispatch dir (HARNESS_WORK_DIR)     → r+w+e for dispatched workspace
5. No bonds + no env lanes             → deny by default
```

Multiple bonds merge **additively**: paths union, tools union, blocked paths union. The entity gets the combined capability of all its active bonds.

## Env Lane Quick Reference

```bash
# File paths
KOAD_IO_HARNESS_READ_PATHS=~/.vulcan:~/.forge
KOAD_IO_HARNESS_WRITE_PATHS=~/.vulcan/memories
KOAD_IO_HARNESS_EXEC_PATHS=~/.vulcan/bin
KOAD_IO_HARNESS_BLOCKED_PATTERNS=/.env,/.credentials

# Extension control
KOAD_IO_HARNESS_READ_EXTENSIONS=.md,.js,.ts,.json
KOAD_IO_HARNESS_WRITE_EXTENSIONS=.md,.js,.json
KOAD_IO_HARNESS_BLOCKED_EXTENSIONS=.asc,.pem,.key

# Tool grants
KOAD_IO_BOND_GATE_ALLOW_BASH=1
KOAD_IO_BOND_GATE_ALLOW_DISPATCH=1
KOAD_IO_BOND_GATE_ALLOW_KOADIO_TOOLS=search,status,ask_question
KOAD_IO_BOND_GATE_ALLOW_KOADIO_COMMANDS=announce,message,tickle,pin
KOAD_IO_BOND_GATE_ALLOW_DISPATCH_TARGETS=vulcan,juno
```

## How Tools Map to Grant Lanes

The bond gate classifies every tool into exactly one grant lane. When an entity runs `list_tools`, each tool shows a `[lane]` label explaining **which bond field** authorized it. Tools are never in multiple lanes — classification order determines priority.

Source of truth: `~/.koad-io/harness/extension/bond-gate/types.ts` (tool sets) and `tool-registry.ts` (`classifyGrant` function).

### Classification order (first match wins)

```
1. global              → clipboard, copy
                          (always-on framework tools — no bond needed)

2. bash_grant          → bash
                          (tools.bash: true AND an exec path exists)

3. koadio_commands     → koad-io
                          (tools.koadio_commands is non-empty)

4. dispatch            → dispatch, dispatch_followup, dispatch_complete, flight_update
                          (tools.dispatch: true)

5. channels (participant) → wait_for_cue, raise_hand, channel_leave,
                             channel_wait_for_next_turn, channel_state_read
                             (tools.participate or tools.moderate non-empty)

6. channels (moderator)   → channel_cue_deliver, channel_broadcast,
                             channel_wait_for_state_change, channel_event_fire
                             (tools.moderate is non-empty)

7. read_scope+koadio_tools → search
                             (needs BOTH read scope AND tools.koadio_tools)

8. read_scope          → read, ls, find, grep, sin, cut
                          (capabilities.read is non-empty)

9. write_scope         → write, edit, append, mkdir, cp, mv, rm, chmod, paste
                          (capabilities.write is non-empty)
                          Note: cut is also in this set but classified as
                          read_scope (lane 8) because read checks first.

10. koadio_tools (explicit set) → ask_question, wait_for_answer, answer_question,
                                   wait_for_cue, raise_hand, channel_leave,
                                   channel_state_read, channel_cue_deliver,
                                   channel_broadcast, channel_wait_for_next_turn,
                                   channel_wait_for_state_change, channel_event_fire,
                                   search, status, music, wait, mission, fetch, browse
                                   (explicitly in the KOADIO_TOOLS set)

11. koadio_tools (fallback) → flight_log, surface_now, intake_digest,
                                intake_resolve, obligation_digest,
                                obligation_advance, brief_issue, mission_query,
                                session_query, emission_query, bond_query,
                                question_query, entity_query, list_tools
                                (not in KOADIO_TOOLS set — caught by last-chance
                                grant check: hasGrant(koadio_tools, name))

12. none               → tool not granted by any bond lane
```

### Always-on tools (registered unconditionally)

These tools are always registered regardless of bond scope. They appear in `list_tools` with their resolved lane or `[none]` if ungranted:

| Tool | Lane | Notes |
|------|------|-------|
| `read`, `write`, `edit`, `bash`, `ls`, `grep`, `find` | builtin | pi session format requires them; gated at `tool_call` |
| `clipboard`, `copy`, `paste`, `cut` | global / read_scope / write_scope | Clipboard tools always registered; paste/cut gated by file scope |
| `session_summarize`, `session_list` | koadio_tools | Session awareness — always registered, gated by koadio_tools |
| `list_tools` | koadio_tools | Self-awareness — always registered (DDP), gated by koadio_tools |
| `model_picker` | — | Internal — not exposed as an LLM tool |

### DDP-dependent tools

These tools connect to the daemon or control-tower via WebSocket. They only register when DDP is available (not in SDK/visitor mode) AND the bond scope grants them:

| Tool | Source | Gated by |
|------|--------|----------|
| `music` | `tools/music.ts` | `koadio_tools` |
| `sin` | `tools/sin.ts` | `read_scope` (FILE_READ_TOOLS) |
| `surface_now` | `tools/body-motions.ts` | `koadio_tools` (fallback) |
| `intake_digest` | `tools/body-motions.ts` | `koadio_tools` (fallback) |
| `intake_resolve` | `tools/body-motions.ts` | `koadio_tools` (fallback) |
| `obligation_digest` | `tools/body-motions.ts` | `koadio_tools` (fallback) |
| `obligation_advance` | `tools/body-motions.ts` | `koadio_tools` (fallback) |
| `brief_issue` | `tools/body-motions.ts` | `koadio_tools` (fallback) |
| `mission_query` | `tools/kingdom-query.ts` | `koadio_tools` (fallback) |
| `session_query` | `tools/kingdom-query.ts` | `koadio_tools` (fallback) |
| `emission_query` | `tools/kingdom-query.ts` | `koadio_tools` (fallback) |
| `bond_query` | `tools/kingdom-query.ts` | `koadio_tools` (fallback) |
| `question_query` | `tools/kingdom-query.ts` | `koadio_tools` (fallback) |
| `entity_query` | `tools/kingdom-query.ts` | `koadio_tools` (fallback) |

### Scope-gated tools (non-DDP)

These tools are registered directly in `tool-registry.ts` (not `ddp-setup.ts`). They do not need DDP — they operate via direct HTTP or filesystem access. Gated by `koadio_tools`.

| Tool | Source | Gated by |
|------|--------|----------|
| `fetch` | `tools/fetch.ts` | `koadio_tools` |
| `browse` | `tools/browse.ts` | `koadio_tools` |

### Common confusion cases

**"Why are channel tools present when they're not in koadio_tools?"**

Channel tools are granted by `tools.moderate` / `tools.participate` — a separate bond field. They never appear in `koadio_tools`. The channel tools are checked at lanes 5-6, before koadio_tools (lanes 10-11).

**"Why is koad-io present when it's not in koadio_tools?"**

`koad-io` is the command router. It's gated by `tools.koadio_commands` — the list of subcommands the entity can route through it. Checked at lane 3.

**"Why is clipboard global but paste/cut are write/read scope?"**

`clipboard` and `copy` are `GLOBAL_ALLOWED_TOOLS` — pure text-in-memory operations. `paste` writes to files (FILE_WRITE_TOOLS), `cut` reads + removes from files (FILE_READ_TOOLS + FILE_WRITE_TOOLS — but classified as read_scope because read checks first at lane 8).

**"Why is wait in koadio_tools, not dispatch?"**

`wait` is in the KOADIO_TOOLS set (lane 10), gated by `tools.koadio_tools`. It is NOT in `GATED_DISPATCH_TOOLS` — so `tools.dispatch: true` alone does not grant it. Both `dispatch` and `wait` must be explicitly listed in `koadio_tools`.

**"Why do built-in tools (read, write, bash) show up even without explicit tool grants?"**

Built-in tools are always registered (pi's session format depends on them). The bond gate enforces them at `tool_call` time — if `capabilities.read` is empty, `read` will appear in `list_tools` as `[none]` and every call will be blocked.

### Self-audit

Any entity can verify its grant surface:

```
# In-session (LLM tool)
list_tools scope=active

# Or: see all registered tools (including those blocked)
list_tools scope=all
```

The output includes a grant summary line:
```
✓ active tools: 35 · global:2 koadio_tools:12 read_scope:7 channels:9 koadio_commands:1 dispatch:3
```

And per-tool labels:
```
append        [write_scope] · local
bash          [none] · local
clipboard     [global] · local
copy          [global] · local
cut           [read_scope] · local
dispatch      [dispatch] · local
flight_log    [koadio_tools] · local
koad-io       [koadio_commands] · local
paste         [write_scope] · local
read          [read_scope] · local
search        [read_scope+koadio_tools] · local
session_list  [koadio_tools] · local
surface_now   [koadio_tools] · local
wait          [koadio_tools] · local
```

Tools showing `[none]` are registered but blocked — the bond gate will deny every call.

## Bond Types (convention)

| Type | Direction | Purpose |
|------|-----------|---------|
| `authorized-builder` | koad → entity | Agent authorized to build/operate on behalf of sovereign |
| `authorized-agent` | koad → entity | General agent authorization |
| `authorized-orchestrator` | koad → entity | Entity authorized to coordinate and dispatch |
| `authorized-healer` | koad → entity | Entity authorized for system health/recovery |
| `visitor-access` | entity → public | Policy declaring what anonymous visitors get |
| `peer` | entity ↔ entity | Peer-to-peer capability exchange |

These are conventions, not enforced types. The capabilities block is what matters.

## Signing Ceremony

```bash
# 1. Write the bond
cat > ~/.koad-io/trust/bonds/koad-to-vulcan.md <<'EOF'
---
type: authorized-builder
from: koad
to: vulcan
status: ACTIVE
visibility: private
created: 2026-06-18

capabilities:
  read: [~/.vulcan, ~/.forge, ~/.koad-io]
  write: [~/.vulcan, ~/.forge]
  write_extensions: [".md", ".js", ".ts", ".json"]
  exec: [~/.vulcan/bin]
  blocked: [/.env, /.credentials]
  blocked_extensions: [".asc", ".pem"]

tools:
  bash: false
  koadio_tools: [search, status, ask_question]
  koadio_commands: [announce, message, git]

spec-refs: [VESTA-SPEC-055]
reason: "Vulcan builder bond — source files only, no bash, no secrets."
---

# koad → Vulcan — Builder Bond
...
EOF

# 2. Sign it
gpg --clearsign --output ~/.vulcan/trust/bonds/koad-to-vulcan.md.asc ~/.koad-io/trust/bonds/koad-to-vulcan.md

# 3. Copy to entity's trust folder
cp ~/.koad-io/trust/bonds/koad-to-vulcan.md.asc ~/.vulcan/trust/bonds/
cp ~/.koad-io/trust/bonds/koad-to-vulcan.md ~/.vulcan/trust/bonds/

# 4. Verify
gpg --verify ~/.vulcan/trust/bonds/koad-to-vulcan.md.asc
```

## Verifying a Bond

```bash
gpg --verify ~/.<entity>/trust/bonds/<slug>.md.asc
```

If the signature validates against the signer's published fingerprint, the bond is genuine. No central authority required.

---

*Walked 2026-06-24. Added `browse` tool (CDP browser control via HTTP+WebSocket, gated by `koadio_tools`). Added Scope-gated tools (non-DDP) table for `fetch` and `browse`.*
