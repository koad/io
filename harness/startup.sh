#!/usr/bin/env bash
# VESTA-SPEC-067: Entity context assembly
# Assembles context layers and pre-emptive primitives to stdout.
# The calling hook pipes this into --append-system-prompt or equivalent.
#
# Design: the cheapest token is the one the entity never has to generate.
# Front-load the map — ls the key dirs, report the facts, cat the identity.
# The entity wakes up already knowing what it has. No guessing. No tool calls
# to discover its own structure. Its first breath is this script's exhale.
#
# Usage (env already sourced by koad-io bin before hook fires):
#   SYSTEM_PROMPT="$(~/.koad-io/harness/startup.sh)"
#   exec claude . --append-system-prompt "$SYSTEM_PROMPT"
#
# Env required:
#   ENTITY       — entity name (e.g. juno)
#   CWD          — caller's working directory (set by koad-io bin)
#
# Env optional:
#   ENTITY_DIR   — entity directory (default: ~/.$ENTITY)
#   KOAD_IO_DIR  — framework directory (default: ~/.koad-io)
#   KOAD_IO_ROOTED — if true, entity works from $ENTITY_DIR (has an office)
#                    if unset, entity works from $CWD (out on the town)
#
# Outputs:
#   stdout       — assembled system prompt
#   stderr       — diagnostic log (for auditing)
#   .context     — same content written to $ENTITY_DIR/.context (for static harnesses)
#
set -euo pipefail

ENTITY="${ENTITY:?ENTITY not set}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"
CALL_DIR="${CWD:-$PWD}"

# --- Resolve working directory ---
if [ "${KOAD_IO_ROOTED:-}" = "true" ]; then
  HARNESS_WORK_DIR="$ENTITY_DIR"
else
  HARNESS_WORK_DIR="$CALL_DIR"
fi
export HARNESS_WORK_DIR

# --- Startup facts (deterministic, not AI-dependent) ---
_HOST="$(hostname -s 2>/dev/null || echo unknown)"
_USER="$(whoami 2>/dev/null || echo unknown)"
_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
_DATE_HUMAN="$(date '+%A %B %-d, %Y')"  # e.g. "Monday April 13, 2026"

# --- Helper: list a directory if it exists, one item per line ---
_ls() {
  if [ -d "$1" ]; then
    ls -1 "$1" 2>/dev/null
  fi
}

# --- Helper: variable substitution on context files ---
# Resolves $ENTITY, $ENTITY_DIR, $HOST, $USER, $DATE, $DATE_HUMAN
# in primer/identity files as they're assembled. One source file,
# every entity sees their own name.
_subst() {
  sed \
    -e "s|\\\$ENTITY_DIR|$ENTITY_DIR|g" \
    -e "s|\\\$ENTITY|$ENTITY|g" \
    -e "s|\\\$HOST|$_HOST|g" \
    -e "s|\\\$USER|$_USER|g" \
    -e "s|\\\$DATE|$_DATE_HUMAN|g" \
    -e "s|\\\$PURPOSE|${PURPOSE:-}|g" \
    -e "s|\\\$ROLE|${ROLE:-}|g" \
    -e "s|~/\.\$ENTITY|$ENTITY_DIR|g" \
    -e "s|~/\.\\<$ENTITY\\>|$ENTITY_DIR|g"
}

# --- Diagnostic log (stderr) ---
echo "[startup] entity=$ENTITY host=$_HOST user=$_USER" >&2
echo "[startup] entity_dir=$ENTITY_DIR call_dir=$CALL_DIR" >&2
echo "[startup] rooted=${KOAD_IO_ROOTED:-false} → work_dir=$HARNESS_WORK_DIR" >&2

# --- Assemble prompt (stdout) ---
# Everything below this line goes to the entity as pre-loaded context.
# The goal: zero tool calls needed to orient.

cat <<EOF
## Session Context

- **entity:** $ENTITY
- **host:** $_HOST
- **user:** $_USER
- **entity_dir:** $ENTITY_DIR
- **work_dir:** $HARNESS_WORK_DIR
- **call_dir:** $CALL_DIR
- **today:** $_DATE_HUMAN
- **started:** $_DATE

## Git Status

EOF

