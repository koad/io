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
import { Text } from "@earendil-works/pi-tui";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { clipText as clip } from "../utils/tool-render";

const HOME = os.homedir();
const KOAD_IO_BIN = process.env.KOAD_IO_BIN || `${HOME}/.koad-io/bin/koad-io`;

function resolveCascadeLauncher(): string {
  const entity = String(process.env.ENTITY || "").trim().toLowerCase();
  if (!entity) return KOAD_IO_BIN;
  const entityLauncher = path.join(HOME, ".koad-io", "bin", entity);
  return fs.existsSync(entityLauncher) ? entityLauncher : KOAD_IO_BIN;
}

function summarizeCall(params: any): string {
  const parts = [params.sub, params.to, params.ref, params.slug, params.type, params.args]
    .filter(Boolean)
    .map(v => String(v));
  if (params.tags?.length) parts.push(`#${params.tags.join(" #")}`);
  if (params.body) parts.push(params.body);
  return parts.join(" · ") || "no additional args";
}

function shellSplit(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      if (ch === inQuote) { inQuote = null; continue; }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) { result.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);
  return result;
}

function execKoadio(args: string[], explicitCwd?: string, timeoutSec?: number): { stdout: string; stderr: string; exitCode: number; cwd: string } {
  const launcher = resolveCascadeLauncher();
  const cmd = `${launcher} ${args.map(a => JSON.stringify(a)).join(" ")}`;
  // Resolve CWD: explicit override > HARNESS_WORK_DIR > entity home > process.cwd()
  const entity = String(process.env.ENTITY || "").trim().toLowerCase();
  const entityHome = entity ? path.join(HOME, `.${entity}`) : undefined;
  const cwd = explicitCwd
    || process.env.HARNESS_WORK_DIR
    || (entityHome && fs.existsSync(entityHome) ? entityHome : undefined)
    || process.cwd();
  try {
    const result = cp.spawnSync("bash", ["-c", cmd], {
      env: process.env,
      cwd,
      timeout: (timeoutSec ?? 300) * 1000,
      stdio: "pipe",
    });
    return {
      stdout: (result.stdout || "").toString().trim(),
      stderr: (result.stderr || "").toString().trim(),
      exitCode: result.status ?? 1,
      cwd,
    };
  } catch (err: any) {
    return { stdout: "", stderr: err.message || "spawn failed", exitCode: 1, cwd };
  }
}

export function registerKoadioTool(pi: ExtensionAPI): void {
  // ── Tool registration ─────────────────────────────────────────
  pi.registerTool({
    name: "koad-io",
    label: "koad-io",
    description: [
      "Kingdom command router — typed gateway to the koad:io command cascade.",
      "Available: announce, brief, build, channel, commit, configure, console, conversation, dance-hall, drift, emit, feedback, gestate, git, harness, identity, inbox, init, inspect, install, invite, io, kadira, kanban, kingdom, message, obligation, outfit, party, pin, play, probe, profile, publish, rebuild, recon, respond, restart, roles, session, shell, shot, sign, spawn, start, status, stop, surface, test, think, tickle, trust-bond-viewer, upload, upstart, usage, wait.",
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
      args: Type.Optional(Type.String({ description: "Additional arguments (single string, space-split). Prefer args_list for multi-word args." })),
      args_list: Type.Optional(Type.Array(Type.String(), { description: "Additional arguments as an array. Preferred over args — no splitting needed." })),
      cwd: Type.Optional(Type.String({ description: "Working directory override. Default: HARNESS_WORK_DIR > entity home > session CWD." })),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)." })),
      type: Type.Optional(Type.String({ description: "Emission type for emit (notice, warning, error)." })),
      slug: Type.Optional(Type.String({ description: "Topic slug for conversation." })),
    }),

    renderCall(args: any, theme: any) {
      const cwdHint = args.cwd ? ` @ ${args.cwd.replace(/^\/home\/koad/, "~")}` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("koad-io ")) + theme.fg("accent", `${args.command || "?"}${cwdHint}`),
        `  ${theme.fg("dim", summarizeCall(args))}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const command = details.command ?? "?";
      const ok = details.exitCode === 0;
      const cwdLabel = details.cwd ? ` @ ${details.cwd.replace(/^\/home\/koad/, "~")}` : "";
      const summary = ok
        ? clip(details.stdout || `✓ ${command}`, expanded ? 320 : 160)
        : clip(details.stderr || `exit ${details.exitCode ?? 1}`, expanded ? 320 : 160);
      const lines = [
        theme.fg(ok ? "success" : "error", ok ? `✓ ${command}${cwdLabel}` : `✗ ${command}${cwdLabel}`),
        `  ${theme.fg("dim", summary)}`,
      ];
      if (expanded && details.args?.length) lines.push(`  ${theme.fg("dim", `args: ${details.args.join(" · ")}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const cmd = params.command as string;
      const execArgs: string[] = [cmd];

      // Map typed fields to positional args in the order the binary expects
      if (params.sub)   execArgs.push(params.sub);
      if (params.to)    execArgs.push(params.to);
      if (params.body)  execArgs.push(params.body);
      if (params.ref)   execArgs.push(params.ref);
      if (params.tags)  execArgs.push(...params.tags);
      if (params.args_list?.length) {
        execArgs.push(...params.args_list);
      } else if (params.args) {
        // shell-split args string so "-m 'msg with spaces'" becomes separate argv entries
        for (const a of shellSplit(params.args)) execArgs.push(a);
      }

      const result = execKoadio(execArgs, params.cwd as string | undefined, params.timeout as number | undefined);

      const out = (result.stdout || "").slice(0, 4000);
      const err = (result.stderr || "").slice(0, 2000);
      const exitOk = result.exitCode === 0;

      let text = exitOk ? (out || `✓ ${cmd}`) : `✗ ${cmd} (exit ${result.exitCode})\n${err || out}`;
      if (exitOk && err) text += `\nstderr: ${err.slice(0, 500)}`;

      return {
        content: [{ type: "text", text: text.slice(0, 5000) }],
        details: { ...params, command: cmd, args: execArgs, cwd: result.cwd, exitCode: result.exitCode, stdout: out, stderr: err },
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

      // Send full output as a displayed custom message so nothing is truncated
      pi.sendMessage({
        customType: "koad-io-command",
        content: result.exitCode === 0
          ? `\`\`\`\n${out.slice(0, 2000)}\n\`\`\``
          : `✗ **${parts[0]}**: ${result.stderr.slice(0, 500)}`,
        display: true,
        details: { command: parts[0], exitCode: result.exitCode },
      }, { deliverAs: "nextTurn" });
    },
  });
}
