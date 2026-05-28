# shell-git — opencode git-state ribbon

A koad:io plugin for opencode. Renders a compact git-state ribbon into the TUI's `session_prompt_right` and `home_prompt_right` slots — the right side of the prompt input area. Matches the glyph vocabulary koad's starship config uses, so the opencode chrome picks up where the shell leaves off.

## What you see

When you're in a git worktree, the right side of the opencode prompt gets a strip like:

```
🌱main 🏎️💨2 📝3 🤷1
```

- `🌱main` — current branch
- `🏎️💨2` — 2 commits ahead of upstream
- `🐢1` — 1 commit behind
- `🗃️3` — 3 staged files
- `📝3` — 3 modified (unstaged)
- `🗑️1` — 1 deleted
- `🤷1` — 1 untracked
- `✖1` — 1 conflict (shown red)

When you're not in a git dir (or the branch detaches weirdly), the ribbon renders nothing — the prompt-right slot falls through to whatever else is registered. The plugin fails quiet by design; it's a guest in the harness's chrome.

## How it works

1. On plugin load, reads `api.state.path.worktree` — opencode's active worktree path.
2. Shells out to `git status --porcelain=v2 --branch` against that path (via `node:child_process.execFileSync`, 1-second timeout).
3. Parses the porcelain v2 output into a typed `GitState` object (branch, ahead, behind, staged, modified, deleted, untracked, conflicted).
4. Stores it in a Solid `createSignal` and re-renders slot content whenever the signal changes.
5. Polls on `setInterval(tick, options.interval)` — default 3000ms. Disposed via `api.lifecycle.onDispose`.

No build step. opencode loads the `.tsx` file directly via its plugin runtime. Types come from `@opencode-ai/plugin/tui` (peer dep in opencode's own `node_modules`).

## Wiring it into an entity

Each entity's `tui.json` (inside its `$ENTITY_DIR`) declares its plugins. Add the framework path:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "/home/koad/.koad-io/plugins/opencode/shell-git/index.tsx",
      {
        "interval": 3000,
        "show_branch": true,
        "show_ahead_behind": true,
        "show_dirty": true,
        "max_branch_len": 32
      }
    ]
  ]
}
```

Points to consider:

- **Absolute path.** Relative paths in `tui.json` resolve against the config file's own location. Since the plugin lives in the framework tree and entity `tui.json` files live in entity dirs, prefer absolute paths (or use a symlink inside the entity dir pointing at the framework plugin).
- **Disable selectively.** Set `plugin_enabled["koad-io.shell-git"] = false` in `tui.json` to disable per-entity without removing the plugin declaration.
- **Environment sensitivity.** `git` must be on PATH. The plugin shells out with a 1-second timeout per call; slow git servers won't hang the TUI.

## Options

| Key                 | Default | Description                                         |
|---------------------|---------|-----------------------------------------------------|
| `enabled`           | `true`  | Hard kill switch                                    |
| `interval`          | `3000`  | Poll interval ms (clamped to ≥500)                  |
| `show_branch`       | `true`  | Render `🌱branch`                                   |
| `show_ahead_behind` | `true`  | Render `🏎️💨N` / `🐢N`                             |
| `show_dirty`        | `true`  | Render staged/modified/deleted/untracked glyphs     |
| `max_branch_len`    | `32`    | Truncate long branch names with `…`                 |

## Extending it

This is a single-file plugin. To extend:

**Change glyphs or colors.** Edit the `renderRibbon` function in `index.tsx`. Glyphs are emoji string literals; colors are pulled from `api.theme.current` via the `tone()` helper (`skin.accent`, `skin.success`, `skin.warning`, `skin.error`, etc.). Stay with theme RGBAs rather than hardcoded hex — the plugin automatically follows the user's opencode theme.

**Add a new signal.** For richer data (stash count, last commit hash, repo origin), add a collector that returns a new field on `GitState`, extend the parser, and add a `<text>` node to the ribbon. Keep the glyph vocabulary small and consistent with koad's starship config so the shell and the harness keep visual parity.

**Target a different slot.** The plugin currently renders into `session_prompt_right` and `home_prompt_right`. To also show the ribbon in `home_bottom` or `sidebar_content`, add another entry in the `slots: { … }` object — the slot function signature varies per slot (see `@opencode-ai/plugin/tui` `TuiHostSlotMap`). Check the type definition in `~/.opencode/node_modules/@opencode-ai/plugin/dist/tui.d.ts`.

**Swap polling for events.** The current implementation polls because it's the simplest correct thing. A smarter version could listen on `api.event.on("file.edited", …)` to trigger re-poll on writes, and fall back to a slow interval for external changes. Worth the complexity only if the 3s cadence visibly lags behind user actions.

**Delegate to starship.** For perfect parity with the user's shell config, you could shell out to `starship prompt` or `starship module git_status` inside the worktree, strip ANSI, and pass the raw string through a `<text>` node. Harder to theme with opencode's own colors but keeps the glyph vocabulary user-controlled. Trade-off: you lose the ability to re-color per theme.

## The bigger pattern

This plugin is the first instance of "koad:io plugin for opencode" as a category. See `~/.koad-io/plugins/PRIMER.md` for the category charter — design principles, shelf layout, wiring contract, spec reference (`koad/vesta#101`).

