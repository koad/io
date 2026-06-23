/**
 * koad-io builtin tool replacements — read, write, edit, bash, ls.
 *
 * These replace pi's built-in tools when --no-builtin-tools is set.
 * The bond gate (bond-gate/index.ts) gates every call against trust bonds.
 *
 * Design principles:
 *   - Smart feedback: detect confusion, suggest next steps, show context
 *   - Safe defaults: truncate large files, validate paths, respect bonds
 *   - Extensible: easy to add new capabilities, hooks, or instrumentation
 *
 * Parameter shapes match pi's built-in tool shapes so the bond gate's
 * event.input inspection works without changes.
 */

import type { ExtensionAPI, ToolResult } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as childProcess from "node:child_process";
import { Type } from "typebox";
import { clipText as clip, clipPath } from "../utils/tool-render";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_READ_LINES = 2000;
const MAX_READ_BYTES = 100_000; // ~100KB
const MAX_BASH_OUTPUT = 50_000; // ~50KB per stream
const DEFAULT_BASH_TIMEOUT = 120; // seconds

const HOME = os.homedir();

function resolvePath(raw: string, cwd: string): string {
  if (raw.startsWith("~")) return path.join(HOME, raw.slice(1));
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
}

function cwd(): string {
  return process.env.HARNESS_WORK_DIR || process.cwd();
}

function truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return { text, truncated: false };
  const buf = Buffer.from(text, "utf-8");
  const truncated = buf.subarray(0, maxBytes).toString("utf-8");
  return { text: truncated + "\n\n... [truncated]", truncated: true };
}

function detectBinary(buf: Buffer): boolean {
  // Check first 8KB for NUL bytes (binary heuristic)
  const sample = buf.subarray(0, 8192);
  return sample.includes(0);
}

function fileMetadata(filePath: string): Record<string, unknown> {
  try {
    const stat = fs.statSync(filePath);
    return {
      size: stat.size,
      sizeHuman: humanSize(stat.size),
      modified: stat.mtime.toISOString(),
      mode: (stat.mode & 0o777).toString(8),
      isDirectory: stat.isDirectory(),
      isSymlink: stat.isSymbolicLink(),
    };
  } catch {
    return {};
  }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const textExts = new Set([
    ".ts", ".js", ".jsx", ".tsx", ".mjs", ".cjs",
    ".md", ".txt", ".json", ".yaml", ".yml", ".toml",
    ".css", ".scss", ".sass", ".less",
    ".html", ".htm", ".xml", ".svg",
    ".sh", ".bash", ".zsh", ".fish",
    ".py", ".rb", ".rs", ".go", ".java", ".c", ".h", ".cpp", ".hpp",
    ".sql", ".graphql", ".proto",
    ".env", ".gitignore", ".dockerignore", ".editorconfig",
    ".log", ".diff", ".patch",
    ".asc", ".pem", ".key", ".pub",
    ".ini", ".cfg", ".conf",
    ".vue", ".svelte",
    "", // no extension = treat as text
  ]);
  return textExts.has(ext);
}

// ---------------------------------------------------------------------------
// read tool
// ---------------------------------------------------------------------------

