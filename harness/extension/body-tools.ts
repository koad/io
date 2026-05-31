/**
 * koad-io body tools — kingdom motions for Juno body surface.
 *
 * Six tools that wrap forge commands:
 *   surface_now        — snapshot of what matters right now
 *   intake_digest      — classify inbox items
 *   intake_resolve     — act on inbox items
 *   obligation_digest  — unify ticklers, followups, questions
 *   obligation_advance — move obligations to next state
 *   brief_issue        — file brief + optionally dispatch + followup
 *
 * Each tool is a thin typed wrapper around a forge command. Business logic
 * lives in ~/.forge/commands/{surface,inbox,obligation,brief}/.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as cp from "node:child_process";
import * as os from "node:os";
import { Type } from "typebox";
import { clipText as clip } from "./utils/tool-render";

const HOME = os.homedir();
const KOAD_IO_BIN = process.env.KOAD_IO_BIN || `${HOME}/.koad-io/bin/koad-io`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function execKoadio(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const cmd = `${KOAD_IO_BIN} ${args.map(a => JSON.stringify(a)).join(" ")}`;
  try {
    const result = cp.spawnSync("bash", ["-c", cmd], {
      env: process.env,
      cwd: process.cwd(),
      timeout: 15000,
      stdio: "pipe",
      maxBuffer: 512 * 1024,
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

function tryParseJson(text: string): any {
  try { return JSON.parse(text); }
  catch { return null; }
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

export function registerBodyTools(pi: ExtensionAPI): void {

  // ── surface_now ─────────────────────────────────────────────────
  pi.registerTool({
    name: "surface_now",
    label: "Surface Now",
    description: [
      "Kingdom situational-awareness snapshot — what matters right now.",
      "Queries daemon for flights + questions, scans local messages + ticklers,",
      "and returns a structured overview with attention candidates.",
      "Backed by ~/.forge/commands/surface/now/command.sh",
    ].join("\n"),
    promptSnippet: "Snapshot of what matters now (intake, obligations, flights, questions)",
    promptGuidelines: [
      "Use surface_now at the start of a session or when reorienting.",
      "Returns intake count, obligation count, active flights, open questions.",
      "Attention candidates highlight high-priority items needing action.",
    ],
    parameters: Type.Object({
      entity: Type.Optional(Type.String({
        description: "Entity to surface (defaults to current entity).",
      })),
    }),

    renderCall(args: any, theme: any) {
      const entity = args.entity || "current";
      return new Text([
        theme.fg("toolTitle", theme.bold("surface_now ")) + theme.fg("accent", `@ ${entity}`),
        `  ${theme.fg("dim", `snapshot of kingdom state`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const s = details.summary ?? {};
      const ok = details.exitCode === 0;
      const lines: string[] = [];
      if (!ok) {
        lines.push(theme.fg("warning", `⚠ daemon unreachable`));
        if (expanded && details.stderr) lines.push(`  ${theme.fg("dim", clip(details.stderr, 200))}`);
        return new Text(lines.join("\n"), 0, 0);
      }
      lines.push(theme.fg("success", `✓ ${details.entity || "?"} @ ${(details.snapshot_ts || "").slice(0, 19)}`));
      lines.push(`  ${theme.fg("dim", `📥 intake: ${s.intake ?? 0} · 📋 obligations: ${s.obligations ?? 0} · ✈️ flights: ${s.flights ?? 0} · ❓ questions: ${s.questions ?? 0}`)}`);
      if (expanded) {
        const att = details.attention_candidates ?? {};
        if (att.high_priority_obligations?.length) {
          lines.push(`  ${theme.fg("warning", `⚠ ${att.high_priority_obligations.length} high-priority obligations`)}`);
        }
        if (att.active_flights?.length) {
          lines.push(`  ${theme.fg("accent", `✈️ ${att.active_flights.length} active flights`)}`);
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const args = ["surface", "now", "--json"];
      if (params.entity) args.push(`--entity=${params.entity}`);

      const result = execKoadio(args);
      const parsed = tryParseJson(result.stdout);
      if (result.exitCode !== 0 || !parsed) {
        return {
          content: [{ type: "text", text: result.stdout || result.stderr || "surface_now failed" }],
          details: { exitCode: result.exitCode, stderr: result.stderr.slice(0, 500), stdout: result.stdout.slice(0, 1000) },
        };
      }
      const s = parsed.summary || {};
      const att = parsed.attention_candidates || {};
      const lines: string[] = [];
      lines.push(`${parsed.entity || "?"} @ ${(parsed.snapshot_ts || "").slice(0, 19)}`);
      lines.push(`📥 intake: ${s.intake ?? 0} · 📋 obligations: ${s.obligations ?? 0}`);
      lines.push(`✈️ flights: ${s.flights ?? 0} · ❓ questions: ${s.questions ?? 0}`);
      if (att.high_priority_obligations?.length) {
        lines.push(`⚠ ${att.high_priority_obligations.length} high-priority obligations`);
        for (const o of att.high_priority_obligations.slice(0, 5)) {
          lines.push(`  - ${o.title || o.id}`);
        }
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: parsed,
      };
    },
  });

  // ── intake_digest ──────────────────────────────────────────────
  pi.registerTool({
    name: "intake_digest",
    label: "Intake Digest",
    description: [
      "Classify entity inbox messages into semantic buckets.",
      "Reads ~/.forge/messages/<entity>/ and returns actionable, stale,",
      "and decision-bearing items with recommended next actions.",
      "Backed by ~/.forge/commands/inbox/digest/command.sh",
    ].join("\n"),
    promptSnippet: "Classify inbox into actionable / stale / decision-bearing buckets",
    promptGuidelines: [
      "Use intake_digest before intake_resolve — preview first, act second.",
      "Use --mode=actionable to focus on items needing attention.",
      "Each item gets a recommended_next_action and recommended_class.",
    ],
    parameters: Type.Object({
      entity: Type.Optional(Type.String({
        description: "Entity whose inbox to digest (defaults to current).",
      })),
      since: Type.Optional(Type.String({
        description: "ISO timestamp — only items after this.",
      })),
      mode: Type.Optional(Type.String({
        description: "Filter: actionable, stale, decision-bearing, all (default).",
      })),
    }),

    renderCall(args: any, theme: any) {
      const entity = args.entity || "current";
      const mode = args.mode || "all";
      return new Text([
        theme.fg("toolTitle", theme.bold("intake_digest ")) + theme.fg("accent", `${entity}`),
        `  ${theme.fg("dim", `mode: ${mode}${args.since ? ` · since: ${args.since}` : ""}`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const exitCode = details.exitCode;
      const isError = exitCode !== undefined && exitCode !== 0;
      const lines: string[] = [];

      if (isError) {
        lines.push(theme.fg("warning", `⚠ intake_digest failed (exit ${exitCode})`));
        if (expanded && details.stderr) lines.push(`  ${theme.fg("dim", clip(details.stderr, 200))}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      const total = details.summary?.total ?? 0;
      const buckets = details.buckets ?? {};
      lines.push(theme.fg("success", `✓ ${details.entity || "?"} inbox: ${total} items`));
      lines.push(`  ${theme.fg("dim", `⚡ actionable: ${buckets.actionable?.count ?? 0} · 🧠 decisions: ${buckets.decision_bearing?.count ?? 0} · 📦 stale: ${buckets.stale?.count ?? 0}`)}`);
      if (expanded && buckets.actionable?.items?.length) {
        for (const item of buckets.actionable.items.slice(0, 5)) {
          lines.push(`  ${theme.fg("accent", `[${item.class}]`)} ${theme.fg("dim", clip(item.summary, 60))}`);
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const args = ["inbox", "digest", "--json"];
      if (params.entity) args.push(`--entity=${params.entity}`);
      if (params.since) args.push(`--since=${params.since}`);
      if (params.mode) args.push(`--mode=${params.mode}`);

      const result = execKoadio(args);
      const parsed = tryParseJson(result.stdout);
      if (result.exitCode !== 0 || !parsed) {
        return {
          content: [{ type: "text", text: result.stdout || result.stderr || "intake_digest failed" }],
          details: { exitCode: result.exitCode, stderr: result.stderr.slice(0, 500), entity: params.entity || undefined },
        };
      }
      const total = parsed.summary?.total ?? 0;
      const buckets = parsed.buckets ?? {};
      return {
        content: [{
          type: "text",
          text: `${parsed.entity || "?"} inbox: ${total} items — ⚡${buckets.actionable?.count ?? 0} actionable, 🧠${buckets.decision_bearing?.count ?? 0} decisions, 📦${buckets.stale?.count ?? 0} stale`,
        }],
        details: parsed,
      };
    },
  });

  // ── intake_resolve ─────────────────────────────────────────────
  pi.registerTool({
    name: "intake_resolve",
    label: "Intake Resolve",
    description: [
      "Act on classified inbox items — mark handled, archive, promote to brief,",
      "promote to tickle, flag for reply, link to existing work.",
      "Backed by ~/.forge/commands/inbox/resolve/command.sh",
    ].join("\n"),
    promptSnippet: "Resolve inbox items (mark_handled, promote_to_brief, archive_stale, …)",
    promptGuidelines: [
      "Use after intake_digest. Preview first, act second.",
      "Actions: mark_handled, archive_stale, extract_decision, promote_to_brief,",
      "  promote_to_tickle, reply_needed, link_to_existing_work.",
      "Use --dry-run to preview before executing.",
      "Ids come from intake_digest output — they are stable filenames.",
    ],
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        description: "Inbox item ids (from intake_digest output).",
      }),
      action: Type.String({
        description: "Action: mark_handled, archive_stale, extract_decision, promote_to_brief, promote_to_tickle, reply_needed, link_to_existing_work.",
      }),
      entity: Type.Optional(Type.String({
        description: "Entity whose inbox to act on (defaults to current).",
      })),
      note: Type.Optional(Type.String({
        description: "Optional note attached to the action.",
      })),
      dry_run: Type.Optional(Type.Boolean({
        description: "If true, preview only — no mutations.",
      })),
    }),

    renderCall(args: any, theme: any) {
      const ids = Array.isArray(args.ids) ? args.ids.length : 0;
      const dry = args.dry_run ? " dry-run" : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("intake_resolve ")) + theme.fg("accent", `${args.action || "?"}`),
        `  ${theme.fg("dim", `${ids} item(s)${dry}${args.note ? ` · ${clip(args.note, 40)}` : ""}`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const ok = details.exitCode === 0;
      const lines = [
        theme.fg(ok ? "success" : "error", `${ok ? "✓" : "✗"} ${details.action || "?"} — ${details.items_resolved ?? 0} items`),
      ];
      if (details.dry_run) lines.push(`  ${theme.fg("warning", "dry run — no mutations")}`);
      if (expanded && details.note) lines.push(`  ${theme.fg("dim", `note: ${details.note}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const args = ["inbox", "resolve", ...params.ids, `--action=${params.action}`, "--json"];
      if (params.entity) args.push(`--entity=${params.entity}`);
      if (params.note) args.push(`--note=${params.note}`);
      if (params.dry_run) args.push("--dry-run");

      const result = execKoadio(args);
      const parsed = tryParseJson(result.stdout);
      return {
        content: [{
          type: "text",
          text: `${params.dry_run ? "[DRY RUN] " : ""}${params.action}: ${params.ids.length} item(s) for ${params.entity || "current"}`,
        }],
        details: parsed || { action: params.action, ids: params.ids, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
      };
    },
  });

  // ── obligation_digest ───────────────────────────────────────────
  pi.registerTool({
    name: "obligation_digest",
    label: "Obligation Digest",
    description: [
      "Unify ticklers, followups, waiting questions, and deferred inbox —",
      "\"what is hanging on me?\" — grouped by overdue, today, blocked, delegable, stale.",
      "Backed by ~/.forge/commands/obligation/digest/command.sh",
    ].join("\n"),
    promptSnippet: "Show everything owed — grouped by overdue / today / stale / delegable",
    promptGuidelines: [
      "Use obligation_digest to see what commitments are pending.",
      "Groups: overdue, today, blocked, delegable, stale.",
      "Each item has stable id, source, priority, age, group.",
      "Use obligation_advance to move items to their next state.",
    ],
    parameters: Type.Object({
      entity: Type.Optional(Type.String({
        description: "Entity whose obligations to digest (defaults to current).",
      })),
    }),

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("obligation_digest ")) + theme.fg("accent", `${args.entity || "current"}`),
        `  ${theme.fg("dim", `"what is hanging on me?"`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const exitCode = details.exitCode;
      const isError = exitCode !== undefined && exitCode !== 0;
      const lines: string[] = [];

      if (isError) {
        lines.push(theme.fg("warning", `⚠ obligation_digest failed (exit ${exitCode})`));
        if (expanded && details.stderr) lines.push(`  ${theme.fg("dim", clip(details.stderr, 200))}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      const total = details.total ?? 0;
      const buckets = details.buckets ?? {};
      lines.push(theme.fg("success", `✓ ${details.entity || "?"} obligations: ${total} total`));
      lines.push(`  ${theme.fg("error", `🔴 overdue: ${buckets.overdue?.count ?? 0}`)} ${theme.fg("warning", `🟡 today: ${buckets.today?.count ?? 0}`)} ${theme.fg("dim", `📦 stale: ${buckets.stale?.count ?? 0}`)}`);
      if (expanded && buckets.overdue?.items?.length) {
        for (const item of buckets.overdue.items.slice(0, 5)) {
          lines.push(`  ${theme.fg("error", `[${item.source}]`)} ${theme.fg("dim", clip(item.title || item.id, 60))}`);
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const args = ["obligation", "digest", "--json"];
      if (params.entity) args.push(`--entity=${params.entity}`);

      const result = execKoadio(args);
      const parsed = tryParseJson(result.stdout);
      if (result.exitCode !== 0 || !parsed) {
        return {
          content: [{ type: "text", text: result.stdout || result.stderr || "obligation_digest failed" }],
          details: { exitCode: result.exitCode, stderr: result.stderr.slice(0, 500), entity: params.entity || undefined },
        };
      }
      const total = parsed.total ?? 0;
      const buckets = parsed.buckets ?? {};
      return {
        content: [{
          type: "text",
          text: `${parsed.entity || "?"} obligations: ${total} total — 🔴${buckets.overdue?.count ?? 0} overdue, 🟡${buckets.today?.count ?? 0} today, 📦${buckets.stale?.count ?? 0} stale`,
        }],
        details: parsed,
      };
    },
  });

  // ── obligation_advance ──────────────────────────────────────────
  pi.registerTool({
    name: "obligation_advance",
    label: "Obligation Advance",
    description: [
      "Move obligations to their next state: resolve, snooze, escalate, delegate,",
      "convert to brief, convert to question, drop with reason.",
      "Backed by ~/.forge/commands/obligation/advance/command.sh",
    ].join("\n"),
    promptSnippet: "Advance obligation (resolve, snooze_until, escalate, delegate, …)",
    promptGuidelines: [
      "Use after obligation_digest. Preview first, act second.",
      "Actions: resolve, snooze_until, escalate, delegate, convert_to_brief,",
      "  convert_to_question, drop_with_reason.",
      "Use --dry-run to preview before executing.",
      "Ids come from obligation_digest output — they are stable slugs.",
      "Use --snooze-until=<ISO> with snooze_until to set a specific date.",
      "Use --delegate-to=<entity> with delegate.",
    ],
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        description: "Obligation ids (from obligation_digest output).",
      }),
      action: Type.String({
        description: "Action: resolve, snooze_until, escalate, delegate, convert_to_brief, convert_to_question, drop_with_reason.",
      }),
      entity: Type.Optional(Type.String({
        description: "Entity whose obligations to advance (defaults to current).",
      })),
      note: Type.Optional(Type.String({
        description: "Optional note attached to the action.",
      })),
      snooze_until: Type.Optional(Type.String({
        description: "ISO date to snooze until (for snooze_until action).",
      })),
      delegate_to: Type.Optional(Type.String({
        description: "Entity to delegate to (for delegate action).",
      })),
      dry_run: Type.Optional(Type.Boolean({
        description: "If true, preview only — no mutations.",
      })),
    }),

    renderCall(args: any, theme: any) {
      const ids = Array.isArray(args.ids) ? args.ids.length : 0;
      const dry = args.dry_run ? " dry-run" : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("obligation_advance ")) + theme.fg("accent", `${args.action || "?"}`),
        `  ${theme.fg("dim", `${ids} item(s)${dry}${args.snooze_until ? ` · until ${args.snooze_until}` : ""}${args.delegate_to ? ` → ${args.delegate_to}` : ""}`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const ok = details.exitCode === 0;
      const lines = [
        theme.fg(ok ? "success" : "error", `${ok ? "✓" : "✗"} ${details.action || "?"} — ${details.resolved ?? 0} resolved, ${details.failed ?? 0} failed`),
      ];
      if (details.dry_run) lines.push(`  ${theme.fg("warning", "dry run — no mutations")}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const args = ["obligation", "advance", ...params.ids, `--action=${params.action}`, "--json"];
      if (params.entity) args.push(`--entity=${params.entity}`);
      if (params.note) args.push(`--note=${params.note}`);
      if (params.snooze_until) args.push(`--snooze-until=${params.snooze_until}`);
      if (params.delegate_to) args.push(`--delegate-to=${params.delegate_to}`);
      if (params.dry_run) args.push("--dry-run");

      const result = execKoadio(args);
      const parsed = tryParseJson(result.stdout);
      return {
        content: [{
          type: "text",
          text: `${params.dry_run ? "[DRY RUN] " : ""}${params.action}: ${params.ids.length} obligation(s)`,
        }],
        details: parsed || { action: params.action, ids: params.ids, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
      };
    },
  });

  // ── brief_issue ─────────────────────────────────────────────────
  pi.registerTool({
    name: "brief_issue",
    label: "Brief Issue",
    description: [
      "File a brief to a target entity. Optionally dispatch a flight and/or",
      "create a followup obligation. Collapses \"write file + dispatch + remind self\"",
      "into one kingdom motion.",
      "Backed by ~/.forge/commands/brief/issue/command.sh",
    ].join("\n"),
    promptSnippet: "Issue brief to entity (target_entity, subject, body) — optionally dispatch + followup",
    promptGuidelines: [
      "Use brief_issue to direct work to another entity.",
      "Kind: brief (default), followup, synthesis, decision-package.",
      "Set --dispatch to launch a flight immediately.",
      "Set --followup to create a tickle reminder for yourself.",
      "Returns stable brief_id (filename), path, and optional flight_id.",
    ],
    parameters: Type.Object({
      target_entity: Type.String({
        description: "Entity to file the brief for (e.g. vulcan, muse, sibyl).",
      }),
      subject: Type.String({
        description: "Brief subject line.",
      }),
      body: Type.Optional(Type.String({
        description: "Brief body — full markdown. If omitted, subject is used.",
      })),
      kind: Type.Optional(Type.String({
        description: "Brief kind: brief (default), followup, synthesis, decision-package.",
      })),
      priority: Type.Optional(Type.String({
        description: "Priority: low, normal (default), high, urgent.",
      })),
      due: Type.Optional(Type.String({
        description: "ISO due date.",
      })),
      refs: Type.Optional(Type.Array(Type.String(), {
        description: "Reference strings to attach.",
      })),
      dispatch: Type.Optional(Type.Boolean({
        description: "If true, dispatch a flight to the target entity immediately.",
      })),
      followup: Type.Optional(Type.Boolean({
        description: "If true, create a tickle followup reminder for the sender.",
      })),
    }),

    renderCall(args: any, theme: any) {
      const extras: string[] = [];
      if (args.dispatch) extras.push("dispatch");
      if (args.followup) extras.push("followup");
      const extra = extras.length > 0 ? ` · ${extras.join(", ")}` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("brief_issue ")) + theme.fg("accent", `${args.kind || "brief"} → ${args.target_entity || "?"}`),
        `  ${theme.fg("dim", `${clip(args.subject || "")}${extra}`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const brief = details.brief ?? {};
      const lines = [
        theme.fg("success", `✓ brief issued → ${brief.entity || "?"}`),
        `  ${theme.fg("dim", `id: ${brief.id || "?"} · ${clip(brief.subject || "", 60)}`)}`,
      ];
      if (details.dispatched && details.flight_id) {
        lines.push(`  ${theme.fg("accent", `✈️ flight: ${details.flight_id}`)}`);
      }
      if (details.followup_created) {
        lines.push(`  ${theme.fg("warning", `🔔 followup created`)}`);
      }
      if (expanded && details.brief?.path) {
        lines.push(`  ${theme.fg("dim", `path: ${details.brief.path}`)}`);
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const args = ["brief", "issue", params.target_entity, `--subject=${params.subject}`, "--json"];
      if (params.body) args.push(`--body=${params.body}`);
      if (params.kind) args.push(`--kind=${params.kind}`);
      if (params.priority) args.push(`--priority=${params.priority}`);
      if (params.due) args.push(`--due=${params.due}`);
      if (params.refs?.length) args.push(`--refs=${params.refs.join(",")}`);
      if (params.dispatch) args.push("--dispatch");
      if (params.followup) args.push("--followup");

      const result = execKoadio(args);
      const parsed = tryParseJson(result.stdout);
      if (result.exitCode !== 0 || !parsed) {
        return {
          content: [{ type: "text", text: result.stdout || result.stderr || "brief_issue failed" }],
          details: { exitCode: result.exitCode, stderr: result.stderr.slice(0, 500), stdout: result.stdout.slice(0, 1000) },
        };
      }
      const brief = parsed.brief ?? {};
      const lines: string[] = [
        `✓ brief issued to ${brief.entity || params.target_entity}`,
        `  id: ${brief.id || "?"} — ${brief.subject || params.subject}`,
      ];
      if (parsed.dispatched && parsed.flight_id) {
        lines.push(`  ✈️ flight dispatched: ${parsed.flight_id}`);
      }
      if (parsed.followup_created) {
        lines.push(`  🔔 followup reminder created`);
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: parsed,
      };
    },
  });
}