# Entity repo status (always available, fast)
if [ -d "$ENTITY_DIR/.git" ]; then
  _branch="$(git -C "$ENTITY_DIR" branch --show-current 2>/dev/null || echo unknown)"
  _status="$(git -C "$ENTITY_DIR" status --porcelain 2>/dev/null)"
  _ahead="$(git -C "$ENTITY_DIR" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)"
  _last_commit="$(git -C "$ENTITY_DIR" log --oneline -1 2>/dev/null || echo 'no commits')"
  echo "**Entity repo** (\`$ENTITY_DIR\`):"
  echo "- branch: \`$_branch\`"
  if [ -z "$_status" ]; then
    echo "- working tree: clean"
  else
    echo "- working tree: dirty"
    echo '```'
    echo "$_status"
    echo '```'
  fi
  [ "$_ahead" -gt 0 ] && echo "- **$_ahead commits ahead of origin** (unpushed)"
  echo "- last commit: \`$_last_commit\`"
  echo
fi

# Working dir repo status (if different from entity dir and is a git repo)
if [ "$HARNESS_WORK_DIR" != "$ENTITY_DIR" ] && [ -d "$HARNESS_WORK_DIR/.git" ]; then
  _wbranch="$(git -C "$HARNESS_WORK_DIR" branch --show-current 2>/dev/null || echo unknown)"
  _wstatus="$(git -C "$HARNESS_WORK_DIR" status --porcelain 2>/dev/null)"
  _wahead="$(git -C "$HARNESS_WORK_DIR" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)"
  _wlast="$(git -C "$HARNESS_WORK_DIR" log --oneline -1 2>/dev/null || echo 'no commits')"
  echo "**Working dir** (\`$HARNESS_WORK_DIR\`):"
  echo "- branch: \`$_wbranch\`"
  if [ -z "$_wstatus" ]; then
    echo "- working tree: clean"
  else
    echo "- working tree: dirty"
    echo '```'
    echo "$_wstatus"
    echo '```'
  fi
  [ "$_wahead" -gt 0 ] && echo "- **$_wahead commits ahead of origin** (unpushed)"
  echo "- last commit: \`$_wlast\`"
  echo
fi

# Active briefs (symlinks = dispatched work orders)
_briefs_count=0
if [ -d "$ENTITY_DIR/briefs" ]; then
  _briefs_count=$(ls -1 "$ENTITY_DIR/briefs/" 2>/dev/null | wc -l)
fi
if [ "$_briefs_count" -gt 0 ]; then
  echo "### Active Briefs ($_briefs_count)"
  echo
  ls -1 "$ENTITY_DIR/briefs/" 2>/dev/null | sed 's/^/- /'
  echo
fi

cat <<'EOF'
## Pre-emptive Primitives

A look around yourself. This is what you have on disk right now.

### Commands
EOF
_ls "$ENTITY_DIR/commands" | sed 's/^/- /'
_ls "$KOAD_IO_DIR/commands" | sed 's/^/- /' | sed 's/^//' # framework fallbacks

cat <<'EOF'

### Hooks
EOF
_ls "$ENTITY_DIR/hooks" | sed 's/^/- /'

cat <<'EOF'

### Trust Bonds
EOF
_ls "$ENTITY_DIR/trust/bonds" 2>/dev/null | { grep -v '\.asc$' || true; } | sed 's/\.md$//' | sed 's/^/- /'

cat <<'EOF'

### Memories
EOF
_ls "$ENTITY_DIR/memories" | { grep '\.md$' || true; } | sed 's/\.md$//' | sed 's/^/- /'

cat <<'EOF'

### Skills
EOF
_ls "$ENTITY_DIR/skills" | sed 's/^/- /'

# --- Active Flights (Section 5a — VESTA-SPEC-110) ----------------------------
# If the entity has a control flight scanner, run it with --active and splice
# the output into the system prompt. Read-only. Non-zero exit or empty output
# skips silently — session never blocks on a missing or broken control layer.
#
# Entity scope: only entities with a control layer at the required path emit
# this section. All others skip silently with no config changes required.
_flight_scan="$ENTITY_DIR/commands/control/flight/status/command.sh"
if [ -x "$_flight_scan" ]; then
  _flight_out="$("$_flight_scan" --active 2>/dev/null || true)"
  if [ -n "$_flight_out" ]; then
    echo "[startup] control/flight: active flights found, splicing" >&2
    printf '\n### Active Flights\n\n```\n%s\n```\n' "$_flight_out"
  else
    echo "[startup] control/flight: no active flights" >&2
  fi
