/**
 * koad-io status tool — kingdom operational pulse.
 *
 * Wraps ~/.koad-io/bin/status — queries daemon health, active flights,
 * recent emissions, and active sessions.
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

    renderCall(args: any, theme: any) {
      const sub = args.sub || "overview";
      const flags = args.json ? " --json" : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("status ")) + theme.fg("accent", `${sub}${flags}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result && result.details) ? result.details : {} as Record<string, any>;
      const ok = details.exitCode === 0;
      const content = (result && result.content && result.content[0] && result.content[0].text) ? result.content[0].text : "";
      const linesArr = content.split("\n");
      const firstLine = linesArr.length > 0 ? linesArr[0].slice(0, 120) : "";
      return new Text([
        theme.fg(ok ? "success" : "error", ok ? "✓ status" : `✗ status — ${details.reachable === false ? "unreachable" : `exit ${details.exitCode}`}`),
        `  ${theme.fg("dim", clip(firstLine, expanded ? 480 : 120))}`,
      ].join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal, _onUpdate) {
      // sessions subcommand: scan pi sessions directory directly
      // (the bash status script only handles service health probes)
      if (params.sub === "sessions") {
        return await executeStatusSessions(params);
      }

      const args: string[] = [];
      if (params.sub) args.push(params.sub);
      if (params.json) args.push("--json");

      return new Promise((resolve) => {
        const child = cp.spawn("bash", ["-c", `${STATUS_BIN} ${args.join(" ")}`], {
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        const timeout = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            content: [{ type: "text", text: stdout || "daemon unreachable (timeout)" }],
            details: { reachable: false, exitCode: 1, stderr: stderr.slice(0, 200), timedOut: true },
          });
        }, 8000);

        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        child.on("close", (code) => {
          clearTimeout(timeout);
          const exitCode = code != null ? code : 1;
          if (exitCode !== 0) {
            resolve({
              content: [{ type: "text", text: stdout || "daemon unreachable" }],
              details: { reachable: false, exitCode, stderr: stderr.slice(0, 200) },
            });
            return;
          }
          resolve({
            content: [{ type: "text", text: stdout.slice(0, 2000) }],
            details: { exitCode, full: stdout.slice(0, 4000) },
          });
        });

        child.on("error", () => {
          clearTimeout(timeout);
          resolve({
            content: [{ type: "text", text: stdout || "daemon unreachable" }],
            details: { reachable: false, exitCode: 1 },
          });
        });
      });
    },
  });
}

// ── status sessions: scan pi sessions directory ────────────────────────────

interface SessionBrief {
  entity: string;
  id: string;
  cwd: string;
  created: string;
  mtime: number;
  model: string;
  turns: number;
}

function walkSessionFiles(dir: string, maxDepth = 3, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const files: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSessionFiles(full, maxDepth, depth + 1));
    } else if (entry.name.endsWith(".jsonl")) {
      files.push(full);
    }
  }
  return files;
}

function scanSessionBrief(filePath: string): SessionBrief | null {
  try {
    const firstLine = fs.readFileSync(filePath, "utf-8").split("\n")[0];
    if (!firstLine) return null;
    const header = JSON.parse(firstLine);
    if (header.type !== "session" || !header.id) return null;

    const stat = fs.statSync(filePath);
    let model = "?";
    let turns = 0;

    // Quick scan — just first 100 lines for model/turns
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").slice(0, 100);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "model_change" && model === "?") {
          model = entry.modelId || "?";
        }
        if (entry.type === "message" && entry.message?.role === "user") {
          turns++;
        }
      } catch { /* skip */ }
    }

    // Entity from parent dir name: "--home-koad-.vulcan--" → "vulcan"
    const parentDir = path.basename(path.dirname(filePath));
    const entity = parentDir.replace(/^--home-[^-]+-\./, "").replace(/--$/, "") || "?";

    return {
      entity,
      id: header.id,
      cwd: header.cwd || "?",
      created: header.timestamp || "?",
      mtime: stat.mtimeMs,
      model,
      turns,
    };
  } catch {
    return null;
  }
}

function timeAgoShort(ms: number): string {
  const diff = Date.now() - ms;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

async function executeStatusSessions(params: any) {
  const HOME = os.homedir();
  const sessionsDir = path.join(HOME, ".koad-io", "harness", "sessions");
  const files = walkSessionFiles(sessionsDir);

  const sessions: SessionBrief[] = [];
  for (const file of files) {
    const s = scanSessionBrief(file);
    if (s) sessions.push(s);
  }

  // Group: active (last 2h) vs recent (last 24h)
  const now = Date.now();
  const active = sessions.filter(s => now - s.mtime < 2 * 3600 * 1000);
  const recent = sessions.filter(s => now - s.mtime >= 2 * 3600 * 1000 && now - s.mtime < 24 * 3600 * 1000);

  // Count by entity
  const byEntity: Record<string, SessionBrief[]> = {};
  for (const s of active) {
    (byEntity[s.entity] ??= []).push(s);
  }

  const lines: string[] = [];
  lines.push(`── koad:io sessions ──`);
  lines.push(`  total: ${sessions.length} session files on disk`);
  lines.push(`  active (≤2h): ${active.length}`);
  lines.push(`  recent (≤24h): ${recent.length}`);
  lines.push("");

  if (active.length > 0) {
    lines.push("── active ──");
    const sorted = Object.entries(byEntity).sort(([, a], [, b]) => b.length - a.length);
    for (const [entity, sess] of sorted) {
      const latest = sess.sort((a, b) => b.mtime - a.mtime)[0];
      lines.push(`  ● ${entity}  ·  ${sess.length} session${sess.length > 1 ? "s" : ""}  ·  latest ${timeAgoShort(latest.mtime)} ago  ·  ${latest.model}  ·  ${latest.turns}t`);
    }
  } else {
    lines.push("  no active sessions (none touched in last 2h)");
  }
  lines.push("");

  // Show recent entities
  if (recent.length > 0) {
    const recentByEntity: Record<string, SessionBrief[]> = {};
    for (const s of recent) {
      (recentByEntity[s.entity] ??= []).push(s);
    }
    lines.push("── recent (2h–24h) ──");
    const sorted = Object.entries(recentByEntity).sort(([, a], [, b]) => b.length - a.length).slice(0, 8);
    for (const [entity, sess] of sorted) {
      lines.push(`  ◐ ${entity}  ·  ${sess.length} session${sess.length > 1 ? "s" : ""}`);
    }
  }

  const text = lines.join("\n");
  return {
    content: [{ type: "text", text }],
    details: { sessions: active.length, total: sessions.length, active, recent, byEntity },
  };
}
