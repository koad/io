/**
 * meteor_shell — run arbitrary JS expressions against a Meteor server's DDP connection.
 *
 * Calls the eval.server DDP method on either control-tower or daemon.
 * The target server must have eval.server registered (control-tower: src/server/eval.js).
 *
 * Used by: juno (and other entities) to introspect live Meteor servers.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getDDPClient } from "../ddp";

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMeteorShellTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "meteor_shell",
    label: "Meteor Shell",
    description: [
      "Run arbitrary JavaScript code on a live Meteor server (control-tower or daemon)",
      "via the eval.server DDP method. Returns { result, error } where exactly one",
      "is non-null.",
      "",
      "The target server must have the eval.server DDP method registered.",
      "Currently available on control-tower (after this deployment).",
    ].join("\n"),
    promptSnippet: "meteor_shell <code> on control|daemon",
    promptGuidelines: [
      "Use meteor_shell to run JS expressions on a live Meteor server for debugging.",
      "Target 'control' for control-tower, 'daemon' for the daemon.",
      "The code runs server-side with full Meteor context — be careful with mutations.",
      "Only localhost connections are accepted by eval.server (safety gate).",
    ],
    parameters: Type.Object({
      code: Type.String({
        description: "JavaScript code to evaluate on the server. Can be an expression or block.",
      }),
      target: Type.Optional(Type.String({
        description: "Which server to target: 'control' (control-tower) or 'daemon'. Default: 'control'.",
        default: "control",
      })),
    }),

    async execute(_toolCallId, params) {
      const target = (params.target as string) ?? "control";
      const code = String(params.code ?? "").trim();

      if (!code) {
        return {
          content: [{ type: "text", text: "code is required" }],
          details: { error: "missing code" },
        };
      }

      // Validate target
      if (target !== "control" && target !== "daemon") {
        return {
          content: [{ type: "text", text: `target must be 'control' or 'daemon', got '${target}'` }],
          details: { error: "invalid target" },
        };
      }

      const client = getDDPClient(target);
      if (!client) {
        return {
          content: [{ type: "text", text: `No DDP client for '${target}'. Is DDP connected?` }],
          details: { error: "no ddp client" },
        };
      }

      if (!client.isConnected) {
        return {
          content: [{ type: "text", text: `DDP to '${target}' is not connected.` }],
          details: { error: "ddp disconnected" },
        };
      }

      try {
        const raw = await client.call("eval.server", code);
        return {
          content: [{ type: "text", text: JSON.stringify(raw, null, 2) }],
          details: { target, method: "eval.server" },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `eval.server failed: ${err.message || err}` }],
          details: { error: err.message, target },
        };
      }
    },
  });
}
