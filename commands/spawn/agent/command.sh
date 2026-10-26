#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later

# Spawn Agent Command
# Spawns an interactive Claude Code subagent
#
# Usage:
#   alice spawn agent <name> [options]
#   alice spawn agent list
#   alice spawn agent kill <name>
#   alice spawn agent log <name>
#
# Options:
#   --detach               Spawn in new gnome-terminal (default: run in current shell)
#   --model <model>        Claude model (sonnet, opus, haiku)
#   --agent <agent>        Use specific agent (Explore, Plan, general-purpose)
#   --dir <path>           Working directory
#   --prompt <text>        Initial prompt (only with --detach)
#
# Environment Variables (extensible via ~/.alice/.env):
#   SPAWN_TERMINAL       - Terminal emulator (default: gnome-terminal)
#   SPAWN_TERMINAL_ARGS  - Arguments before command (default: --)
#   CLAUDE_MODEL         - Default Claude model (default: sonnet)
#   CLAUDE_AGENT         - Default agent to use
#   SPAWN_WORKDIR        - Default working directory
#   SPAWN_DIR            - Where subagent state is stored (~/.alice/subagents)

set -e

# === ENV VAR DEFAULTS ===
# These cascade: .koad-io/.env -> .alice/.env -> command .env -> CLI args

export SPAWN_TERMINAL="${SPAWN_TERMINAL:-gnome-terminal}"
export SPAWN_TERMINAL_ARGS="${SPAWN_TERMINAL_ARGS:---}"
export SPAWN_SESSION_PREFIX="${SPAWN_SESSION_PREFIX:-subagent}"
export CLAUDE_MODEL="${CLAUDE_MODEL:-sonnet}"
export CLAUDE_AGENT="${CLAUDE_AGENT:-}"
export SPAWN_WORKDIR="${SPAWN_WORKDIR:-$CWD}"
export SPAWN_DIR="${SPAWN_DIR:-$HOME/.alice/subagents}"
export SPAWN_LOG="${SPAWN_LOG:-true}"

# === AUDIT TRAILING CONFIG ===
export SPAWN_AUDIT="${SPAWN_AUDIT:-true}"
export SPAWN_AUDIT_DIR="${SPAWN_AUDIT_DIR:-.koad-io}"
export SPAWN_AUDIT_COMBINE="${SPAWN_AUDIT_COMBINE:-true}"

# Ensure subagent directory exists
mkdir -p "$SPAWN_DIR"

# === SUBCOMMAND HANDLER ===
SUBCOMMAND="$1"

case "$SUBCOMMAND" in
  list|ls)
    echo "=== Active Subagents ==="
    if [ ! -d "$SPAWN_DIR" ] || [ -z "$(ls -A "$SPAWN_DIR" 2>/dev/null)" ]; then
      echo "No subagents registered"
      exit 0
    fi
    
    for agent_dir in "$SPAWN_DIR"/*/; do
      [ -d "$agent_dir" ] || continue
      name=$(basename "$agent_dir")
      pid_file="$agent_dir/pid"
      log_file="$agent_dir/log.txt"
      info_file="$agent_dir/info.txt"
      
      if [ -f "$pid_file" ]; then
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
          status="Running"
        else
          status="Stopped"
        fi
      else
        pid="N/A"
        status="Unknown"
      fi
      
      echo ""
      echo "  Name: $name"
      echo "  PID:  $pid"
      echo "  Status: $status"
      
      if [ -f "$info_file" ]; then
        while IFS= read -r line; do
          echo "  $line"
        done < "$info_file"
      fi
      
      if [ -f "$log_file" ]; then
        echo "  Log: $log_file"
      fi
    done
    echo ""
    echo "Total subagents: $(ls -d "$SPAWN_DIR"/*/ 2>/dev/null | wc -l)"
    exit 0
    ;;
    
  kill)
    AGENT_NAME="$2"
    if [ -z "$AGENT_NAME" ]; then
      echo "Usage: alice spawn agent kill <name>"
      exit 1
    fi
    
    AGENT_DIR="$SPAWN_DIR/$AGENT_NAME"
    if [ ! -d "$AGENT_DIR" ]; then
      echo "Subagent '$AGENT_NAME' not found"
      exit 1
    fi
    
    if [ -f "$AGENT_DIR/pid" ]; then
      pid=$(cat "$AGENT_DIR/pid")
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" && echo "Killed subagent '$AGENT_NAME' (PID: $pid)"
      else
        echo "Subagent '$AGENT_NAME' is not running"
      fi
    else
      # Try to find by name in running processes
      pkill -f "claude.*$AGENT_NAME" && echo "Killed subagent '$AGENT_NAME' via pkill"
    fi
    exit 0
    ;;
    
  log)
    AGENT_NAME="$2"
    if [ -z "$AGENT_NAME" ]; then
      echo "Usage: alice spawn agent log <name>"
      exit 1
    fi
    
    LOG_FILE="$SPAWN_DIR/$AGENT_NAME/log.txt"
    if [ -f "$LOG_FILE" ]; then
      tail -50 "$LOG_FILE"
    else
      echo "Log file not found for '$AGENT_NAME'"
      exit 1
    fi
    exit 0
    ;;
    
  agent)
    # Handle "spawn agent agent-name" as legacy syntax
    SUBCOMMAND=""
    ;;
