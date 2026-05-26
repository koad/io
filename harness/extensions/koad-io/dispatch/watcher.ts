// Background flight watcher — polls control-tower /api/flights via Node http
// until the dispatched flight lands or errors, then injects a session
// message and stops. No child process — no early-exit race.
//
// For failed flights, also reads the flight JSON file directly to surface
// richer diagnostics (stderr tail, stats, close reason) that may not be
// exposed through the control-tower REST API.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const HOME = os.homedir();
const FLIGHTS_DIR = path.join(HOME, ".juno", "control", "flights");
const RUNS_DIR = path.join(HOME, ".juno", "control", "runs");

const CONTROL_URL =
  process.env.KOAD_IO_CONTROL_URL ?? "http://10.10.10.10:28283";
const CONTROL_HOST = new URL(CONTROL_URL).hostname;
const CONTROL_PORT = parseInt(new URL(CONTROL_URL).port || "28283", 10);
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 450;

interface FlightResult {
  found: boolean;
  status?: string;
  ended?: string;
  elapsed_s?: number;
  closingNote?: string;
  brief?: string;
}

const watchers = new Map<string, ReturnType<typeof setInterval>>();

function pollFlight(flightId: string): Promise<FlightResult> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://${CONTROL_HOST}:${CONTROL_PORT}/api/flights`,
      { timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const flights: any[] = data?.flights ?? [];
            const match = flights.find((f: any) =>
              f._id?.endsWith(flightId),
            );
            if (!match) {
              resolve({ found: false });
              return;
            }
            resolve({
              found: true,
              status: match.status,
              ended: match.ended,
              elapsed_s: match.elapsed,
              closingNote: match.completionSummary ?? match.closingNote,
              brief: match.briefSlug ?? match.brief,
            });
          } catch {
            resolve({ found: false });
          }
        });
      },
    );
    req.on("error", () => resolve({ found: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ found: false });
    });
  });
}

// ── Rich diagnostics from flight + run record files ───────────────

interface RichDiagnostics {
  stderrTail?: string;
  closeReason?: string;
  overwrittenFallback?: boolean;
  stats?: Record<string, unknown>;
}

function readFlightFileDiagnostics(flightId: string): RichDiagnostics | null {
  try {
    const entries = fs.readdirSync(FLIGHTS_DIR);
    const match = entries.find(f => f.includes(flightId) && f.endsWith(".json"));
    if (!match) return null;

    const filePath = path.join(FLIGHTS_DIR, match);
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

    // Also check the run record for richer error data (stderr_tail, outputs)
    const runRecordId = record.run_record_id;
    if (runRecordId) {
      try {
        const runPath = path.join(RUNS_DIR, `${runRecordId}.json`);
        if (fs.existsSync(runPath)) {
          const runData = JSON.parse(fs.readFileSync(runPath, "utf-8"));
          if (runData.outputs?.stderr_tail && !diag.stderrTail) {
            diag.stderrTail = String(runData.outputs.stderr_tail).slice(0, 500);
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
  flightId: string,
  entity: string,
  planBasename: string,
): void {
  if (watchers.has(flightId)) return;

  let polls = 0;

  const check = async () => {
    polls++;

    const result = await pollFlight(flightId);

    if (!result.found) {
      if (polls >= MAX_POLLS) {
        const elapsed = polls * (POLL_INTERVAL_MS / 1000);
        pi.sendMessage(
          {
            customType: "koad-io-flight-landing",
            content: `⏳ **${entity}** ⟐ \`${flightId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\` — still flying after ${elapsed}s`,
            display: true,
            details: { flightId, entity, planBasename, status: "timeout", elapsedS: elapsed },
          },
          { triggerTurn: true },
        );
        stopWatching(flightId);
      }
      return;
    }

    const status = result.status ?? "flying";
    if (status === "flying") {
      if (polls >= MAX_POLLS) {
        const elapsed = polls * (POLL_INTERVAL_MS / 1000);
        pi.sendMessage(
          {
            customType: "koad-io-flight-landing",
            content: `⏳ **${entity}** ⟐ \`${flightId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\` — still flying after ${elapsed}s`,
            display: true,
            details: { flightId, entity, planBasename, status: "timeout", elapsedS: elapsed },
          },
          { triggerTurn: true },
        );
        stopWatching(flightId);
      }
      return;
    }

    // Landed or errored
    const elapsedS = result.elapsed_s ?? 0;
    const mins = Math.floor(elapsedS / 60);
    const secs = elapsedS % 60;
    const dur = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    let note = result.closingNote ? ` — ${result.closingNote}` : "";

    // For failed/error flights, surface richer diagnostics
    let diag: RichDiagnostics | null = null;
    if (status === "error" || status === "failed") {
      diag = readFlightFileDiagnostics(flightId);
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
      msg = `✓ **${entity}** landed ⟐ \`${flightId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\` (${dur})${note}`;
    } else if (status === "error" || status === "failed") {
      msg = `⚠ **${entity}** ${status} ⟐ \`${flightId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\`${note}`;
    } else {
      msg = `⏳ **${entity}** ⟐ \`${flightId.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\` — ${status} after ${dur}`;
    }

    pi.sendMessage(
      {
        customType: "koad-io-flight-landing",
        content: msg,
        display: true,
        details: {
          flightId,
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

    stopWatching(flightId);
  };

  const timer = setInterval(check, POLL_INTERVAL_MS);
  watchers.set(flightId, timer);
  // Run immediately for fast flights
  check();
}

function stopWatching(flightId: string): void {
  const timer = watchers.get(flightId);
  if (timer) {
    clearInterval(timer);
    watchers.delete(flightId);
  }
}
