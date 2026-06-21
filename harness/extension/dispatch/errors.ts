// Dispatch error classification and parsing.
//
// Provides the error taxonomy for dispatch failures — both assembly-time
// (entity not found, conservation violations, kingdom ceiling) and
// runtime (daemon/control-tower unreachable, HTTP errors, spawn failures).

// ── Error kinds ──────────────────────────────────────────────────────

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
  | "DISPATCH_ID_NOT_FOUND"
  | "SPAWN_FAILED";

export interface DispatchError {
  kind: DispatchErrorKind;
  message: string;
  detail?: string; // raw server response or extra context
}

// ── Parser: dispatch stderr ───────────────────────────────────────────

export function parseDispatchError(
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

// ── Parser: assemble stderr ───────────────────────────────────────────

export function parseAssembleError(stderr: string): DispatchError {
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
    message: "Dispatch assembly failed",
    detail: stderr.slice(-400),
  };
}