esac

# === MAIN SPAWN LOGIC ===

# Parse remaining arguments
AGENT_NAME=""
INITIAL_PROMPT=""
USE_MODEL=""
USE_AGENT=""
USE_DIR=""
DETACH=false

while [ $# -gt 0 ]; do
  case "$1" in
    --detach)
      DETACH=true
      shift
      ;;
    --model)
      USE_MODEL="$2"
      shift 2
      ;;
    --agent)
      USE_AGENT="$2"
      shift 2
      ;;
    --dir|-d)
      USE_DIR="$2"
      shift 2
      ;;
    --prompt|-p)
      INITIAL_PROMPT="$2"
      shift 2
      ;;
    *)
      if [ -z "$AGENT_NAME" ]; then
        AGENT_NAME="$1"
      else
        INITIAL_PROMPT="$INITIAL_PROMPT $1"
      fi
      shift
      ;;
  esac
done

# Check for required arguments
if [ -z "$AGENT_NAME" ]; then
  echo "Usage: alice spawn agent <name> [options]"
  echo ""
  echo "Arguments:"
  echo "  <name>              - Name for the subagent"
  echo ""
  echo "Options:"
  echo "  --detach             - Spawn in new gnome-terminal [default: current shell]"
  echo "  --model <model>      - Claude model (sonnet, opus, haiku) [default: sonnet]"
  echo "  --agent <agent>      - Use agent (Explore, Plan, general-purpose)"
  echo "  --dir <path>         - Working directory [default: $SPAWN_WORKDIR]"
  echo "  --prompt <text>      - Initial prompt (only with --detach)"
  echo ""
  echo "Subcommands:"
  echo "  list                 - List active subagents"
  echo "  kill <name>          - Kill a subagent"
  echo "  log <name>           - View subagent log"
  echo ""
  echo "Environment Variables:"
  echo "  SPAWN_TERMINAL=$SPAWN_TERMINAL"
  echo "  SPAWN_MODEL=$CLAUDE_MODEL"
  echo "  SPAWN_AGENT=$CLAUDE_AGENT"
  echo "  SPAWN_DIR=$SPAWN_DIR"
  exit 1
fi

# Resolve working directory
WORKDIR="${USE_DIR:-$SPAWN_WORKDIR}"

# === SETUP AUDIT TRAILING ===
# Create .koad-io folder in working directory for audit logs
AUDIT_DIR="$WORKDIR/$SPAWN_AUDIT_DIR"
if [ "$SPAWN_AUDIT" = "true" ]; then
  mkdir -p "$AUDIT_DIR"
  
  # Generate audit file name with timestamp
  AUDIT_FILE="$AUDIT_DIR/spawn-$AGENT_NAME-$(date +%Y%m%d-%H%M%S).log"
  
  # If combine mode, also create/update a combined log file
  if [ "$SPAWN_AUDIT_COMBINE" = "true" ]; then
    AUDIT_COMBINED="$AUDIT_DIR/spawn-$AGENT_NAME.log"
  else
    AUDIT_COMBINED=""
  fi
  
  # Function to log to audit files
  audit_log() {
    local msg="$1"
    local timestamp
    timestamp=$(date -Iseconds)
    local entry="[$timestamp] $msg"
    
    if [ -n "$AUDIT_FILE" ]; then
      echo "$entry" >> "$AUDIT_FILE"
    fi
    if [ -n "$AUDIT_COMBINED" ] && [ -w "$AUDIT_COMBINED" ]; then
      echo "$entry" >> "$AUDIT_COMBINED"
    fi
  }
  
  # Log audit start
  {
    echo "========================================"
    echo "AUDIT: Spawn Agent Session Start"
    echo "========================================"
    echo "Agent Name: $AGENT_NAME"
    echo "Session ID: $SESSION_ID"
    echo "Working Directory: $WORKDIR"
    echo "Audit Directory: $AUDIT_DIR"
    echo "Model: $MODEL"
    echo "Agent: ${AGENT:-none}"
    echo "Detached: $DETACH"
    echo "Started: $(date -Iseconds)"
    echo "========================================"
    echo ""
  } >> "$AUDIT_FILE"
  
  if [ -n "$AUDIT_COMBINED" ]; then
    {
      echo "========================================"
      echo "AUDIT: Spawn Agent Session Start"
      echo "========================================"
      echo "Agent Name: $AGENT_NAME"
      echo "Session ID: $SESSION_ID"
      echo "Working Directory: $WORKDIR"
      echo "Audit Directory: $AUDIT_DIR"
      echo "Model: $MODEL"
      echo "Agent: ${AGENT:-none}"
      echo "Detached: $DETACH"
      echo "Started: $(date -Iseconds)"
      echo "========================================"
      echo ""
    } >> "$AUDIT_COMBINED"
  fi
  
  echo "---koad-io [audit] enabled---"
  echo "Audit log: $AUDIT_FILE"
  if [ -n "$AUDIT_COMBINED" ]; then
    echo "Combined log: $AUDIT_COMBINED"
  fi
  echo "------------------------"
