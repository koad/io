import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const HOME = os.homedir();
const SIN_BIN = process.env.KOAD_IO_SIN_BIN || `${HOME}/.koad-io/bin/sin`;

const SinParams = Type.Object({
  query: Type.String({
    description: "Text to search for.",
  }),
  path: Type.String({
    description: "Directory to search in. Cannot be exactly your home directory; it must be a subfolder or another explicit directory.",
  }),
  limit: Type.Optional(Type.Number({
    description: "Maximum result lines to return (default 40, capped at 200).",
    default: 40,
  })),
});

function resolveSearchDir(rawPath: string, cwd: string): string {
  const expanded = rawPath === "~"
    ? HOME
    : rawPath.startsWith("~/")
      ? path.join(HOME, rawPath.slice(2))
      : rawPath;

  const absolute = path.resolve(cwd, expanded);
  const real = fs.realpathSync(absolute);
  const homeReal = fs.realpathSync(HOME);

  if (real === homeReal) {
    throw new Error("sin path cannot be your home directory directly — pick a subfolder instead");
  }

  const stat = fs.statSync(real);
  if (!stat.isDirectory()) {
    throw new Error("sin path must be a directory");
  }

  return real;
}

export function registerSinTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "sin",
    label: "Sin Search",
    description: "Search recursively inside one explicit directory using ~/.koad-io/bin/sin. Refuses to search your home directory directly; use a subfolder path instead.",
    promptSnippet: "Search recursively in one directory with sin (query, path, limit?)",
    promptGuidelines: [
      "Use sin when you want grep-like recursive text search inside one explicit directory.",
      "Always pass a concrete subdirectory path; sin refuses to search $HOME directly.",
    ],
    parameters: SinParams,

    renderCall(args: any, theme: any) {
      return new Text(
        theme.fg("toolTitle", theme.bold("sin ")) +
        theme.fg("accent", String(args?.path ?? "")) +
        theme.fg("dim", ` · ${String(args?.query ?? "")}`),
        0,
        0,
      );
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const shown = Number(details.shownLines ?? 0);
      const total = Number(details.totalLines ?? 0);
      const lines = [
        theme.fg("success", `✓ sin matches: ${total}`),
        `  ${theme.fg("dim", details.path ?? "")}`,
      ];
      if (!expanded && total > shown) {
        lines.push(`  ${theme.fg("dim", `showing ${shown} of ${total}`)}`);
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!fs.existsSync(SIN_BIN)) {
        throw new Error(`sin binary not found: ${SIN_BIN}`);
      }

      const query = String(params.query ?? "").trim();
      if (!query) throw new Error("sin query is required");

      const cwd = process.env.HARNESS_WORK_DIR || ctx.cwd || process.cwd();
      const searchDir = resolveSearchDir(String(params.path ?? ""), cwd);
      const limit = Math.min(Math.max(1, Number(params.limit ?? 40)), 200);

      const result = cp.spawnSync(SIN_BIN, [query], {
        cwd: searchDir,
        env: process.env,
        timeout: 30000,
        stdio: "pipe",
        maxBuffer: 1024 * 1024,
      });

      const stdout = (result.stdout || "").toString().trim();
      const stderr = (result.stderr || "").toString().trim();
      const exitCode = result.status ?? 0;

      if (result.error) {
        throw new Error(result.error.message || "sin spawn failed");
      }

      if (exitCode !== 0 && exitCode !== 1 && !stdout) {
        throw new Error(`sin failed: ${stderr || `exit ${exitCode}`}`);
      }

      const allLines = stdout ? stdout.split("\n") : [];
      const shownLines = allLines.slice(0, limit);
      const suffix = allLines.length > limit ? `\n… ${allLines.length - limit} more matches` : "";
      const text = shownLines.length > 0 ? `${shownLines.join("\n")}${suffix}` : "(no matches)";

      return {
        content: [{ type: "text", text }],
        details: {
          path: searchDir,
          query,
          exitCode,
          totalLines: allLines.length,
          shownLines: shownLines.length,
          stderr: stderr.slice(0, 1000),
        },
      };
    },
  });
}
