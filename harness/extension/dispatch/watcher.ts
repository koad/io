// Background dispatch watcher — polls control-tower /api/dispatches via Node http
// until the dispatched entity lands or errors, then injects a session
// message and stops. No child process — no early-exit race.
//
// For failed dispatches, also reads the dispatch JSON file directly to surface
// richer diagnostics (stderr tail, stats, close reason) that may not be
// exposed through the control-tower REST API.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const HOME = os.homedir();
const RUNTIME_PATH = process.env.KOAD_IO_RUNTIME_PATH ?? path.join(HOME, ".local", "share", "koad-io", "runtime");
const DISPATCHES_DIR = path.join(RUNTIME_PATH, "dispatches");
// Legacy paths for read fallback
const LEGACY_FLIGHTS_DIR = path.join(HOME, ".juno", "control", "flights");
const LEGACY_RUNS_DIR = path.join(HOME, ".juno", "control", "runs");

function dispatchJsonPath(dispatchId: string): string {
  return path.join(DISPATCHES_DIR, dispatchId, "dispatch.json");
}

const _BIND_IP = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
const CONTROL_URL =
  process.env.KOAD_IO_CONTROL_URL ?? `http://${_BIND_IP}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`;
const CONTROL_HOST = new URL(CONTROL_URL).hostname;
const CONTROL_PORT = parseInt(new URL(CONTROL_URL).port || "28283", 10);
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 450;

interface DispatchPollResult {
  found: boolean;
  status?: string;
  started?: string;
  ended?: string;
  elapsed_s?: number;
  closingNote?: string;
  brief?: string;
}

const watchers = new Map<string, ReturnType<typeof setInterval>>();

function computeElapsedSeconds(started?: string, ended?: string): number | undefined {
  if (!started || !ended) return undefined;
  const startMs = Date.parse(started);
  const endMs = Date.parse(ended);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return undefined;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function pollDispatch(dispatchId: string): Promise<DispatchPollResult> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://${CONTROL_HOST}:${CONTROL_PORT}/api/dispatches`,
      { timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const dispatches: any[] = data?.dispatches ?? data?.flights ?? [];
            const match = dispatches.find((f: any) =>
              f._id?.endsWith(dispatchId),
            );
            if (match) {
              const started = match.started ?? match.started_at;
              const ended = match.ended ?? match.completed_at;
              const elapsed = match.elapsed ?? match.elapsed_s ?? computeElapsedSeconds(started, ended);
              resolve({
                found: true,
                status: match.status,
                started,
                ended,
                elapsed_s: elapsed,
                closingNote: match.completionSummary ?? match.closingNote,
                brief: match.briefSlug ?? match.brief,
              });
              return;
            }
            // Not in control-tower — try disk for CLI-dispatched entities
            resolve(pollDiskDispatch(dispatchId));
          } catch {
            resolve(pollDiskDispatch(dispatchId));
          }
        });
      },
    );
    req.on("error", () => resolve(pollDiskDispatch(dispatchId)));
    req.on("timeout", () => {
      req.destroy();
      resolve(pollDiskDispatch(dispatchId));
    });
  });
}

function pollDiskDispatch(dispatchId: string): DispatchPollResult {
  const filePath = findDispatchFile(dispatchId);
  if (!filePath) return { found: false };
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const rec = JSON.parse(raw);
    const started = rec.started ?? rec.started_at;
    const ended = rec.ended ?? rec.completed_at;
    const elapsed = rec.elapsed ?? rec.elapsed_s ?? computeElapsedSeconds(started, ended);
    return {
      found: true,
      status: rec.status,
      started,
      ended,
      elapsed_s: elapsed,
      closingNote: rec.closingNote,
      brief: rec.brief,
    };
  } catch {
    return { found: false };
  }
}

function findDispatchFile(dispatchId: string): string | null {
  const exactPath = dispatchJsonPath(dispatchId);
  if (fs.existsSync(exactPath)) return exactPath;
  try {
    const entries = fs.readdirSync(DISPATCHES_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.includes(dispatchId)) {
        const p = path.join(DISPATCHES_DIR, e.name, "dispatch.json");
        if (fs.existsSync(p)) return p;
      }
    }
  } catch {}
  return null;
}

// ── Rich diagnostics from dispatch + run record files ───────────────

interface RichDiagnostics {
  stderrTail?: string;
  closeReason?: string;
  overwrittenFallback?: boolean;
  stats?: Record<string, unknown>;
}

