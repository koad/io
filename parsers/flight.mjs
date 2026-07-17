import fs from "node:fs";
import path from "node:path";
import {
  clip,
  elapsedSeconds,
  firstNonEmpty,
  formatMoney,
  normalizeIso,
  parseJsonlLine,
} from "./_utils.mjs";

function runtimeRoot() {
  return process.env.KOAD_IO_RUNTIME_PATH || path.join(process.env.HOME || "", ".local", "share", "koad-io", "runtime");
}

function dispatchRoot() {
  return path.join(runtimeRoot(), "dispatches");
}

function rankFlightMatch(entry, raw) {
  if (entry === raw) return 0;
  if (entry.startsWith(`${raw}-`) || entry.endsWith(`-${raw}`)) return 1;
  if (entry.startsWith(raw) || entry.endsWith(raw)) return 2;
  if (entry.includes(raw)) return 3;
  return Number.POSITIVE_INFINITY;
}

function resolveFlightPath(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (fs.existsSync(raw)) {
    const stat = fs.statSync(raw);
    if (stat.isDirectory()) {
      return {
        dir: raw,
        dispatchPath: path.join(raw, "dispatch.json"),
        inputKind: "path",
        matchKind: "path",
        candidateCount: 1,
      };
    }
    if (stat.isFile() && path.basename(raw) === "dispatch.json") {
      return {
        dir: path.dirname(raw),
        dispatchPath: raw,
        inputKind: "path",
        matchKind: "path",
        candidateCount: 1,
      };
    }
  }
  const root = dispatchRoot();
  if (!fs.existsSync(root)) return null;
  const candidates = fs.readdirSync(root)
    .map((entry) => ({ entry, rank: rankFlightMatch(entry, raw) }))
    .filter((candidate) => Number.isFinite(candidate.rank))
    .sort((a, b) => a.rank - b.rank || a.entry.length - b.entry.length || a.entry.localeCompare(b.entry));
  if (candidates.length === 0) return null;
  const best = candidates[0];
  return {
    dir: path.join(root, best.entry),
    dispatchPath: path.join(root, best.entry, "dispatch.json"),
    inputKind: "flight-id",
    matchKind: best.rank === 0 ? "exact-id" : best.rank === 1 ? "boundary-shorthand" : best.rank === 2 ? "prefix-or-suffix" : "contains",
    candidateCount: candidates.length,
  };
}

function loadRunSnapshots(runPath) {
  if (!runPath || !fs.existsSync(runPath)) return [];
  return fs.readFileSync(runPath, "utf8")
    .split(/\r?\n/)
    .map(parseJsonlLine)
    .filter((entry) => entry.ok)
    .map((entry) => entry.value);
}

