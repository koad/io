// koad:io bond-gate — shared types, constants, helpers, logging.
//
// Gates every tool call against the entity's trust bonds.
// Bonds are signed capability grants from one entity to another.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileScope {
  read: string[];
  write: string[];
  exec: string[];
  blocked: string[];
}

export interface ToolGrants {
  bash: boolean;
  dispatch: boolean;
  dispatch_followup: boolean;
  dispatch_complete: boolean;
  koadio_tools: string[];
  koadio_commands: string[];
  channels: {
    moderate: string[];
    participate: string[];
  };
}

export interface EntityCapabilities {
  dispatch_targets: string[];
  message_targets: string[];
  channel_roles: Record<string, string>;
}

export interface InteractiveOverride {
  bash?: boolean;
  exec?: string[];
  write?: string[];
}

export interface ParsedBond {
  type: string;
  from: string;
  from_fingerprint?: string;
  to: string;
  status: string;
  visibility: string;
  created?: string;
  expires?: string;
  renewal?: string;
  capabilities: FileScope;
  tools: ToolGrants;
  entity_capabilities: EntityCapabilities;
  interactive: InteractiveOverride;
  device_ids: string[];
  path: string;
  specRefs: string[];
  reason?: string;
}

export interface BondScope {
  file: FileScope;
  tools: ToolGrants;
  entity_capabilities: EntityCapabilities;
  interactive: InteractiveOverride;
  errors: string[];
  mode: "bypass" | "bonded" | "env-var" | "default";
  label: string;
  bondCount: number;
  deviceId: string;
  envLanes: string[];
  envReadTools: string[];
  envWriteTools: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HOME = os.homedir();
export const FORGE_DIR = path.join(HOME, ".forge");

export const DEFAULT_BLOCKED = ["/.env", "/.credentials", "/.git/", "/id/"];

export const EMPTY_FILE_SCOPE: FileScope = {
  read: [],
  write: [],
  exec: [],
  blocked: [...DEFAULT_BLOCKED],
};

export const EMPTY_TOOL_GRANTS: ToolGrants = {
  bash: false,
  dispatch: false,
  dispatch_followup: false,
  dispatch_complete: false,
  koadio_tools: [],
  koadio_commands: [],
  channels: { moderate: [], participate: [] },
};

export const EMPTY_ENTITY_CAPS: EntityCapabilities = {
  dispatch_targets: [],
  message_targets: [],
  channel_roles: {},
};

export const EMPTY_INTERACTIVE: InteractiveOverride = {};

// ---------------------------------------------------------------------------
// Tool classification sets
// ---------------------------------------------------------------------------

export const KOADIO_TOOLS = new Set([
  "ask_question", "wait_for_answer", "answer_question",
  "wait_for_cue", "raise_hand", "channel_leave",
  "channel_state_read", "channel_cue_deliver", "channel_broadcast",
  "channel_wait_for_next_turn", "channel_wait_for_state_change",
  "channel_event_fire",
  "search", "status", "music", "koad-io", "wait",
  "mission",
]);

export const PI_BUILTIN_TOOLS = new Set(["read", "write", "edit", "bash", "ls", "grep", "find"]);

export const GATED_DISPATCH_TOOLS = new Set(["dispatch", "dispatch_followup", "dispatch_complete"]);

export const GLOBAL_ALLOWED_TOOLS = new Set<string>();
export const SCOPED_SEARCH_TOOLS = new Set(["search"]);
export const FILE_READ_TOOLS = new Set(["read", "ls", "find", "grep", "sin"]);
export const FILE_WRITE_TOOLS = new Set(["write", "edit", "mkdir", "cp", "mv", "rm", "chmod"]);
export const SHELL_TOOLS = new Set(["bash"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function currentDeviceId(): string {
  return os.hostname();
}

export function normalizeFingerprint(raw: string | undefined): string | undefined {
  const normalized = raw?.replace(/\s+/g, "").trim().toLowerCase();
  return normalized || undefined;
}

export function expandPath(raw: string): string {
  if (raw === "~") return HOME;
  if (raw.startsWith("~/")) return path.join(HOME, raw.slice(2));
  return path.resolve(raw);
}

export function resolveToolPath(raw: string, cwd: string): string {
  if (raw === "~") return HOME;
  if (raw.startsWith("~/")) return path.join(HOME, raw.slice(2));
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
}

export function parsePathList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(":")
    .map(s => s.trim())
    .filter(Boolean)
    .map(expandPath);
}

export function parseNameList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,:]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function isUnder(absolutePath: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => {
    const resolved = path.resolve(prefix);
    const relative = path.relative(resolved, absolutePath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

export function isBlocked(absolutePath: string, blocked: string[]): boolean {
  const normalized = absolutePath + "/";
  return blocked.some(pattern => normalized.includes(pattern));
}

// ---------------------------------------------------------------------------
// Visitor mode (used by SDK / RPC for public/bonded visitor access)
// ---------------------------------------------------------------------------

export interface VisitorAccessScope {
  read: string[];
  write: string[];
  exec: string[];
  blocked: string[];
}

export interface VisitorCaller {
  handle: string;
}

export interface VisitorConfig {
  /** Entity handle the visitor is accessing */
  entityHandle: string;
  /** File access scope for this visitor (from bond or default) */
  accessScope: VisitorAccessScope;
  /** Caller identity — null for public/anonymous visitors */
  caller: VisitorCaller | null;
  /** When true, skip bond file resolution entirely (use accessScope only) */
  noBondFiles?: boolean;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const DEBUG_LOG = path.join(HOME, ".koad-io", "harness", "bond-gate.log");

export function log(msg: string): void {
  const ts = new Date().toISOString();
  try {
    fs.appendFileSync(DEBUG_LOG, `[${ts}] ${msg}\n`);
  } catch (_) {}
}

export function logError(msg: string, err?: any): void {
  const detail = err ? ` — ${(err.stderr || err.message || String(err)).toString().slice(0, 300)}` : "";
  log(`ERROR ${msg}${detail}`);
}

export function logMode(ctx: any, message: string, level: "info" | "warning" = "info"): void {
  log(level === "warning" ? `WARN ${message}` : message);
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
}
