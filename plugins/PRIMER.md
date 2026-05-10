---
type: primer
folder: ~/.koad-io/plugins/
parents:
  - ~/.koad-io/
children:
  - path: opencode/
    blurb: Plugins for the opencode TUI/server harness — git-state ribbon in prompt-right slots
    status: documented
features:
  - name: koad-io-plugin-shelf
    blurb: Category convention — harness extensions that run inside the harness's process as modules, targeting one harness per shelf
    location: ~/.koad-io/plugins/PRIMER.md
  - name: plugin-opencode-shell-git
    blurb: Starship-parity git-state ribbon in opencode prompt-right slots — branch, ahead/behind, staged/modified/deleted/untracked
    location: ~/.koad-io/plugins/opencode/shell-git/index.tsx
relates-to:
  - ~/.koad-io/PRIMER.md
  - ~/.koad-io/hooks/PRIMER.md
  - ~/.koad-io/commands/PRIMER.md
  - ~/.livy/features/koad-io-plugin-shelf.md
  - ~/.livy/features/plugin-opencode-shell-git.md
entities:
  - vulcan
  - koad
last-walked: 2026-05-10
as-of: 9c57eb9c808e451840350d1ac32d1ff8ead0c36c
---

# ~/.koad-io/plugins/ — Harness Extensions

Framework-authored plugins that teach a specific harness to feel like it comes from the kingdom. Each plugin targets exactly one harness (opencode, Claude Code, pi, hermez, …) and lives under that harness's shelf.

## How plugins differ from commands and hooks

koad:io already has:

- `~/.koad-io/commands/` — user-invoked primitives (shell-callable)
- `~/.koad-io/hooks/` — lifecycle responses (framework-triggered)
- `~/.koad-io/plugins/` — **harness extensions** (harness-triggered, render into harness chrome)

Commands and hooks run as standalone bash/scripts. Plugins run *inside the harness's process* as modules the harness loads. They speak the harness's extension API (opencode plugin ABI, Claude Code hook schema, etc.) and render into chrome the harness owns (statuslines, TUI slots, sidebar blocks).

## Shelf layout

```
~/.koad-io/plugins/
├── PRIMER.md            ← this file
├── opencode/            ← plugins for opencode (TUI + server hooks)
│   └── shell-git/       ← git-state ribbon in prompt-right slots
├── claude/              ← plugins for Claude Code (reserved)
└── pi/                  ← plugins for pi-mono (reserved)
```

Each `<plugin>/` is self-contained — a single TSX/JS file for simple cases, or a small directory with `index.*` + PRIMER.md for anything richer. Entities wire plugins in from *this* framework location; they do **not** copy the plugin into their own dir. Framework upgrades benefit every entity at once.

## Wiring contract

Entities edit *their own* config to include the framework path. The framework never self-installs into entity configs — explicit wiring is the sovereignty move.

| Harness      | Config file     | Entry shape                                    |
|--------------|-----------------|------------------------------------------------|
| opencode TUI | `tui.json`      | `plugin: ["<path>.tsx", { options }]`          |
| opencode srv | `opencode.json` | `plugin: ["<path>.ts"]`                        |
| Claude Code  | `settings.json` | `statusLine.command: "<path>.sh"` / `hooks: …` |

## Design principles every plugin inherits

1. **Starship parity where possible.** Delegate to `starship prompt` or `starship module <name>` for shell-like surfaces so the harness chrome moves in lockstep with the user's real shell.
2. **Entity outfit theming.** Pull hue/saturation from `~/.<entity>/passenger.json` for accents. Every kingdom surface should recognize itself by color.
3. **XDG state paths, rooted-only recording.** Plugin state goes to `~/.<entity>/.local/state/harness/<sensor>.json`, gated on `KOAD_IO_ROOTED=true`.
4. **One self-awareness row shape.** The canonical "harness self-awareness ribbon" grammar — `timestamp ❯ provider · model · ctx · cost` — is consistent across harnesses.
5. **Fail quiet, never block the harness.** Renders nothing on error rather than throwing. The harness is host; the plugin is a guest.
6. **No secret handling.** Plugins live in a public framework tree. Secrets stay in `~/.<entity>/.credentials`.

## Inventory

| Plugin | Harness | Status | Description |
|--------|---------|--------|-------------|
| `opencode/shell-git` | opencode TUI | unverified | Git-state ribbon in prompt-right slots |

## How to add a new plugin

1. Create `~/.koad-io/plugins/<harness>/<name>/` with a PRIMER.md.
2. Follow the harness's plugin ABI.
3. Inherit the design principles above.
4. If first instance for a new harness, document the wiring contract in this PRIMER.
5. File a reference against `koad/vesta#101` (umbrella spec).

## Related

- `~/.koad-io/PRIMER.md` — framework overview
- `~/.koad-io/hooks/PRIMER.md` — lifecycle hooks (different from plugins)
- `~/.koad-io/commands/PRIMER.md` — shell commands (different from plugins)
- `koad/vesta#101` — umbrella spec

---

*Livy walked this folder 2026-05-10. One opencode shelf with one plugin (shell-git). claude/ and pi/ shelves are reserved placeholders (no files yet).*
