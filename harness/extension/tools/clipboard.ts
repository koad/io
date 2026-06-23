/**
 * koad-io clipboard tools — copy, cut, paste, clipboard.
 *
 * Session-scoped named clipboard slots. The LLM uses these to:
 *   - Carry content between files across turns
 *   - Stage edits before applying them
 *   - Reference text without re-reading large files
 *
 * Bond gated:
 *   copy   → no file access (stores text in memory)
 *   paste  → FILE_WRITE_TOOLS (needs write scope on target)
 *   cut    → FILE_READ_TOOLS + FILE_WRITE_TOOLS (reads source, writes removal)
 *   clipboard → no file access (meta management)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { clipText as clip, clipPath } from "../utils/tool-render";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Local helpers (avoid circular import with builtin-replacements)
// ---------------------------------------------------------------------------

const _HOME = os.homedir();

function _resolvePath(raw: string, _cwd: string): string {
  if (raw.startsWith("~")) return path.join(_HOME, raw.slice(1));
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(_cwd, raw);
}

function _cwd(): string {
  return process.env.HARNESS_WORK_DIR || process.cwd();
}

function _humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

// ---------------------------------------------------------------------------
// Clipboard store (session-scoped, in-memory)
// ---------------------------------------------------------------------------

interface ClipboardEntry {
  content: string;
  source?: string;
  copiedAt: string;
  bytes: number;
}

const clipboardSlots = new Map<string, ClipboardEntry>();

function getSlot(slot: string): ClipboardEntry | undefined {
  return clipboardSlots.get(slot);
}

function setSlot(slot: string, content: string, source?: string): ClipboardEntry {
  const entry: ClipboardEntry = {
    content,
    source,
    copiedAt: new Date().toISOString(),
    bytes: Buffer.byteLength(content, "utf-8"),
  };
  clipboardSlots.set(slot, entry);
  return entry;
}

function listSlots(): Array<{ name: string; bytes: number; source?: string; copiedAt: string; preview: string }> {
  const result: typeof clipboardSlots extends Map<string, infer V> ? Array<{ name: string } & V> : never[] = [];
  for (const [name, entry] of clipboardSlots) {
    result.push({
      name,
      bytes: entry.bytes,
      source: entry.source,
      copiedAt: entry.copiedAt,
      preview: clip(entry.content, 80),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// copy tool
// ---------------------------------------------------------------------------

export function registerCopyTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "copy",
    label: "Copy",
    description: "Store text in a named clipboard slot for use across turns. No file access needed.",
    promptSnippet: "copy content [slot] — store text in clipboard",
    promptGuidelines: [
      "Use copy to store text you'll need in a later turn.",
      "Named slots let you carry multiple pieces of content simultaneously.",
      "Default slot is 'default' — use a named slot for multi-step operations.",
      "Clipboard is session-scoped — cleared when the session ends.",
    ],
    parameters: Type.Object({
      content: Type.String({ description: "Text content to store in clipboard." }),
      slot: Type.Optional(Type.String({ description: "Named slot. Default: 'default'." })),
    }),

    renderCall(args: any, theme: any) {
      const slotLabel = args.slot ? ` → ${args.slot}` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("copy")) + slotLabel +
          theme.fg("accent", ` ${clip(args.content, 50)}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ ${result?.details?.bytes ?? 0}B in "${result?.details?.slot ?? "default"}"`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const content = String(params.content ?? "");
      const slot = (params.slot as string | undefined) || "default";

      if (!content) {
        return {
          isError: true,
          content: [{ type: "text", text: "Empty content — nothing to copy. Provide text to store." }],
          details: { error: "empty content" },
        };
      }

      const entry = setSlot(slot, content);
      const lineCount = content.split("\n").length;

      return {
        content: [{ type: "text", text: `✓ copied ${entry.bytes}B (${lineCount} lines) → slot "${slot}"` }],
        details: { slot, bytes: entry.bytes, lines: lineCount },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// paste tool
// ---------------------------------------------------------------------------

export function registerPasteTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "paste",
    label: "Paste",
    description: "Insert clipboard content into a file. Modes: append, prepend, replace, insert_before, insert_after.",
    promptSnippet: "paste path [slot] [mode] [marker] — insert clipboard content",
    promptGuidelines: [
      "Use paste to insert stored clipboard content into a file.",
      "append: add to end of file. prepend: add to beginning.",
      "replace: replace entire file contents.",
      "insert_before/insert_after: insert before/after a marker line (requires marker param).",
      "If the slot is empty or doesn't exist, paste will fail.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Target file path." }),
      slot: Type.Optional(Type.String({ description: "Clipboard slot to paste from. Default: 'default'." })),
      mode: Type.Optional(StringEnum(["append", "prepend", "replace", "insert_before", "insert_after"] as const, {
        description: "Insert mode. Default: append.",
      })),
      marker: Type.Optional(Type.String({ description: "Text marker for insert_before/insert_after modes. Must match a line exactly." })),
    }),

    renderCall(args: any, theme: any) {
      const slotLabel = args.slot ? ` from "${args.slot}"` : "";
      const modeLabel = args.mode ? ` (${args.mode})` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("paste ")) +
          theme.fg("accent", `${clipPath(args.path)}${slotLabel}${modeLabel}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ pasted ${result?.details?.bytes ?? 0}B → ${clipPath(result?.details?.path || "")}`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const workDir = _cwd();
      const filePath = _resolvePath(params.path, workDir);
      const slot = (params.slot as string | undefined) || "default";
      const mode = (params.mode as string | undefined) || "append";
      const marker = (params.marker as string | undefined);

      // Check clipboard
      const entry = getSlot(slot);
      if (!entry) {
        const available = listSlots().map(s => s.name);
        const hint = available.length > 0 ? `\n\nAvailable slots: ${available.join(", ")}` : "\n\nNo clipboard slots available — use copy first.";
        return {
          isError: true,
          content: [{ type: "text", text: `Clipboard slot "${slot}" is empty or doesn't exist.${hint}` }],
          details: { error: `slot "${slot}" empty`, availableSlots: available },
        };
      }

      // Read existing file
      let existingContent = "";
      let fileExisted = false;
      try {
        existingContent = fs.readFileSync(filePath, "utf-8");
        fileExisted = true;
      } catch { /* file doesn't exist */ }

      let newContent: string;
      let appliedMode = mode;

      switch (mode) {
        case "append":
          const needsNewline = fileExisted && existingContent.length > 0 && !existingContent.endsWith("\n");
          newContent = existingContent + (needsNewline ? "\n" : "") + entry.content;
          break;

        case "prepend":
          newContent = entry.content + (fileExisted && existingContent.length > 0 && !entry.content.endsWith("\n") ? "\n" : "") + existingContent;
          break;

        case "replace":
          newContent = entry.content;
          break;

        case "insert_before":
        case "insert_after":
          if (!marker) {
            return {
              isError: true,
              content: [{ type: "text", text: `Mode "${mode}" requires a \`marker\` parameter — the exact text of the line to insert before/after.` }],
              details: { error: "marker required for this mode" },
            };
          }
          if (!fileExisted) {
            return {
              isError: true,
              content: [{ type: "text", text: `File not found: ${filePath} — insert_before/insert_after requires an existing file.` }],
              details: { error: `not found: ${filePath}` },
            };
          }
          const lines = existingContent.split("\n");
          const markerIdx = lines.findIndex(line => line === marker);
          if (markerIdx === -1) {
            // Try fuzzy match
            let bestIdx = -1;
            let bestScore = 0;
            for (let i = 0; i < lines.length; i++) {
              const score = marker.toLowerCase().includes(lines[i].toLowerCase().trim())
                || lines[i].toLowerCase().trim().includes(marker.toLowerCase())
                  ? 0.5 : 0;
              if (score > bestScore) { bestScore = score; bestIdx = i; }
            }
            const hint = bestIdx >= 0 ? `\n\nClosest match on line ${bestIdx + 1}: "${clip(lines[bestIdx], 80)}"` : "";
            return {
              isError: true,
              content: [{ type: "text", text: `Marker not found: "${clip(marker, 80)}"${hint}\n\nMarker must match a line exactly. Use \`read\` to see exact line contents.` }],
              details: { error: "marker not found", closestLine: bestIdx >= 0 ? bestIdx + 1 : undefined },
            };
          }
          const pasteLines = entry.content.split("\n");
          const insertIdx = mode === "insert_before" ? markerIdx : markerIdx + 1;
          lines.splice(insertIdx, 0, ...pasteLines);
          newContent = lines.join("\n");
          appliedMode = `${mode} line ${markerIdx + 1}`;
          break;

        default:
          return {
            isError: true,
            content: [{ type: "text", text: `Unknown paste mode: "${mode}". Valid modes: append, prepend, replace, insert_before, insert_after.` }],
            details: { error: `unknown mode: ${mode}` },
          };
      }

      // Write
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, newContent, "utf-8");
        const bytes = Buffer.byteLength(entry.content, "utf-8");
        const lineCount = entry.content.split("\n").length;

        return {
          content: [{ type: "text", text: `✓ pasted ${bytes}B (${lineCount} lines) → ${filePath} (${appliedMode})` }],
          details: { path: filePath, bytes, lines: lineCount, mode: appliedMode, slot },
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Paste failed: ${filePath} → ${err.message}` }],
          details: { error: `write error: ${err.message}` },
        };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// cut tool
// ---------------------------------------------------------------------------

export function registerCutTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "cut",
    label: "Cut",
    description: "Copy text from a file into clipboard and remove it from the source. Read + write scope required.",
    promptSnippet: "cut path content [slot] — copy from file and remove",
    promptGuidelines: [
      "Use cut to move content from one file to clipboard.",
      "The exact text must match — use read first to get precise content.",
      "Content is stored in clipboard and removed from the source file.",
      "Default slot is 'default' — use named slots for multi-step operations.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Source file path." }),
      content: Type.String({ description: "Exact text to cut from the file." }),
      slot: Type.Optional(Type.String({ description: "Clipboard slot. Default: 'default'." })),
    }),

    renderCall(args: any, theme: any) {
      const slotLabel = args.slot ? ` → ${args.slot}` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("cut ")) +
          theme.fg("accent", `${clipPath(args.path)}: ${clip(args.content, 40)}`) + slotLabel,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ cut ${result?.details?.bytes ?? 0}B from ${clipPath(result?.details?.path || "")}`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const workDir = _cwd();
      const filePath = _resolvePath(params.path, workDir);
      const cutContent = String(params.content ?? "");
      const slot = (params.slot as string | undefined) || "default";

      if (!cutContent) {
        return {
          isError: true,
          content: [{ type: "text", text: "Empty content — specify the exact text to cut." }],
          details: { error: "empty content" },
        };
      }

      if (!fs.existsSync(filePath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `File not found: ${filePath}` }],
          details: { error: `not found: ${filePath}` },
        };
      }

      let fileContent: string;
      try {
        fileContent = fs.readFileSync(filePath, "utf-8");
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cannot read file: ${filePath} → ${err.message}` }],
          details: { error: `read error: ${err.message}` },
        };
      }

      // Check for exact match
      const idx = fileContent.indexOf(cutContent);
      if (idx === -1) {
        // Fuzzy hint
        const lines = fileContent.split("\n");
        let bestLine = -1;
        let bestScore = 0;
        const cutLines = cutContent.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(cutLines[0]?.trim() || "")) {
            bestScore = 0.5;
            bestLine = i + 1;
            break;
          }
        }
        const hint = bestLine > 0 ? `\n\nPossible match on line ${bestLine}. Use \`read\` to get exact text.` : "";
        return {
          isError: true,
          content: [{ type: "text", text: `Text not found in ${filePath}.${hint}\n\nThe content must match exactly. Use \`read\` first.` }],
          details: { error: "content not found", closestLine: bestLine > 0 ? bestLine : undefined },
        };
      }

      // Count occurrences
      let count = 0;
      let searchIdx = 0;
      while (true) {
        const next = fileContent.indexOf(cutContent, searchIdx);
        if (next === -1) break;
        count++;
        searchIdx = next + 1;
      }

      if (count > 1) {
        const lineNum = fileContent.substring(0, idx).split("\n").length;
        return {
          isError: true,
          content: [{ type: "text", text: `Text appears ${count} times in ${filePath} (first on line ${lineNum}).\n\nCut requires a unique match — include more surrounding context to target one occurrence.` }],
          details: { error: "ambiguous match", occurrences: count, firstLine: lineNum },
        };
      }

      // Perform cut: store in clipboard, remove from file
      const bytes = Buffer.byteLength(cutContent, "utf-8");
      const newContent = fileContent.substring(0, idx) + fileContent.substring(idx + cutContent.length);

      try {
        fs.writeFileSync(filePath, newContent, "utf-8");
        setSlot(slot, cutContent, filePath);
        const lineCount = cutContent.split("\n").length;

        return {
          content: [{ type: "text", text: `✓ cut ${bytes}B (${lineCount} lines) from ${filePath} → slot "${slot}"` }],
          details: { path: filePath, bytes, lines: lineCount, slot },
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Cut failed: ${filePath} → ${err.message}` }],
          details: { error: `write error: ${err.message}` },
        };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// clipboard tool (meta management)
// ---------------------------------------------------------------------------

export function registerClipboardTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "clipboard",
    label: "Clipboard",
    description: "Manage clipboard slots: list, show contents, clear individual slots, or clear all.",
    promptSnippet: "clipboard action [slot] — list/show/clear clipboard slots",
    promptGuidelines: [
      "Use clipboard list to see available slots.",
      "Use clipboard show to see full contents of a slot.",
      "Use clipboard clear to remove a specific slot, or clear_all to reset everything.",
    ],
    parameters: Type.Object({
      action: StringEnum(["list", "show", "clear", "clear_all"] as const, {
        description: "Action to perform.",
      }),
      slot: Type.Optional(Type.String({ description: "Target slot (required for show/clear)." })),
    }),

    renderCall(args: any, theme: any) {
      const slotLabel = args.slot ? ` "${args.slot}"` : "";
      return new Text([
        theme.fg("toolTitle", theme.bold("clipboard ")) +
          theme.fg("accent", `${args.action}${slotLabel}`),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      return new Text(
        theme.fg(ok ? "success" : "error",
          ok ? `✓ clipboard ${result?.details?.action ?? ""}`
             : `✗ ${clip(result?.details?.error || "no error info — check debug.log", 80)}`
        ),
        0, 0,
      );
    },

    async execute(_toolCallId, params) {
      const action = params.action as "list" | "show" | "clear" | "clear_all";
      const slot = (params.slot as string | undefined);

      switch (action) {
        case "list": {
          const slots = listSlots();
          if (slots.length === 0) {
            return {
              content: [{ type: "text", text: "No clipboard slots. Use the `copy` tool to store content." }],
              details: { action: "list", count: 0 },
            };
          }
          const lines = slots.map(s =>
            `  "${s.name}" — ${_humanSize(s.bytes)} · ${s.lines ?? "?"} lines · from ${s.source ?? "(text)"} · ${s.copiedAt.slice(11, 19)}`,
          );
          return {
            content: [{ type: "text", text: `Clipboard slots (${slots.length}):\n\n${lines.join("\n")}` }],
            details: { action: "list", count: slots.length, slots: slots.map(s => s.name) },
          };
        }

        case "show": {
          if (!slot) {
            return {
              isError: true,
              content: [{ type: "text", text: '`show` action requires a `slot` parameter. Example: { "action": "show", "slot": "default" }' }],
              details: { error: "slot required for show" },
            };
          }
          const entry = getSlot(slot);
          if (!entry) {
            return {
              isError: true,
              content: [{ type: "text", text: `Slot "${slot}" is empty or doesn't exist.` }],
              details: { error: `slot "${slot}" empty` },
            };
          }
          const lineCount = entry.content.split("\n").length;
          return {
            content: [{ type: "text", text: `Slot "${slot}" (${_humanSize(entry.bytes)}, ${lineCount} lines):\n\n---\n${entry.content}\n---` }],
            details: { action: "show", slot, bytes: entry.bytes, lines: lineCount },
          };
        }

        case "clear": {
          if (!slot) {
            return {
              isError: true,
              content: [{ type: "text", text: '`clear` action requires a `slot` parameter. Use `clear_all` to clear everything.' }],
              details: { error: "slot required for clear" },
            };
          }
          const existed = clipboardSlots.has(slot);
          clipboardSlots.delete(slot);
          return {
            content: [{ type: "text", text: existed
              ? `✓ cleared slot "${slot}"`
              : `Slot "${slot}" was already empty.`,
            }],
            details: { action: "clear", slot, existed },
          };
        }

        case "clear_all": {
          const count = clipboardSlots.size;
          clipboardSlots.clear();
          return {
            content: [{ type: "text", text: count > 0
              ? `✓ cleared all ${count} clipboard slots`
              : "Clipboard was already empty.",
            }],
            details: { action: "clear_all", cleared: count },
          };
        }

        default:
          return {
            isError: true,
            content: [{ type: "text", text: `Unknown action: "${action}". Valid: list, show, clear, clear_all.` }],
            details: { error: `unknown action: ${action}` },
          };
      }
    },
  });
}
