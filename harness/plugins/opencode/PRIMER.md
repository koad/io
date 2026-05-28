---
type: primer
folder: ~/.koad-io/plugins/opencode/
parents:
  - ~/.koad-io/plugins/
children:
  - path: shell-git/
    blurb: Starship-parity git-state ribbon in opencode prompt-right slots — polled via git status --porcelain=v2
    status: documented
features:
  - name: plugin-opencode-shell-git
    blurb: Compact git ribbon (branch, ahead/behind, staged/modified/deleted/untracked) using opencode's TuiSlotPlugin API
    location: ~/.koad-io/plugins/opencode/shell-git/index.tsx
relates-to:
  - ~/.koad-io/plugins/PRIMER.md
  - ~/.livy/features/plugin-opencode-shell-git.md
entities:
  - vulcan
  - koad
last-walked: 2026-05-10
as-of: 9c57eb9c808e451840350d1ac32d1ff8ead0c36c
---

# ~/.koad-io/plugins/opencode/ — opencode Harness Shelf

Plugins targeting opencode's TUI and server extension APIs.

## Current plugins

| Plugin | Slot | Status |
|--------|------|--------|
| `shell-git/` | `session_prompt_right`, `home_prompt_right` | written, unverified |

## Wiring opencode plugins into an entity

Add the framework path to the entity's `tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "/home/koad/.koad-io/plugins/opencode/shell-git/index.tsx",
      { "interval": 3000 }
    ]
  ]
}
```

Use absolute paths — relative paths in `tui.json` resolve against the config file's location, not the framework tree.

## Plugin ABI version

These plugins target opencode's `@opencode-ai/plugin/tui` TUI plugin API as of opencode 1.4.x. The plugin types are sourced from `~/.opencode/node_modules/@opencode-ai/plugin/dist/tui.d.ts`. No build step required — opencode loads `.tsx` files directly via its plugin runtime.

## Future plugins on this shelf

Candidates from the design principles in `plugins/PRIMER.md`:

- `identity-ribbon/` — entity name + outfit hue in a TUI slot (mirrors the harness statusline's identity row)
- `quota-warning/` — usage/quota display pulled from daemon state
- `self-awareness-row/` — full `timestamp ❯ provider · model · ctx · cost` ribbon inside opencode TUI

---

*Livy walked 2026-05-10. One plugin on this shelf (shell-git). No tui.json in any current entity dir wires it — the plugin is written but not yet deployed.*
