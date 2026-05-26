// Dispatch tool registrations — dispatch, dispatch_followup, dispatch_complete, wait.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { dispatchFlight, execFull, type DispatchResult } from "./flight";
import { startWatching } from "./watcher";

const HOME = os.homedir();

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

    async execute(_toolCallId, params, signal) {
      const sub = params.sub ?? "flight";

      if (sub === "flight") {
        if (!params.flight_id?.trim()) {
          throw new Error("wait flight: flight_id is required");
        }

        const timeout = params.timeout ?? 300;
        const interval = params.interval ?? 4;
        // timeout 0 = wait forever (no limit)
        const execTimeout = timeout === 0 ? 0 : (timeout + 15) * 1000; // add 15s buffer for CLI overhead
        const cmd = `koad-io wait flight ${params.flight_id.trim()} --timeout=${timeout} --interval=${interval} --quiet`;
        const result = execFull(cmd, undefined, undefined, execTimeout);

        if (signal?.aborted) {
          return { content: [{ type: "text", text: "wait cancelled" }], details: { ok: false } };
        }

        if (result.exitCode === 0) {
          const parsed = JSON.parse(result.stdout.split("\n").pop() || "{}");
          const elapsed = parsed.elapsed_s ?? 0;
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const dur = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          const note = parsed.closingNote ? ` — ${parsed.closingNote}` : "";
          return { content: [{ type: "text", text: `✓ flight landed (${dur})${note}` }], details: parsed };
        } else if (result.exitCode === 2) {
          const parsed = JSON.parse(result.stdout.split("\n").pop() || "{}");
          return { content: [{ type: "text", text: `⏳ flight still flying after timeout` }], details: parsed };
        } else {
          throw new Error(`wait flight failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`);
        }
      }

      if (sub === "followup") {
        if (!params.flight_id?.trim()) {
          throw new Error("wait followup: flight_id is required");
        }
        const timeout = params.timeout ?? 300;
        const interval = params.interval ?? 4;
        // timeout 0 = wait forever (no limit)
        const execTimeout = timeout === 0 ? 0 : (timeout + 15) * 1000;
        const cmd = `koad-io wait followup ${params.flight_id.trim()} --timeout=${timeout} --interval=${interval} --quiet`;
        const result = execFull(cmd, undefined, undefined, execTimeout);

        if (signal?.aborted) {
          return { content: [{ type: "text", text: "wait cancelled" }], details: { ok: false } };
        }

        if (result.exitCode === 0) {
          const parsed = JSON.parse(result.stdout.split("\n").pop() || "{}");
          if (parsed.action === "complete") {
            return { content: [{ type: "text", text: `✓ entity signaled mission complete` }], details: parsed };
          }
          return { content: [{ type: "text", text: `entity requests follow-up` }], details: parsed };
        } else if (result.exitCode === 2) {
          return { content: [{ type: "text", text: `⏳ no follow-up request after timeout` }], details: { action: "timeout" } };
        } else {
          throw new Error(`wait followup failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`);
        }
      }

      throw new Error(`wait: unknown sub "${sub}". Supported: flight, followup`);
    },
  });

  // ── dispatch_followup ──────────────────────────────────────────
  pi.registerTool({
    name: "dispatch_followup",
    label: "Dispatch Followup",
    description: "Send a follow-up prompt to a running entity that called `koad-io wait followup`. Appends to the flight's followup.jsonl file.",
    promptSnippet: "Send follow-up prompt to running entity (flight_id, prompt)",
    promptGuidelines: [
      "Use dispatch_followup when a dispatched entity is awaiting further direction.",
      "Appends JSONL to ~/.juno/control/flights/<id>.followup.jsonl.",
      "Use dispatch_complete to signal mission finished instead of sending more work.",
    ],
    parameters: FollowupParams,
    async execute(_toolCallId, params, _signal) {
      const file = path.join(HOME, ".juno", "control", "flights", `${params.flight_id.trim()}.followup.jsonl`);
      const entry = JSON.stringify({ from: "juno", prompt: params.prompt.trim(), at: new Date().toISOString() }) + "\n";
      try {
        fs.appendFileSync(file, entry, "utf-8");
        return { content: [{ type: "text", text: `followup sent to flight \`${params.flight_id.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\`` }], details: { flight_id: params.flight_id, sent: true } };
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
      "Appends to ~/.juno/control/flights/<id>.followup.jsonl.",
    ],
    parameters: CompleteParams,
    async execute(_toolCallId, params, _signal) {
      const file = path.join(HOME, ".juno", "control", "flights", `${params.flight_id.trim()}.followup.jsonl`);
      const entry = JSON.stringify({ action: "complete", from: "juno", note: params.note?.trim() || "mission complete", at: new Date().toISOString() }) + "\n";
      try {
        fs.appendFileSync(file, entry, "utf-8");
        return { content: [{ type: "text", text: `mission complete signaled for \`${params.flight_id.replace(/^\d{8}T\d{6}-\d{3}Z-/, '')}\`` }], details: { flight_id: params.flight_id, action: "complete" } };
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
      const task = (args.task || "...").slice(0, 60);
      const shape = args.shape || "flight";
      const text = theme.fg("toolTitle", theme.bold("dispatch ")) + theme.fg("accent", `${shape} → ${entity}`) + "\n  " + theme.fg("dim", task);
      return new Text(text, 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const details = result.details as DispatchResult | undefined;
      if (!details?.ok) {
        return new Text(theme.fg("error", `✗ dispatch failed: ${details?.error ?? "unknown error"}`), 0, 0);
      }
      const entity = details.entity ?? "?";
      const fid = (details.flight_id ?? "?").replace(/^\d{8}T\d{6}-\d{3}Z-/, '');
      return new Text(theme.fg("success", "⟐ ") + theme.fg("accent", entity) + theme.fg("dim", ` \`${fid}\` — dispatched`), 0, 0);
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
          throw new Error(`dispatch ${entity} failed: ${result.error}`);
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
