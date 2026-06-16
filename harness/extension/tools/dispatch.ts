// Dispatch tool registrations — dispatch, dispatch_followup, dispatch_complete, wait.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { clipText as clip, formatDurationSeconds as formatDuration } from "../utils/tool-render";
import { dispatchFlight, type DispatchResult } from "../dispatch/flight";
import { startWatching } from "../dispatch/watcher";

const HOME = os.homedir();

function shortFlightId(flightId?: string): string {
  return (flightId ?? "?").replace(/^\d{8}T\d{6}-\d{3}Z-/, "");
}


function parseLastJsonLine(stdout: string): Record<string, any> {
  const lines = stdout.split("\n").map(line => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {}
  }
  return {};
}

function waitGoal(sub: string): string {
  return sub === "followup"
    ? "follow-up request or mission completion"
    : "flight to land";
}

async function runWaitCommand(
  command: string,
  meta: Record<string, unknown>,
  signal?: AbortSignal,
  onUpdate?: (patch: { details?: Record<string, unknown>; content?: Array<{ type: "text"; text: string }> }) => void,
): Promise<{ stdout: string; stderr: string; exitCode: number; elapsed_s: number; aborted: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = cp.spawn("bash", ["-lc", command], {
      cwd: HOME,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    const startedAt = Date.now();
    let tick: ReturnType<typeof setInterval> | undefined;

    const finish = (result: { stdout: string; stderr: string; exitCode: number; elapsed_s: number; aborted: boolean }) => {
      if (settled) return;
      settled = true;
      if (tick) clearInterval(tick);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        ...result,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      });
    };

    const emitProgress = () => {
      onUpdate?.({
        content: [{ type: "text", text: "waiting..." }],
        details: {
          ...meta,
          status: "waiting",
          elapsed_s: Math.round((Date.now() - startedAt) / 1000),
        },
      });
    };

    const onAbort = () => {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => {
        try {
          if (child.exitCode == null) child.kill("SIGKILL");
        } catch {}
      }, 1500);
      finish({
        stdout,
        stderr,
        exitCode: 130,
        elapsed_s: Math.round((Date.now() - startedAt) / 1000),
        aborted: true,
      });
    };

    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      finish({
        stdout,
        stderr,
        exitCode: code ?? 1,
        elapsed_s: Math.round((Date.now() - startedAt) / 1000),
        aborted: false,
      });
    });

    emitProgress();
    tick = setInterval(emitProgress, 1000);
  });
}

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

const DispatchShape = StringEnum(["flight"] as const, {
  description: 'Dispatch shape. "flight" assembles a flight plan and launches a detached harness session.',
  default: "flight",
});

const DispatchParams = Type.Object({
  entity: Type.String({ description: "Target entity name (vulcan, muse, copia, etc.)" }),
  task: Type.String({ description: "Task description — prose prompt for the dispatched entity" }),
  shape: Type.Optional(DispatchShape),
  cwd: Type.Optional(Type.String({ description: "Working directory for roaming entities (defaults to entity home)" })),
  budget: Type.Optional(Type.Number({ description: "Token budget ceiling for the dispatch" })),
  model_ceiling: Type.Optional(
    StringEnum(["local", "mid", "frontier"] as const, {
      description: "Model tier ceiling. Default: frontier.",
      default: "frontier",
    }),
  ),
});

const FollowupParams = Type.Object({
  flight_id: Type.String({ description: "Flight ID to send follow-up to" }),
  prompt: Type.String({ description: "Follow-up prompt for the running entity" }),
});

const CompleteParams = Type.Object({
  flight_id: Type.String({ description: "Flight ID to complete" }),
  note: Type.Optional(Type.String({ description: "Optional closing note" })),
});

