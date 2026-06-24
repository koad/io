/**
 * koad-io tool-registry — registers tools the bond scope allows.
 *
 * Grouped by layer:
 *   - Always-on — built-in replacements, clipboard, model picker, session tools
 *     (registered unconditionally; bond gate enforces at tool_call level)
 *   - Scope-gated — ecosystem tools (dispatch, questions, channels, koad-io,
 *     search, status, file ops) — only registered if the bond scope grants them.
 *
 * The bond scope is resolved synchronously from disk before any tools are
 * registered. If bonds change via DDP mid-session, tool-policy.ts handles
 * live re-scoping without re-registration.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BondScope } from "./bond-gate/types";
import {
  FILE_READ_TOOLS,
  FILE_WRITE_TOOLS,
  GATED_DISPATCH_TOOLS,
  GLOBAL_ALLOWED_TOOLS,
  KOADIO_TOOLS,
  SCOPED_SEARCH_TOOLS,
  SHELL_TOOLS,
  CHANNEL_PARTICIPANT_TOOLS,
  CHANNEL_MODERATOR_TOOLS,
} from "./bond-gate/types";

import {
  registerReadTool, registerWriteTool, registerEditTool,
  registerBashTool, registerLsTool, registerGrepTool, registerFindTool,
} from "./tools/builtin-replacements";
import { registerCopyTool, registerPasteTool, registerCutTool, registerClipboardTool } from "./tools/clipboard";
import { registerFileOpTools } from "./tools/file-ops";
import { registerModelPicker } from "./tools/model-picker";
import { registerDispatchTools } from "./tools/dispatch";
import { registerQuestionTools } from "./tools/questions";
import { registerChannelTools } from "./tools/channels";
import { registerKoadioTool } from "./tools/koad-io";
import { registerSearchTool } from "./tools/search";
import { registerStatusTool } from "./tools/status";
import { registerSessionSummarizeTool } from "./tools/session-summarize";
import { registerSessionListTool } from "./tools/session-list";
import { registerFetchTool } from "./tools/fetch";
import { registerBrowseTool } from "./tools/browse";

// ── Scope-gating helpers ──────────────────────────────────────────────────

function hasGrant(list: string[], name: string): boolean {
  return list.includes("*") || list.includes(name);
}

/**
 * Classify which bond grant lane authorizes a tool.
 * Returns the grant source label, or "none" if not granted.
 * Exported for use by list_tools (self-awareness).
 */
export function classifyGrant(name: string, scope: BondScope | null): string {
  if (!scope || scope.mode === "bypass") return "bypass";

  if (GLOBAL_ALLOWED_TOOLS.has(name))    return "global";
  if (SHELL_TOOLS.has(name))            return scope.tools.bash ? "bash_grant" : "none";
  if (name === "koad-io")              return scope.tools.koadio_commands.length > 0 ? "koadio_commands" : "none";
  if (GATED_DISPATCH_TOOLS.has(name))   return scope.tools.dispatch ? "dispatch" : "none";
  if (CHANNEL_PARTICIPANT_TOOLS.has(name)) return (scope.tools.channels.participate.length > 0 || scope.tools.channels.moderate.length > 0) ? "channels" : "none";
  if (CHANNEL_MODERATOR_TOOLS.has(name))   return scope.tools.channels.moderate.length > 0 ? "channels" : "none";
  if (SCOPED_SEARCH_TOOLS.has(name))       return scope.file.read.length > 0 && hasGrant(scope.tools.koadio_tools, name) ? "read_scope+koadio_tools" : "none";
  if (FILE_READ_TOOLS.has(name))          return scope.file.read.length > 0 ? "read_scope" : "none";
  if (FILE_WRITE_TOOLS.has(name))         return scope.file.write.length > 0 ? "write_scope" : "none";
  if (KOADIO_TOOLS.has(name))             return hasGrant(scope.tools.koadio_tools, name) ? "koadio_tools" : "none";

  return hasGrant(scope.tools.koadio_tools, name) ? "koadio_tools" : "none";
}

/**
 * Check whether a tool should be registered given the current bond scope.
 * Exported for use by ddp-setup.ts (which registers DDP-dependent tools).
 */
export function canRegister(name: string, scope: BondScope | null): boolean {
  return classifyGrant(name, scope) !== "none";
}

// ── Registration ──────────────────────────────────────────────────────────

/**
 * Register every tool the harness provides.
 *
 * Built-in replacements are always registered (pi depends on them for
 * rendering and session format — the bond gate enforces at tool_call).
 *
 * Ecosystem tools are only registered if the bond scope grants them.
 * When scope is null (no entity / SDK mode), everything is registered.
 *
 * DDP-dependent tools (music, sin, body tools, kingdom query, tool
 * inspection) are registered separately in ddp-setup.ts.
 */
export function registerHarnessTools(pi: ExtensionAPI, scope: BondScope | null): void {
  // ── Always-on: Built-in replacements ────────────────────────────────────
  registerReadTool(pi);
  registerWriteTool(pi);
  registerEditTool(pi);
  registerBashTool(pi);
  registerLsTool(pi);
  registerGrepTool(pi);
  registerFindTool(pi);

  // ── Always-on: Clipboard ────────────────────────────────────────────────
  registerCopyTool(pi);
  registerPasteTool(pi);
  registerCutTool(pi);
  registerClipboardTool(pi);

  // ── Always-on: Model picker, session tools ──────────────────────────────
  registerModelPicker(pi);
  registerSessionSummarizeTool(pi);
  registerSessionListTool(pi);

  // ── Scope-gated: File operations ─────────────────────────────────────────
  if (scope?.file.write.length || scope?.mode === "bypass" || !scope) {
    registerFileOpTools(pi);
  }

  // ── Scope-gated: Ecosystem tools ────────────────────────────────────────
  if (canRegister("koad-io", scope))           registerKoadioTool(pi);
  if (canRegister("dispatch", scope))          registerDispatchTools(pi);
  if (canRegister("ask_question", scope))      registerQuestionTools(pi);
  if (canRegister("wait_for_cue", scope))      registerChannelTools(pi);
  if (canRegister("search", scope))            registerSearchTool(pi);
  if (canRegister("status", scope))            registerStatusTool(pi);
  if (canRegister("fetch", scope))             registerFetchTool(pi);
  if (canRegister("browse", scope))            registerBrowseTool(pi);
}
