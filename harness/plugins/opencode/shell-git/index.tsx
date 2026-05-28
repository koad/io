/** @jsxImportSource @opentui/solid */
//
// shell-git — render a starship-parity git status ribbon into opencode's
// prompt-right slots, so the opencode TUI shows the same branch + worktree
// state glyphs the user sees at their shell.
//
// Target slots:
//   - session_prompt_right    (right side of the in-session prompt)
//   - home_prompt_right       (right side of the home-screen prompt)
//
// Collection strategy:
//   Shell out to `git` against the active worktree (api.state.path.worktree)
//   and emit a compact ribbon of glyphs. We do NOT parse starship's own
//   output — git is faster, hasn't been around a shell config, and gives us
//   structured data we can theme with opencode's current theme RGBAs.
//
// Polling:
//   A 3-second interval by default. Option `interval` (milliseconds) in the
//   plugin options lets an operator tune it. Disposed via lifecycle hook.
//
// Glyph vocabulary (matches koad's starship.toml as of 2026-04-11):
//   🌱 branch      📝 modified   🗃️ staged    🤷 untracked
//   🗑️ deleted    🏎️💨 ahead    🐢 behind
//
// This is a koad:io plugin — see ~/.koad-io/plugins/PRIMER.md for the
// category. Part of the self-awareness ribbon pattern (vesta#101).

import { execFileSync } from "node:child_process"
import { createSignal, onCleanup } from "solid-js"
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiSlotPlugin,
} from "@opencode-ai/plugin/tui"

// ---------- Options --------------------------------------------------------

type Options = {
  interval?: number        // poll interval ms (default 3000)
  enabled?: boolean        // hard disable (default true)
  show_branch?: boolean    // render 🌱branch (default true)
  show_ahead_behind?: boolean
  show_dirty?: boolean
  max_branch_len?: number  // truncate long branch names (default 32)
}

const defaults: Required<Options> = {
  interval: 3000,
  enabled: true,
  show_branch: true,
  show_ahead_behind: true,
  show_dirty: true,
  max_branch_len: 32,
}

const resolve = (o: Options | undefined): Required<Options> => ({
  ...defaults,
  ...(o ?? {}),
})

// ---------- Git collection -------------------------------------------------

type GitState = {
  branch: string | null
  ahead: number
  behind: number
  modified: number
  staged: number
  untracked: number
  deleted: number
  conflicted: number
}

const empty: GitState = {
  branch: null,
  ahead: 0,
  behind: 0,
  modified: 0,
  staged: 0,
  untracked: 0,
  deleted: 0,
  conflicted: 0,
}

const git = (cwd: string, args: string[]): string => {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim()
  } catch {
    return ""
  }
}

// Parse `git status --porcelain=v2 --branch` into a GitState.
// v2 is stable, parseable, and tells us ahead/behind in the header.
const collect = (worktree: string): GitState | null => {
  if (!worktree) return null
  // Cheap rejection: not a git dir → bail.
  const inside = git(worktree, ["rev-parse", "--is-inside-work-tree"])
  if (inside !== "true") return null

  const out = git(worktree, ["status", "--porcelain=v2", "--branch"])
  if (!out) return { ...empty }

  const state: GitState = { ...empty }

  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length)
      state.branch = head === "(detached)" ? null : head
      continue
    }
    if (line.startsWith("# branch.ab ")) {
      // format: "# branch.ab +N -M"
      const m = line.match(/\+(\d+)\s+-(\d+)/)
      if (m) {
        state.ahead = parseInt(m[1], 10)
        state.behind = parseInt(m[2], 10)
      }
      continue
    }
    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Ordinary/renamed: columns 2 = XY (staged/worktree)
      const xy = line.slice(2, 4)
      const x = xy[0]
      const y = xy[1]
      if (x !== "." && x !== "?") state.staged++
      if (y === "M") state.modified++
      if (y === "D") state.deleted++
      continue
    }
    if (line.startsWith("u ")) {
      state.conflicted++
      continue
    }
    if (line.startsWith("? ")) {
      state.untracked++
    }
  }

  return state
}

// ---------- Theme helpers --------------------------------------------------

const ink = (map: Record<string, unknown>, key: string, fallback: string): string => {
  const v = map[key]
  if (typeof v === "string") return v
  // RGBA objects have a toString but we'll pass them through opentui's fg prop
  if (v && typeof v === "object") return v as unknown as string
  return fallback
}

const tone = (api: TuiPluginApi) => {
  const m = api.theme.current as unknown as Record<string, unknown>
  return {
    muted:   ink(m, "textMuted", "#808080"),
    accent:  ink(m, "primary",   "#5f87ff"),
    text:    ink(m, "text",      "#f0f0f0"),
    warning: ink(m, "warning",   "#d7af00"),
    error:   ink(m, "error",     "#ff5f5f"),
    success: ink(m, "success",   "#5fff87"),
    info:    ink(m, "info",      "#5fd7ff"),
  }
}

// ---------- Ribbon component -----------------------------------------------

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + "…"

type Skin = ReturnType<typeof tone>

const renderRibbon = (g: GitState | null, opts: Required<Options>, skin: Skin) => {
  if (!g || !g.branch) return null
  const branchText = truncate(g.branch, opts.max_branch_len)

  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      {opts.show_branch ? (
        <text fg={skin.accent}>🌱{branchText}</text>
      ) : null}
      {opts.show_ahead_behind && g.ahead > 0 ? (
        <text fg={skin.success}>🏎️💨{g.ahead}</text>
      ) : null}
      {opts.show_ahead_behind && g.behind > 0 ? (
        <text fg={skin.warning}>🐢{g.behind}</text>
      ) : null}
      {opts.show_dirty && g.staged > 0 ? (
        <text fg={skin.info}>🗃️{g.staged}</text>
      ) : null}
      {opts.show_dirty && g.modified > 0 ? (
        <text fg={skin.warning}>📝{g.modified}</text>
      ) : null}
      {opts.show_dirty && g.deleted > 0 ? (
        <text fg={skin.error}>🗑️{g.deleted}</text>
      ) : null}
      {opts.show_dirty && g.untracked > 0 ? (
        <text fg={skin.muted}>🤷{g.untracked}</text>
      ) : null}
      {g.conflicted > 0 ? (
        <text fg={skin.error}>✖{g.conflicted}</text>
      ) : null}
    </box>
  )
}

// ---------- Plugin entrypoint ----------------------------------------------

const tui: TuiPlugin = async (api, options) => {
  const opts = resolve(options as Options | undefined)
  if (!opts.enabled) return

  const [state, setState] = createSignal<GitState | null>(null)

  const tick = () => {
    const worktree = api.state.path.worktree
    if (!worktree) {
      setState(null)
      return
    }
    setState(collect(worktree))
  }

  tick()
  const timer = setInterval(tick, Math.max(500, opts.interval))
  api.lifecycle.onDispose(() => clearInterval(timer))
  onCleanup(() => clearInterval(timer))

  const slot: TuiSlotPlugin = {
    slots: {
      session_prompt_right(ctx) {
        return renderRibbon(state(), opts, tone(api))
      },
      home_prompt_right(ctx) {
        return renderRibbon(state(), opts, tone(api))
      },
    },
  }

  api.slots.register(slot)
}

const plugin: TuiPluginModule & { id: string } = {
  id: "koad-io.shell-git",
  tui,
}

export default plugin
