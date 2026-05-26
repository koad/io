/**
 * koad-io tool — passthrough to ~/.koad-io/bin/koad-io.
 *
 * The framework binary handles the full command cascade: env, credentials,
 * hooks, command routing, and emissions. This tool (and the /koad-io
 * slash command) just pass through typed arguments.
 *
 * Usage:
 *   koad-io announce <body>         → kingdom-wide signal
 *   koad-io message <to> <body>     → drop a note in an inbox
 *   koad-io tickle <to> <body>      → deferred reminder
 *   koad-io pin <ref> [tags...]     → lightweight coordination anchor
 *   koad-io session <sub> [args]    → session awareness
 *   koad-io emit <body>             → fire an emission
 *   koad-io <any-cascade-command>   → passthrough to whatever is available
 *
 * /koad-io slash command: same passthrough, output via notification.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as cp from "node:child_process";
import * as os from "node:os";
import { Type } from "typebox";

const HOME = os.homedir();
const KOAD_IO_BIN = process.env.KOAD_IO_BIN || `${HOME}/.koad-io/bin/koad-io`;

function execKoadio(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const cmd = `${KOAD_IO_BIN} ${args.map(a => JSON.stringify(a)).join(" ")}`;
  try {
    const result = cp.spawnSync("bash", ["-c", cmd], {
      env: process.env,
      cwd: process.cwd(),
      timeout: 15000,
      stdio: "pipe",
    });
    return {
      stdout: (result.stdout || "").toString().trim(),
      stderr: (result.stderr || "").toString().trim(),
      exitCode: result.status ?? 1,
    };
  } catch (err: any) {
    return { stdout: "", stderr: err.message || "spawn failed", exitCode: 1 };
  }
}

export function registerKoadioTool(pi: ExtensionAPI): void {
  // ── Tool registration ─────────────────────────────────────────
  pi.registerTool({
    name: "koad-io",
    label: "koad-io",
    description: [
      "Kingdom command router — typed gateway to the koad:io command cascade.",
      "Available: announce, build, channel, commit, configure, console, conversation, dance-hall, drift, emit, feedback, gestate, git, harness, identity, init, inspect, install, invite, io, kadira, kanban, kingdom, message, outfit, party, pin, play, probe, profile, publish, rebuild, recon, respond, restart, roles, session, shell, shot, sign, spawn, start, status, stop, test, think, tickle, trust-bond-viewer, upload, upstart, usage, wait.",
      "Common: announce, message, tickle, pin, session, emit, conversation, git.",
      "Each invocation goes through the entity launcher (full env cascade + hooks).",
    ].join("\n"),
    promptSnippet: "Run kingdom command (command, sub, to, body, ...) — see description for all sub-actions",
    promptGuidelines: [
      "Use koad-io announce <body> for kingdom-wide signals.",
      "Use koad-io message <to> <body> to drop a note in another entity's inbox.",
      "Use koad-io tickle <to> <body> for deferred reminders.",
      "Use koad-io pin <ref> <tags> to anchor a coordination point.",
      "Use koad-io session <sub> for objective/land/watch.",
      "All commands are auditable — emissions fire automatically.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Command name. Available: announce, build, channel, commit, configure, console, conversation, dance-hall, drift, emit, feedback, gestate, git, harness, identity, init, inspect, install, invite, io, kadira, kanban, kingdom, message, outfit, party, pin, play, probe, profile, publish, rebuild, recon, respond, restart, roles, session, shell, shot, sign, spawn, start, status, stop, test, think, tickle, trust-bond-viewer, upload, upstart, usage, wait." }),
      sub: Type.Optional(Type.String({ description: "Sub-command for session, conversation, git." })),
      to: Type.Optional(Type.String({ description: "Recipient for message, tickle." })),
      body: Type.Optional(Type.String({ description: "Body text for announce, message, tickle, emit, conversation." })),
      ref: Type.Optional(Type.String({ description: "Reference for pin." })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for pin." })),
      args: Type.Optional(Type.String({ description: "Additional arguments for git, session, or passthrough commands." })),
      type: Type.Optional(Type.String({ description: "Emission type for emit (notice, warning, error)." })),
      slug: Type.Optional(Type.String({ description: "Topic slug for conversation." })),
    }),

    async execute(_toolCallId, params) {
      const cmd = params.command as string;
      const execArgs: string[] = [cmd];

      // Map typed fields to positional args in the order the binary expects
      if (params.sub)   execArgs.push(params.sub);
      if (params.to)    execArgs.push(params.to);
      if (params.body)  execArgs.push(params.body);
      if (params.ref)   execArgs.push(params.ref);
      if (params.tags)  execArgs.push(...params.tags);
      if (params.args)  execArgs.push(params.args);

      const result = execKoadio(execArgs);

      if (result.exitCode !== 0) {
        const err = result.stderr.slice(0, 300) || `exit ${result.exitCode}`;
        return {
          content: [{ type: "text", text: `✗ ${cmd}: ${err}` }],
          details: { command: cmd, args: execArgs, exitCode: result.exitCode, stderr: result.stderr.slice(0, 500) },
        };
      }

      const out = result.stdout || `✓ ${cmd}`;
      return {
        content: [{ type: "text", text: out.slice(0, 3000) }],
        details: { command: cmd, args: execArgs, exitCode: 0, stdout: result.stdout },
      };
    },
  });

  // ── /koad-io slash command ─────────────────────────────────────
  pi.registerCommand("koad-io", {
    description: "Run a koad:io command through the framework binary",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/);
      const result = execKoadio(parts);
      const out = result.stdout || (result.exitCode === 0 ? `✓ ${parts[0]}` : result.stderr.slice(0, 200));

      // Send full output as message so nothing is truncated
      ctx.ui.sendMessage(
        result.exitCode === 0
          ? `\`\`\`\n${out.slice(0, 2000)}\n\`\`\``
          : `✗ **${parts[0]}**: ${result.stderr.slice(0, 500)}`,
      );
    },
  });
}
