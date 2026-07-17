import fs from "node:fs";
import path from "node:path";
import {
  clip,
  elapsedSeconds,
  firstNonEmpty,
  formatDurationSeconds,
  formatMoney,
  normalizeIso,
  parseJsonlLine,
  safeJsonParse,
} from "./_utils.mjs";

const RUNTIME_ROOT = process.env.KOAD_IO_RUNTIME_PATH || path.join(process.env.HOME || "", ".local", "share", "koad-io", "runtime");
const DISPATCH_ROOT = path.join(RUNTIME_ROOT, "dispatches");

function resolveFlightPath(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (fs.existsSync(raw)) {
    const stat = fs.statSync(raw);
    if (stat.isDirectory()) return { dir: raw, dispatchPath: path.join(raw, "dispatch.json"), inputKind: "path" };
    if (stat.isFile() && path.basename(raw) === "dispatch.json") return { dir: path.dirname(raw), dispatchPath: raw, inputKind: "path" };
  }
  if (!fs.existsSync(DISPATCH_ROOT)) return null;
  const entries = fs.readdirSync(DISPATCH_ROOT).filter((entry) => entry === raw || entry.includes(raw));
  if (entries.length === 0) return null;
  const entry = entries.sort((a, b) => a.length - b.length)[0];
  return {
    dir: path.join(DISPATCH_ROOT, entry),
    dispatchPath: path.join(DISPATCH_ROOT, entry, "dispatch.json"),
    inputKind: "flight-id",
  };
}

function loadRunSnapshots(runPath) {
  if (!runPath || !fs.existsSync(runPath)) return [];
  return fs.readFileSync(runPath, "utf8").split(/\r?\n/).map(parseJsonlLine).filter((entry) => entry.ok).map((entry) => entry.value);
}

export const parser = {
  name: "flight",
  aliases: ["dispatch", "mission-flight"],
  description: "Dispatch flight directories and dispatch.json records.",

  async canParse(ctx) {
    if (ctx.target.exists) {
      if (ctx.target.type === "directory" && fs.existsSync(path.join(ctx.target.resolved, "dispatch.json"))) return 100;
      if (ctx.target.type === "file" && path.basename(ctx.target.resolved) === "dispatch.json") return 100;
    }
    return resolveFlightPath(ctx.target.input) ? 95 : 0;
  },

  async summarize(ctx) {
    const resolved = resolveFlightPath(ctx.target.exists ? ctx.target.resolved : ctx.target.input);
    if (!resolved || !fs.existsSync(resolved.dispatchPath)) {
      throw new Error(`flight parser could not resolve target: ${ctx.target.input}`);
    }
    const dispatch = JSON.parse(fs.readFileSync(resolved.dispatchPath, "utf8"));
    const runPath = path.join(resolved.dir, "run.jsonl");
    const followupPath = path.join(resolved.dir, "followup.jsonl");
    const runSnapshots = loadRunSnapshots(runPath);
    const lastRun = runSnapshots.length ? runSnapshots[runSnapshots.length - 1] : null;
    const outputs = lastRun?.outputs || {};
    const stats = firstNonEmpty(lastRun?.stats, dispatch.stats, {}) || {};
    const completion = firstNonEmpty(outputs.summary, dispatch.completionSummary, dispatch.completion_summary, dispatch.closingNote, dispatch.closing_note, lastRun?.closing_note, lastRun?.completion_summary);
    const objective = firstNonEmpty(dispatch.ancestry?.objective, dispatch.note, dispatch.brief, dispatch.briefSlug);
    const elapsed = firstNonEmpty(lastRun?.elapsed_s, dispatch.elapsed, elapsedSeconds(dispatch.started, dispatch.ended || new Date().toISOString()));
    const filesTouched = Array.isArray(outputs.files_touched) ? outputs.files_touched : [];
    const followups = fs.existsSync(followupPath)
      ? fs.readFileSync(followupPath, "utf8").split(/\r?\n/).filter((line) => line.trim()).length
      : 0;

    return {
      target: {
        input: ctx.target.input,
        resolved: resolved.dispatchPath,
        type: "file",
        exists: true,
        size_bytes: fs.statSync(resolved.dispatchPath).size,
      },
      summary: {
        title: `Flight summary :: ${dispatch.id || path.basename(resolved.dir)}`,
        headline: `${dispatch.entity || "?"} · ${dispatch.status || "unknown"} · ${clip(objective || "", 140)}`,
        metrics: {
          status: dispatch.status || null,
          entity: dispatch.entity || null,
          elapsed_seconds: elapsed,
          turns: Number(stats.turns || 0),
          tool_calls: Number(stats.toolCalls || 0),
          input_tokens: Number(stats.inputTokens || 0),
          output_tokens: Number(stats.outputTokens || 0),
          tokens: Number(stats.inputTokens || 0) + Number(stats.outputTokens || 0),
          cost: Number(Number(stats.cost || 0).toFixed(6)),
          files_touched: filesTouched.length,
          followups,
        },
        sections: [
          {
            title: "brief",
            items: [
              `- brief: ${dispatch.brief || "unknown"}`,
              `- objective: ${clip(objective || "", 240)}`,
              `- plan: ${dispatch.plan_path || "unknown"}`,
            ],
          },
          {
            title: "completion",
            items: completion ? [`- ${clip(completion, ctx.verbosity >= 2 ? 1200 : 400)}`] : [],
          },
          {
            title: "files touched",
            items: filesTouched.slice(0, ctx.verbosity >= 2 ? 20 : 10).map((file) => `- ${file}`),
          },
          {
            title: "run artifacts",
            items: [
              `- dispatch: ${resolved.dispatchPath}`,
              `- run log: ${fs.existsSync(runPath) ? runPath : "missing"}`,
              `- followups: ${followups}`,
              `- close reason: ${dispatch.closeReason || lastRun?.close_reason || "unknown"}`,
            ],
          },
        ].filter((section) => section.items.length > 0),
        compat_footer: {
          Status: dispatch.status || "unknown",
          Turns: Number(stats.turns || 0),
          "Tool calls": Number(stats.toolCalls || 0),
          Tokens: Number(stats.inputTokens || 0) + Number(stats.outputTokens || 0),
          Cost: formatMoney(stats.cost || 0),
        },
      },
      data: {
        dispatch_id: dispatch.id || null,
        entity: dispatch.entity || null,
        brief: dispatch.brief || null,
        objective: objective || null,
        status: dispatch.status || null,
        started_at: normalizeIso(dispatch.started),
        ended_at: normalizeIso(dispatch.ended),
        elapsed_seconds: elapsed,
        completion_summary: completion || null,
        close_reason: dispatch.closeReason || lastRun?.close_reason || null,
        model: firstNonEmpty(lastRun?.model, dispatch.model) || null,
        stats: {
          turns: Number(stats.turns || 0),
          tool_calls: Number(stats.toolCalls || 0),
          input_tokens: Number(stats.inputTokens || 0),
          output_tokens: Number(stats.outputTokens || 0),
          cost: Number(Number(stats.cost || 0).toFixed(6)),
        },
        outputs: {
          files_touched: filesTouched,
          final_text: outputs.final_text || null,
          summary: outputs.summary || null,
        },
        followups,
        ancestry: dispatch.ancestry || {},
        run_snapshots: runSnapshots.length,
        run_statuses: runSnapshots.map((entry) => entry?.status).filter(Boolean),
      },
      warnings: [
        !fs.existsSync(runPath) ? "run.jsonl missing — summary is dispatch-only." : null,
      ].filter(Boolean),
    };
  },
};
