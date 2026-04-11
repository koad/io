# koad:io plugins

Framework-authored plugins that teach a specific harness to feel like it comes from the kingdom. Each plugin targets exactly one harness (opencode, Claude Code, pi, hermez, …) and lives under that harness's shelf.

## Layout

```
~/.koad-io/plugins/
├── PRIMER.md            ← this file — introduces the category
├── opencode/            ← plugins targeting opencode (TUI + server hooks)
│   └── shell-git/       ← example: git-state ribbon in prompt-right slots
├── claude/              ← plugins targeting Claude Code (reserved)
├── pi/                  ← plugins targeting pi-mono (reserved)
└── <harness>/<plugin>/
```

Each `<plugin>/` is self-contained — a single TSX/JS file for simple cases, or a small directory with `index.*` + PRIMER.md for anything richer. Entities wire plugins in from *this* framework location; they do **not** copy the plugin into their own dir. Framework upgrades benefit every entity at once.

## Why this is its own shelf

koad:io already has:

- `~/.koad-io/commands/` — user-invoked primitives (shell-callable)
- `~/.koad-io/hooks/` — lifecycle responses (framework-triggered)
- `~/.koad-io/plugins/` — **harness extensions** (harness-triggered, render into harness chrome)

The difference: commands and hooks run as standalone bash/scripts. Plugins run *inside the harness's process* as modules the harness loads. They speak the harness's extension API (opencode plugin ABI, Claude Code hook schema, etc.) and render into chrome the harness owns (statuslines, TUI slots, sidebar blocks).

The Claude Code statusline at `~/.koad-io/commands/harness/claude/statusline.sh` is historically in `commands/harness/` but it *is* a koad:io plugin for Claude Code. A later cleanup relocates it to `~/.koad-io/plugins/claude/statusline/` for shelf symmetry — entity wiring doesn't change, only the canonical path.

## Design principles every plugin inherits

1. **Starship parity where possible.** For any shell-like surface (identity row, git state, timestamp), delegate to `starship prompt` or `starship module <name>` so the harness chrome moves in lockstep with the user's real shell. One config, many surfaces.

2. **Entity outfit theming.** Pull hue/saturation from `~/.<entity>/passenger.json` (via framework utilities) for accents — timestamp colons, status glyphs, identity ribbons. Every kingdom surface should recognize itself by color.

3. **XDG state paths, rooted-only recording.** If a plugin writes sensor data to the entity dir, the target is `~/.<entity>/.local/state/harness/<sensor>.json`, gated on `KOAD_IO_ROOTED=true`. Roaming entities display but don't record — otherwise state gets polluted with unrelated CWD sessions. See `feedback_statusline_sensor_gating`.

4. **One self-awareness row shape.** The Claude statusline's row 3 — `timestamp ❯ provider · model · ctx · cost [· quota]` — is the canonical "harness self-awareness ribbon." Other harnesses rebuild the same semantic row in their own chrome. Keep the grammar consistent.

5. **Fail quiet, never block the harness.** If a plugin can't read git, can't find starship, or can't parse state, it renders nothing (or a minimal fallback) rather than throwing. The harness is the host; the plugin is a guest.

6. **No secret handling.** Plugins live in a public framework tree. They read config and state, they don't read credentials. Secrets stay in `~/.<entity>/.credentials` and reach plugins only via already-running processes the plugin observes, never by direct file read.

## Wiring contract

Each harness has its own config file for plugin declarations:

| Harness        | Config file     | Entry shape                                       |
|----------------|-----------------|---------------------------------------------------|
| opencode TUI   | `tui.json`      | `plugin: ["<path>.tsx", { options }]`             |
| opencode srv   | `opencode.json` | `plugin: ["<path>.ts"]`                           |
| Claude Code    | `settings.json` | `statusLine.command: "<path>.sh"` / `hooks: …`    |

Entities edit *their own* config to include the framework path. The framework never self-installs into entity configs — explicit wiring is the sovereignty move.

## How to add a new plugin

1. Create `~/.koad-io/plugins/<harness>/<name>/` — with a PRIMER.md describing what the plugin does, what slot/hook it targets, and how to wire it in.
2. Follow the harness's plugin ABI (see the harness's own docs or an existing plugin as reference).
3. Inherit the design principles above. If you're shipping a first instance for a new harness, document the wiring contract in this PRIMER.
4. File a PR / spec reference against `koad/vesta#101` (the umbrella spec).
5. Add a pointer from this PRIMER's layout section so the shelf is discoverable.

## Related

- `~/.koad-io/commands/harness/PRIMER.md` — harness dispatch reference
- `project_koad_io_harness_plugins.md` (entity memory) — the category concept
- `koad/vesta#101` — umbrella spec
