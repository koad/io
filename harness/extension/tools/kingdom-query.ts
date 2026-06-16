/**
 * Semantic kingdom query tools — mission, session, emission, bond, question, entity.
 *
 * Six tools that provide a semantic query surface over the dual backend:
 *   - embedded: direct REST + DDP-reactive collections
 *   - remote:    gated DDP
 *
 * Hard ontology rule: no flight_query — a flight is a shape of mission.
 * Transport is hidden from the caller.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { clipText as clip } from "../utils/tool-render";
import type { DDPClient } from "../ddp";
import {
  missionQuery, sessionQuery, emissionQuery,
  bondQuery, questionQuery, entityQuery,
} from "../kingdom/queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatQueryResult(summary: string, backend: string, degraded: boolean, degradedReason?: string): string {
  const lines = [summary];
  if (degraded) lines.push(`  ⚠ degraded (${degradedReason || "unknown"}) — ${backend}`);
  else lines.push(`  ${backend}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerKingdomQueryTools(
  pi: ExtensionAPI,
  clients: { daemon: DDPClient | null; control: DDPClient | null },
): void {
  const missionDDP = clients.control ?? clients.daemon;
  const sessionDDP = clients.control ?? clients.daemon;
  const emissionDDP = clients.control ?? clients.daemon; // emissions live in control-tower
  const bondDDP = clients.daemon ?? clients.control;
  const entityDDP = clients.daemon ?? clients.control;

  // ── mission_query ─────────────────────────────────────────────
  pi.registerTool({
    name: "mission_query",
    label: "Mission Query",
    description: [
      "Query kingdom missions (flights and future execution shapes).",
      "Supports filtering by entity, status, active_only, id, shape, since.",
      "Hard ontology: a flight is a shape of mission — use mission_query, not flight_query.",
      "Backend: embedded direct when local, gated DDP when remote.",
    ].join("\n"),
    promptSnippet: "Query missions — filter by entity, status, active_only, id, shape, since",
    promptGuidelines: [
      "Use mission_query to see what's flying, landed, or stale.",
      "Filter by entity to see one entity's mission history.",
      "Use active_only=true for currently airborne missions.",
      "The results include shape=flight (future: other execution shapes).",
      "Not flight_query — a flight is a shape of mission.",
    ],
    parameters: Type.Object({
      entity: Type.Optional(Type.String({
        description: "Filter by entity (e.g. vulcan, juno, muse).",
      })),
      status: Type.Optional(Type.String({
        description: "Filter by status: flying, landed, stale.",
      })),
      active_only: Type.Optional(Type.Boolean({
        description: "Only currently active (flying) missions.",
      })),
      id: Type.Optional(Type.String({
        description: "Look up a specific mission by id.",
      })),
      shape: Type.Optional(Type.String({
        description: "Filter by execution shape (default: all). Currently only 'flight' exists.",
      })),
      since: Type.Optional(Type.String({
        description: "ISO timestamp — only missions started after this.",
      })),
      limit: Type.Optional(Type.Number({
        description: "Max results (default 50, max 200).",
      })),
    }),

    renderCall(args: any, theme: any) {
      const parts: string[] = [];
      if (args.entity) parts.push(`@${args.entity}`);
      if (args.status) parts.push(args.status);
      if (args.active_only) parts.push("active");
      if (args.id) parts.push(`#${clip(args.id, 20)}`);
      const filter = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("mission_query")) + filter,
        `  ${theme.fg("dim", `query kingdom missions`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const count = details.count ?? 0;
      const backend = details.backend ?? "?";
      const degraded = details.degraded ?? false;
      const lines: string[] = [
        theme.fg(degraded && count === 0 ? "warning" : "success",
          `${degraded && count === 0 ? "⚠" : "✓"} ${count} mission(s)`),
        `  ${theme.fg("dim", `${backend}${degraded ? " (degraded)" : ""}`)}`,
      ];
      if (expanded && details.results?.length) {
        for (const m of details.results.slice(0, 10)) {
          const icon = m.status === "flying" ? "✈️" : m.status === "landed" ? "✅" : "📦";
          lines.push(`  ${icon} ${theme.fg("accent", m.entity)} ${theme.fg("dim", clip(m.brief_slug || m.id, 30))} ${m.status}`);
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const result = await missionQuery(missionDDP, {
        id: params.id,
        entity: params.entity,
        status: params.status,
        active_only: params.active_only,
        shape: params.shape,
        since: params.since,
        limit: params.limit || 50,
      });

      const summary = `${result.count} mission(s)`;
      const lines: string[] = [formatQueryResult(summary, result.backend, result.degraded, result.degraded_reason)];

      // Surface actual mission data inline
      const missions = result.results ?? [];
      if (missions.length > 0) {
        for (const m of missions.slice(0, 20)) {
          const entity = m.entity || "?";
          const status = m.status || "?";
          const brief = (m.brief_slug || m.id || "").slice(0, 60);
          const icon = status === "flying" ? "✈️" : status === "landed" ? "✅" : "📦";
          const elapsed = m.elapsed ? ` ${m.elapsed}s` : "";
          lines.push(`${icon} ${entity} [${status}]${elapsed} ${brief}`);
          if (m.id) lines.push(`  id: ${m.id}`);
          if (m.completion_summary) lines.push(`  → ${m.completion_summary.slice(0, 120)}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          ...result,
          summary,
        },
      };
    },
  });

  // ── session_query ─────────────────────────────────────────────
  pi.registerTool({
    name: "session_query",
    label: "Session Query",
    description: [
      "Query harness sessions across the kingdom.",
      "Supports filtering by entity, active_only, id.",
      "Backend: embedded direct when local, gated DDP when remote.",
    ].join("\n"),
    promptSnippet: "Query harness sessions — filter by entity, active_only, id",
    promptGuidelines: [
      "Use session_query to see who's online and what sessions are active.",
      "Filter by entity to see one entity's session history.",
      "Use active_only=true for currently active sessions (last 2 hours).",
    ],
    parameters: Type.Object({
      entity: Type.Optional(Type.String({
        description: "Filter by entity (e.g. vulcan, juno).",
      })),
      active_only: Type.Optional(Type.Boolean({
        description: "Only sessions active in last 2 hours.",
      })),
      id: Type.Optional(Type.String({
        description: "Look up a specific session by id.",
      })),
      limit: Type.Optional(Type.Number({
        description: "Max results (default 50).",
      })),
    }),

    renderCall(args: any, theme: any) {
      const parts: string[] = [];
      if (args.entity) parts.push(`@${args.entity}`);
      if (args.active_only) parts.push("active");
      const filter = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("session_query")) + filter,
        `  ${theme.fg("dim", `query harness sessions`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const count = details.count ?? 0;
      const degraded = details.degraded ?? false;
      const lines: string[] = [
        theme.fg(degraded && count === 0 ? "warning" : "success",
          `${degraded && count === 0 ? "⚠" : "✓"} ${count} session(s)`),
        `  ${theme.fg("dim", `${details.backend || "?"}${degraded ? " (degraded)" : ""}`)}`,
      ];
      if (expanded && details.results?.length) {
        for (const s of details.results.slice(0, 10)) {
          const icon = s.status === "active" ? "🟢" : "⚫";
          lines.push(`  ${icon} ${theme.fg("accent", s.entity)} ${theme.fg("dim", clip(s.id, 20))} ${s.status}`);
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const result = await sessionQuery(sessionDDP, {
        id: params.id,
        entity: params.entity,
        active_only: params.active_only,
        limit: params.limit || 50,
      });

      const summary = `${result.count} session(s)`;
      const lines: string[] = [formatQueryResult(summary, result.backend, result.degraded, result.degraded_reason)];

      const sessions = result.results ?? [];
      if (sessions.length > 0) {
        for (const s of sessions.slice(0, 20)) {
          const ent = s.entity || "?";
          const status = s.status || "?";
          const icon = status === "active" ? "🟢" : "⚫";
          lines.push(`${icon} ${ent} [${status}] ${String(s.id || "").slice(0, 40)}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          ...result,
          summary,
        },
      };
    },
  });

  // ── emission_query ────────────────────────────────────────────
  pi.registerTool({
    name: "emission_query",
    label: "Emission Query",
    description: [
      "Query the kingdom emission stream semantically.",
      "Supports filtering by entity, type, status, active_only, mission_id, since.",
      "Backend: embedded direct when local, gated DDP when remote.",
    ].join("\n"),
    promptSnippet: "Query emissions — filter by entity, type, active_only, since",
    promptGuidelines: [
      "Use emission_query to see the kingdom's event stream.",
      "Filter by entity, type (notice, warning, error, etc.), or status.",
      "Use active_only=true for open/active lifecycle emissions.",
      "Use since=<ISO> for recent emissions only.",
    ],
    parameters: Type.Object({
      entity: Type.Optional(Type.String({
        description: "Filter by emitting entity.",
      })),
      type: Type.Optional(Type.String({
        description: "Filter by emission type (notice, warning, error, etc.).",
      })),
      status: Type.Optional(Type.String({
        description: "Filter by emission status (open, active, closed).",
      })),
      active_only: Type.Optional(Type.Boolean({
        description: "Only open or active lifecycle emissions.",
      })),
      mission_id: Type.Optional(Type.String({
        description: "Filter emissions linked to a specific mission.",
      })),
      since: Type.Optional(Type.String({
        description: "ISO timestamp — only emissions after this.",
      })),
      limit: Type.Optional(Type.Number({
        description: "Max results (default 50).",
      })),
    }),

    renderCall(args: any, theme: any) {
      const parts: string[] = [];
      if (args.entity) parts.push(`@${args.entity}`);
      if (args.type) parts.push(args.type);
      if (args.active_only) parts.push("active");
      const filter = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("emission_query")) + filter,
        `  ${theme.fg("dim", `query emission stream`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const count = details.count ?? 0;
      const degraded = details.degraded ?? false;
      const lines: string[] = [
        theme.fg(degraded && count === 0 ? "warning" : "success",
          `${degraded && count === 0 ? "⚠" : "✓"} ${count} emission(s)`),
        `  ${theme.fg("dim", `${details.backend || "?"}${degraded ? " (degraded)" : ""}`)}`,
      ];

      // Always show type breakdown + time range even when collapsed
      const typeSummary = details.type_summary;
      const timeRange = details.time_range;
      if (typeSummary) lines.push(`  ${theme.fg("dim", typeSummary)}`);
      if (timeRange) lines.push(`  ${theme.fg("dim", timeRange)}`);

      if (expanded && details.results?.length) {
        for (const e of details.results.slice(0, 10)) {
          const ts = (e.started || "").slice(11, 19);
          const typeLabel = e.type || "?";
          lines.push(`  ${theme.fg("dim", ts)} ${theme.fg("accent", e.entity)} ${theme.fg("dim", `[${typeLabel}]`)} ${clip(e.body || "", 50)}`);
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const result = await emissionQuery(emissionDDP, {
        id: params.id,
        entity: params.entity,
        type: params.type,
        status: params.status,
        active_only: params.active_only,
        mission_id: params.mission_id,
        since: params.since,
        limit: params.limit || 50,
      });

      const summary = `${result.count} emission(s)`;
      const lines: string[] = [formatQueryResult(summary, result.backend, result.degraded, result.degraded_reason)];

      const emissions = result.results ?? [];
      let typeSummary = "";
      let timeRange = "";
      if (emissions.length > 0) {
        // Summary: type breakdown + time range
        const typeCounts: Record<string, number> = {};
        let oldest = "";
        let newest = "";
        for (const e of emissions) {
          const t = e.type || "unknown";
          typeCounts[t] = (typeCounts[t] || 0) + 1;
          if (e.started) {
            if (!oldest || e.started < oldest) oldest = e.started;
            if (!newest || e.started > newest) newest = e.started;
          }
        }
        typeSummary = Object.entries(typeCounts)
          .sort(([,a], [,b]) => b - a)
          .map(([t, n]) => `${n}x ${t}`).join(", ");
        lines.push(typeSummary);

        // Time range
        if (oldest && newest) {
          const spanMs = new Date(newest).getTime() - new Date(oldest).getTime();
          const spanS = Math.round(spanMs / 1000);
          const spanStr = spanS < 120 ? `${spanS}s` : spanS < 3600 ? `${Math.round(spanS / 60)}m ${spanS % 60}s` : `${Math.floor(spanS / 3600)}h ${Math.round((spanS % 3600) / 60)}m`;
          timeRange = `${emissions.length} over ${spanStr}, oldest ${oldest.slice(0, 19).replace("T", " ")}`;
          lines.push(timeRange);
        }

        lines.push("");
        for (const e of emissions.slice(0, 20)) {
          const ent = e.entity || "?";
          const type = e.type || "?";
          const body = (e.body || "").slice(0, 80);
          const ts = (e.started || "").slice(11, 19);
          lines.push(`${ts} ${ent} [${type}] ${body}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          ...result,
          summary,
          type_summary: typeSummary as string | undefined,
          time_range: timeRange as string | undefined,
        },
      };
    },
  });

  // ── bond_query ─────────────────────────────────────────────────
  pi.registerTool({
    name: "bond_query",
    label: "Bond Query",
    description: [
      "Query trust bonds and bond-relevant state.",
      "Supports filtering by entity, from, to, type, status.",
      "Backend: daemon REST when local, gated DDP when remote.",
    ].join("\n"),
    promptSnippet: "Query trust bonds — filter by entity, from, to, type",
    promptGuidelines: [
      "Use bond_query to reason about authority and permissions.",
      "Filter by entity to see all bonds involving that entity.",
      "Filter by from/to for directional queries.",
      "Filter by type for relationship categories (authorized-builder, peer, etc.).",
    ],
    parameters: Type.Object({
      entity: Type.Optional(Type.String({
        description: "Entity to query bonds for (matches from or to).",
      })),
      from: Type.Optional(Type.String({
        description: "Filter bonds originating from this entity.",
      })),
      to: Type.Optional(Type.String({
        description: "Filter bonds targeting this entity.",
      })),
      type: Type.Optional(Type.String({
        description: "Filter by bond type (authorized-agent, authorized-builder, peer, etc.).",
      })),
      status: Type.Optional(Type.String({
        description: "Filter by bond status: ACTIVE, REVOKED.",
      })),
      limit: Type.Optional(Type.Number({
        description: "Max results (default 50).",
      })),
    }),

    renderCall(args: any, theme: any) {
      const parts: string[] = [];
      if (args.entity) parts.push(`@${args.entity}`);
      if (args.from) parts.push(`from:${args.from}`);
      if (args.to) parts.push(`to:${args.to}`);
      if (args.type) parts.push(args.type);
      const filter = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("bond_query")) + filter,
        `  ${theme.fg("dim", `query trust bonds`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const count = details.count ?? 0;
      const degraded = details.degraded ?? false;
      const lines: string[] = [
        theme.fg(degraded && count === 0 ? "warning" : "success",
          `${degraded && count === 0 ? "⚠" : "✓"} ${count} bond(s)`),
        `  ${theme.fg("dim", `${details.backend || "?"}${degraded ? " (degraded)" : ""}`)}`,
      ];
      if (expanded && details.results?.length) {
        for (const b of details.results.slice(0, 10)) {
          const sig = b.signed ? "🔏" : "📝";
          lines.push(`  ${sig} ${theme.fg("accent", b.from)} → ${theme.fg("accent", b.to)} ${theme.fg("dim", `[${b.type}]`)} ${b.status}`);
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const result = await bondQuery(bondDDP, {
        entity: params.entity,
        from: params.from,
        to: params.to,
        type: params.type,
        status: params.status,
        limit: params.limit || 50,
      });

      const summary = `${result.count} bond(s)`;
      const lines: string[] = [formatQueryResult(summary, result.backend, result.degraded, result.degraded_reason)];

      const bonds = result.results ?? [];
      if (bonds.length > 0) {
        for (const b of bonds.slice(0, 20)) {
          const from = b.from || "?";
          const to = b.to || "?";
          const type = b.type || "?";
          const status = b.status || "?";
          const sig = b.signed ? "🔏" : "📝";
          lines.push(`${sig} ${from}→${to} [${type}] ${status}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          ...result,
          summary,
        },
      };
    },
  });

  // ── question_query ─────────────────────────────────────────────
  pi.registerTool({
    name: "question_query",
    label: "Question Query",
    description: [
      "Query queued questions and answers across the kingdom.",
      "Supports filtering by from, to, status, id.",
      "Backend: control-tower REST when local, gated DDP when remote.",
    ].join("\n"),
    promptSnippet: "Query questions — filter by from, to, status (open/answered/cancelled)",
    promptGuidelines: [
      "Use question_query to see open questions, answered questions, or the full queue.",
      "Filter by status=open for pending questions needing answers.",
      "Filter by from/to for entity-scoped queries.",
    ],
    parameters: Type.Object({
      from: Type.Optional(Type.String({
        description: "Filter questions asked by this entity.",
      })),
      to: Type.Optional(Type.String({
        description: "Filter questions directed to this entity.",
      })),
      status: Type.Optional(Type.String({
        description: "Filter by status: open, answered, cancelled, resumed.",
      })),
      id: Type.Optional(Type.String({
        description: "Look up a specific question by id.",
      })),
      limit: Type.Optional(Type.Number({
        description: "Max results (default 50).",
      })),
    }),

    renderCall(args: any, theme: any) {
      const parts: string[] = [];
      if (args.from) parts.push(`from:${args.from}`);
      if (args.to) parts.push(`to:${args.to}`);
      if (args.status) parts.push(args.status);
      const filter = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("question_query")) + filter,
        `  ${theme.fg("dim", `query question queue`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const count = details.count ?? 0;
      const degraded = details.degraded ?? false;
      const lines: string[] = [
        theme.fg(degraded && count === 0 ? "warning" : "success",
          `${degraded && count === 0 ? "⚠" : "✓"} ${count} question(s)`),
        `  ${theme.fg("dim", `${details.backend || "?"}${degraded ? " (degraded)" : ""}`)}`,
      ];
      if (expanded && details.results?.length) {
        for (const q of details.results.slice(0, 10)) {
          const icon = q.status === "open" ? "❓" : q.status === "answered" ? "✅" : "❌";
          lines.push(`  ${icon} ${theme.fg("accent", q.from)}→${theme.fg("accent", q.to)} ${theme.fg("dim", clip(q.question, 200))}`);
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const result = await questionQuery(clients.control ?? clients.daemon, {
        from: params.from,
        to: params.to,
        status: params.status,
        id: params.id,
        limit: params.limit || 50,
      });

      const summary = `${result.count} question(s)`;
      const lines: string[] = [formatQueryResult(summary, result.backend, result.degraded, result.degraded_reason)];

      // Surface actual question data inline
      const questions = result.results ?? [];
      if (questions.length > 0) {
        for (const q of questions.slice(0, 20)) {
          const from = q.from || "?";
          const to = q.to || "?";
          const status = q.status || "?";
          const question = (q.question || "").slice(0, 120);
          const icon = status === "open" ? "❓" : status === "answered" ? "✅" : "📋";
          lines.push(`${icon} ${from}→${to} [${status}] ${question}`);
          if (q._id) lines.push(`  id: ${q._id}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          ...result,
          summary,
        },
      };
    },
  });

  // ── entity_query ───────────────────────────────────────────────
  pi.registerTool({
    name: "entity_query",
    label: "Entity Query",
    description: [
      "Query kingdom entities — handle, role, host, status.",
      "Supports filtering by handle or id.",
      "Optional tool — fell out cleanly from the collection surface.",
      "Backend: DDP-reactive when available.",
    ].join("\n"),
    promptSnippet: "Query kingdom entities — filter by handle, id",
    promptGuidelines: [
      "Use entity_query to discover entities, their roles, hosts, and status.",
      "Filter by handle for a specific entity.",
    ],
    parameters: Type.Object({
      handle: Type.Optional(Type.String({
        description: "Filter by entity handle (e.g. vulcan, juno).",
      })),
      id: Type.Optional(Type.String({
        description: "Look up a specific entity by DDP _id.",
      })),
      limit: Type.Optional(Type.Number({
        description: "Max results (default 50).",
      })),
    }),

    renderCall(args: any, theme: any) {
      const filter = args.handle ? ` (@${args.handle})` : args.id ? ` (#${clip(args.id, 20)})` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("entity_query")) + filter,
        `  ${theme.fg("dim", `query kingdom entities`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const count = details.count ?? 0;
      const degraded = details.degraded ?? false;
      const lines: string[] = [
        theme.fg(degraded && count === 0 ? "warning" : "success",
          `${degraded && count === 0 ? "⚠" : "✓"} ${count} entit${count === 1 ? "y" : "ies"}`),
        `  ${theme.fg("dim", `${details.backend || "?"}${degraded ? " (degraded)" : ""}`)}`,
      ];
      if (expanded && details.results?.length) {
        for (const e of details.results.slice(0, 20)) {
          lines.push(`  🏷️ ${theme.fg("accent", e.handle)} ${theme.fg("dim", `[${e.role || "?"}]`)} @ ${e.host || "?"}`);
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const result = await entityQuery(entityDDP, {
        handle: params.handle,
        id: params.id,
        limit: params.limit || 50,
      });

      const summary = `${result.count} entit${result.count === 1 ? "y" : "ies"}`;
      const content = formatQueryResult(summary, result.backend, result.degraded, result.degraded_reason);

      return {
        content: [{ type: "text", text: content }],
        details: {
          ...result,
          summary,
        },
      };
    },
  });
}