else
  AUDIT_FILE=""
  AUDIT_COMBINED=""
  audit_log() { : ; }  # No-op if audit disabled
fi

# Create agent state directory
AGENT_DIR="$SPAWN_DIR/$AGENT_NAME"
mkdir -p "$AGENT_DIR"

# Generate session ID
SESSION_ID=$(cat /proc/sys/kernel/random/uuid)

# Resolve model and agent
MODEL="${USE_MODEL:-$CLAUDE_MODEL}"
AGENT="${USE_AGENT:-$CLAUDE_AGENT}"

# Save agent info
{
  echo "name=$AGENT_NAME"
  echo "session_id=$SESSION_ID"
  echo "workdir=$WORKDIR"
  echo "model=$MODEL"
  echo "agent=$AGENT"
  echo "spawned=$(date -Iseconds)"
  echo "detached=$DETACH"
} > "$AGENT_DIR/info.txt"

# Build the claude command
CLAUDE_CMD="claude"

# Add name (display name in terminal)
CLAUDE_CMD="$CLAUDE_CMD -n '$SPAWN_SESSION_PREFIX-$AGENT_NAME'"

# Add model
if [ -n "$MODEL" ]; then
  CLAUDE_CMD="$CLAUDE_CMD --model '$MODEL'"
fi

# Add agent
if [ -n "$AGENT" ]; then
  CLAUDE_CMD="$CLAUDE_CMD --agent '$AGENT'"
fi

# Add session ID for tracking
CLAUDE_CMD="$CLAUDE_CMD --session-id '$SESSION_ID'"

# Escape for bash -c
ESCAPED_CLAUDE_CMD=$(echo "$CLAUDE_CMD" | sed "s/'/\\\\'/g")

echo "--koad-io [alice] spawn agent start--"
echo "Agent Name: $AGENT_NAME"
echo "Session ID: $SESSION_ID"
echo "Mode: $([ "$DETACH" = true ] && echo "DETACHED (new terminal)" || echo "INLINE (current shell)")"
echo "Terminal: $SPAWN_TERMINAL"
echo "Working Directory: $WORKDIR"
echo "Model: $MODEL"
echo "Agent: ${AGENT:-none}"
echo "Log: $AGENT_DIR/log.txt"
if [ "$SPAWN_AUDIT" = "true" ]; then
  echo "Audit: $AUDIT_FILE"
fi
echo "---"

cd "$WORKDIR"

# Log the start (use eval to expand $(date) properly)
echo "=== Subagent started at $(date) ===" > "$AGENT_DIR/log.txt"
echo "Session ID: $SESSION_ID" >> "$AGENT_DIR/log.txt"
echo "Model: $MODEL" >> "$AGENT_DIR/log.txt"
echo "Agent: ${AGENT:-none}" >> "$AGENT_DIR/log.txt"
echo "" >> "$AGENT_DIR/log.txt"

