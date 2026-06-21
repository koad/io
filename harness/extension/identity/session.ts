// koad-io identity — session I/O: flush to disk, emit to daemon, bootstrap from jsonl.

import * as fs from "node:fs";
import * as path from "node:path";
import { FooterIdentity, briefSlug } from "./footer";
import { compactModel } from "../../utils/format";
import type { Telemetry, KingdomState } from "./types";
import type { DDPClient } from "../../ddp";

// ---------------------------------------------------------------------------
// Session flush (every 30s) — writes session state JSON
// ---------------------------------------------------------------------------

export function flushSession(
  id: FooterIdentity,
  tel: Telemetry,
  kingdom: KingdomState,
  sessionsDir: string,
  mcpToken: string,
  entity: string,
): void {
  if (!sessionsDir || !mcpToken) return;
  try {
    const file = path.join(sessionsDir, `${mcpToken}.json`);
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({
      sessionId: mcpToken,
      piSessionId: id.piSessionId || undefined,
      piSessionVersion: id.piSessionVersion || undefined,
      entity,
      operator: id.operator,
      spirit: process.env.KOAD_IO_SPIRIT ?? id.operator,
      harness: "pi",
      host: id.host,
      pid: process.pid,
      cwd: id.piSessionCwd || process.env.PWD || process.cwd(),
      provider: id.currentProvider,
      model: compactModel(id.currentProvider, id.currentModel),
      modelId: id.currentModel,
      flightId: id.flightId || undefined,
      brief: briefSlug(id.flightPlan) || undefined,
      cost: tel.totalCost,
      tokensIn: tel.tokensIn,
      tokensOut: tel.tokensOut,
      cacheRead: tel.cacheRead,
      cacheWrite: tel.cacheWrite,
      contextPct: tel.contextPct,
      contextWindow: tel.contextWindow,
      turnCount: tel.turnCount,
      toolCount: tel.toolCount,
      thinkingLevel: tel.thinkingLevel || undefined,
      sessionUptimeS: Math.floor((Date.now() - id.sessionStartedAt.getTime()) / 1000),
      lastToolMs: tel.lastToolMs || undefined,
      slowestToolMs: tel.slowestToolMs || undefined,
      slowestToolName: tel.slowestToolName || undefined,
      slowToolCount: tel.slowToolCount || undefined,
      totalToolMs: tel.totalToolMs || undefined,
      kingdom,
      lastSeen: new Date().toISOString(),
    }));
    fs.renameSync(tmp, file);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Emission update (via control-tower DDP)
// ---------------------------------------------------------------------------

export function emitUpdate(
  control: DDPClient | undefined,
  emitEnabled: boolean,
  payload: Record<string, unknown>,
): void {
  if (!emitEnabled) return;
  if (!control?.isConnected) return;
  control.call('emit.update', payload).catch(() => {});
}

// ---------------------------------------------------------------------------
// Extract pi session ID from session filename.
// Pi session filenames follow the pattern: <timestamp>_<uuid>.jsonl
// e.g. 2026-06-12T21-31-37-519Z_019ebdbf-64af-73e1-84ed-2a88c757f268.jsonl
// ---------------------------------------------------------------------------

export function extractPiSessionId(sessionFile: string): string | undefined {
  const basename = path.basename(sessionFile, ".jsonl");
  const underscoreIdx = basename.indexOf("_");
  if (underscoreIdx >= 0) {
    const candidate = basename.slice(underscoreIdx + 1);
    // Sanity check: pi session IDs are UUIDs, so they contain hyphens.
    if (candidate.includes("-")) return candidate;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Bootstrap from Pi session jsonl — replays session to rebuild token counts,
// model, thinking level, and cwd. Called on session_start with retries.
// ---------------------------------------------------------------------------

export function bootstrapFromPiSession(
  sessionFile: string | undefined,
  id: FooterIdentity,
  tel: Telemetry,
): void {
  if (!sessionFile) return;

  // Seed piSessionId from filename before reading JSONL.
  // On fresh sessions the JSONL header may not yet contain the id field,
  // but the filename always encodes pi's session UUID.
  if (!id.piSessionId) {
    id.piSessionId = extractPiSessionId(sessionFile);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(sessionFile, "utf8");
  } catch (_) {
    return;
  }

  // Reset counters before replay
  tel.turnCount = 0;
  tel.tokensIn = 0;
  tel.tokensOut = 0;
  tel.cacheRead = 0;
  tel.cacheWrite = 0;
  tel.totalCost = 0;

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch (_) { continue; }
    if (!obj || typeof obj !== "object") continue;

    if (obj.type === "session") {
      if (obj.cwd) id.piSessionCwd = obj.cwd;
      // JSONL id field takes precedence over filename-derived value
      if (obj.id) id.piSessionId = obj.id;
      if (typeof obj.version === "number") id.piSessionVersion = obj.version;
      continue;
    }
    if (obj.type === "model_change") {
      if (obj.provider) id.currentProvider = obj.provider;
      if (obj.modelId) id.currentModel = obj.modelId;
      continue;
    }
    if (obj.type === "thinking_level_change") {
      if (obj.thinkingLevel) tel.thinkingLevel = obj.thinkingLevel;
      continue;
    }
    if (obj.type === "message" && obj.message?.role === "assistant") {
      const u = obj.message.usage;
      if (u) {
        tel.turnCount++;
        tel.tokensIn  += u.input ?? u.input_tokens ?? u.prompt_tokens ?? 0;
        tel.tokensOut += u.output ?? u.output_tokens ?? u.completion_tokens ?? 0;
        tel.cacheRead += u.cacheRead ?? u.cache_read_input_tokens ?? 0;
        tel.cacheWrite += u.cacheWrite ?? u.cache_creation_input_tokens ?? 0;
        if (typeof u.cost?.total === "number") tel.totalCost += u.cost.total;
      }
      continue;
    }
  }
}