export function registerReadTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "read",
    label: "Read",
    description: "Read a file's contents with line numbers. Respects bond read scope.",
    promptSnippet: "read path [offset] [limit] — read file contents with line numbers",
    promptGuidelines: [
      "Use read to inspect file contents within your read scope.",
      "Large files are auto-truncated at 2000 lines / 100KB. Use offset/limit for range reads.",
      "Binary files return metadata only — do not attempt to read binary content.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to read." }),
      offset: Type.Optional(Type.Number({ description: "Starting line number (1-indexed). Default: 1." })),
      limit: Type.Optional(Type.Number({ description: "Maximum lines to read. Default: 2000." })),
    }),

    renderCall(args: any, theme: any) {
      const range = args.offset ? `:${args.offset}${args.limit ? `-${args.offset + args.limit - 1}` : ""}` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("read ")) + theme.fg("accent", clipPath(args.path) + range),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      if (ok) {
        const meta = result?.details?.meta;
        const metaStr = meta ? ` · ${meta.sizeHuman}` : "";
        const trunc = result?.details?.truncated ? " [truncated]" : "";
        return new Text(
          theme.fg("success", `✓ ${clipPath(result?.details?.path)}${metaStr}${trunc}`),
          0, 0,
        );
      }
      return new Text(
        theme.fg("error", `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const workDir = cwd();
      const filePath = resolvePath(params.path, workDir);
      const offset = Math.max(1, (params.offset ?? 1) as number);
      const limit = Math.min(MAX_READ_LINES, (params.limit ?? MAX_READ_LINES) as number);

      // File existence check
      if (!fs.existsSync(filePath)) {
        const suggestions: string[] = [];
        // Try to find similar files
        const dir = path.dirname(filePath);
        if (fs.existsSync(dir)) {
          try {
            const siblings = fs.readdirSync(dir);
            const name = path.basename(filePath);
            const matches = siblings.filter(f => f.includes(name) || name.includes(f)).slice(0, 5);
            if (matches.length > 0) suggestions.push(`Similar files: ${matches.join(", ")}`);
          } catch { /* ignore */ }
        }
        return {
          isError: true,
          content: [{ type: "text", text: `File not found: ${filePath}${suggestions.length > 0 ? "\n\nSuggestions:\n" + suggestions.join("\n") : ""}` }],
          details: { error: `not found: ${filePath}`, suggestions },
        };
      }

      // Directory check
      if (fs.statSync(filePath).isDirectory()) {
        return {
          isError: true,
          content: [{ type: "text", text: `${filePath} is a directory. Use the \`ls\` tool to list directory contents, or specify a file path.` }],
          details: { error: "path is a directory", path: filePath },
        };
      }

      // Symlink resolution
      let resolvedPath: string;
      try {
        resolvedPath = fs.realpathSync(filePath);
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cannot resolve symlink: ${filePath} → ${err.message}` }],
          details: { error: `broken symlink: ${err.message}` },
        };
      }

      // Binary detection
      let buf: Buffer;
      try {
        buf = fs.readFileSync(resolvedPath);
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Permission denied: ${filePath} → ${err.message}` }],
          details: { error: `read error: ${err.message}` },
        };
      }

      if (detectBinary(buf) && !isTextFile(filePath)) {
        const meta = fileMetadata(resolvedPath);
        return {
          content: [{ type: "text", text: `Binary file detected: ${resolvedPath}\n\n${Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\nUse \`sin\` or \`search\` to search within binary files, or use appropriate tooling for this file type.` }],
          details: { binary: true, path: resolvedPath, meta },
        };
      }

      // Decode and paginate
      let content: string;
      try {
        content = buf.toString("utf-8");
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Encoding error: ${filePath} → ${err.message}` }],
          details: { error: `encoding error: ${err.message}` },
        };
      }

      const lines = content.split("\n");
      const totalLines = lines.length;
      const startLine = Math.min(offset, totalLines);
      const endLine = Math.min(startLine + limit - 1, totalLines);
      const selectedLines = lines.slice(startLine - 1, endLine);
      const output = selectedLines.map((line, i) => `${String(startLine + i).padStart(Math.min(6, String(totalLines).length), " ")} │ ${line}`).join("\n");

      const truncated = endLine < totalLines;
      const meta = fileMetadata(resolvedPath);
      const headerLines: string[] = [];
      headerLines.push(`# ${resolvedPath}`);
      headerLines.push(`# ${meta.sizeHuman} · ${totalLines} lines · modified ${meta.modified}`);
      if (offset > 1) headerLines.push(`# showing lines ${startLine}–${endLine} of ${totalLines} (offset=${offset})`);
      headerLines.push("");

      let finalText = headerLines.join("\n") + output;
      if (truncated) {
        finalText += `\n\n... [${totalLines - endLine} more lines — use offset=${endLine + 1} to continue]`;
      }

      const { text, truncated: byteTruncated } = truncate(finalText, MAX_READ_BYTES);

      return {
        content: [{ type: "text", text }],
        details: {
          path: resolvedPath,
          meta,
          lines: { total: totalLines, shown: endLine - startLine + 1, offset: startLine, limit },
          truncated: truncated || byteTruncated,
        },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// write tool
// ---------------------------------------------------------------------------

export function registerWriteTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "write",
    label: "Write",
    description: "Write content to a file. Creates the file (and parent dirs) if missing. Overwrites existing content.",
    promptSnippet: "write path content — write a file from scratch (overwrites)",
    promptGuidelines: [
      "Use write to create new files or completely replace existing file contents.",
      "Parent directories are created automatically.",
      "Protected files (.env, .credentials, secrets) cannot be written — use append instead.",
      "For small changes to existing files, use edit instead of write.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "File path to write." }),
      content: Type.String({ description: "Content to write." }),
    }),

    renderCall(args: any, theme: any) {
      const preview = (args.content || "").replace(/\n/g, " ").slice(0, 50);
      return new Text([
        theme.fg("toolTitle", theme.bold("write ")) +
          theme.fg("accent", `${clipPath(args.path)} ← ${clip(preview, 30)}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ wrote ${result?.details?.bytes ?? 0}B → ${clipPath(result?.details?.path)}`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const workDir = cwd();
      const filePath = resolvePath(params.path, workDir);
      const content = String(params.content ?? "");

      // ── Pre-flight: empty content check ──────────────────────
      if (!content.trim() && content.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: `Empty content — nothing to write to ${filePath}.\n\nIf you intended to create an empty file, use \`bash\` with \`touch ${filePath}\` instead.\nIf you intended to clear a file, confirm that's what you want.` }],
          details: { error: "empty content" },
        };
      }

      // ── Protected filename check (defense in depth — bond gate also checks) ─
      const basename = path.basename(filePath);
      const protectedPatterns = [
        /^\.env(\..*)?$/, /^\.credentials(\..*)?$/, /^credentials(\..*)?$/,
        /^secret(s)?(\..*)?$/i, /^\..*key(\.pem)?$/, /^\..*token$/i,
        /^id_rsa$/, /^id_ed25519$/,
      ];
      if (protectedPatterns.some(re => re.test(basename))) {
        return {
          isError: true,
          content: [{ type: "text", text: `${filePath} is a protected file — write is blocked to prevent accidental secret destruction.\n\nUse the \`append\` tool to add lines, or ask the user to edit it manually.` }],
          details: { error: "protected filename", path: filePath },
        };
      }

      // ── Pre-flight: existing file analysis ───────────────────
      let existed = false;
      let previousSize = 0;
      let wasBinary = false;
      let previousLines = 0;
      try {
        const stat = fs.statSync(filePath);
        existed = stat.isFile();
        previousSize = stat.size;
        if (existed && previousSize > 0) {
          const head = fs.readFileSync(filePath).subarray(0, 8192);
          wasBinary = detectBinary(head);
          if (!wasBinary) {
            const prevContent = fs.readFileSync(filePath, "utf-8");
            previousLines = prevContent.split("\n").length;
          }
        }
      } catch { /* doesn't exist or not readable */ }

      if (existed && wasBinary) {
        return {
          isError: true,
          content: [{ type: "text", text: `Warning: ${filePath} appears to be a binary file (${humanSize(previousSize)}). Overwriting it with text content may corrupt it.\n\nIf you're sure this is intentional, confirm and try again.\nOtherwise, use appropriate tooling for binary file modification.` }],
          details: { error: "binary file overwrite", path: filePath, previousSize, wasBinary: true },
        };
      }

      if (existed && previousSize > 1024 * 1024) {
        // Large file overwrite — flag it but don't block
        // The LLM will see this and can reconsider
      }

      // ── Pre-flight: directory writability ────────────────────
      const dir = path.dirname(filePath);
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        // Check we can actually write to the directory
        const testFile = path.join(dir, `.koad-write-test-${Date.now()}`);
        fs.writeFileSync(testFile, "");
        fs.unlinkSync(testFile);
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cannot write to directory: ${dir} → ${err.message}\n\nCheck permissions or use a different path.` }],
          details: { error: `directory not writable: ${err.message}`, path: filePath },
        };
      }

      // ── Execute write ────────────────────────────────────────
      try {
        fs.writeFileSync(filePath, content, "utf-8");
        const bytes = Buffer.byteLength(content, "utf-8");

        let message = `✓ wrote ${bytes}B → ${filePath}`;
        let validationNote = "";
        if (existed) {
          message += ` (overwrote ${humanSize(previousSize)}, ${previousLines}L)`;
          const sizeDelta = bytes - previousSize;
          const deltaStr = sizeDelta >= 0 ? `+${sizeDelta}B` : `${sizeDelta}B`;
          validationNote = `\n\nSize change: ${deltaStr}`;
          if (sizeDelta > 0 && previousLines > 0) {
            validationNote += ` · Content grew by ${sizeDelta}B`;
          } else if (sizeDelta < 0 && previousLines > 0) {
            validationNote += ` · Content shrank by ${Math.abs(sizeDelta)}B`;
          }
        } else {
          message += ` (new file)`;
          validationNote = `\n\nCreated at: ${filePath}`;
        }
        message += validationNote;

        return {
          content: [{ type: "text", text: message }],
          details: { path: filePath, bytes, existed, previousSize, previousLines, wasBinary },
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Write failed: ${filePath} → ${err.message}` }],
          details: { error: `write error: ${err.message}`, path: filePath },
        };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// edit tool