else
  echo "[startup] control/flight: scanner absent, skipped" >&2
fi

# --- Bookmarked Questions (Section 5b — VESTA-SPEC-110) ----------------------
# If the entity has a control questions scanner, run it and splice questions
# into the system prompt. Sentinel "q: no bookmarked questions" → skip.
# Same degradation contract as flights: any failure → skip silently.
_q_scan="$ENTITY_DIR/commands/control/q/list/command.sh"
if [ -x "$_q_scan" ]; then
  _q_out="$("$_q_scan" 2>/dev/null || true)"
  if [ -n "$_q_out" ] && [ "$_q_out" != "q: no bookmarked questions" ]; then
    echo "[startup] control/q: bookmarked questions found, splicing" >&2
    printf '\n### Bookmarked Questions\n\n```\n%s\n```\n' "$_q_out"
  else
    echo "[startup] control/q: no bookmarked questions" >&2
  fi
else
  echo "[startup] control/q: scanner absent, skipped" >&2
fi

# --- Pending tickles (Section 5 — VESTA-SPEC-097) ----------------------------
# If the entity has a tickler loader (commands/tickler/scan/command.sh), run
# it and splice its report into the system prompt. Read-only by design. The
# loader is invoked directly — not via the `<entity> tickler scan` wrapper —
# to skip the cascade banner and keep the injected context clean.
#
# Entities without a tickler loader skip silently. Loaders that report "no
# tickles right now" also skip (nothing to surface, no wasted tokens).
#
# Rollout pattern: drop `commands/tickler/scan/command.sh` into any entity
# that wants automatic session-start tickler injection across any harness
# that consumes startup.sh (claude, opencode, pi, hermez, ...). One wiring,
# kingdom-wide continuity.
_tickler_scan="$ENTITY_DIR/commands/tickler/scan/command.sh"
if [ -x "$_tickler_scan" ]; then
  _tickler_out="$("$_tickler_scan" 2>/dev/null || true)"
  if [ -n "$_tickler_out" ] && [ "$_tickler_out" != "Tickler: no tickles right now" ]; then
    echo "[startup] tickler: spliced into system prompt" >&2
    # Tickle party — the human at the CLI sees the same surface the entity
    # sees in its system prompt. startup.sh's stderr passes through to the
    # terminal (the hook only captures stdout into $SYSTEM_PROMPT), so
    # echoing here reaches both parties with a single source of truth.
    printf '\n%s\n\n' "$_tickler_out" >&2
    printf '\n### Pending Tickles\n\n```\n%s\n```\n' "$_tickler_out"
  else
    echo "[startup] tickler: loader present, nothing due" >&2
  fi
fi

# If roaming, show what's in the working directory too
if [ "$HARNESS_WORK_DIR" != "$ENTITY_DIR" ]; then
  cat <<EOF

### Working Directory ($HARNESS_WORK_DIR)
EOF
  _ls "$HARNESS_WORK_DIR" | head -30 | sed 's/^/- /'
fi

# --- Local .koad-io/ footprint ---
# Workspaces may have a .koad-io/ folder with local kingdom state:
# parties (shared conversations), breadcrumbs, config overrides.
# If present, surface it so the entity knows what's here.
if [ -d "$HARNESS_WORK_DIR/.koad-io" ]; then
  echo "[startup] local .koad-io/ found in $HARNESS_WORK_DIR" >&2
  cat <<'EOF'

### Local .koad-io/
EOF
  _ls "$HARNESS_WORK_DIR/.koad-io" | sed 's/^/- /'

  # Surface active parties
  if [ -d "$HARNESS_WORK_DIR/.koad-io/parties" ]; then
    cat <<'EOF'

