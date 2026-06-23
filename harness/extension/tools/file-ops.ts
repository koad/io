/**
 * koad-io file operation tools — cp, mv, rm, chmod, mkdir, append.
 *
 * Gated by the bond gate's write scope (same as write/edit tools).
 * Registered as FILE_WRITE_TOOLS so the bond gate enforces path permissions.
 *
 * append is the safe write path for protected files (.env, .credentials,
 * etc.) where the LLM cannot read the contents (redacted by the scrubber)
 * so a blind write/edit would destroy them. append adds lines without
 * needing to see existing content.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { clipText as clip, clipPath } from "../utils/tool-render";

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
        theme.fg("toolTitle", theme.bold("mkdir ")) + theme.fg("accent", clipPath(args.path)),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? `✓ ${clipPath(result?.details?.dst)}` : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`),
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
        theme.fg("toolTitle", theme.bold("cp ")) + theme.fg("accent", `${clipPath(args.src)} → ${clipPath(args.dst)}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? `✓ ${clipPath(result?.details?.dst)}` : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`),
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
        theme.fg("toolTitle", theme.bold("mv ")) + theme.fg("accent", `${clipPath(args.src)} → ${clipPath(args.dst)}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? `✓ ${clipPath(result?.details?.dst)}` : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`),
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
        theme.fg("toolTitle", theme.bold("rm ")) + theme.fg("accent", clipPath(args.path)),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? `✓ ${clipPath(result?.details?.path)}` : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`),
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

  // ── append ──────────────────────────────────────────────────
  pi.registerTool({
    name: "append",
    label: "Append",
    description:
      "Append text to a file. Creates the file if it does not exist. " +
      "Safe for protected files (.env, .credentials) where write/edit " +
      "is blocked — append adds lines without needing to read existing content.",
    promptSnippet: "append path — add lines to a file without overwriting",
    promptGuidelines: [
      "Use append to add lines to protected files (.env, .credentials, .gitignore) where write/edit is blocked.",
      "Also use append for log files, growing lists, and incrementally building config files.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "File to append to. Created if missing." }),
      content: Type.String({ description: "Text to append. A trailing newline is added automatically." }),
    }),

    renderCall(args: any, theme: any) {
      const preview = (args.content || "").replace(/\n/g, " ").slice(0, 60);
      return new Text([
        theme.fg("toolTitle", theme.bold("append ")) +
          theme.fg("accent", `${clipPath(args.path)} ← ${clip(preview, 30)}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ appended ${result?.details?.bytes ?? 0}B to ${clipPath(result?.details?.path)}`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`,
        ), 0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const cwd = process.env.HARNESS_WORK_DIR || process.cwd();
      const target = resolvePath(params.path, cwd);
      try {
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const text = String(params.content ?? "") + "\n";
        fs.appendFileSync(target, text, "utf-8");
        const bytes = Buffer.byteLength(text, "utf-8");
        return {
          content: [{ type: "text", text: `✓ appended ${bytes}B to ${target}` }],
          details: { path: target, bytes },
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
        theme.fg("toolTitle", theme.bold("chmod ")) + theme.fg("accent", `${args.mode || ""} ${clipPath(args.path)}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error", ok ? `✓ ${result?.details?.mode || ""} ${clipPath(result?.details?.path)}` : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`),
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