if [ "$DETACH" = true ]; then
  # === DETACHED MODE: Spawn in new gnome-terminal (INTERACTIVE) ===
  
  echo "Spawning interactive claude in new terminal..."
  
  # Build the claude command without --print (interactive)
  DETACHED_CLAUDE="claude -n '$SPAWN_SESSION_PREFIX-$AGENT_NAME'"
  if [ -n "$MODEL" ]; then
    DETACHED_CLAUDE="$DETACHED_CLAUDE --model '$MODEL'"
  fi
  if [ -n "$AGENT" ]; then
    DETACHED_CLAUDE="$DETACHED_CLAUDE --agent '$AGENT'"
  fi
  DETACHED_CLAUDE="$DETACHED_CLAUDE --session-id '$SESSION_ID'"
  
  # Create a wrapper script to run
  WRAPPER="$AGENT_DIR/wrapper.sh"
  cat > "$WRAPPER" << WRAPPEREOF
#!/bin/bash
cd "$WORKDIR"

# Audit log path
AUDIT_FILE="$AUDIT_FILE"
AUDIT_COMBINED="$AUDIT_COMBINED"

# Function to log to audit files
audit_log() {
  local msg="$1"
  local timestamp
  timestamp=\$(date -Iseconds)
  local entry="[\$timestamp] \$msg"
  
  if [ -n "\$AUDIT_FILE" ]; then
    echo "\$entry" >> "\$AUDIT_FILE"
  fi
  if [ -n "\$AUDIT_COMBINED" ] && [ -w "\$AUDIT_COMBINED" ]; then
    echo "\$entry" >> "\$AUDIT_COMBINED"
  fi
}

# Start audit entry
audit_log "DETACHED MODE: Subagent started"

# Run claude and pipe to both log file and audit
$DETACHED_CLAUDE 2>&1 | tee -a "$AGENT_DIR/log.txt" | while IFS= read -r line; do
  audit_log "OUTPUT: \$line"
done

# End audit entry
audit_log "DETACHED MODE: Subagent ended"

echo "" >> "$AGENT_DIR/log.txt"
echo "=== Subagent ended at \$(date) ===" >> "$AGENT_DIR/log.txt"
echo ""
echo "---"
echo "Subagent session ended. Press Enter to close."
read
WRAPPEREOF
  chmod +x "$WRAPPER"
  
  # Run in gnome-terminal
  $SPAWN_TERMINAL $SPAWN_TERMINAL_ARGS "$WRAPPER" &
  
  TERMINAL_PID=$!
  echo "$TERMINAL_PID" > "$AGENT_DIR/pid"
  
  echo ""
  echo "Spawned agent '$AGENT_NAME' in new terminal"
  echo "  PID: $TERMINAL_PID"
  echo "  Log: $AGENT_DIR/log.txt"
  echo ""
  echo "To view subagents: alice spawn agent list"
  echo "To view logs: alice spawn agent log $AGENT_NAME"
  echo "To kill: alice spawn agent kill $AGENT_NAME"
  
else
  # === INLINE MODE: Run NON-INTERACTIVE with --print ===
  
  echo "Running non-interactive claude (--print)..."
  echo "Logging to: $AGENT_DIR/log.txt"
  if [ -n "$AUDIT_FILE" ]; then
    echo "Audit logging to: $AUDIT_FILE"
  fi
  echo ""
  
  # Log start to audit
  audit_log "INLINE MODE: Subagent started with prompt: $INITIAL_PROMPT"
  
  # Check if we have a prompt
  if [ -n "$INITIAL_PROMPT" ]; then
    # Run with prompt and --print (non-interactive, print result and exit)
    # Pipe to both log file and audit
    claude -p --model "$MODEL" --agent "$AGENT" --session-id "$SESSION_ID" "$INITIAL_PROMPT" 2>&1 | tee -a "$AGENT_DIR/log.txt" | while IFS= read -r line; do
      audit_log "OUTPUT: $line"
    done
  else
    echo "No prompt provided. Use --prompt <text> or pass prompt as argument"
    echo "Example: alice spawn agent myagent --prompt 'Hello, say hi'"
    exit 1
  fi
  
  # Log the end
  {
    echo ""
    echo "=== Subagent ended at $(date) ==="
  } >> "$AGENT_DIR/log.txt"
  
  # Log end to audit
  audit_log "INLINE MODE: Subagent ended"
  
  # Write final audit summary
  if [ -n "$AUDIT_FILE" ]; then
    {
      echo ""
      echo "========================================"
      echo "AUDIT: Session Summary"
      echo "========================================"
      echo "Agent Name: $AGENT_NAME"
      echo "Session ID: $SESSION_ID"
      echo "Ended: $(date -Iseconds)"
      echo "========================================"
    } >> "$AUDIT_FILE"
  fi
  
  echo ""
  echo "Subagent completed. Returned to main shell."
fi
