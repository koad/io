// Flight plan assembly — calls `juno assemble flight` and extracts
// the dispatch plan path from stdout.
//
// Separated from the launch orchestration so assembly errors are
// classified in one place and the main dispatch function stays lean.

import * as fs from "node:fs";
import { execFull } from "./shell";
import { parseAssembleError, type DispatchError } from "./errors";

export interface AssembleResult {
  ok: boolean;
  planPath?: string;
  error?: DispatchError;
}

export function assembleFlight(
  entity: string,
  task: string,
  budget: number,
  modelCeiling: string,
): AssembleResult {
  const cmd = `juno assemble flight ${entity} --budget ${budget} --model-ceiling ${modelCeiling}`;
  const result = execFull(cmd, task, undefined, 30000);

  if (result.exitCode !== 0) {
    return { ok: false, error: parseAssembleError(result.stderr) };
  }

  const planPath = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("/") && l.endsWith(".md"))
    .pop();

  if (!planPath || !fs.existsSync(planPath)) {
    return {
      ok: false,
      error: {
        kind: "PLAN_NOT_FOUND",
        message: "Dispatch plan path not found in assemble output",
        detail: result.stdout.slice(-500),
      },
    };
  }

  return { ok: true, planPath };
}