function readTextTail(filePath, maxBytes = 3000) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  const start = Math.max(0, (stat.size || 0) - maxBytes);
  const length = Math.max(0, (stat.size || 0) - start);
  if (!length) return "";
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8").trim();
  } finally {
    fs.closeSync(fd);
  }
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
    const stdoutPath = path.join(resolved.dir, "stdout.log");
    const stderrPath = path.join(resolved.dir, "stderr.log");
    const runSnapshots = loadRunSnapshots(runPath);
    const lastRun = runSnapshots.length ? runSnapshots[runSnapshots.length - 1] : null;
    const outputs = lastRun?.outputs || {};
    const stats = firstNonEmpty(lastRun?.stats, dispatch.stats, {}) || {};
    const completion = firstNonEmpty(outputs.summary, dispatch.completionSummary, dispatch.completion_summary, dispatch.closingNote, dispatch.closing_note, lastRun?.closing_note, lastRun?.completion_summary);
    const objective = firstNonEmpty(dispatch.ancestry?.objective, dispatch.note, dispatch.brief, dispatch.briefSlug);
    const elapsed = firstNonEmpty(lastRun?.elapsed_s, dispatch.elapsed, elapsedSeconds(dispatch.started, dispatch.ended || new Date().toISOString()));
    const filesTouched = Array.isArray(outputs.files_touched)
      ? outputs.files_touched
      : Array.isArray(outputs.artifacts)
        ? outputs.artifacts
        : [];
    const followups = fs.existsSync(followupPath)
      ? fs.readFileSync(followupPath, "utf8").split(/\r?\n/).filter((line) => line.trim()).length
      : 0;
    const stdoutTail = readTextTail(stdoutPath, ctx.verbosity >= 2 ? 5000 : 2400);
    const stderrTail = firstNonEmpty(outputs.stderr_tail, outputs.stderr, readTextTail(stderrPath, 2400)) || null;
    const runLogPath = firstNonEmpty(lastRun?.run_log_path, outputs.run_log_path, dispatch.run_log_path) || null;
    const transcriptKind = runLogPath ? "run-log" : stdoutTail ? "stdout-log-fallback" : "none";
    const transcriptTail = transcriptKind === "run-log"
      ? readTextTail(runLogPath, ctx.verbosity >= 2 ? 5000 : 2400)
      : stdoutTail;
    const missingFields = [
      completion ? null : "completion_summary",
      runLogPath ? null : "run_log_path",
      transcriptTail ? null : "transcript_tail",
      stderrTail ? null : "stderr_tail",
      filesTouched.length ? null : "output_files",
    ].filter(Boolean);
    const warnings = [
      !fs.existsSync(runPath) ? "run.jsonl missing — summary is dispatch-only." : null,
      resolved.inputKind === "flight-id" && resolved.matchKind !== "exact-id"
        ? `Resolved flight shorthand via ${resolved.matchKind}${resolved.candidateCount > 1 ? ` (${resolved.candidateCount} candidates)` : ""}.`
        : null,
      transcriptKind === "stdout-log-fallback"
        ? "No structured run transcript was linked; transcript_tail is a stdout.log fallback."
        : null,
      transcriptKind === "none"
        ? "No run transcript or stdout log was available for transcript_tail."
        : null,
      stderrTail ? null : "No stderr tail was captured for this flight.",
      filesTouched.length ? null : "No files_touched/artifacts list was captured for this flight.",
    ].filter(Boolean);

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
          transcript_kind: transcriptKind,
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
            title: "log tails",
            items: [
              transcriptTail ? `- transcript (${transcriptKind}): ${clip(transcriptTail.replace(/\s+/g, " "), ctx.verbosity >= 2 ? 1200 : 500)}` : null,
              stderrTail ? `- stderr: ${clip(String(stderrTail).replace(/\s+/g, " "), 500)}` : null,
            ].filter(Boolean),
          },
          {
            title: "run artifacts",
            items: [
              `- dispatch: ${resolved.dispatchPath}`,
              `- run log: ${fs.existsSync(runPath) ? runPath : "missing"}`,
              `- linked transcript: ${runLogPath || "missing"}`,
              `- stdout log: ${fs.existsSync(stdoutPath) ? stdoutPath : "missing"}`,
              `- stderr log: ${fs.existsSync(stderrPath) ? stderrPath : "missing"}`,
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
        run_id: firstNonEmpty(lastRun?.run_id, dispatch.run_record_id) || null,
        run_log_kind: transcriptKind,
        run_log_path: runLogPath,
        stdout_tail: stdoutTail || null,
        stderr_tail: stderrTail || null,
        transcript_tail: transcriptTail || null,
        final_text: outputs.final_text || null,
        output_files: filesTouched,
        missing_fields: missingFields,
        stats: {
          turns: Number(stats.turns || 0),
          tool_calls: Number(stats.toolCalls || 0),
          input_tokens: Number(stats.inputTokens || 0),
          output_tokens: Number(stats.outputTokens || 0),
          cost: Number(Number(stats.cost || 0).toFixed(6)),
        },
        lookup: {
          input_kind: resolved.inputKind,
          match_kind: resolved.matchKind,
          candidate_count: resolved.candidateCount,
        },
        followups,
        ancestry: dispatch.ancestry || {},
        run_snapshots: runSnapshots.length,
        run_statuses: runSnapshots.map((entry) => entry?.status).filter(Boolean),
      },
      warnings,
    };
  },
};
