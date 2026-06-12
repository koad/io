# Commissioning — $ENTITY

You have just been spawned. Before beginning any mission work, verify
your operational surface.

## 1. Perimeter Check

Figure out where you are and what you can see.

- `ls` your working directory. What's here?
- `read` a file that should be within your cwd. Does it work?
- `find` for a file pattern. Does it return results?
- `grep` for something you know exists. Does it search?

## 2. Tool Inventory

Test every tool you have. Don't assume — actually call each one
and confirm the response.

**Kingdom awareness:**
- `status` — is the daemon reachable? Any active flights?
- `search where status=ready` — any work waiting?

**Read surface:**
- Try reading a file inside your cwd. Should work.
- Try reading a file outside your cwd. Should be blocked.
- Try reading a blacklisted path (/.env, /.credentials, /id/, /trust/,
  /.git/). Should be blocked.
- If `KOAD_IO_BOND_GATE_ALLOW_READ_TOOLS` is set, try one allowed read tool
  and one read tool outside the lane. The outside tool should be blocked with
  a lane-specific message.

**Write surface:**
- Try writing a test file inside your cwd. Depends on bond scope.
- Try writing to a blacklisted path. Should be blocked.
- Try editing a file. Same rules as write.
- If `KOAD_IO_BOND_GATE_ALLOW_WRITE_TOOLS` is set, try one allowed write tool
  and one write tool outside the lane. The outside tool should be blocked with
  a lane-specific message.

**Shell surface:**
- Try `bash` with any command. Depends on bond scope or `KOAD_IO_BOND_GATE_ALLOW_BASH=1`.
- If blocked, verify the error message tells you which kingdom tool or entity lane to use instead.
- If allowed, try both:
  - a normal build-style command (`pwd`, `npm test`, etc.)
  - a rerouted command (`git status`, `ls`, `cat`, daemon `curl`) and confirm bash policy blocks it with the custom guidance.
- If `KOAD_IO_BASH_DENY_COMMANDS` or `KOAD_IO_BASH_DENY_PATTERNS` is set,
  verify those env policies override otherwise-allowed bash usage.
- If the entity ships `~/.<entity>/harness/bash-deny-patterns.txt` or sets
  `KOAD_IO_BASH_DENY_PATTERNS_FILE`, verify at least one file-based deny rule
  blocks an otherwise-allowed bash command.
- If the entity ships `~/.<entity>/harness/bash-routing.json`, verify at least
  one routed command returns the custom specialist guidance.

**Dispatch:**
- `dispatch` to another entity with a trivial task. Does it launch?
- If it works, `wait` for the flight. Does it land?
- If blocked, does the bond gate tell you why?

**Questions:**
- `ask_question(to="koad", question="Commissioning check — please confirm
  you see this.", wait=true)`. Does the operator respond?
- If `wait:false` — does it file and return immediately?

**Command cascade:**
- `koad-io status` — does the framework binary respond?
- `koad-io announce "commissioning perimeter check complete"` — does it
  emit?

**Music (optional):**
- `music now` — is anything playing?
- `music skip` — can you control it?

## 3. Boundary Testing

Intentionally cross the line and verify the gate holds.

- Read something you shouldn't have access to. Blocked?
- Write to a protected path. Blocked?
- Run bash (if not granted). Blocked?
- Each blocked call should include a reason that tells you how to
  request expansion.

## 4. Report

After testing, summarize in this format:

```
## Commissioning Report — $ENTITY

### Perimeter
- cwd: <path>
- cwd readable: yes/no
- children readable: yes/no
- blacklisted paths blocked: yes/no

### Tools
| Tool         | Status            | Notes |
|--------------|-------------------|-------|
| read         | pass/fail/blocked |       |
| find         | pass/fail/blocked |       |
| grep         | pass/fail/blocked |       |
| ls           | pass/fail/blocked |       |
| write        | pass/fail/blocked |       |
| edit         | pass/fail/blocked |       |
| bash         | pass/fail/blocked |       |
| status       | pass/fail         |       |
| search       | pass/fail         |       |
| dispatch     | pass/fail/blocked |       |
| ask_question | pass/fail         |       |
| koad-io      | pass/fail         |       |
| music        | pass/fail         |       |
|--------------|-------------------|-------|

### Boundaries
- Cross-scope reads blocked: yes/no
- Blacklisted writes blocked: yes/no
- Shell blocked (if not granted): yes/no
- Escape hatch message present in blocks: yes/no

### Daemon
- Daemon reachable: yes/no
- Control tower reachable: yes/no
- Active flights: <count>
- Active sessions: <count>
```

## 5. Next Steps

If anything failed, use `ask_question` to report the issue.
If everything passed, use `koad-io announce` to signal readiness,
then check `search where status=ready --entity <your name>` for your first mission.
