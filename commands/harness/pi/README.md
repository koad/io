# Isolated Pi Harness Package Lab

This directory keeps experimental Pi package work isolated from your normal Pi instance.

## Isolation

Use:

```bash
export PI_CODING_AGENT_DIR="$PWD/.local/agent"
```

The harness also defaults Pi to this directory unless `KOAD_IO_PI_AGENT_DIR` is set.

## Local package

Package root:

```text
packages/experimental-pi-package
```

It is registered in `.local/agent/settings.json` as a local package, so running Pi with the isolated agent dir loads it without touching `~/.pi/agent`.

## Tool whitelist guard

The experimental package reports all tool calls and blocks path-based tool calls outside a whitelist.

Configure allowed folders with `:`-separated paths:

```bash
export PI_TOOL_WHITELIST_DIRS="$PWD:/tmp/safe-scratch"
```

Fallback env names are also supported:

```bash
export KOAD_IO_PI_TOOL_WHITELIST_DIRS="$PWD"
export KOAD_IO_TOOL_WHITELIST_DIRS="$PWD"
```

Or create a whitelist file:

```json
// .local/agent/tool-whitelist.json
{
  "folders": ["../..", "/tmp/safe-scratch"]
}
```

Relative entries in the file resolve relative to the whitelist file. If no env var or whitelist file is set, it defaults to the current working directory.

Note: `bash` is checked by cwd and obvious absolute path tokens. This is a guardrail, not a full shell sandbox.

## Test

```bash
./bin/pi-local list
PI_TOOL_WHITELIST_DIRS="$PWD" ./bin/pi-local --offline
```
