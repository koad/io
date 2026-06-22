/**
 * meteor_shell — run JS on a live Meteor server via the native `meteor shell` CLI.
 *
 * Writes code to a .js file in ~/.koad-io/harness/meteor-shell/<entity>/
 * (safe from entity deletion — outside bond-gate write scope),
 * then runs `cd <target>/src/ && meteor shell <file>`.
 *
 * The file persists alongside session artifacts for auditability.
 *
 * Targets are discovered dynamically from the kingdom service registry at
 * ~/.local/share/koad-io/runtime/services.jsonl. Any service with a
 * <datadir>/src/.meteor directory becomes a valid shell target.
 * Backwards-compat aliases (control, live) are auto-added.
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

// ── dynamic target discovery from kingdom service registry ─────────

function buildTargetDirs(): Record<string, string> {
  const targets: Record<string, string> = {};
  const servicesPath = `${HOME}/.local/share/koad-io/runtime/services.jsonl`;

  try {
    const content = fs.readFileSync(servicesPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const svc = JSON.parse(trimmed);
        const meteorDir = `${svc.datadir}/src/.meteor`;
        if (svc.name && svc.datadir && fs.existsSync(meteorDir)) {
          targets[svc.name] = `${svc.datadir}/src/`;
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  } catch {
    // services.jsonl unreadable — targets stays empty, tool will report unknown
  }

  // backwards-compat aliases (original hardcoded names)
  if (targets["control-tower"] && !targets["control"]) {
    targets["control"] = targets["control-tower"];
  }
  if (targets["websites-koad-live"] && !targets["live"]) {
    targets["live"] = targets["websites-koad-live"];
  }

  return targets;
}

const TARGET_DIRS: Record<string, string> = buildTargetDirs();

const SHELL_BASE = `${HOME}/.koad-io/harness/meteor-shell`;

// ---------------------------------------------------------------------------
// Core runner — also exported for ddp.ts publications sub-command
// ---------------------------------------------------------------------------

export interface MeteorShellResult {
  output: string;
  filePath: string;
  error?: string;
}

/**
 * Run JS code against a Meteor server via the native `meteor shell` CLI.
 *
 * Saves the code to a timestamped file in the harness meteor-shell directory,
 * then runs `cd <target-dir> && meteor shell <file>`.
 * The file is kept for session records — it lives outside entity write scope.
 */
export function runMeteorShell(target: string, code: string): MeteorShellResult {
  const entity = process.env.ENTITY ?? "unknown";
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const dir = path.join(SHELL_BASE, entity);
  const filePath = path.join(dir, `${ts}-${rand}.js`);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, code, "utf-8");

  const targetDir = TARGET_DIRS[target];
  if (!targetDir) {
    return { output: "", filePath, error: `Unknown target: ${target}` };
  }

  try {
    const stdout = cp.execSync(`cd ${targetDir} && meteor shell < ${filePath}`, {
      timeout: 60_000,
      encoding: "utf-8",
      env: { ...process.env, METEOR_PROFILE: "" },
    });
    return { output: stdout.trim(), filePath };
  } catch (err: any) {
    const stderr = err.stderr?.toString() || err.message || String(err);
    const stdout = err.stdout?.toString() || "";
    return { output: stdout.trim(), filePath, error: stderr.trim() };
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMeteorShellTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "meteor_shell",
    label: "Meteor Shell",
    description: [
      "Run arbitrary JavaScript code on a live Meteor server via the native `meteor shell` CLI.",
      "Code is saved to a .js file under ~/.koad-io/harness/meteor-shell/<entity>/ and",
      "executed against the target server's running Meteor process.",
      "",
      "The file persists alongside session artifacts for auditability.",
      "",
      "Targets are discovered dynamically from the kingdom service registry",
      "(~/.local/share/koad-io/runtime/services.jsonl). Any registered service",
      "with a src/.meteor directory is a valid target.",
      "'all' fans to control + daemon + live in parallel.",
      "The target server must have a running Meteor process.",
    ].join("\n"),
    promptSnippet: "meteor_shell <code> on control|daemon|live|all",
    promptGuidelines: [
      "Use meteor_shell to run JS expressions on a live Meteor server for debugging.",
      "Targets are discovered from the kingdom service registry. Use canonical service names or backwards-compat aliases (control, daemon, live). 'all' fans to control + daemon + live.",
      "The code runs server-side with full Meteor context — be careful with mutations.",
      "Use JSON.stringify() for structured output that parses cleanly.",
    ],
    parameters: Type.Object({
      code: Type.String({
        description: "JavaScript code to evaluate. Multi-statement blocks supported — split on ; and newlines. let/const/var declarations are hoisted for subsequent statements.",
      }),
      target: Type.Optional(Type.String({
        description: "Which server to target. Canonical names from services.jsonl (e.g. 'control-tower', 'musium'), backwards-compat aliases ('control', 'daemon', 'live'), or 'all' (fans to control+daemon+live). Default: 'control'.",
        default: "control",
      })),
    }),

    renderCall(args: any, theme: any) {
      const target = args.target || "control";
      const codePreview = clip(String(args.code != null ? args.code : ""), 80);
      return new Text([
        theme.fg("toolTitle", theme.bold("meteor_shell ")) + theme.fg("accent", `on ${target}`),
        `  ${theme.fg("dim", codePreview)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const content = (result && result.content && result.content[0] && result.content[0].text) ? result.content[0].text : "";
      const details = (result && result.details) ? result.details : {} as Record<string, any>;
      const ok = !details.error;
      const linesArr = content.split("\n");
      const firstLine = linesArr.length > 0 ? linesArr[0].slice(0, 120) : "";
      const showContent = expanded ? clip(content, 480) : firstLine;
      const suffix = !expanded && linesArr.length > 1 ? " …" : "";
      const tgt = details.target != null ? details.target : "?";
      const err = details.error != null ? details.error : "failed";
      const file = details.filePath != null ? ` → ${path.basename(String(details.filePath))}` : "";
      return new Text([
        theme.fg(ok ? "success" : "error", ok ? `✓ ${tgt}${file}` : `✗ ${tgt} — ${err}`),
        `  ${theme.fg("dim", showContent + suffix)}`,
      ].join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const target = (params.target != null ? params.target : "control") as string;
      const code = String(params.code != null ? params.code : "").trim();

      if (!code) {
        return {
          content: [{ type: "text", text: "code is required" }],
          details: { error: "missing code" },
        };
      }

      const validTargets = [...Object.keys(TARGET_DIRS), "all"];
      if (!validTargets.includes(target)) {
        return {
          content: [{ type: "text", text: `target must be one of: ${validTargets.join(', ')}, got '${target}'` }],
          details: { error: "invalid target" },
        };
      }

      // ── target: 'all' — fan to control + daemon + live ──────────────
      if (target === "all") {
        const fanTargets = ["control", "daemon", "live"] as const;
        const results: Record<string, { output: string; error?: string; filePath: string }> = {};
        for (const t of fanTargets) {
          const r = runMeteorShell(t, code);
          results[t] = { output: r.output, filePath: r.filePath };
          if (r.error) results[t].error = r.error;
        }
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          details: { target: "all" },
        };
      }

      // ── single target ──────────────────────────────────────────────
      const result = runMeteorShell(target, code);
      if (result.error && !result.output) {
        return {
          content: [{ type: "text", text: `meteor shell failed on ${target}: ${result.error}` }],
          details: { error: result.error, target, filePath: result.filePath },
        };
      }
      return {
        content: [{ type: "text", text: result.output || "(no output)" }],
        details: { target, filePath: result.filePath },
      };
    },
  });
}