// ---------------------------------------------------------------------------

export function registerEditTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "edit",
    label: "Edit",
    description: "Apply targeted text replacements to a file. Specify exact oldText and newText blocks.",
    promptSnippet: "edit path edits — apply text replacements to a file",
    promptGuidelines: [
      "Use edit for targeted changes to existing files.",
      "Always read the file first to get the exact text to replace.",
      "Each edit block specifies oldText (exact match) and newText (replacement).",
      "For complete rewrites, use write. For adding lines, use append.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "File path to edit." }),
      edits: Type.Array(
        Type.Object({
          oldText: Type.String({ description: "Exact text to find and replace." }),
          newText: Type.String({ description: "Replacement text." }),
        }),
        { description: "List of edits to apply." },
      ),
    }),

    renderCall(args: any, theme: any) {
      const n = args.edits?.length ?? 0;
      return new Text([
        theme.fg("toolTitle", theme.bold("edit ")) +
          theme.fg("accent", `${clipPath(args.path)} · ${n} edit${n !== 1 ? "s" : ""}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ applied ${result?.details?.applied ?? 0} edit(s) → ${clipPath(result?.details?.path)}`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const workDir = cwd();
      const filePath = resolvePath(params.path, workDir);
      const edits = (params.edits ?? []) as Array<{ oldText: string; newText: string }>;

      // ── Pre-flight: empty edits check ────────────────────────
      if (edits.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: "No edits provided — specify at least one { oldText, newText } block." }],
          details: { error: "no edits provided" },
        };
      }

      // ── Pre-flight: file must exist ──────────────────────────
      if (!fs.existsSync(filePath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `File not found: ${filePath}\n\nUse \`write\` to create a new file, or check the path with \`ls\`.` }],
          details: { error: `not found: ${filePath}`, suggestion: "use write for new files" },
        };
      }

      // ── Pre-flight: read file once ───────────────────────────
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cannot read file for editing: ${filePath} → ${err.message}\n\nMake sure you have read permission for this file.` }],
          details: { error: `read error: ${err.message}` },
        };
      }

      const fileLines = content.split("\n");
      const totalLines = fileLines.length;

      // ── Pre-flight: validate ALL edits before touching file ─
      // This is atomic: either all edits pass or none are applied.
      const validation: Array<{
        index: number;
        oldText: string;
        newText: string;
        status: "ok" | "not-found" | "ambiguous" | "no-change";
        occurrences: number;
        firstLine: number;
        lineHint?: string;
        contextBefore?: string;
        contextAfter?: string;
      }> = [];

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];

        // Check for no-op
        if (edit.oldText === edit.newText) {
          validation.push({
            index: i, oldText: edit.oldText, newText: edit.newText,
            status: "no-change", occurrences: 0, firstLine: -1,
          });
          continue;
        }

        // Find all occurrences
        const occurrences: number[] = [];
        let searchIdx = 0;
        while (true) {
          const idx = content.indexOf(edit.oldText, searchIdx);
          if (idx === -1) break;
          occurrences.push(idx);
          searchIdx = idx + 1;
        }

        if (occurrences.length === 0) {
          // Not found — find best approximate match
          let bestLine = -1;
          let bestSimilarity = 0;
          const oldLines = edit.oldText.split("\n");
          for (let li = 0; li < fileLines.length; li++) {
            // Compare first line of oldText against each file line
            const similarity = computeSimilarity(oldLines[0], fileLines[li]);
            if (similarity > bestSimilarity) {
              bestSimilarity = similarity;
              bestLine = li + 1;
            }
          }

          // Show context around the best match
          let contextBefore = "";
          let contextAfter = "";
          if (bestLine > 0 && bestSimilarity > 0.3) {
            const ctxStart = Math.max(0, bestLine - 3);
            const ctxEnd = Math.min(totalLines, bestLine + 2);
            contextBefore = fileLines.slice(ctxStart, bestLine - 1).map(l => `  ${clip(l, 80)}`).join("\n");
            contextAfter = fileLines.slice(bestLine, ctxEnd).map(l => `  ${clip(l, 80)}`).join("\n");
          }

          const lineHint = bestSimilarity > 0.3
            ? `\n  Possible match on line ${bestLine} (similarity: ${(bestSimilarity * 100).toFixed(0)}%)`
            : "";

          validation.push({
            index: i, oldText: edit.oldText, newText: edit.newText,
            status: "not-found", occurrences: 0, firstLine: bestLine,
            lineHint, contextBefore, contextAfter,
          });
        } else if (occurrences.length > 1) {
          // Ambiguous — oldText appears multiple times
          const firstLineNum = content.substring(0, occurrences[0]).split("\n").length;
          validation.push({
            index: i, oldText: edit.oldText, newText: edit.newText,
            status: "ambiguous", occurrences: occurrences.length,
            firstLine: firstLineNum,
            lineHint: `\n  Appears ${occurrences.length} times — make oldText more specific to target one occurrence`,
          });
        } else {
          // OK — single unique match
          const lineNum = content.substring(0, occurrences[0]).split("\n").length;
          validation.push({
            index: i, oldText: edit.oldText, newText: edit.newText,
            status: "ok", occurrences: 1, firstLine: lineNum,
          });
        }
      }

      // ── Report validation failures ───────────────────────────
      const failures = validation.filter(v => v.status !== "ok");
      if (failures.length > 0) {
        const noChanges = validation.filter(v => v.status === "no-change");
        const notFounds = validation.filter(v => v.status === "not-found");
        const ambiguous = validation.filter(v => v.status === "ambiguous");

        let report = `Edit validation failed — ${failures.length} of ${edits.length} edit(s) blocked:\n\n`;

        for (const nf of notFounds) {
          report += `✗ Edit #${nf.index + 1}: oldText not found\n`;
          report += `  Text: "${clip(nf.oldText, 60)}"\n`;
          if (nf.lineHint) report += nf.lineHint + "\n";
          if (nf.contextBefore) report += `  Context before:\n${nf.contextBefore}\n`;
          if (nf.contextAfter) report += `  Context after:\n${nf.contextAfter}\n`;
          report += `\n`;
        }

        for (const amb of ambiguous) {
          report += `⚠ Edit #${amb.index + 1}: oldText is ambiguous\n`;
          report += `  Text: "${clip(amb.oldText, 60)}"\n`;
          report += `  Found ${amb.occurrences} occurrences (first on line ${amb.firstLine})\n`;
          if (amb.lineHint) report += amb.lineHint + "\n";
          report += `\n`;
        }

        for (const nc of noChanges) {
          report += `ℹ Edit #${nc.index + 1}: no change (oldText === newText)\n`;
          report += `  Text: "${clip(nc.oldText, 60)}"\n\n`;
        }

        report += `Tips:\n`;
        report += `- Use \`read\` first to get exact text with line numbers\n`;
        report += `- Include more surrounding context in oldText to disambiguate\n`;
        report += `- For large rewrites, use \`write\` instead\n`;
        report += `- For adding lines, use \`append\` instead`;

        return {
          isError: true,
          content: [{ type: "text", text: report }],
          details: {
            error: "validation failed",
            path: filePath,
            validation: validation.map(v => ({ status: v.status, firstLine: v.firstLine, occurrences: v.occurrences })),
            applied: 0,
            total: edits.length,
          },
        };
      }

      // ── All edits validated — apply atomically ──────────────
      let newContent = content;
      for (const edit of edits) {
        if (edit.oldText === edit.newText) continue; // skip no-ops
        newContent = newContent.replace(edit.oldText, edit.newText);
      }

      try {
        fs.writeFileSync(filePath, newContent, "utf-8");
        const bytes = Buffer.byteLength(newContent, "utf-8");
        const originalBytes = Buffer.byteLength(content, "utf-8");
        const delta = bytes - originalBytes;
        const deltaStr = delta >= 0 ? `+${delta}B` : `${delta}B`;

        const actualEdits = edits.filter(e => e.oldText !== e.newText).length;
        const lineChanges: string[] = [];
        for (const v of validation) {
          if (v.status === "ok") {
            lineChanges.push(`  line ${v.firstLine}: ${clip(v.oldText, 40)} → ${clip(v.newText, 40)}`);
          }
        }

        let message = `✓ applied ${actualEdits} edit(s) → ${filePath} (${deltaStr})`;
        if (lineChanges.length > 0 && lineChanges.length <= 5) {
          message += "\n\nChanges:";
          for (const lc of lineChanges) message += "\n" + lc;
        } else if (lineChanges.length > 5) {
          message += `\n\nChanges: ${lineChanges.length} edits applied (too many to list)`;
        }

        return {
          content: [{ type: "text", text: message }],
          details: {
            path: filePath, bytes, applied: actualEdits, total: edits.length,
            delta, changes: lineChanges,
          },
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Write failed after editing: ${filePath} → ${err.message}` }],
          details: { error: `write error: ${err.message}` },
        };
      }
    },
  });
}

// Simple string similarity (ratio of common chars)
function computeSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();
  if (aLower === bLower) return 1;
  let matches = 0;
  const shorter = aLower.length < bLower.length ? aLower : bLower;
  const longer = aLower.length < bLower.length ? bLower : aLower;
  let searchFrom = 0;
  for (let i = 0; i < shorter.length; i++) {
    const idx = longer.indexOf(shorter[i], searchFrom);
    if (idx !== -1) { matches++; searchFrom = idx + 1; }
  }
  return matches / longer.length;
}

// ---------------------------------------------------------------------------
// bash tool
// ---------------------------------------------------------------------------

export function registerBashTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "bash",
    label: "Bash",
    description: "Execute a shell command. Respects bond exec scope and bash policy.",
    promptSnippet: "bash command [timeout] — run a shell command",
    promptGuidelines: [
      "Use bash for shell commands within your exec scope.",
      "Specify timeout in seconds for long-running commands (default: 120s).",
      "File discovery: use read, ls, sin, or search instead of cat/grep/find/ls through bash.",
      "Git: use koad-io tool with command=\"git\" instead of git through bash.",
      "Never use bash for privilege escalation (sudo/su) or host-level commands.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute." }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Default: 120." })),
    }),

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("bash ")) +
          theme.fg("accent", clip(args.command, 80)),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      const exitCode = result?.details?.exitCode;
      const duration = result?.details?.duration;
      const status = ok ? (exitCode === 0 ? "✓" : `⚠ exit ${exitCode}`) : "✗";
      const durationStr = duration ? ` · ${duration}s` : "";
      return new Text(
        theme.fg(ok ? (exitCode === 0 ? "success" : "warning") : "error",
          `${status}${durationStr}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params, signal) {
      const command = String(params.command ?? "");
      const timeout = Math.max(1, Math.min(600, (params.timeout ?? DEFAULT_BASH_TIMEOUT) as number)) * 1000; // ms

      if (!command.trim()) {
        return {
          isError: true,
          content: [{ type: "text", text: "Empty command — provide a shell command to execute." }],
          details: { error: "empty command" },
        };
      }

      return new Promise<ToolResult>((resolve) => {
        const startTime = Date.now();

        const proc = childProcess.exec(command, {
          timeout,
          maxBuffer: MAX_BASH_OUTPUT * 2,
          cwd: cwd(),
          shell: "/bin/bash",
        }, (error, stdout, stderr) => {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          const exitCode = error && "code" in error ? (error as any).code : 0;

          let out = stdout ?? "";
          let err = stderr ?? "";

          // Truncate large outputs
          const outTrunc = truncate(out, MAX_BASH_OUTPUT);
          const errTrunc = truncate(err, MAX_BASH_OUTPUT);
          out = outTrunc.text;
          err = errTrunc.text;

          // Handle timeout
          if (error && (error as any).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            err += `\n\n[output exceeded ${MAX_BASH_OUTPUT} bytes — truncated]`;
          }

          let message = "";
          if (out) message += out;
          if (err) message += (message ? "\n\n" : "") + "stderr:\n" + err;
          if (!message.trim()) message = "(command produced no output)";
          message += `\n\n---\nexit code: ${exitCode ?? 0} · duration: ${duration}s`;

          if (signal?.aborted) {
            resolve({
              isError: true,
              content: [{ type: "text", text: "Command was cancelled by user." }],
              details: { error: "cancelled", duration },
            });
            return;
          }

          // Non-zero exit is not always an error — let the bond gate decide
          // but mark it so the LLM can distinguish
          resolve({
            content: [{ type: "text", text: message }],
            details: { exitCode: exitCode ?? 0, duration, truncated: outTrunc.truncated || errTrunc.truncated },
            isError: exitCode !== 0 && exitCode !== undefined && exitCode !== 130,
          });
        });

        // Wire up abort signal
        if (signal) {
          signal.addEventListener("abort", () => {
            proc.kill("SIGTERM");
            setTimeout(() => {
              if (!proc.killed) proc.kill("SIGKILL");
            }, 2000);
          });
        }
      });
    },
  });
}

