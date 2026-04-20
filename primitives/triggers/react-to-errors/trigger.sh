#!/usr/bin/env bash
# PRIMITIVE: react-to-errors
# KIND: trigger
# TRIGGER: {"type":"error"}
# EVENT: any
# DEBOUNCE: 10
#
# Purpose: Healer role reactive trigger. Opens a heal flight parented to the
#          originating error emission and files a heal log for investigation.
#          The flight becomes part of the error's emission tree, so querying
#          /api/emissions/tree/<error_id> shows the full chain: what broke,
#          who reacted, what was found, what was done.
#
# Roles: healer only
#
# Env vars available from daemon trigger runner:
#   EMISSION_ENTITY  — entity that emitted the error
#   EMISSION_BODY    — body text of the emission
#   EMISSION_ID      — emission _id
#   EMISSION_TYPE    — should be "error"
#   ENTITY           — the entity this script runs as (the healer)

set -euo pipefail

# Skip self-errors to avoid heal loops
if [ "${EMISSION_ENTITY:-}" = "${ENTITY:-}" ]; then
  exit 0
fi

if [ -z "${EMISSION_ENTITY:-}" ] || [ -z "${EMISSION_ID:-}" ]; then
  exit 0
fi

source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null || exit 0

# Gate: only emit if KOAD_IO_EMIT=1 (emit.sh handles the gate internally)
koad_io_emit_open flight \
  "investigating ${EMISSION_ENTITY} error" \
  "{\"parentId\":\"${EMISSION_ID}\",\"trigger\":\"react-to-errors\",\"targetEntity\":\"${EMISSION_ENTITY}\"}"

# Capture error context to a dated heal log
HEAL_DIR="$HOME/heals/$(date +%Y-%m-%d)-auto"
mkdir -p "$HEAL_DIR"

cat > "$HEAL_DIR/${EMISSION_ENTITY}-${EMISSION_ID}.md" <<HEALLOG
---
triggered_by: ${EMISSION_ID}
entity: ${EMISSION_ENTITY}
at: $(date -Iseconds)
primitive: react-to-errors
---

# Auto-opened heal investigation

**Error body:** ${EMISSION_BODY:-<empty>}

**Next steps:**
- pull tree: \`curl http://10.10.10.10:28282/api/emissions/tree/${EMISSION_ID}\`
- diagnose root cause
- either resolve in-scope or escalate via notice emission to juno
HEALLOG

koad_io_emit_close "heal log filed at ${HEAL_DIR}/${EMISSION_ENTITY}-${EMISSION_ID}.md"
