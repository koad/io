/**
 * koad-io status tool — kingdom operational pulse.
 *
 * Wraps ~/.koad-io/bin/status — queries daemon health, active flights,
 * recent emissions, and active sessions.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as cp from "node:child_process";
import * as os from "node:os";
import { Type } from "typebox";

const HOME = os.homedir();
const STATUS_BIN = `${HOME}/.koad-io/bin/status`;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerStatusTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "status",
    label: "Kingdom Status",
    description: [
      "Kingdom operational pulse — daemon health, active flights, recent emissions, sessions.",
      "Sub-commands: (default overview), daemon, flights, emissions, sessions.",
      "Add --json for raw output.",
    ].join("\n"),
    promptSnippet: "Check kingdom status (sub: daemon|flights|emissions|sessions)",
    promptGuidelines: [
      "Use status for a quick kingdom overview before making decisions.",
      "Use status flights to see what's airborne.",
      "Use status sessions to see who's online.",
    ],
    parameters: Type.Object({
      sub: Type.Optional(Type.String({
        description: "Sub-command: daemon, flights, emissions, sessions. Omit for overview.",
      })),
      json: Type.Optional(Type.Boolean({
        description: "Return raw JSON instead of formatted text.",
      })),
    }),

    async execute(_toolCallId, params) {
      const args: string[] = [];
      if (params.sub) args.push(params.sub);
      if (params.json) args.push("--json");

      const cmd = `${STATUS_BIN} ${args.join(" ")}`;
      let stdout = "";
      let stderr = "";
      let exitCode = 1;

      try {
        const result = cp.spawnSync("bash", ["-c", cmd], {
          env: process.env,
          timeout: 8000,
          stdio: "pipe",
          maxBuffer: 256 * 1024,
        });
        stdout = (result.stdout || "").toString().trim();
        stderr = (result.stderr || "").toString().trim();
        exitCode = result.status ?? 1;
      } catch (err: any) {
        stderr = err.message || "spawn failed";
      }

      if (exitCode !== 0) {
        // Daemon down or degraded — return what we have, don't error
        return {
          content: [{ type: "text", text: stdout || "daemon unreachable" }],
          details: { reachable: false, exitCode, stderr: stderr.slice(0, 200) },
        };
      }

      return {
        content: [{ type: "text", text: stdout.slice(0, 2000) }],
        details: { exitCode, full: stdout.slice(0, 4000) },
      };
    },
  });
}