When you add a second plugin (`identity-ribbon`, `quota-warning`, `self-awareness-row`, …), follow the same shape:

1. Single self-contained file (or small dir if you need assets).
2. Inherits the design principles from the category PRIMER.
3. Fails quiet.
4. Themed via `api.theme.current`.
5. Framework-owned, entity-wired.

## Verification status

**Unverified.** This plugin has been written against the opencode 1.4.x TUI plugin API (`@opencode-ai/plugin/tui`) but has not been booted in a live opencode TUI session yet. Known uncertainties:

- Whether `onCleanup` from `solid-js` is the correct cleanup hook alongside `api.lifecycle.onDispose` (both are called defensively).
- Whether the `fg` prop on `<text>` accepts RGBA objects directly or wants strings — the smoke-test plugin mixes both; we pass through whatever `theme.current[key]` returns.
- Whether the 3s interval is felt as laggy vs. snappy in practice.

First boot will surface any issues. See "Troubleshooting" below.

## Troubleshooting

| Symptom                                        | Likely cause / fix                                                          |
|------------------------------------------------|-----------------------------------------------------------------------------|
| No ribbon visible                              | Not in a git dir; or `git` not on PATH; or `enabled: false`; or worktree empty |
| Ribbon shows but branch name only              | Working tree clean (all counters zero) — this is correct                    |
| Ribbon flickers / lags                         | Lower `interval` for snappier, raise for calmer                             |
| `plugin load error: cannot import solid-js`    | `solid-js` is a transitive peer; confirm via `~/.opencode/node_modules/solid-js` |
| Wrong colors                                   | Theme's `primary`/`warning`/`error` missing — fallback hex kicks in         |
| Runtime type errors on `api.state.path.worktree` | Older opencode; requires 1.4.x TUI plugin API                             |

## Files

- `index.tsx` — the plugin
- `PRIMER.md` — this file

## Related

- `~/.koad-io/plugins/PRIMER.md` — category charter
- `~/.juno/memories/project_koad_io_harness_plugins.md` — the concept memory
- `koad/vesta#101` — umbrella spec
- `~/.opencode/node_modules/@opencode-ai/plugin/dist/tui.d.ts` — plugin API types
- `/home/koad/Workbench/opencode/.opencode/plugins/tui-smoke.tsx` — reference plugin (opencode's own smoke test)
- `/home/koad/Workbench/opencode/packages/opencode/specs/tui-plugins.md` — official plugin spec
