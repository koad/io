/**
 * koad-io kingdom hook shims for the Pi harness.
 *
 * Bridges Pi's extension API to the kingdom bash hook scripts:
 *   session_start → standing-watchers.sh (blocking) + session-harvest.sh (async)
 *   input         → prompt-awareness.sh  (blocking, transforms user text if output non-empty)
 *
 * These are the Pi equivalents of Claude Code's SessionStart and UserPromptSubmit hooks.
 * "input" source="rpc" fires in -p dispatch mode too, so awareness runs there as well.
 */

import type { ExtensionAPI, InputEventResult } from "@earendil-works/pi-coding-agent";
import { execSync, spawn } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

const HOME = os.homedir();
const FORGE_HOOKS = path.join(HOME, ".forge", "hooks");

function hookPath(name: string): string {
  return path.join(FORGE_HOOKS, name);
}

export default function (pi: ExtensionAPI): void {
  // ── session_start ─────────────────────────────────────────────────────────
  pi.on("session_start", (_event, ctx) => {
    // Write kingdom lifecycle IDs as a CustomEntry so the Pi session jsonl is
    // self-describing. Does NOT enter LLM context — extension state only.
    try {
      pi.appendEntry("koad-io", {
        flightId: process.env.HARNESS_CONTROL_FLIGHT_ID || undefined,
        emissionId: process.env.HARNESS_EMISSION_ID || undefined,
        parentEmissionId: process.env.HARNESS_PARENT_EMISSION_ID || undefined,
        sessionToken: process.env.KOAD_IO_MCP_SESSION_TOKEN || undefined,
        harnessSessionId: process.env.HARNESS_SESSION_ID || undefined,
        entity: process.env.ENTITY || undefined,
      });
    } catch (_) {}

    // Register standing watchers for this session (blocking — must complete before agent runs)
    try {
      execSync(hookPath("standing-watchers.sh"), {
        env: process.env,
        stdio: "ignore",
        timeout: 8000,
      });
    } catch (_) {}

    // Session harvest — fire-and-forget (writes session state to disk async)
    try {
      spawn(hookPath("session-harvest.sh"), [], {
        env: process.env,
        stdio: "ignore",
        detached: true,
      }).unref();
    } catch (_) {}
  });

  // ── input (UserPromptSubmit equivalent) ───────────────────────────────────
  pi.on("input", (event, _ctx): InputEventResult | void => {
    // Only fire on user-originated and rpc input, not on extension re-submissions
    if (event.source === "extension") return { action: "continue" };

    let awareness = "";
    try {
      awareness = execSync(hookPath("prompt-awareness.sh"), {
        env: process.env,
        encoding: "utf-8",
        timeout: 8000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch (_) {}

    if (!awareness) return { action: "continue" };

    return {
      action: "transform",
      text: `<system-reminder>\n${awareness}\n</system-reminder>\n\n${event.text}`,
    };
  });
}