// ---------------------------------------------------------------------------
// ls tool
// ---------------------------------------------------------------------------

export function registerLsTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ls",
    label: "List",
    description: "List directory contents. Shows file size, modified time, and type indicators.",
    promptSnippet: "ls path — list directory contents with details",
    promptGuidelines: [
      "Use ls to list directory contents within your read scope.",
      "Shows file size, modified time, and type (dir/file/symlink).",
      "For recursive search, use sin or search instead.",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory to list. Default: current working directory." })),
    }),

    renderCall(args: any, theme: any) {
      const dir = args.path ? clipPath(args.path) : ".";
      return new Text([
        theme.fg("toolTitle", theme.bold("ls ")) + theme.fg("accent", dir),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      const count = result?.details?.count ?? 0;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ ${count} item${count !== 1 ? "s" : ""} → ${clipPath(result?.details?.path || "")}`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const workDir = cwd();
      const dirPath = params.path ? resolvePath(params.path, workDir) : workDir;

      if (!fs.existsSync(dirPath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `Directory not found: ${dirPath}` }],
          details: { error: `not found: ${dirPath}` },
        };
      }

      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) {
        return {
          isError: true,
          content: [{ type: "text", text: `${dirPath} is not a directory. Use \`read\` to inspect file contents.` }],
          details: { error: "not a directory" },
        };
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cannot list directory: ${dirPath} → ${err.message}` }],
          details: { error: `list error: ${err.message}` },
        };
      }

      // Sort: directories first, then files, alphabetical within each
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      // Build detail lines
      const lines: string[] = [];
      for (const entry of entries) {
        let entryStat: fs.Stats | null = null;
        try {
          entryStat = fs.statSync(path.join(dirPath, entry.name));
        } catch { /* skip */ }

        const type = entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f";
        const size = entryStat ? humanSize(entryStat.size) : "?";
        const modified = entryStat ? entryStat.mtime.toISOString().slice(0, 19).replace("T", " ") : "?";
        const suffix = entry.isDirectory() ? "/" : entry.isSymbolicLink() ? "@" : "";
        lines.push(`${type}  ${size.padStart(8)}  ${modified}  ${entry.name}${suffix}`);
      }

      if (lines.length === 0) {
        return {
          content: [{ type: "text", text: `${dirPath}\n(empty directory)` }],
          details: { path: dirPath, count: 0, entries: [] },
        };
      }

      const header = `${dirPath}\n${"-".repeat(60)}\ntype  size      modified             name`;
      const output = `${header}\n${lines.join("\n")}\n\n${lines.length} item${lines.length !== 1 ? "s" : ""}`;

      return {
        content: [{ type: "text", text: output }],
        details: { path: dirPath, count: lines.length },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// grep tool
// ---------------------------------------------------------------------------

export function registerGrepTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "grep",
    label: "Grep",
    description: "Search for a pattern in files. Recursive by default. Respects bond read scope.",
    promptSnippet: "grep pattern [path] [-i] [-l] [glob] — search text in files",
    promptGuidelines: [
      "Use grep to search for text patterns across files within your read scope.",
      "Results are limited to 100 matches — refine your pattern if you hit the limit.",
      "Binary files are skipped automatically.",
      "For structured discovery (frontmatter, atlas), use search instead.",
    ],
    parameters: Type.Object({
      pattern: Type.String({ description: "Regex pattern to search for." }),
      path: Type.Optional(Type.String({ description: "File or directory to search. Default: current working directory." })),
      ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search. Default: false." })),
      filesOnly: Type.Optional(Type.Boolean({ description: "Only list matching filenames, no content. Default: false." })),
      glob: Type.Optional(Type.String({ description: "Glob pattern to filter files, e.g. '*.ts'. Default: all files." })),
    }),

    renderCall(args: any, theme: any) {
      const flags = [args.ignoreCase ? "-i" : "", args.filesOnly ? "-l" : "", args.glob || ""].filter(Boolean).join(" ");
      const flagStr = flags ? ` ${flags}` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("grep ")) +
          theme.fg("accent", `"${clip(args.pattern, 40)}"${flagStr} in ${clipPath(args.path || ".")}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      const count = result?.details?.matchCount ?? 0;
      const files = result?.details?.filesSearched ?? 0;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ ${count} match${count !== 1 ? "es" : ""} across ${files} file${files !== 1 ? "s" : ""}`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params, signal) {
      const workDir = cwd();
      const searchPath = params.path ? resolvePath(params.path, workDir) : workDir;
      const pattern = String(params.pattern ?? "");
      const ignoreCase = !!params.ignoreCase;
      const filesOnly = !!params.filesOnly;
      const glob = (params.glob as string | undefined) ?? "";

      if (!pattern) {
        return {
          isError: true,
          content: [{ type: "text", text: "Empty pattern — provide a regex pattern to search for." }],
          details: { error: "empty pattern" },
        };
      }

      if (!fs.existsSync(searchPath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `Path not found: ${searchPath}` }],
          details: { error: `not found: ${searchPath}` },
        };
      }

      // Build file list
      const files: string[] = [];
      const MAX_FILES = 5000;
      const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total
      let totalSize = 0;

      function walkDir(dir: string) {
        if (files.length >= MAX_FILES || totalSize >= MAX_TOTAL_SIZE) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
          if (files.length >= MAX_FILES) break;
          const full = path.join(dir, entry.name);
          // Skip hidden dirs, node_modules, .git, __pycache__
          if (entry.isDirectory()) {
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") continue;
            walkDir(full);
          } else if (entry.isFile()) {
            if (entry.name.startsWith(".")) continue;
            if (glob && !minimatchSimple(entry.name, glob)) continue;
            try {
              const stat = fs.statSync(full);
              if (stat.size > 1024 * 1024) continue; // skip files > 1MB
              totalSize += stat.size;
              files.push(full);
            } catch { /* skip */ }
          }
        }
      }

      if (fs.statSync(searchPath).isDirectory()) {
        walkDir(searchPath);
      } else {
        files.push(searchPath);
      }

      if (files.length === 0) {
        return {
          content: [{ type: "text", text: `No files found to search in ${searchPath}` }],
          details: { filesSearched: 0, matchCount: 0 },
        };
      }

      // Compile regex
      let re: RegExp;
      try {
        re = new RegExp(pattern, ignoreCase ? "gi" : "g");
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid regex pattern: ${pattern} → ${err.message}` }],
          details: { error: `invalid regex: ${err.message}` },
        };
      }

      // Search
      const results: Array<{ file: string; line: number; match: string }> = [];
      const matchingFiles = new Set<string>();
      const MAX_MATCHES = 100;

      for (const filePath of files) {
        if (results.length >= MAX_MATCHES) break;
        if (signal?.aborted) break;
        try {
          const buf = fs.readFileSync(filePath);
          if (detectBinary(buf)) continue;
          const content = buf.toString("utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            re.lastIndex = 0;
            const m = re.exec(lines[i]);
            if (m) {
              matchingFiles.add(filePath);
              if (!filesOnly) {
                results.push({ file: filePath, line: i + 1, match: lines[i] });
                if (results.length >= MAX_MATCHES) break;
              }
            }
          }
        } catch { /* skip unreadable files */ }
      }

      if (results.length === 0 && matchingFiles.size === 0) {
        return {
          content: [{ type: "text", text: `No matches for "${pattern}" in ${files.length} files` }],
          details: { filesSearched: files.length, matchCount: 0, pattern },
        };
      }

      let output: string;
      if (filesOnly) {
        output = [...matchingFiles].map(f => resolveRelative(f, workDir)).join("\n");
      } else {
        output = results.map(r => {
          const rel = resolveRelative(r.file, workDir);
          return `${rel}:${r.line}:${r.match}`;
        }).join("\n");
        if (results.length >= MAX_MATCHES) {
          output += `\n\n... [truncated at ${MAX_MATCHES} matches — refine your pattern]`;
        }
      }

      return {
        content: [{ type: "text", text: output }],
        details: {
          filesSearched: files.length,
          matchCount: filesOnly ? matchingFiles.size : results.length,
          pattern,
          truncated: results.length >= MAX_MATCHES,
        },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// find tool
// ---------------------------------------------------------------------------

export function registerFindTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "find",
    label: "Find",
    description: "Find files by name pattern. Fast filesystem discovery within bond read scope.",
    promptSnippet: "find name/glob [path] [type] — find files by name pattern",
    promptGuidelines: [
      "Use find to locate files by name pattern within your read scope.",
      "Supports glob patterns: *.ts, *config*, etc.",
      "Results limited to 200 files — refine your pattern if needed.",
      "For content search, use grep instead.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Glob pattern to match filenames, e.g. '*.ts', 'config.*', '*.md'." }),
      path: Type.Optional(Type.String({ description: "Directory to search. Default: current working directory." })),
      type: Type.Optional(Type.String({ description: "Filter by type: 'f' (files), 'd' (directories). Default: both." })),
    }),

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("find ")) +
          theme.fg("accent", `"${clip(args.name, 30)}" in ${clipPath(args.path || ".")}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      const count = result?.details?.count ?? 0;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ ${count} file${count !== 1 ? "s" : ""} matched`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params, signal) {
      const workDir = cwd();
      const searchPath = params.path ? resolvePath(params.path, workDir) : workDir;
      const namePattern = String(params.name ?? "");
      const typeFilter = (params.type as string | undefined) ?? "";

      if (!namePattern) {
        return {
          isError: true,
          content: [{ type: "text", text: "Empty name pattern — provide a glob pattern to match, e.g. '*.ts'." }],
          details: { error: "empty pattern" },
        };
      }

      if (!fs.existsSync(searchPath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `Path not found: ${searchPath}` }],
          details: { error: `not found: ${searchPath}` },
        };
      }

      if (!fs.statSync(searchPath).isDirectory()) {
        return {
          isError: true,
          content: [{ type: "text", text: `${searchPath} is not a directory.` }],
          details: { error: "not a directory" },
        };
      }

      const results: Array<{ path: string; type: string; size: string; modified: string }> = [];
      const MAX_RESULTS = 200;

      function walkDir(dir: string) {
        if (results.length >= MAX_RESULTS) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
          if (results.length >= MAX_RESULTS) break;
          if (signal?.aborted) break;
          const full = path.join(dir, entry.name);
          // Skip hidden dirs, node_modules, .git, __pycache__
          if (entry.isDirectory()) {
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") continue;
            // Check dir name match
            if (minimatchSimple(entry.name, namePattern) && (!typeFilter || typeFilter === "d")) {
              try {
                const stat = fs.statSync(full);
                results.push({
                  path: resolveRelative(full, workDir),
                  type: "d",
                  size: "-",
                  modified: stat.mtime.toISOString().slice(0, 19).replace("T", " "),
                });
              } catch { /* skip */ }
            }
            walkDir(full);
          } else if (entry.isFile()) {
            if (minimatchSimple(entry.name, namePattern)) {
              try {
                const stat = fs.statSync(full);
                results.push({
                  path: resolveRelative(full, workDir),
                  type: "f",
                  size: humanSize(stat.size),
                  modified: stat.mtime.toISOString().slice(0, 19).replace("T", " "),
                });
              } catch { /* skip */ }
            }
          }
        }
      }

      walkDir(searchPath);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No files matching "${namePattern}" found in ${searchPath}` }],
          details: { count: 0, pattern: namePattern },
        };
      }

      const output = results.map(r => {
        const typeIcon = r.type === "d" ? "📁" : "📄";
        return `${typeIcon}  ${r.size.padStart(8)}  ${r.modified}  ${r.path}`;
      }).join("\n");

      const truncated = results.length >= MAX_RESULTS;
      const finalOutput = output + (truncated ? `\n\n... [truncated at ${MAX_RESULTS} results — refine your pattern]` : `\n\n${results.length} result${results.length !== 1 ? "s" : ""}`);

      return {
        content: [{ type: "text", text: finalOutput }],
        details: { count: results.length, pattern: namePattern, truncated },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Minimatch-like glob matcher (simplified, no external dependency)
// ---------------------------------------------------------------------------

function minimatchSimple(filename: string, pattern: string): boolean {
  if (!pattern) return true;
  if (pattern === filename) return true;
  // Convert glob to regex
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "__DOUBLESTAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLESTAR__/g, ".*")
    .replace(/\?/g, "[^/]");
  try {
    return new RegExp("^" + regex + "$").test(filename);
  } catch {
    return false;
  }
}

function resolveRelative(filePath: string, baseDir: string): string {
  const relative = path.relative(baseDir, filePath);
  return relative.startsWith("..") ? filePath : ("./" + relative);
}
