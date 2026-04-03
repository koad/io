#!/usr/bin/env bash
# think — raw one-liner for quick local inference via ollama on fourty4
#
# NOTE: Not for entity work. Use OpenClaw (port 18789) for anything identity-aware
# or session-context-aware. This hits ollama directly with no harness integration.
#
# Usage:
#   think "your prompt"
#   think -m deepseek "your prompt"
#   think -s "you are a chef" "what should I cook?"
#   echo "prompt" | think
#   think --list
#   think --help

set -euo pipefail

FOURTY4_OLLAMA="${OLLAMA_HOST:-http://10.10.10.11:11434}"
DEFAULT_MODEL="${THINK_MODEL:-llama3.2:latest}"

MODEL="$DEFAULT_MODEL"
SYSTEM_PROMPT=""
PROMPT=""
RAW=false
NO_STREAM=false

usage() {
  cat >&2 <<EOF
think — local inference via ollama on fourty4

Usage:
  think [options] "prompt"
  echo "prompt" | think [options]

Options:
  -m, --model <name>      Model to use (default: $DEFAULT_MODEL)
  -s, --system <prompt>   System prompt
  -r, --raw               Raw JSON output
      --no-stream         Wait for full response instead of streaming
      --list              List available models on fourty4
  -h, --help              Show this help

Models:
  llama3.2:latest     128k context, fast general language      (default)
  deepseek-r1:8b      128k context, strong reasoning
  qwen2.5-coder:32b   32k context, code generation
  qwen2.5-coder:1.5b  32k context, quick code tasks
  gemma3:1b           32k context, lightweight

Environment:
  OLLAMA_HOST    Override ollama endpoint (default: http://10.10.10.11:11434)
  THINK_MODEL    Override default model

Examples:
  think "explain DDP handshakes"
  think -m deepseek-r1:8b "reason through this architecture decision"
  think -m qwen2.5-coder:32b "refactor this function" < myfile.js
  echo "translate to french: hello world" | think
  git diff | think -s "you are a code reviewer" "review this diff"
EOF
}

list_models() {
  echo "Models available on fourty4 ($FOURTY4_OLLAMA):"
  curl -sf "$FOURTY4_OLLAMA/api/tags" \
    | jq -r '.models[] | "  \(.name)\t\(.size | . / 1073741824 | floor)GB"' 2>/dev/null \
    || echo "  (could not reach $FOURTY4_OLLAMA)" >&2
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--model)
      MODEL="$2"; shift 2 ;;
    -s|--system)
      SYSTEM_PROMPT="$2"; shift 2 ;;
    -r|--raw)
      RAW=true; shift ;;
    --no-stream)
      NO_STREAM=true; shift ;;
    --list)
      list_models; exit 0 ;;
    -h|--help|help)
      usage; exit 0 ;;
    --)
      shift; PROMPT="$*"; break ;;
    -*)
      echo "Unknown option: $1" >&2; usage; exit 1 ;;
    *)
      PROMPT="$1"; shift ;;
  esac
done

# Read from stdin if no prompt arg and stdin is not a tty
if [[ -z "$PROMPT" ]] && [[ ! -t 0 ]]; then
  PROMPT=$(cat)
fi

if [[ -z "$PROMPT" ]]; then
  usage; exit 1
fi

# Build request payload
if [[ -n "$SYSTEM_PROMPT" ]]; then
  PAYLOAD=$(jq -n \
    --arg model "$MODEL" \
    --arg system "$SYSTEM_PROMPT" \
    --arg prompt "$PROMPT" \
    --argjson stream "$( [[ "$NO_STREAM" == true ]] && echo false || echo true )" \
    '{model: $model, system: $system, prompt: $prompt, stream: $stream}')
else
  PAYLOAD=$(jq -n \
    --arg model "$MODEL" \
    --arg prompt "$PROMPT" \
    --argjson stream "$( [[ "$NO_STREAM" == true ]] && echo false || echo true )" \
    '{model: $model, prompt: $prompt, stream: $stream}')
fi

# Execute
if [[ "$RAW" == true ]]; then
  curl -sf "$FOURTY4_OLLAMA/api/generate" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD"
elif [[ "$NO_STREAM" == true ]]; then
  curl -sf "$FOURTY4_OLLAMA/api/generate" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    | jq -r '.response // empty'
else
  curl -sf "$FOURTY4_OLLAMA/api/generate" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    | while IFS= read -r line; do
        echo "$line" | jq -r '.response // empty' 2>/dev/null
      done
fi
