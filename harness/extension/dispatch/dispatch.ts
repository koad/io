// Dispatch orchestration — assembles a flight plan, launches via
// control-tower, retries preflight failures, and writes the DDP record.
//
// Delegates: error taxonomy → ./errors, shell helpers → ./shell,
// assembly logic → ./assemble. This file stays focused on the
// retry loop, DDP write, and top-level result assembly.

import * as os from "node:os";
import { getDDPClient } from "../ddp";
import { execFull, entityHome } from "./shell";
import { assembleFlight } from "./assemble";
import {
  parseDispatchError,
  type DispatchError,
  type DispatchErrorKind,
} from "./errors";

// Re-export types for consumers
export type { DispatchErrorKind, DispatchError } from "./errors";

// ── Result type (returned by dispatchFlight) ──────────────────────

export interface DispatchResult {
  ok: boolean;
  dispatch_id?: string;
  plan_path?: string;
  entity: string;
  shape: string;
  cwd?: string;
  error?: string;
  _error?: DispatchError;
}

// ── Constants ─────────────────────────────────────────────────────

const PREFLIGHT_RETRIES = 3;
const PREFLIGHT_RETRY_DELAY_MS = 5000;

// ── Main dispatch ──────────────────────────────────────────────────

export async function dispatchFlight(params: {
  entity: string;
  task: string;
  cwd?: string;
  budget?: number;
  modelCeiling?: string;
}): Promise<DispatchResult> {
  const { entity, task } = params;

  // ── Entity existence ──────────────────────────────────────────
  const home = entityHome(entity);
  if (!home) {
    return {
      ok: false,
      entity,
      shape: "flight",
      error: `Entity "${entity}" not found — no directory at ~/.${entity}`,
      _error: {
        kind: "ENTITY_NOT_FOUND",
        message: `Entity "${entity}" not found — no ~/.${entity}/`,
      },
    };
  }

  // ── Resolve cwd: explicit > entity home ─────────────────────
  const cwd = params.cwd || home;

  // ── Assemble ──────────────────────────────────────────────────
  const assembled = assembleFlight(
    entity,
    task,
    params.budget || 0,
    params.modelCeiling || "frontier",
  );

  if (!assembled.ok) {
    const err = assembled.error!;
    return {
      ok: false,
      entity,
      shape: "flight",
      error: err.message,
      _error: err,
    };
  }

  const planPath = assembled.planPath!;

  // ── Dispatch via koad-io dispatch open ───────────────────────
  const budgetFlag = params.budget ? ` --budget=${params.budget}` : "";
  const ceilingFlag = params.modelCeiling
    ? ` --model=${params.modelCeiling}`
    : "";
  const cwdFlag = cwd ? ` --cwd=${cwd}` : "";
  const dispatchCmd = `koad-io dispatch open ${entity} --plan=${planPath}${cwdFlag}${budgetFlag}${ceilingFlag}`;

  let dispatched = execFull(dispatchCmd, undefined, undefined, 0); // no timeout

  // Retry preflight failures — daemon/control-tower may be restarting
  for (let attempt = 1; attempt <= PREFLIGHT_RETRIES; attempt++) {
    if (dispatched.exitCode === 0) break;
    const parsed = parseDispatchError(
      dispatched.stderr,
      dispatched.stdout,
      dispatched.exitCode,
    );
    if (
      parsed.kind === "PREFLIGHT_DAEMON_DOWN" ||
      parsed.kind === "PREFLIGHT_CONTROL_DOWN" ||
      parsed.kind === "PREFLIGHT_FAILED"
    ) {
      if (attempt <= PREFLIGHT_RETRIES) {
        await new Promise((r) => setTimeout(r, PREFLIGHT_RETRY_DELAY_MS));
        dispatched = execFull(dispatchCmd, undefined, undefined, 0);
        continue;
      }
    }
    break;
  }

  if (dispatched.exitCode !== 0) {
    const parsed = parseDispatchError(
      dispatched.stderr,
      dispatched.stdout,
      dispatched.exitCode,
    );
    return {
      ok: false,
      entity,
      shape: "flight",
      plan_path: planPath,
      error: parsed.message + (parsed.detail ? ` — ${parsed.detail}` : ""),
      _error: parsed,
    };
  }

  // ── Extract dispatch ID from JSON output ────────────────────────
  let parsedOutput: any;
  try {
    parsedOutput = JSON.parse(dispatched.stdout);
  } catch (_) {
    return {
      ok: false,
      entity,
      shape: "flight",
      plan_path: planPath,
      error: "dispatch succeeded but returned invalid JSON",
      _error: {
        kind: "SPAWN_FAILED",
        message: "Invalid JSON from dispatch open",
        detail: dispatched.stdout.slice(-300),
      },
    };
  }

  const dispatchId = parsedOutput.dispatch_id ?? parsedOutput.flight_id;

  if (!dispatchId) {
    return {
      ok: false,
      entity,
      shape: "flight",
      plan_path: planPath,
      error: "Dispatch succeeded but dispatch-id not found in output",
      _error: {
        kind: "DISPATCH_ID_NOT_FOUND",
        message: "No dispatch-id in dispatch output",
        detail: dispatched.stdout.slice(-300),
      },
    };
  }

  // ── Write dispatch record to control-tower live via DDP ──────
  const control = getDDPClient("control");
  if (control?.isConnected) {
    control
      .call("dispatch.create", {
        _id: dispatchId,
        entity,
        status: "flying",
        brief: planPath,
        started: new Date(),
        host: os.hostname(),
      })
      .catch(() => {});
  }

  return {
    ok: true,
    dispatch_id: dispatchId,
    plan_path: planPath,
    entity,
    shape: "flight",
    cwd,
  };
}
