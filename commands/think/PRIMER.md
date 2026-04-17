<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/think/`

> Raw local inference via ollama — quick one-liners to the kingdom's inference machine.

## What this does

`think` sends a prompt directly to ollama on the inference host (default: `fourty4`) and streams the response. Not entity-aware — no harness, no identity context, no session continuity. Use it for quick local reasoning tasks where you don't need the full entity harness.

## Invocation

```bash
think "explain DDP handshakes"
think -m deepseek-r1:8b "reason through this architecture decision"
think -m qwen2.5-coder:32b "refactor this" < myfile.js
echo "translate to french: hello world" | think
git diff | think -s "you are a code reviewer" "review this diff"
think --list                          # List available models on inference host
```

## Options

| Flag | Purpose |
|------|---------|
| `-m, --model <name>` | Model to use (default: `llama3.2:latest`) |
| `-s, --system <prompt>` | System prompt |
| `-r, --raw` | Raw JSON output |
| `--no-stream` | Wait for full response |
| `--list` | List available models |

## Environment

- `KOAD_IO_INFERENCE_HOST` — inference hostname (default: `fourty4`)
- `OLLAMA_HOST` — full URL override (overrides inference host)
- `THINK_MODEL` — default model override

## Notes

- For entity-aware work, use `<entity> harness claude` instead — it loads identity context and hooks.
- `think` is intentionally stateless — no session history, no memory, no harness integration.
- Requires network access to the inference host.
