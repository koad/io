// Telemetry state + Pi event handlers.
// DDP-driven kingdom updates instead of REST polling.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DDPClient, type EmissionRecord, type BondRecord } from "../ddp";
import { createFooterComponent, FooterIdentity, footerIdentityDefaults, briefSlug } from "./footer";
import { clearOutfitCache } from "../utils/outfit";
import { compactModel } from "../utils/format";
import type { HealthState } from "../utils/ansi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Telemetry {
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  turnCount: number;
  toolCount: number;
  contextPct: number;
  contextWindow: number;
  autoCompact: boolean;
  thinkingLevel: string;
  activeTool: string;
  activePath: string;
  idle: boolean;
}

export interface ErrorEntry {
  at: string;       // ISO timestamp
  msg: string;
  toolName?: string;
}

export interface KingdomState {
  flightCount: number;
  bondCount: number;
  lastTool: string;
  lastToolEntity: string;
  daemon: HealthState;
  daemonReady: boolean;
  daemonUptimeS: number;
  control: HealthState;
  controlReady: boolean;
  controlUptimeS: number;
  lastPollAt: string;
  lastError: string;
  errorLog: ErrorEntry[];
  errorCount: number;
  lastEmission: { text: string; at: number } | null;
}

export const EMPTY_KINGDOM: KingdomState = {
  flightCount: 0,
  bondCount: 0,
  lastTool: "",
  lastToolEntity: "",
  daemon: "starting",
  daemonReady: false,
  daemonUptimeS: 0,
  control: "starting",
  controlReady: false,
  controlUptimeS: 0,
  lastPollAt: "",
  lastError: "",
  errorLog: [],
  errorCount: 0,
  lastEmission: null,
};

export const EMPTY_TELEMETRY: Telemetry = {
  totalCost: 0,
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cacheWrite: 0,
  turnCount: 0,
  toolCount: 0,
  contextPct: 0,
  contextWindow: 0,
  autoCompact: false,
  thinkingLevel: "",
  activeTool: "",
  activePath: "",
  idle: true,
};

// ---------------------------------------------------------------------------
// Telemetry session
// ---------------------------------------------------------------------------

export interface TelemetrySession {
  id: FooterIdentity;
  tel: Telemetry;
  kingdom: KingdomState;
  startTimers(): void;
  stopTimers(): void;
  flushSession(): void;
  storeCtx(ctx: any): void;
}