### Active Parties
EOF
    for _party_dir in "$HARNESS_WORK_DIR/.koad-io/parties"/*/; do
      if [ -f "$_party_dir/PRIMER.md" ]; then
        _party_name="$(basename "$_party_dir")"
        _session_id=""
        [ -f "$_party_dir/session" ] && _session_id="$(cat "$_party_dir/session")"
        echo "- **$_party_name** (session: ${_session_id:-unknown})"
        # Show first few lines of the PRIMER for context
        head -8 "$_party_dir/PRIMER.md" | { grep -E '^\- ' || true; } | sed 's/^/  /'
      fi
    done
    cat <<'EOF'

> There are active party-line conversations in this workspace.
> Use `<entity> respond "message"` to join, or ask the user if they'd like to participate.
EOF
  fi
fi

printf '\n---\n\n'

# --- Layer 1: Kingdom ---
if [ -f "$KOAD_IO_DIR/KOAD_IO.md" ]; then
  _subst < "$KOAD_IO_DIR/KOAD_IO.md"
  printf '\n\n---\n\n'
  echo "[startup] layer1: KOAD_IO.md ($(wc -c < "$KOAD_IO_DIR/KOAD_IO.md") bytes)" >&2
else
  echo "[startup] layer1: KOAD_IO.md not found, skipped" >&2
fi

# --- Layer 2: Entity ---
if [ -f "$ENTITY_DIR/ENTITY.md" ]; then
  _subst < "$ENTITY_DIR/ENTITY.md"
  echo "[startup] layer2: ENTITY.md ($(wc -c < "$ENTITY_DIR/ENTITY.md") bytes)" >&2
else
  echo "[startup] layer2: ENTITY.md not found, skipped" >&2
fi

# --- Layer 2b: Role primers ---
# An entity declares its role via KOAD_IO_ENTITY_ROLE in ~/.<entity>/.env.
# The framework maintains a library at ~/.koad-io/harness/primers/<role>/.
# Every .md in the role directory is loaded — drop a primer in the folder,
# every entity with that role gets it on next session start.
# No role declared = no primers loaded. Missing role dir = logged, not fatal.
PRIMERS_BASE="$KOAD_IO_DIR/harness/primers"
if [ -n "${KOAD_IO_ENTITY_ROLE:-}" ]; then
  _role_dir="$PRIMERS_BASE/$KOAD_IO_ENTITY_ROLE"
  if [ -d "$_role_dir" ]; then
    _primer_count=0
    for _primer_file in "$_role_dir"/*.md; do
      [ -f "$_primer_file" ] || continue
      _primer_name="$(basename "$_primer_file" .md)"
      printf '\n---\n\n# Role Primer: %s\n\n' "$_primer_name"
      _subst < "$_primer_file"
      echo "[startup] role primer: $KOAD_IO_ENTITY_ROLE/$_primer_name ($(wc -c < "$_primer_file") bytes)" >&2
      _primer_count=$((_primer_count + 1))
    done
    echo "[startup] role primers: $KOAD_IO_ENTITY_ROLE — $_primer_count loaded" >&2
  else
    echo "[startup] role primers: dir not found for role '$KOAD_IO_ENTITY_ROLE', skipped" >&2
  fi
else
  echo "[startup] role primers: no KOAD_IO_ENTITY_ROLE declared" >&2
fi

# --- Layer 4: Location — PRIMER.md (roaming entities only) ----------------
#
# A PRIMER.md is a sign on the door — orientation for whoever walks into
# that directory. Rooted entities never read their own PRIMER (they wrote
# the sign). Roaming entities read the PRIMER of wherever they've been
# sent — that's the whole point of roaming.

if [ "${KOAD_IO_ROOTED:-}" = "true" ]; then
  echo "[startup] primer: skipped (rooted entity — CWD primers don't apply)" >&2
else
  PRIMER_FILE=""
  for _p in "$HARNESS_WORK_DIR"/[Pp][Rr][Ii][Mm][Ee][Rr].[Mm][Dd]; do
    if [ -f "$_p" ]; then
      PRIMER_FILE="$_p"
      break
    fi
  done
  if [ -n "$PRIMER_FILE" ]; then
    echo "[startup] primer: $PRIMER_FILE ($(wc -c < "$PRIMER_FILE") bytes)" >&2
    printf '\n---\n\n# Location Context (%s)\n\n' "$HARNESS_WORK_DIR"
    _subst < "$PRIMER_FILE"
  fi
fi

# Layers loaded by the harness itself (not here):
#   3. Implement — CLAUDE.md auto-loaded from HARNESS_WORK_DIR (claude-specific)
#   5. Memory    — harness memory system
#   6. Guardrails — hardcoded in portal harness, implicit in CLI

# --- End of assembly ---
# stdout is captured by the calling harness as SYSTEM_PROMPT.
# Each leaf harness consumes it in its own native way:
#   claude   → --append-system-prompt
#   opencode → OPENCODE_CONFIG_CONTENT (JSON injection)
