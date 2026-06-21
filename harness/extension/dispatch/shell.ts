// Dispatch shell helpers — entity home resolution and shell execution.
//
// Pure functions with no dispatch-specific logic. Used by both the
// assembly step (juno assemble) and the launch step (koad-io dispatch open).

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = os.homedir();

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