export function createTelemetrySession(pi: ExtensionAPI, ddp: DDPClient): TelemetrySession {
  // State
  const id: FooterIdentity = footerIdentityDefaults();
  const tel: Telemetry = { ...EMPTY_TELEMETRY };
  const kingdom: KingdomState = { ...EMPTY_KINGDOM };

  // Refs
  let footerDataRef: any;
  let tuiRef: any;
  let cachedCtx: any;

  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let gitTimer: ReturnType<typeof setInterval> | undefined;

  // Env
  const entity = id.entity;
  const sessionsDir = process.env.KOAD_IO_HARNESS_SESSIONS_DIR ?? "";
  const mcpToken = process.env.KOAD_IO_MCP_SESSION_TOKEN ?? "";
  const emitEnabled = process.env.KOAD_IO_EMIT === "1";
  const emissionId = process.env.HARNESS_EMISSION_ID ?? "";
  const _ip = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
  const daemonHttpUrl = process.env.KOAD_IO_DAEMON_URL ?? `http://${_ip}:${process.env.KOAD_IO_PORT ?? "28282"}`;
  const controlHttpUrl = process.env.KOAD_IO_CONTROL_URL ?? `http://${_ip}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`;
  const emitHttpUrl = controlHttpUrl;

  // -----------------------------------------------------------------
  // Session flush (every 30s)
  // -----------------------------------------------------------------

  function flushSession(): void {
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
        kingdom,
        lastSeen: new Date().toISOString(),
      }));
      fs.renameSync(tmp, file);
    } catch (_) {}
  }

  // -----------------------------------------------------------------
  // Emission update (via control-tower)
  // -----------------------------------------------------------------

  function emitUpdate(payload: Record<string, unknown>): void {
    if (!emitEnabled || !emissionId) return;
    fetch(`${emitHttpUrl}/emit/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _id: emissionId, ...payload }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});
  }

  // -----------------------------------------------------------------
  // Refresh footer
  // -----------------------------------------------------------------

  function refresh(): void {
    if (!cachedCtx) return;

    // Read bond gate scope from bond-gate extension
    try {
      const bs = (pi as any).__bondScope;
      if (bs) {
        kingdom.bondCount = bs.bondCount;
        kingdom.bondMode = bs.mode;
      }
    } catch (_) {}
    try {
      const usage = cachedCtx.getContextUsage();
      if (usage?.tokens !== undefined && usage?.limit > 0) {
        tel.contextPct = Math.round((usage.tokens / usage.limit) * 100);
        tel.contextWindow = usage.limit;
      }
    } catch (_) {}
    let themeRef: any;
    try {
      cachedCtx.ui.setFooter((tui: any, theme: any, fd: any) => {
        if (!tuiRef) tuiRef = tui;
        if (!footerDataRef) footerDataRef = fd;
        themeRef = theme;
        return createFooterComponent(id, tel, kingdom, footerDataRef, themeRef);
      });
      tuiRef?.requestRender();
    } catch (_) {}
  }

  function storeCtx(ctx: any): void {
    if (ctx?.ui?.setFooter) cachedCtx = ctx;
  }

  // -----------------------------------------------------------------
  // Timers
  // -----------------------------------------------------------------

  let healthTimer: ReturnType<typeof setInterval> | undefined;

  function startTimers(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    if (flushTimer) clearInterval(flushTimer);
    if (gitTimer) clearInterval(gitTimer);
    if (healthTimer) clearInterval(healthTimer);
    refreshTimer = setInterval(refresh, 1000);
    flushTimer = setInterval(flushSession, 30_000);
    healthTimer = setInterval(pollHealth, 10_000);
    pollHealth(); // immediate first poll
  }

  function stopTimers(): void {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = undefined; }
    if (flushTimer) { clearInterval(flushTimer); flushTimer = undefined; }
    if (gitTimer) { clearInterval(gitTimer); gitTimer = undefined; }
    if (healthTimer) { clearInterval(healthTimer); healthTimer = undefined; }
    tuiRef = undefined;
    footerDataRef = undefined;
    cachedCtx = undefined;
  }

  // -----------------------------------------------------------------
  // Session bootstrap — reads the known session JSONL for identity
  // state (cwd, session id, model, thinking level) before the first
  // agent turn fires, so the footer is populated immediately.
  // -----------------------------------------------------------------

  function bootstrapFromPiSession(sessionFile: string | undefined): void {
    if (!sessionFile) return;

    let raw: string;
    try {
      raw = fs.readFileSync(sessionFile, "utf8");
    } catch (_) {
      return; // file doesn’t exist yet — caller will retry
    }

    for (const line of raw.split("\n")) {
      if (!line) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch (_) { continue; }
      if (!obj || typeof obj !== "object") continue;

      if (obj.type === "session") {
        if (obj.cwd) id.piSessionCwd = obj.cwd;
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
      if (obj.type === "message" && obj.message?.role === "user") break;
    }
  }

  // -----------------------------------------------------------------
  // HTTP health polling (daemon + control-tower)
  // -----------------------------------------------------------------

  interface KoadIOHealth {
    health?: { status?: string; uptime?: number };
    upstart?: string;
    asof?: string;
  }

  type HealthStatus = "ok" | "degraded" | "down";

  interface HealthResult {
    status: HealthStatus;
    ready: boolean;
    uptimeS: number;
    responseMs: number;
  }

  async function fetchHealth(url: string): Promise<HealthResult | null> {
    const start = Date.now();
    try {
      const res = await fetch(`${url}/.well-known/koad-io.json`, {
        signal: AbortSignal.timeout(5000),
      });
      const responseMs = Date.now() - start;

      // Parse body regardless of status code — the daemon may return
      // non-2xx (e.g. 316) with valid health JSON
      let json: KoadIOHealth | null = null;
      try { json = await res.json() as KoadIOHealth; } catch (_) {}

      if (!json?.health?.status) {
        return { status: "degraded", ready: false, uptimeS: 0, responseMs };
      }
      const up = json.health.status === "up";
      if (!up) {
        return { status: "degraded", ready: false, uptimeS: json.health.uptime ?? 0, responseMs };
      }
      if (responseMs > 2000) {
        return { status: "degraded", ready: true, uptimeS: json.health.uptime ?? 0, responseMs };
      }
      return { status: "ok", ready: true, uptimeS: json.health.uptime ?? 0, responseMs };
    } catch (_) {
      return null;
    }
  }

  async function pollHealth(): Promise<void> {
    const [daemonH, controlH] = await Promise.all([
      fetchHealth(daemonHttpUrl),
      fetchHealth(controlHttpUrl),
    ]);

    if (daemonH) {
      kingdom.daemon = daemonH.status;
      kingdom.daemonReady = daemonH.ready;
      kingdom.daemonUptimeS = daemonH.uptimeS;
    } else {
      kingdom.daemon = "down";
      kingdom.daemonReady = false;
    }

    if (controlH) {
      kingdom.control = controlH.status;
      kingdom.controlReady = controlH.ready;
      kingdom.controlUptimeS = controlH.uptimeS;
    } else {
      kingdom.control = "down";
      kingdom.controlReady = false;
    }

    kingdom.lastPollAt = new Date().toISOString();
    updateStatusIndicators();
    tuiRef?.requestRender();
  }

  function updateStatusIndicators(): void {
    if (!cachedCtx) return;
    try {
      const bothOk = kingdom.daemon === "ok" && kingdom.control === "ok" && kingdom.daemonReady && kingdom.controlReady;
      const bothDown = kingdom.daemon === "down" && kingdom.control === "down";
      const bothStarting = kingdom.daemon === "starting" && kingdom.control === "starting";

      let text: string;
      if (bothOk) {
        text = "koad:io online";
      } else if (bothDown) {
        text = "koad:io offline";
      } else if (bothStarting) {
        text = "koad:io connecting…";
      } else {
        const dot = (s: HealthState) => s === "ok" ? "●" : s === "degraded" || s === "starting" ? "◐" : "○";
        text = `d${dot(kingdom.daemon)} c${dot(kingdom.control)}`;
      }
      cachedCtx.ui.setStatus("koad-io", text);
    } catch (_) {}
  }

  // ── DDP (control-tower: emissions + bonds) ────────────────────

  ddp.on("emission", (event, record) => {
    if (event === "added" || event === "changed") {
      if (record.body?.startsWith("→ ")) {
        kingdom.lastTool = record.body.slice(2).slice(0, 36);
        kingdom.lastToolEntity = record.entity ?? "";
      }
      // Track last emission for footer display
      const body = record.body || "";
      const entity = record.entity || "?";
      const type = record.type || "";
      if (body && type !== "session") {
        kingdom.lastEmission = {
          text: `[${entity}] ${type}: ${body}`,
          at: Date.now(),
        };
      }
    }
    kingdom.flightCount = ddp.flightCount;
    kingdom.lastPollAt = new Date().toISOString();
    tuiRef?.requestRender();
  });

  ddp.on("bond", (_event) => {
    kingdom.bondCount = ddp.bondCount;
    kingdom.lastPollAt = new Date().toISOString();
    tuiRef?.requestRender();
  });

  ddp.on("connected", () => {
    kingdom.flightCount = ddp.flightCount;
    kingdom.bondCount = ddp.bondCount;
    tuiRef?.requestRender();
  });

  // -----------------------------------------------------------------
  // Pi lifecycle events
  // -----------------------------------------------------------------

  pi.on("session_shutdown", () => {
    stopTimers();
    flushSession();
  });

  pi.on("session_start", (_event: any, ctx: any) => {
    stopTimers();
    clearOutfitCache();
    id.sessionStartedAt = new Date();
    storeCtx(ctx);
    // Flash "harnessed by pi" for 17s, then switch to kingdom health indicators
    try { ctx.ui.setStatus("koad-io", "koad:io harnessed by pi"); } catch (_) {}
    setTimeout(() => updateStatusIndicators(), 17_000);
    try { tel.autoCompact = ctx.sessionManager?.getSession?.()?.autoCompactionEnabled ?? false; } catch (_) {}
    refresh();
    startTimers();

    const sessionFile = ctx.sessionManager.getSessionFile() as string | undefined;

    let bootAttempts = 0;
    const maxAttempts = 4;
    const bootDelay = 500;

    function tryBootstrap(): void {
      bootstrapFromPiSession(sessionFile);
      bootAttempts++;

      // Retry if we still have nothing and the file may not exist on disk yet
      if (!id.piSessionCwd && !id.currentModel && bootAttempts < maxAttempts) {
        setTimeout(tryBootstrap, bootDelay);
        return;
      }

      refresh();
      const modelLabel = compactModel(id.currentProvider, id.currentModel);
      emitUpdate({
        status_line: `${entity} online | ${modelLabel}${id.flightId ? ` | ${id.flightId.split("-").slice(-2).join("-")}` : ""}${id.flightPlan ? ` | ${briefSlug(id.flightPlan)}` : ""}`,
      });
    }
    setTimeout(tryBootstrap, bootDelay);
  });

  // ── Session auto-naming (first user prompt becomes session name) ─
  let sessionNamed = false;

  pi.on("before_agent_start", async (event: any) => {
    if (sessionNamed) return;
    sessionNamed = true;

    const prompt = (event.prompt ?? "").trim();
    if (!prompt) return;

    // Extract a readable name from the first prompt
    let name = prompt
      .replace(/^[@!]/, "")             // strip @file or !command prefixes
      .replace(/\s+/g, " ")             // collapse whitespace
      .slice(0, 72);                     // keep it short

    // If it ends mid-word, trim to last space
    if (name.length >= 60) {
      const cut = name.lastIndexOf(" ", 60);
      if (cut > 20) name = name.slice(0, cut);
    }

    // Capitalize first letter
    name = name.charAt(0).toUpperCase() + name.slice(1);

    pi.setSessionName(name);
  });

  pi.on("agent_start", (_event: any, ctx: any) => {
    tel.idle = false;
    storeCtx(ctx);
    try { tel.autoCompact = ctx.sessionManager?.getSession?.()?.autoCompactionEnabled ?? tel.autoCompact; } catch (_) {}
    emitUpdate({ status_line: `thinking | ${entity} | ${compactModel(id.currentProvider, id.currentModel)}` });
    refresh();
  });

  pi.on("agent_end", (_event: any, ctx: any) => {
    tel.idle = true;
    tel.activeTool = "";
    tel.activePath = "";
    storeCtx(ctx);
    try { tel.autoCompact = ctx.sessionManager?.getSession?.()?.autoCompactionEnabled ?? tel.autoCompact; } catch (_) {}
    emitUpdate({ status_line: `idle | t${tel.turnCount} $${tel.totalCost.toFixed(4)}` });
    flushSession();
    refresh();
  });

  pi.on("turn_start", (_event: any, ctx: any) => {
    storeCtx(ctx);
    const usage = ctx.getContextUsage();
    if (usage?.tokens !== undefined && usage?.limit > 0) {
      tel.contextPct = Math.round((usage.tokens / usage.limit) * 100);
      tel.contextWindow = usage.limit;
    }
    refresh();
  });

  pi.on("turn_end", (_event: any, ctx: any) => {
    storeCtx(ctx);
    refresh();
  });

  pi.on("message_end", (event: any) => {
    if (event.message.role !== "assistant") return;
    tel.turnCount++;
    if (event.message.provider) id.currentProvider = event.message.provider;
    if (event.message.model) id.currentModel = event.message.model;
    const usage = event.message.usage;
    if (!usage) return;
    if (typeof usage.cost?.total === "number") tel.totalCost += usage.cost.total;
    tel.tokensIn += usage.input ?? usage.input_tokens ?? usage.prompt_tokens ?? 0;
    tel.tokensOut += usage.output ?? usage.output_tokens ?? usage.completion_tokens ?? 0;
    tel.cacheRead += usage.cacheRead ?? usage.cache_read_input_tokens ?? 0;
    tel.cacheWrite += usage.cacheWrite ?? usage.cache_creation_input_tokens ?? 0;
    refresh();
  });

  pi.on("model_select", (event: any) => {
    id.currentProvider = event.model?.provider ?? id.currentProvider;
    id.currentModel = event.model?.id ?? id.currentModel;
    refresh();
  });

  pi.on("thinking_level_select", (event: any) => {
    tel.thinkingLevel = event.level ?? tel.thinkingLevel;
    refresh();
  });

  function recordError(msg: string, toolName?: string): void {
    const entry: ErrorEntry = { at: new Date().toISOString(), msg, toolName };
    kingdom.errorLog.push(entry);
    if (kingdom.errorLog.length > 100) kingdom.errorLog.shift();
    kingdom.lastError = msg;
    kingdom.errorCount++;
    tuiRef?.requestRender();
  }

  pi.on("tool_execution_start", (event: any, ctx: any) => {
    tel.toolCount++;
    tel.activeTool = event.toolName;
    const inp = event.input;
    let arg = "";
    if (inp) {
      if (typeof inp.path === "string") arg = inp.path.replace(os.homedir(), "~");
      else if (typeof inp.command === "string") arg = inp.command.slice(0, 60);
    }
    tel.activePath = arg;
    const note = arg ? `${event.toolName} ${arg}` : event.toolName;
    emitUpdate({ note: `→ ${note}`, status_line: `${entity}│⚙${note.slice(0, 40)}` });
    storeCtx(ctx);
    refresh();
  });

  pi.on("tool_execution_end", (event: any, ctx: any) => {
    if (event.isError) {
      const errText = event.result?.content?.[0]?.text ?? event.result?.error ?? `tool ${event.toolName} failed`;
      recordError(typeof errText === "string" ? errText.slice(0, 200) : String(errText).slice(0, 200), event.toolName);
      emitUpdate({ note: `← ${event.toolName} ERROR` });
    }
    if (event.toolName === tel.activeTool) {
      tel.activeTool = "";
      tel.activePath = "";
    }
    storeCtx(ctx);
    refresh();
  });

  // ── Flight landing message renderer ─────────────────────────────

  pi.registerMessageRenderer("koad-io-flight-landing", {
    render(message: any, theme: any) {
      const d = message.details ?? {};
      const entity = d.entity ?? "?";
      const fid = (d.flightId ?? "?").slice(-12);
      const ok = d.status === "landed" || d.status === "closed";
      const icon = ok ? "✓" : d.status === "error" ? "✗" : "⏳";
      const color = ok ? theme.fg("success", icon) : theme.fg("error", icon);

      const mins = Math.floor((d.elapsedS ?? 0) / 60);
      const secs = (d.elapsedS ?? 0) % 60;
      const dur = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

      let line = `${color} ${theme.bold(entity)} ⟐ \`${fid}\` (${dur})`;
      if (d.closingNote) line += ` — ${theme.fg("dim", d.closingNote)}`;

      return new Text(line, 0, 0);
    },
  });

  // Start DDP connection
  ddp.connect();

  return { id, tel, kingdom, startTimers, stopTimers, flushSession, storeCtx };
}
