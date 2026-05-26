/**
 * koad-io search tool — typed gateway to the kingdom search binary.
 *
 * Wraps ~/.koad-io/bin/search — the proven waterfall search that knows
 * the kingdom's file topology: entities, forge, framework, briefs,
 * specs, memories, assessments, ticklers.
 *
 * Modes:
 *   text   — grep/ripgrep across all kingdom surfaces
 *   where  — frontmatter field query (status=ready, entities=vulcan)
 *   related — constellation discovery around a file
 *   stale  — find forgotten work (untouched > N days)
 *   atlas  — full kingdom dashboard grouped by status
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as cp from "node:child_process";
import * as os from "node:os";
import { Type } from "typebox";

const HOME = os.homedir();
const SEARCH_BIN = process.env.KOAD_IO_SEARCH_BIN || `${HOME}/.koad-io/bin/search`;

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

const SearchParams = Type.Object({
  mode: Type.Optional(Type.String({
    description: 'Search mode: text, where, related, stale, atlas. Default: text.',
    default: "text",
  })),
  query: Type.Optional(Type.String({
    description: "Search pattern (text mode), file path (related mode), topic (echo mode), or empty (atlas/stale modes).",
  })),
  where: Type.Optional(Type.String({
    description: "Frontmatter filter for --where mode (e.g. 'status=ready' or 'entities=vulcan').",
  })),
  entity: Type.Optional(Type.String({
    description: "Limit search to one entity's directories (e.g. 'vulcan').",
  })),
  days: Type.Optional(Type.Number({
    description: "Stale threshold in days (default 7). Only for stale mode.",
    default: 7,
  })),
  skip_complete: Type.Optional(Type.Boolean({
    description: "Exclude done/archived/closed items from results.",
  })),
  limit: Type.Optional(Type.Number({
    description: "Max result lines to return (default 40, capped at 200).",
    default: 40,
  })),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSearchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "search",
    label: "Kingdom Search",
    description: [
      "Unified kingdom search — waterfalls through all entities, forge, and framework.",
      "Modes:",
      "  text <pattern> — grep match across the kingdom",
      "  where <key=value> — frontmatter query (e.g. status=ready)",
      "  related <file> — constellation: everything connected to a file",
      "  stale [days] — forgotten work untouched > N days (default 7)",
      "  atlas — full kingdom dashboard grouped by status",
    ].join("\n"),
    promptSnippet: "Search kingdom (mode: text|where|related|stale|atlas, query, ...)",
    promptGuidelines: [
      "Use search text <pattern> to find briefs, specs, memories by keyword.",
      "Use search where status=ready to find work that's ready for action.",
      "Use search related <file> to understand what touches a given file.",
      "Use search stale to find forgotten work that needs attention.",
      "Results are truncated — use entity/where filters to narrow.",
    ],
    parameters: SearchParams,

    async execute(_toolCallId, params) {
      const mode = params.mode || "text";
      const query = params.query || "";
      const whereStr = params.where || "";
      const entity = params.entity || "";
      const days = params.days ?? 7;
      const limit = Math.min(params.limit ?? 40, 200);

      // Build search args matching ~/.koad-io/bin/search interface
      const args: string[] = [];

      switch (mode) {
        case "text":
          if (!query) throw new Error("search text: query is required");
          args.push(query);
          break;
        case "where":
          if (!whereStr) throw new Error("search where: where is required (e.g. status=ready)");
          args.push("--where", whereStr);
          break;
        case "related":
          if (!query) throw new Error("search related: file path is required");
          args.push("--related", query);
          break;
        case "stale":
          args.push("--stale", String(days));
          break;
        case "atlas":
          args.push("--atlas");
          break;
        default:
          throw new Error(`Unknown search mode: ${mode}. Valid: text, where, related, stale, atlas.`);
      }

      if (entity) args.push("--entity", entity);
      if (params.skip_complete) args.push("--skip-complete");

      const cmd = `${SEARCH_BIN} ${args.map(a => JSON.stringify(a)).join(" ")}`;
      let stdout = "";
      let stderr = "";
      let exitCode = 1;

      try {
        const result = cp.spawnSync("bash", ["-c", cmd], {
          env: process.env,
          cwd: process.cwd(),
          timeout: 30000,
          stdio: "pipe",
          maxBuffer: 1024 * 1024,
        });
        stdout = (result.stdout || "").toString().trim();
        stderr = (result.stderr || "").toString().trim();
        exitCode = result.status ?? 1;
      } catch (err: any) {
        stderr = err.message || "spawn failed";
      }

      if (exitCode !== 0 && !stdout) {
        throw new Error(`search ${mode} failed: ${stderr || `exit ${exitCode}`}`);
      }

      // Truncate for display
      const lines = stdout.split("\n");
      const display = lines.slice(0, limit).join("\n");
      const suffix = lines.length > limit ? `\n… ${lines.length - limit} more results` : "";

      return {
        content: [{ type: "text", text: display + suffix }],
        details: {
          mode, query, where: whereStr, entity,
          exitCode, totalLines: lines.length, limit,
          fullStdout: stdout.slice(0, 8000),
        },
      };
    },
  });
}
