// Flight assembly + control-tower launch.
//
// Resilient dispatch: retries preflight failures (daemon restarts),
// classifies errors into actionable categories, parses structured
// error messages from control-tower HTTP responses.

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = os.homedir();

// ── Error classification ──────────────────────────────────────────

export type DispatchErrorKind =
  | "ENTITY_NOT_FOUND"
  | "NOT_ROOTED_NEEDS_CWD"
  | "ASSEMBLY_FAILED"
  | "PLAN_NOT_FOUND"
  | "PREFLIGHT_DAEMON_DOWN"
  | "PREFLIGHT_CONTROL_DOWN"
  | "PREFLIGHT_FAILED"
  | "CONTROL_REJECTED"
  | "CONTROL_ERROR"
  | "FLIGHT_ID_NOT_FOUND"
  | "SPAWN_FAILED";

export interface DispatchError {
  kind: DispatchErrorKind;
  message: string;
  detail?: string; // raw server response or extra context
}

export interface DispatchResult {
  ok: boolean;
  flight_id?: string;
  plan_path?: string;
  entity: string;
  shape: string;
  error?: string; // legacy — kept for renderResult; prefer DispatchError below
  _error?: DispatchError;
}

// ── Helpers ────────────────────────────────────────────────────────

export function entityHome(entity: string): string | null {
  const dir = path.join(HOME, `.${entity}`);
  return fs.existsSync(dir) ? dir : null;
}

export function execFull(
  command: string,
  input?: string,
  cwd?: string,
  timeoutMs = 0, // 0 = no timeout
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = cp.spawnSync("bash", ["-c", command], {
      cwd: cwd ?? HOME,
      timeout: timeoutMs === 0 ? undefined : timeoutMs,
      encoding: "utf-8",
      input: input ?? undefined,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      stdout: (result.stdout ?? "").trim(),
      stderr: (result.stderr ?? "").trim(),
      exitCode: result.status ?? 1,
    };
  } catch (err: any) {
    return {
      stdout: "",
      stderr: err?.message ?? "spawn failed",
      exitCode: 1,
    };
  }
}

// ── Error parser — extracts structured error from dispatch stderr ──

function parseDispatchError(
  stderr: string,
  stdout: string,
  exitCode: number,
): DispatchError {
  const combined = stderr + "\n" + stdout;

  // Preflight: daemon down
  const daemonMatch = combined.match(
    /preflight failed.*daemon\b[^:]*:\s*(.+)/i,
  );
  if (daemonMatch) {
    return {
      kind: "PREFLIGHT_DAEMON_DOWN",
      message: "Daemon unreachable — may be restarting",
      detail: daemonMatch[1].trim(),
    };
  }

  // Preflight: control-tower down
  const ctMatch = combined.match(
    /preflight failed.*control-tower\b[^:]*:\s*(.+)/i,
  );
  if (ctMatch) {
    return {
      kind: "PREFLIGHT_CONTROL_DOWN",
      message: "Control-tower unreachable — may be restarting",
      detail: ctMatch[1].trim(),
    };
  }

  // Generic preflight failure
  if (/preflight failed/i.test(combined)) {
    return {
      kind: "PREFLIGHT_FAILED",
      message: "Preflight check failed",
      detail: combined.slice(-400),
    };
  }

  // Control-tower HTTP error with JSON body
  const httpMatch = combined.match(
    /HTTP\s+(\d{3}):\s*(\{.+?\})\s*$/m,
  );
  if (httpMatch) {
    try {
      const body = JSON.parse(httpMatch[2]);
      const serverError = body.error || body.message || httpMatch[2];
      return {
        kind: "CONTROL_REJECTED",
        message: serverError,
        detail: `HTTP ${httpMatch[1]}`,
      };
    } catch {
      return {
        kind: "CONTROL_REJECTED",
        message: httpMatch[2].slice(0, 200),
        detail: `HTTP ${httpMatch[1]}`,
      };
    }
  }

  // HTTP error without parseable JSON
  const httpBare = combined.match(/HTTP\s+(\d{3})/);
  if (httpBare) {
    return {
      kind: "CONTROL_ERROR",
      message: `Control-tower returned HTTP ${httpBare[1]}`,
      detail: combined.slice(-300),
    };
  }

  // Fallback
  return {
    kind: "CONTROL_ERROR",
    message: `Dispatch exited ${exitCode}`,
    detail: combined.slice(-500),
  };
}

