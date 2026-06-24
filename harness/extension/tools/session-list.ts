/**
 * session_list — list recent pi sessions with metadata.
 *
 * Scans ~/.koad-io/harness/sessions/ for JSONL session files and extracts
 * session name, model, cwd, timestamps, turn count, tool calls, tokens, cost.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { clipText as clip } from "../utils/tool-render";

const HOME = os.homedir();
// Pi writes sessions to ~/.koad-io/harness/sessions/<entity-slug>/
// KOAD_IO_HARNESS_SESSIONS_DIR (per-entity MCP token dir) is the
// wrong location — it contains only MCP session tokens, not JSONL.
// Use the env var only as an override; default to the pi data dir.
const PI_SESSIONS_DIR = path.join(HOME, ".koad-io", "harness", "sessions");
const SESSIONS_DIR = process.env.KOAD_IO_HARNESS_SESSIONS_DIR_OVERRIDE
  || PI_SESSIONS_DIR;

interface SessionInfo {
  file: string;
  displayPath: string;
  id: string;
  name?: string;
  model?: string;
  provider?: string;
  cwd?: string;
  created?: string;
  turns: number;
  toolCalls: number;
  errors: number;
  tokens: number;
  cost: number;
  mtime: number;
}

function walkSessions(dir: string, maxDepth = 3, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSessions(full, maxDepth, depth + 1));
    } else if (entry.name.endsWith(".jsonl")) {
      files.push(full);
    }
  }
  return files;
}

function readSessionHeader(filePath: string): Partial<SessionInfo> {
  const info: Partial<SessionInfo> = {};
  try {
    const firstLine = fs.readFileSync(filePath, "utf-8").split("\n")[0];
    if (!firstLine) return info;
    const header = JSON.parse(firstLine);
    if (header.type === "session") {
      info.id = header.id;
      info.cwd = header.cwd;
      info.created = header.timestamp;
    }
  } catch {
    // ignore parse errors
  }
  return info;
}

function scanSession(filePath: string): SessionInfo | null {
  const header = readSessionHeader(filePath);
  if (!header.id) return null;

  const stat = fs.statSync(filePath);

  let name: string | undefined;
  let model: string | undefined;
  let provider: string | undefined;
  let turns = 0;
  let toolCalls = 0;
  let errors = 0;
  let tokens = 0;
  let cost = 0;

  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const etype = entry.type;

        if (etype === "session_info" && entry.name && !name) {
          name = entry.name;
        }
        if (etype === "model_change") {
          model = entry.modelId;
          provider = entry.provider;
        }
        if (etype === "message") {
          const role = entry.message?.role;
          if (role === "user") turns++;
          if (role === "assistant") {
            const usage = entry.message?.usage;
            if (usage) {
              tokens += (usage.input || 0) + (usage.output || 0);
              const c = usage.cost;
              if (typeof c === "number") cost += c;
              else if (c?.total) cost += c.total;
            }
            // Also count tool calls/results in assistant message content
            const content = entry.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "toolCall" || block.type === "tool_use") toolCalls++;
                if (block.type === "toolResult" && block.isError) errors++;
              }
            }
          }
        }
        // Top-level tool_call / tool_result entries (pi mode)
        if (etype === "tool_call") toolCalls++;
        if (etype === "tool_result" && entry.isError) errors++;
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    return null;
  }

  const displayPath = filePath.replace(HOME, "~");

  return {
    file: filePath,
    displayPath,
    id: header.id,
    name,
    model,
    provider,
    cwd: header.cwd,
    created: header.created,
    turns,
    toolCalls,
    errors,
    tokens,
    cost,
    mtime: stat.mtimeMs,
  };
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function formatCost(n: number): string {
  return `$${n.toFixed(3)}`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSessionListTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "session_list",
    label: "Session List",
    description: [
      "List recent pi sessions with metadata — name, model, cwd, turns,",
      "tool calls, tokens, cost, and age.",
      "Scans the pi harness sessions directory.",
    ].join("\n"),
    promptSnippet: "List recent sessions (limit?, cwd filter?)",
    promptGuidelines: [
      "Use session_list to find a past session by name, cwd, or model.",
      "Use limit to cap results (default 20, max 100).",
      "Use cwd_filter to narrow to sessions from a specific directory.",
      "The session file path can be passed to session_summarize for details.",
    ],
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({
        description: "Max sessions to return (default 20, max 100).",
        default: 20,
      })),
      cwd_filter: Type.Optional(Type.String({
        description: "Filter sessions by working directory substring.",
      })),
      model_filter: Type.Optional(Type.String({
        description: "Filter sessions by model substring.",
      })),
    }),

    renderCall(args: any, theme: any) {
      const parts: string[] = [];
      if (args.limit) parts.push(`limit=${args.limit}`);
      if (args.cwd_filter) parts.push(`cwd=${args.cwd_filter}`);
      if (args.model_filter) parts.push(`model=${args.model_filter}`);
      return new Text([
        theme.fg("toolTitle", theme.bold("session_list")),
        parts.length > 0 ? `  ${theme.fg("dim", parts.join(" · "))}` : "",
      ].filter(Boolean).join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const sessions = details.sessions as SessionInfo[] | undefined;
      if (!sessions?.length) {
        return new Text(theme.fg("dim", "no sessions found"), 0, 0);
      }
      const lines: string[] = [];
      lines.push(theme.fg("success", `✓ ${sessions.length} session${sessions.length !== 1 ? "s" : ""}`));
      if (!expanded) {
        // Show first 5 inline
        for (const s of sessions.slice(0, 5)) {
          const model = s.model ? `${s.provider || ""}/${s.model}`.replace(/^\/+/, "") : "?";
          lines.push(`  ${theme.fg("dim", `${s.name || "(unnamed)"} · ${model} · ${s.turns}t · ${formatTokens(s.tokens)} · ${timeAgo(s.mtime)}`)}`);
        }
        if (sessions.length > 5) lines.push(`  ${theme.fg("dim", `… ${sessions.length - 5} more`)}`);
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const limit = Math.min(Math.max(1, Number(params.limit ?? 20)), 100);
      const cwdFilter = params.cwd_filter ? String(params.cwd_filter) : undefined;
      const modelFilter = params.model_filter ? String(params.model_filter) : undefined;

      const files = walkSessions(SESSIONS_DIR);
      const sessions: SessionInfo[] = [];

      for (const file of files) {
        const s = scanSession(file);
        if (!s) continue;

        // Apply filters
        if (cwdFilter && !(s.cwd || "").toLowerCase().includes(cwdFilter.toLowerCase())) continue;
        if (modelFilter) {
          const modelStr = `${s.provider || ""} ${s.model || ""}`.toLowerCase();
          if (!modelStr.includes(modelFilter.toLowerCase())) continue;
        }

        sessions.push(s);
      }

      // Sort by modification time (most recent first), apply limit
      sessions.sort((a, b) => b.mtime - a.mtime);
      const limited = sessions.slice(0, limit);

      // Format output
      const lines: string[] = [];
      lines.push(`Found ${sessions.length} session${sessions.length !== 1 ? "s" : ""}${sessions.length > limit ? ` (showing ${limit})` : ""}`);
      lines.push("");

      for (const s of limited) {
        const model = s.model
          ? `${s.provider || ""}/${s.model}`.replace(/^\/+/, "")
          : "(unknown model)";
        const cwd = s.cwd ? s.cwd.replace(HOME, "~") : "?";
        const name = s.name || "(unnamed)";
        const age = timeAgo(s.mtime);

        lines.push(`── ${clip(name, 60)} ──`);
        lines.push(`  id:      ${s.id.slice(0, 12)}…`);
        lines.push(`  model:   ${model}`);
        lines.push(`  cwd:     ${cwd}`);
        lines.push(`  created: ${s.created || "?"}  ·  ${age}`);
        lines.push(`  turns:   ${s.turns}  ·  tools: ${s.toolCalls}  ·  errors: ${s.errors}`);
        lines.push(`  tokens:  ${formatTokens(s.tokens)}  ·  cost: ${formatCost(s.cost)}`);
        lines.push(`  file:    ${s.displayPath}`);
        lines.push("");
      }

      return {
        content: [{ type: "text", text: lines.join("\n").slice(0, 8000) }],
        details: { sessions: limited, total: sessions.length, limit },
      };
    },
  });
}