const WaitParams = Type.Object({
  sub: StringEnum(["flight", "followup"] as const, {
    description: '"flight" polls until a dispatched flight lands. "followup" polls until entity requests follow-up.',
    default: "flight",
  }),
  flight_id: Type.String({ description: "Flight ID to wait for (required for sub=flight)" }),
  timeout: Type.Optional(Type.Number({ description: "Max seconds to wait (default 300). 0 = no timeout.", default: 300 })),
  interval: Type.Optional(Type.Number({ description: "Seconds between polls (default 4).", default: 4 })),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDispatchTools(pi: ExtensionAPI): void {
  // ── wait tool ──────────────────────────────────────────────────
  pi.registerTool({
    name: "wait",
    label: "Wait",
    description: "Block until a kingdom event completes. Supports waiting for a dispatched flight to land, or for a running entity to request a follow-up prompt.",
    promptSnippet: "Wait for flight (sub: flight) or follow-up request (sub: followup)",
    promptGuidelines: [
      "Use wait flight when you need to block on a previously dispatched flight completing.",
      "Use wait followup when a running entity is awaiting further direction — blocks until they request it.",
    ],
    parameters: WaitParams,

    renderCall(args: any, theme: any) {
      const sub = args.sub || "flight";
      const flightId = shortFlightId(args.flight_id);
      const timeout = args.timeout ?? 300;
      const interval = args.interval ?? 4;
      const timeoutText = timeout === 0 ? "∞" : formatDuration(timeout);
      const text = [
        theme.fg("toolTitle", theme.bold("wait ")) + theme.fg("accent", `${sub} → ${flightId}`),
        `  ${theme.fg("dim", `waiting for: ${waitGoal(sub)}`)}`,
        `  ${theme.fg("dim", `timeout: ${timeoutText} · poll: every ${interval}s · Esc cancels local wait`)}`,
      ].join("\n");
      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded, isPartial }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const sub = details.sub ?? "flight";
      const flightId = shortFlightId(details.flight_id);
      const elapsed = formatDuration(details.elapsed_s ?? 0);
      const timeout = details.timeout_s === 0 ? "∞" : formatDuration(details.timeout_s ?? 300);
      const poll = details.poll_interval_s ?? 4;
      const lines: string[] = [];

      if (isPartial || details.status === "waiting") {
        lines.push(theme.fg("warning", `⏳ waiting for ${waitGoal(sub)}`));
        lines.push(`  ${theme.fg("accent", `flight: ${flightId}`)} ${theme.fg("dim", `· elapsed: ${elapsed} · timeout: ${timeout} · poll: ${poll}s`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "cancelled") {
        lines.push(theme.fg("warning", `⏸ wait cancelled`));
        lines.push(`  ${theme.fg("accent", `flight: ${flightId}`)} ${theme.fg("dim", `· elapsed: ${elapsed} · timeout: ${timeout}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (sub === "flight") {
        if (details.status === "landed") {
          lines.push(theme.fg("success", `✓ flight landed after ${elapsed}`));
          if (details.closingNote) lines.push(`  ${theme.fg("dim", details.closingNote)}`);
          return new Text(lines.join("\n"), 0, 0);
        }
        if (details.status === "timeout") {
          lines.push(theme.fg("warning", `⏳ flight still flying after ${elapsed}`));
          lines.push(`  ${theme.fg("accent", `flight: ${flightId}`)} ${theme.fg("dim", `· timeout: ${timeout} · poll: ${poll}s`)}`);
          return new Text(lines.join("\n"), 0, 0);
        }
      }

      if (sub === "followup") {
        if (details.action === "complete") {
          lines.push(theme.fg("success", `✓ entity signaled mission complete after ${elapsed}`));
          if (expanded && details.note) lines.push(`  ${theme.fg("dim", details.note)}`);
          return new Text(lines.join("\n"), 0, 0);
        }
        if (details.action === "followup") {
          lines.push(theme.fg("success", `✓ follow-up requested after ${elapsed}`));
          if (expanded && details.prompt) lines.push(`  ${theme.fg("dim", `prompt: ${details.prompt}`)}`);
          return new Text(lines.join("\n"), 0, 0);
        }
        if (details.status === "timeout" || details.action === "timeout") {
          lines.push(theme.fg("warning", `⏳ no follow-up request after ${elapsed}`));
          lines.push(`  ${theme.fg("accent", `flight: ${flightId}`)} ${theme.fg("dim", `· timeout: ${timeout} · poll: ${poll}s`)}`);
          return new Text(lines.join("\n"), 0, 0);
        }
      }

      return new Text(theme.fg("dim", `wait finished for ${flightId}`), 0, 0);
    },

    async execute(_toolCallId, params, signal, onUpdate) {
      const sub = params.sub ?? "flight";
      const flightId = params.flight_id?.trim();
      if (!flightId) {
        throw new Error(`wait ${sub}: flight_id is required`);
      }

      const timeout = params.timeout ?? 300;
      const interval = params.interval ?? 4;
      const meta = {
        sub,
        flight_id: flightId,
        timeout_s: timeout,
        poll_interval_s: interval,
      };
      const cmd = `koad-io wait ${sub} ${flightId} --timeout=${timeout} --interval=${interval} --quiet`;
      const result = await runWaitCommand(cmd, meta, signal, onUpdate as any);

      if (result.aborted) {
        return {
          content: [{ type: "text", text: `wait cancelled — \`${shortFlightId(flightId)}\` still pending` }],
          details: { ...meta, status: "cancelled", elapsed_s: result.elapsed_s, interrupted: true },
        };
      }

      const parsed = parseLastJsonLine(result.stdout);

      if (sub === "flight") {
        if (result.exitCode === 0) {
          const details = { ...meta, ...parsed, status: "landed", elapsed_s: parsed.elapsed_s ?? result.elapsed_s };
          const note = details.closingNote ? ` — ${details.closingNote}` : "";
          return {
            content: [{ type: "text", text: `✓ flight landed (${formatDuration(details.elapsed_s)})${note}` }],
            details,
          };
        }
        if (result.exitCode === 2) {
          return {
            content: [{ type: "text", text: `⏳ flight still flying after timeout` }],
            details: { ...meta, ...parsed, status: "timeout", elapsed_s: parsed.elapsed_s ?? result.elapsed_s },
          };
        }
        throw new Error(`wait flight failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`);
      }

      if (sub === "followup") {
        if (result.exitCode === 0) {
          const action = parsed.action === "complete" ? "complete" : "followup";
          const details = { ...meta, ...parsed, action, status: action, elapsed_s: parsed.elapsed_s ?? result.elapsed_s };
          if (action === "complete") {
            return { content: [{ type: "text", text: `✓ entity signaled mission complete` }], details };
          }
          return { content: [{ type: "text", text: `entity requests follow-up` }], details };
        }
        if (result.exitCode === 2) {
          return {
            content: [{ type: "text", text: `⏳ no follow-up request after timeout` }],
            details: { ...meta, ...parsed, action: "timeout", status: "timeout", elapsed_s: parsed.elapsed_s ?? result.elapsed_s },
          };
        }
        throw new Error(`wait followup failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`);
      }

      throw new Error(`wait: unknown sub "${sub}". Supported: flight, followup`);
    },
  });

  // ── dispatch_followup ──────────────────────────────────────────
  pi.registerTool({
    name: "dispatch_followup",
    label: "Dispatch Followup",
    description: "Send a follow-up prompt to a running entity that called `koad-io wait followup`. Appends to the dispatch's followup.jsonl file.",
    promptSnippet: "Send follow-up prompt to running entity (flight_id, prompt)",
    promptGuidelines: [
      "Use dispatch_followup when a dispatched entity is awaiting further direction.",
      "Appends JSONL to \$KOAD_IO_RUNTIME_PATH/dispatches/<id>/followup.jsonl.",
      "Use dispatch_complete to signal mission finished instead of sending more work.",
    ],
    parameters: FollowupParams,
    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("dispatch_followup ")) + theme.fg("accent", `${shortFlightId(args.flight_id)}`),
        `  ${theme.fg("dim", args.prompt ?? "")}`,
      ].join("\n"), 0, 0);
    },
    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const lines = [
        theme.fg("success", `✓ follow-up sent`),
        `  ${theme.fg("accent", `flight: ${shortFlightId(details.flight_id)}`)} ${theme.fg("dim", `· ${clip(details.prompt ?? "", expanded ? 180 : 90)}`)}`,
      ];
      if (expanded && details.file) lines.push(`  ${theme.fg("dim", `file: ${details.file}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },
    async execute(_toolCallId, params, _signal) {
      const rawId = params.flight_id.trim();
      // Resolve short IDs (e.g. vulcan-d98aba) to full flight IDs by globbing
      // the flights directory. The followup file uses the full timestamp-prefixed
      // format: YYYYMMDDTHHMMSS-mmmZ-entity-shortid.followup.jsonl
      let flightId = rawId;
      const runtimePath = process.env.KOAD_IO_RUNTIME_PATH || path.join(HOME, ".local", "share", "koad-io", "runtime");
      const dispatchesDir = path.join(runtimePath, "dispatches");
      if (!/^\d{8}T\d{6}-\d{3}Z-/.test(rawId)) {
        try {
          const candidates = fs.readdirSync(dispatchesDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.includes(rawId))
            .map(d => d.name);
          if (candidates.length === 1) {
            flightId = candidates[0];
          }
          // If no candidates found, fall through with rawId
        } catch (_) {
          // readdir failed — fall through with rawId
        }
      }
      const prompt = params.prompt.trim();
      const file = path.join(dispatchesDir, flightId, "followup.jsonl");
      const entry = JSON.stringify({ from: "juno", prompt, at: new Date().toISOString() }) + "\n";
      try {
        fs.appendFileSync(file, entry, "utf-8");
        return { content: [{ type: "text", text: `followup sent to flight \`${shortFlightId(flightId)}\`` }], details: { flight_id: flightId, prompt, file, sent: true } };
      } catch (err: any) {
        throw new Error(`followup failed: ${err.message}`);
      }
    },
  });

  // ── dispatch_complete ──────────────────────────────────────────
  pi.registerTool({
    name: "dispatch_complete",
    label: "Dispatch Complete",
    description: "Signal a running entity that the mission is complete. The entity's `koad-io wait followup` call will return with action=complete.",
    promptSnippet: "Signal mission complete to running entity (flight_id, note?)",
    promptGuidelines: [
      "Use dispatch_complete when you're satisfied with a dispatched entity's work.",
      "Appends to \$KOAD_IO_RUNTIME_PATH/dispatches/<id>/followup.jsonl.",
    ],
    parameters: CompleteParams,
    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("dispatch_complete ")) + theme.fg("accent", `${shortFlightId(args.flight_id)}`),
        `  ${theme.fg("dim", args.note || "mission complete")}`,
      ].join("\n"), 0, 0);
    },
    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const lines = [
        theme.fg("success", `✓ mission complete signaled`),
        `  ${theme.fg("accent", `flight: ${shortFlightId(details.flight_id)}`)} ${theme.fg("dim", `· ${details.note || "mission complete"}`)}`,
      ];
      if (expanded && details.file) lines.push(`  ${theme.fg("dim", `file: ${details.file}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },
    async execute(_toolCallId, params, _signal) {
      const rawId = params.flight_id.trim();
      // Same short-ID resolution as dispatch_followup
      let flightId = rawId;
      const runtimePath = process.env.KOAD_IO_RUNTIME_PATH || path.join(HOME, ".local", "share", "koad-io", "runtime");
      const dispatchesDir = path.join(runtimePath, "dispatches");
      if (!/^\d{8}T\d{6}-\d{3}Z-/.test(rawId)) {
        try {
          const candidates = fs.readdirSync(dispatchesDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.includes(rawId))
            .map(d => d.name);
          if (candidates.length === 1) {
            flightId = candidates[0];
          }
        } catch (_) {}
      }
      const note = params.note?.trim() || "mission complete";
      const file = path.join(dispatchesDir, flightId, "followup.jsonl");
      const entry = JSON.stringify({ action: "complete", from: "juno", note, at: new Date().toISOString() }) + "\n";
      try {
        fs.appendFileSync(file, entry, "utf-8");
        return { content: [{ type: "text", text: `mission complete signaled for \`${shortFlightId(flightId)}\`` }], details: { flight_id: flightId, action: "complete", note, file } };
      } catch (err: any) {
        throw new Error(`complete failed: ${err.message}`);
      }
    },
  });

  // ── dispatch ───────────────────────────────────────────────────
  pi.registerTool({
    name: "dispatch",
    label: "Dispatch",
    description: "Dispatch work to another koad:io entity. Supports shape 'flight' (assembles a flight plan and launches a detached harness session via control-tower).",
    promptSnippet: "Dispatch work to entity (shape: flight) — assembles plan + control-tower launch",
    promptGuidelines: [
      "Use dispatch when delegating work to another entity (vulcan, muse, copia, etc.).",
      "The flight shape launches a detached harness session — the entity runs independently.",
      "If the target entity is not KOAD_IO_ROOTED (check ~/.[entity]/.env), you MUST provide cwd so the entity knows where to work. Otherwise the dispatch will fail.",
      "Prefer dispatch over bash-level assemble+control-dispatch for audit trail and emission tracking.",
    ],
    parameters: DispatchParams,

    renderCall(args: any, theme: any) {
      const entity = args.entity || "...";
      const task = args.task || "...";
      const shape = args.shape || "flight";
      const cwdHint = args.cwd ? ` @ ${args.cwd.replace(/^\/home\/koad/, "~")}` : "";
      const text = theme.fg("toolTitle", theme.bold("dispatch ")) + theme.fg("accent", `${shape} → ${entity}${cwdHint}`) + "\n  " + theme.fg("dim", task);
      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = result.details as DispatchResult | undefined;
      if (!details?.ok) {
        return new Text(theme.fg("error", `✗ dispatch failed: ${details?.error ?? "unknown error"}`), 0, 0);
      }
      const entity = details.entity ?? "?";
      const fid = (details.flight_id ?? "?").replace(/^\d{8}T\d{6}-\d{3}Z-/, '');
      const cwdLabel = details.cwd ? ` @ ${details.cwd.replace(/^\/home\/koad/, "~")}` : "";
      const lines = [theme.fg("success", `✓ dispatched ${entity}${cwdLabel}`), `  ${theme.fg("accent", `flight: ${fid}`)}`];
      if (expanded && details.plan_path) lines.push(`  ${theme.fg("dim", `plan: ${details.plan_path}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal) {
      const shape = params.shape ?? "flight";
      const entity = params.entity?.trim();
      const task = params.task?.trim();

      if (!entity) throw new Error("dispatch: entity is required");
      if (!task) throw new Error("dispatch: task is required");

      if (shape === "flight") {
        const result = await dispatchFlight({ entity, task, cwd: params.cwd, budget: params.budget, modelCeiling: params.model_ceiling });

        if (!result.ok) {
          return {
            content: [{ type: "text", text: `✗ dispatch failed: ${result.error ?? `dispatch ${entity} failed`}` }],
            details: result,
          };
        }

        const planBasename = path.basename(result.plan_path ?? "", ".md");
        const summary = [`dispatched **${entity}**  ⟐ \`${result.flight_id!.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\``, `plan: \`${planBasename}\`  ·  path: ${result.plan_path}`].join("\n");

        startWatching(pi, result.flight_id!, entity, planBasename);

        return { content: [{ type: "text", text: summary }], details: result };
      }

      throw new Error(`dispatch: unknown shape "${shape}". Supported: flight`);
    },
  });
}