function parseAssembleError(stderr: string): DispatchError {
  if (/empty task on stdin/i.test(stderr)) {
    return {
      kind: "ASSEMBLY_FAILED",
      message: "No task provided — stdin was empty",
    };
  }
  if (/entity home not found/i.test(stderr)) {
    return {
      kind: "ENTITY_NOT_FOUND",
      message: "Entity home directory not found",
      detail: stderr.slice(-200),
    };
  }
  // Conservation violation
  const consMatch = stderr.match(/CONSERVATION VIOLATION[^\n]*/i);
  if (consMatch) {
    return {
      kind: "ASSEMBLY_FAILED",
      message: consMatch[0].trim(),
    };
  }
  // Kingdom ceiling
  const ceilMatch = stderr.match(/KINGDOM CEILING[^\n]*/i);
  if (ceilMatch) {
    return {
      kind: "ASSEMBLY_FAILED",
      message: ceilMatch[0].trim(),
    };
  }
  return {
    kind: "ASSEMBLY_FAILED",
    message: "Flight assembly failed",
    detail: stderr.slice(-400),
  };
}

// ── Main dispatch ──────────────────────────────────────────────────

const PREFLIGHT_RETRIES = 3;
const PREFLIGHT_RETRY_DELAY_MS = 5000;

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
      _error: { kind: "ENTITY_NOT_FOUND", message: `Entity "${entity}" not found — no ~/.${entity}/` },
    };
  }

  // ── Rooted check ──────────────────────────────────────────────
  const isRooted = (() => {
    try {
      const envFile = path.join(home, ".env");
      if (!fs.existsSync(envFile)) return false;
      const envRaw = fs.readFileSync(envFile, "utf8");
      return /^KOAD_IO_ROOTED\s*=\s*true\s*$/m.test(envRaw);
    } catch {
      return false;
    }
  })();

  if (!isRooted && !params.cwd) {
    return {
      ok: false,
      entity,
      shape: "flight",
      error: `Entity "${entity}" is not KOAD_IO_ROOTED. Provide a cwd so the entity knows where to work.`,
      _error: {
        kind: "NOT_ROOTED_NEEDS_CWD",
        message: `Entity "${entity}" not rooted — cwd required`,
      },
    };
  }

  // ── Assemble ──────────────────────────────────────────────────
  const budgetFlag = params.budget ? ` --budget ${params.budget}` : "";
  const ceilingFlag = params.modelCeiling
    ? ` --model-ceiling ${params.modelCeiling}`
    : "";

  const assembleCmd = `juno assemble flight ${entity}${budgetFlag}${ceilingFlag}`;
  const assembled = execFull(assembleCmd, task, undefined, 30000);

  if (assembled.exitCode !== 0) {
    const parsed = parseAssembleError(assembled.stderr);
    return {
      ok: false,
      entity,
      shape: "flight",
      error: parsed.message,
      _error: parsed,
    };
  }

  const planPath = assembled.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("/") && l.endsWith(".md"))
    .pop();

  if (!planPath || !fs.existsSync(planPath)) {
    return {
      ok: false,
      entity,
      shape: "flight",
      error: "Assemble succeeded but flight plan path not found in output",
      _error: {
        kind: "PLAN_NOT_FOUND",
        message: "Flight plan path not found in assemble output",
        detail: assembled.stdout.slice(-500),
      },
    };
  }

  // ── Dispatch (with preflight retry) ───────────────────────────
  const cwdFlag = params.cwd ? ` --cwd ${params.cwd}` : "";
  const dispatchCmd = `juno control dispatch ${entity} --plan=${planPath}${cwdFlag}`;

  let dispatched = execFull(dispatchCmd, undefined, undefined, 0); // no timeout

  // Retry preflight failures — daemon/control-tower may be restarting
  for (let attempt = 1; attempt <= PREFLIGHT_RETRIES; attempt++) {
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
    break; // not a retryable error, or we're done retrying
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

  // ── Extract flight ID ─────────────────────────────────────────
  const flightId = dispatched.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{8}T\d{6}-\d{3}Z-/.test(l))
    .pop();

  if (!flightId) {
    return {
      ok: false,
      entity,
      shape: "flight",
      plan_path: planPath,
      error: "Dispatch succeeded but flight-id not found in output",
      _error: {
        kind: "FLIGHT_ID_NOT_FOUND",
        message: "No flight-id in dispatch output",
        detail: dispatched.stdout.slice(-300),
      },
    };
  }

  return {
    ok: true,
    flight_id: flightId,
    plan_path: planPath,
    entity,
    shape: "flight",
  };
}