function readDispatchFileDiagnostics(dispatchId: string): RichDiagnostics | null {
  // New path first
  let filePath = dispatchJsonPath(dispatchId);
  if (!fs.existsSync(filePath)) {
    // Legacy fallback: scan flat files
    try {
      const entries = fs.readdirSync(LEGACY_FLIGHTS_DIR);
      const match = entries.find(f => f.includes(dispatchId) && f.endsWith(".json"));
      if (match) filePath = path.join(LEGACY_FLIGHTS_DIR, match);
      else return null;
    } catch (_) {
      return null;
    }
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const record = JSON.parse(raw);

    const diag: RichDiagnostics = {};

    // Extract close reason if available
    if (record.closeReason) diag.closeReason = record.closeReason;
    if (record.overwrittenFallback) diag.overwrittenFallback = true;
    if (record.stats) diag.stats = record.stats;

    // Try to extract stderr from the closing note
    const closingNote: string | undefined = record.closingNote;
    if (closingNote && typeof closingNote === "string") {
      const stderrMatch = closingNote.match(/stderr:\s*(.+)/);
      if (stderrMatch) diag.stderrTail = stderrMatch[1].slice(0, 500);
    }

    // Also check run.jsonl for richer error data (stderr_tail, outputs)
    const runRecordId = record.run_record_id;
    if (runRecordId) {
      try {
        // New path: run.jsonl in dispatch folder
        const runJsonl = path.join(DISPATCHES_DIR, dispatchId, "run.jsonl");
        if (fs.existsSync(runJsonl)) {
          const lines = fs.readFileSync(runJsonl, "utf-8").split("\n").filter(l => l.trim());
          if (lines.length > 0) {
            const runData = JSON.parse(lines[lines.length - 1]);
            if (runData.outputs?.stderr_tail && !diag.stderrTail) {
              diag.stderrTail = String(runData.outputs.stderr_tail).slice(0, 500);
            }
          }
        } else {
          // Legacy run record fallback
          const legacyRunPath = path.join(LEGACY_RUNS_DIR, `${runRecordId}.json`);
          if (fs.existsSync(legacyRunPath)) {
            const runData = JSON.parse(fs.readFileSync(legacyRunPath, "utf-8"));
            if (runData.outputs?.stderr_tail && !diag.stderrTail) {
              diag.stderrTail = String(runData.outputs.stderr_tail).slice(0, 500);
            }
          }
        }
      } catch (_) {}
    }

    return diag;
  } catch (_) {
    return null;
  }
}

// ── Watcher ───────────────────────────────────────────────────────

export function startWatching(
  pi: ExtensionAPI,
  dispatchId: string,
  entity: string,
  planBasename: string,
): void {
  if (watchers.has(dispatchId)) return;

  let polls = 0;

  const check = async () => {
    polls++;

    const result = await pollDispatch(dispatchId);

    if (!result.found) {
      if (polls >= MAX_POLLS) {
        const elapsed = polls * (POLL_INTERVAL_MS / 1000);
        pi.sendMessage(
          {
            customType: "koad-io-dispatch-landing",
            content: `⏳ **${entity}** ⟐ \`${dispatchId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\` — still flying after ${elapsed}s`,
            display: true,
            details: { dispatchId, entity, planBasename, status: "timeout", elapsedS: elapsed },
          },
          { triggerTurn: true },
        );
        stopWatching(dispatchId);
      }
      return;
    }

    const status = result.status ?? "flying";
    if (status === "flying") {
      if (polls >= MAX_POLLS) {
        const elapsed = polls * (POLL_INTERVAL_MS / 1000);
        pi.sendMessage(
          {
            customType: "koad-io-dispatch-landing",
            content: `⏳ **${entity}** ⟐ \`${dispatchId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\` — still flying after ${elapsed}s`,
            display: true,
            details: { dispatchId, entity, planBasename, status: "timeout", elapsedS: elapsed },
          },
          { triggerTurn: true },
        );
        stopWatching(dispatchId);
      }
      return;
    }

    // Landed or errored
    const elapsedS = result.elapsed_s ?? 0;
    const mins = Math.floor(elapsedS / 60);
    const secs = elapsedS % 60;
    const dur = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    let note = result.closingNote ? ` — ${result.closingNote}` : "";

    // For failed/error dispatches, surface richer diagnostics
    let diag: RichDiagnostics | null = null;
    if (status === "error" || status === "failed") {
      diag = readDispatchFileDiagnostics(dispatchId);
      if (diag?.stderrTail) {
        // Truncate for display, full stderr in details
        const tail = diag.stderrTail.slice(0, 300);
        note += `\n\`\`\`\n${tail}${diag.stderrTail.length > 300 ? "..." : ""}\n\`\`\``;
      }
      if (diag?.closeReason && !result.closingNote?.includes(diag.closeReason)) {
        note += `\nclose reason: ${diag.closeReason}`;
      }
    }

    let msg: string;
    if (status === "landed" || status === "closed") {
      msg = `✓ **${entity}** landed ⟐ \`${dispatchId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\` (${dur})${note}`;
    } else if (status === "error" || status === "failed") {
      msg = `⚠ **${entity}** ${status} ⟐ \`${dispatchId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\`${note}`;
    } else {
      msg = `⏳ **${entity}** ⟐ \`${dispatchId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\` — ${status} after ${dur}`;
    }

    pi.sendMessage(
      {
        customType: "koad-io-dispatch-landing",
        content: msg,
        display: true,
        details: {
          dispatchId,
          entity,
          planBasename,
          brief: result.brief || undefined,
          status,
          elapsedS,
          closingNote: result.closingNote || undefined,
          ended: result.ended || undefined,
          ...(diag ? { diagnostics: diag } : {}),
        },
      },
      { triggerTurn: true },
    );

    stopWatching(dispatchId);
  };

  const timer = setInterval(check, POLL_INTERVAL_MS);
  watchers.set(dispatchId, timer);
  // Run immediately for fast dispatches
  check();
}

function stopWatching(dispatchId: string): void {
  const timer = watchers.get(dispatchId);
  if (timer) {
    clearInterval(timer);
    watchers.delete(dispatchId);
  }
}
