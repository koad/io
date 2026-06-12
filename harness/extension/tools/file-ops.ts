/**
 * koad-io file operation tools — cp, mv, rm, chmod, mkdir.
 *
 * Gated by the bond gate's write scope (same as write/edit tools).
 * Registered as FILE_WRITE_TOOLS so the bond gate enforces path permissions.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { clipText as clip } from "../utils/tool-render";

function resolvePath(raw: string, cwd: string): string {
  if (raw.startsWith("/") || raw.startsWith("~")) return raw.replace(/^~/, process.env.HOME || "/home/koad");
  return path.resolve(cwd, raw);
}

export function registerFileOpTools(pi: ExtensionAPI): void {

  // ── mkdir ────────────────────────────────────────────────────
  pi.registerTool({
    name: "mkdir",
    label: "Mkdir",
    description: "Create a directory. Creates parent directories automatically.",
    promptSnippet: "mkdir path — create a directory tree",
    promptGuidelines: ["Use mkdir to create directories within your write scope."],
    parameters: Type.Object({
      path: Type.String({ description: "Directory path to create." }),
    }),

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("mkdir ")) + theme.fg("accent", clip(args.path || "", 50)),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? `✓ created ${clip(result?.details?.path || "", 50)}` : `✗ ${clip(result?.details?.error || "", 80)}`),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const cwd = process.env.HARNESS_WORK_DIR || process.cwd();
      const dir = resolvePath(params.path, cwd);
      try {
        fs.mkdirSync(dir, { recursive: true });
        return {
          content: [{ type: "text", text: `✓ created ${dir}` }],
          details: { path: dir },
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: "text", text: `✗ ${err.message}` }], details: { error: err.message } };
      }
    },
  });

  // ── cp ───────────────────────────────────────────────────────
  pi.registerTool({
    name: "cp",
    label: "Copy",
    description: "Copy a file or directory from source to destination. Creates destination parent dirs.",
    promptSnippet: "cp src dst — duplicate a file or directory",
    promptGuidelines: ["Use cp to duplicate files within your write scope."],
    parameters: Type.Object({
      src: Type.String({ description: "Source path." }),
      dst: Type.String({ description: "Destination path." }),
    }),

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("cp ")) + theme.fg("accent", `${clip(args.src || "", 25)} → ${clip(args.dst || "", 25)}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? "✓ copied" : `✗ ${clip(result?.details?.error || "", 80)}`),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const cwd = process.env.HARNESS_WORK_DIR || process.cwd();
      const src = resolvePath(params.src, cwd);
      const dst = resolvePath(params.dst, cwd);
      try {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          fs.cpSync(src, dst, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
        }
        return {
          content: [{ type: "text", text: `✓ ${src} → ${dst}` }],
          details: { src, dst },
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: "text", text: `✗ ${err.message}` }], details: { error: err.message } };
      }
    },
  });

  // ── mv ───────────────────────────────────────────────────────
  pi.registerTool({
    name: "mv",
    label: "Move",
    description: "Move/rename a file or directory. Faster than cp+rm — same filesystem, instant.",
    promptSnippet: "mv src dst — move or rename a file",
    promptGuidelines: ["Use mv to relocate files within your write scope."],
    parameters: Type.Object({
      src: Type.String({ description: "Source path." }),
      dst: Type.String({ description: "Destination path." }),
    }),

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("mv ")) + theme.fg("accent", `${clip(args.src || "", 25)} → ${clip(args.dst || "", 25)}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? "✓ moved" : `✗ ${clip(result?.details?.error || "", 80)}`),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const cwd = process.env.HARNESS_WORK_DIR || process.cwd();
      const src = resolvePath(params.src, cwd);
      const dst = resolvePath(params.dst, cwd);
      try {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, dst);
        return {
          content: [{ type: "text", text: `✓ ${src} → ${dst}` }],
          details: { src, dst },
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: "text", text: `✗ ${err.message}` }], details: { error: err.message } };
      }
    },
  });

  // ── rm ───────────────────────────────────────────────────────
  pi.registerTool({
    name: "rm",
    label: "Remove",
    description: "Delete a file. Refuses to delete directories (safety).",
    promptSnippet: "rm path — delete a file (not dirs)",
    promptGuidelines: [
      "Delete a file. Won't delete directories — use bash rm -rf for that.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to delete." }),
    }),

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("rm ")) + theme.fg("accent", clip(args.path || "", 50)),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? "✓ deleted" : `✗ ${clip(result?.details?.error || "", 80)}`),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const cwd = process.env.HARNESS_WORK_DIR || process.cwd();
      const target = resolvePath(params.path, cwd);
      try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          return { isError: true, content: [{ type: "text", text: `✗ ${target} is a directory — use bash rm -rf for recursive deletion (blocked by bond gate for safety)` }], details: { error: "is a directory" } };
        }
        fs.unlinkSync(target);
        return {
          content: [{ type: "text", text: `✓ deleted ${target}` }],
          details: { path: target },
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: "text", text: `✗ ${err.message}` }], details: { error: err.message } };
      }
    },
  });

  // ── chmod ────────────────────────────────────────────────────
  pi.registerTool({
    name: "chmod",
    label: "Chmod",
    description: "Change file permissions. Octal (755) or symbolic (+x). Use to make scripts executable.",
    promptSnippet: "chmod 755 path — change file permissions",
    promptGuidelines: ["Use chmod to make scripts executable within your write scope."],
    parameters: Type.Object({
      path: Type.String({ description: "File path." }),
      mode: Type.String({ description: "Octal mode (e.g. 755) or symbolic (+x)." }),
    }),

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("chmod ")) + theme.fg("accent", `${args.mode || ""} ${clip(args.path || "", 30)}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? "✓ permissions updated" : `✗ ${clip(result?.details?.error || "", 80)}`),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const cwd = process.env.HARNESS_WORK_DIR || process.cwd();
      const target = resolvePath(params.path, cwd);
      try {
        if (params.mode.startsWith("+") || params.mode.startsWith("-")) {
          // Symbolic: +x, -x
          const flag = params.mode.includes("x") ? fs.constants.X_OK : 0;
          const current = fs.statSync(target).mode;
          if (params.mode.startsWith("+")) {
            fs.chmodSync(target, current | (flag || 0o111));
          } else {
            fs.chmodSync(target, current & ~(flag || 0o111));
          }
        } else {
          // Octal
          const oct = parseInt(params.mode, 8);
          fs.chmodSync(target, oct);
        }
        return {
          content: [{ type: "text", text: `✓ chmod ${params.mode} ${target}` }],
          details: { path: target, mode: params.mode },
        };
      } catch (err: any) {
        return { isError: true, content: [{ type: "text", text: `✗ ${err.message}` }], details: { error: err.message } };
      }
    },
  });
}
