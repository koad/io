// koad-io identity — createTelemetrySession(): orchestrates footer, DDP, pi lifecycle.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as os from "node:os";
import { DDPClient } from "../ddp";
import { createFooterComponent, FooterIdentity, footerIdentityDefaults, briefSlug } from "./footer";
import { clearOutfitCache } from "../utils/outfit";
import { compactModel } from "../utils/format";
import type { Telemetry, KingdomState, ErrorEntry } from "./types";
export type { Telemetry, KingdomState, ErrorEntry } from "./types";
import { EMPTY_TELEMETRY, EMPTY_KINGDOM } from "./types";
import { flushSession, emitUpdate, bootstrapFromPiSession } from "./session";
import { pollHealth, updateStatusIndicators, wireDDPHandlers } from "./health";

// ---------------------------------------------------------------------------
// Public API
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

export function createTelemetrySession(
  pi: ExtensionAPI,
  clients: { control: DDPClient; daemon: DDPClient },
): TelemetrySession {
  const id: FooterIdentity = footerIdentityDefaults();
  const tel: Telemetry = { ...EMPTY_TELEMETRY };
  const kingdom: KingdomState = { ...EMPTY_KINGDOM };

  let footerDataRef: any;
  let tuiRef: any;
  let cachedCtx: any;

  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  let gitTimer: ReturnType<typeof setInterval> | undefined;

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
  // Session I/O wrappers
  // -----------------------------------------------------------------

  function flush(): void {
    flushSession(id, tel, kingdom, sessionsDir, mcpToken, entity);
  }

  function emit(payload: Record<string, unknown>): void {
    emitUpdate(clients.control, emitEnabled, emissionId, payload);
  }

  // -----------------------------------------------------------------
  // Footer refresh
  // -----------------------------------------------------------------

  function refresh(): void {
    if (!cachedCtx) return;

    try {
      const usage = cachedCtx.getContextUsage();
      if (usage?.tokens !== undefined && usage?.contextWindow > 0) {
        tel.contextPct = Math.round((usage.tokens / usage.contextWindow) * 1000) / 10;
        tel.contextWindow = usage.contextWindow;
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

  function startTimers(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    if (flushTimer) clearInterval(flushTimer);
    if (gitTimer) clearInterval(gitTimer);
    if (healthTimer) clearInterval(healthTimer);
    refreshTimer = setInterval(refresh, 1000);
    flushTimer = setInterval(flush, 30_000);
    healthTimer = setInterval(() => pollHealth(daemonHttpUrl, controlHttpUrl, kingdom, (k) => updateStatusIndicators(k, cachedCtx), () => tuiRef?.requestRender()), 10_000);
    pollHealth(daemonHttpUrl, controlHttpUrl, kingdom, (k) => updateStatusIndicators(k, cachedCtx), () => tuiRef?.requestRender());

    // Log DDP subscription errors to the kingdom error ring buffer
    clients.control.on("error" as any, (err: Error) => {
      recordError(`ddp: ${err.message}`, "ddp");
    });
    clients.daemon.on("error" as any, (err: Error) => {
      recordError(`ddp daemon: ${err.message}`, "ddp");
    });
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
  // DDP event handlers
  // -----------------------------------------------------------------

  wireDDPHandlers(clients, kingdom, () => tuiRef?.requestRender());

  // ── Bond scope updates from bond-gate.ts via pi.events ───────────
  pi.events.on("koad-io:bond-scope", (scope: any) => {
    if (scope && typeof scope.bondCount === "number") {
      kingdom.bondCount = scope.bondCount;
      (kingdom as any).bondMode = scope.mode;
    }
    tuiRef?.requestRender();
  });

  // -----------------------------------------------------------------
  // Error recording
  // -----------------------------------------------------------------

  function recordError(msg: string, toolName?: string): void {
    const entry: ErrorEntry = { at: new Date().toISOString(), msg, toolName };
    kingdom.errorLog.push(entry);
    if (kingdom.errorLog.length > 100) kingdom.errorLog.shift();
    kingdom.lastError = msg;
    kingdom.errorCount++;
    tuiRef?.requestRender();

    // Emit error to control tower via DDP
    if (clients.control?.isConnected) {
      clients.control.call('emit.insert', {
        entity,
        type: "harness.error",
        body: `${toolName ? `[${toolName}] ` : ""}${msg}`,
        timestamp: new Date(),
        meta: {
          payload: {
            toolName: toolName ?? null,
            errorCount: kingdom.errorCount,
            sessionId: process.env.HARNESS_SESSION_ID,
          },
          source: "pi-telemetry",
        },
      }).catch(() => {});
    }
  }

  // Tool execution timing
  const _toolStarts = new Map<string, number>();
  const SLOW_TOOL_THRESHOLD_MS = 5000;

  // -----------------------------------------------------------------
  // Pi lifecycle events
  // -----------------------------------------------------------------

  pi.on("session_shutdown", () => {
    stopTimers();
    flush();
    // Close the flight via DDP if this session was a dispatch
    if (id.flightId && clients.control?.isConnected) {
      const note = `session ended | t${tel.turnCount} ${tel.totalCost.toFixed(4)}`;
      clients.control.call('dispatch.close', id.flightId, note, {
        turns: tel.turnCount,
        toolCalls: tel.toolCount,
        inputTokens: tel.tokensIn,
        outputTokens: tel.tokensOut,
        cost: tel.totalCost,
      }).catch(() => {});
    }
  });

  let sessionNamed = false;

  pi.on("session_start", (_event: any, ctx: any) => {
    stopTimers();
    clearOutfitCache();
    id.sessionStartedAt = new Date();
    storeCtx(ctx);
    try { tel.autoCompact = ctx.sessionManager?.getSession?.()?.autoCompactionEnabled ?? false; } catch (_) {}
    refresh();
    startTimers();

    const sessionFile = ctx.sessionManager.getSessionFile() as string | undefined;

    let bootAttempts = 0;
    const maxAttempts = 4;
    const bootDelay = 500;

    function tryBootstrap(): void {
      bootstrapFromPiSession(sessionFile, id, tel);
      bootAttempts++;

      if (!id.piSessionCwd && !id.currentModel && bootAttempts < maxAttempts) {
        setTimeout(tryBootstrap, bootDelay);
        return;
      }

      refresh();
      const modelLabel = compactModel(id.currentProvider, id.currentModel);
      emit({
        status_line: `${entity} online | ${modelLabel}${id.flightId ? ` | ${id.flightId.split("-").slice(-2).join("-")}` : ""}${id.flightPlan ? ` | ${briefSlug(id.flightPlan)}` : ""}`,
      });
    }
    setTimeout(tryBootstrap, bootDelay);
  });

  pi.on("before_agent_start", async (event: any) => {
    if (sessionNamed) return;
    sessionNamed = true;

    const prompt = (event.prompt ?? "").trim();
    if (!prompt) return;

    let name = prompt
      .replace(/^[@!]/, "")
      .replace(/\s+/g, " ")
      .slice(0, 72);

    if (name.length >= 60) {
      const cut = name.lastIndexOf(" ", 60);
      if (cut > 20) name = name.slice(0, cut);
    }

    name = name.charAt(0).toUpperCase() + name.slice(1);
    pi.setSessionName(name);
  });

  pi.on("agent_start", (_event: any, ctx: any) => {
    tel.idle = false;
    storeCtx(ctx);
    try { tel.autoCompact = ctx.sessionManager?.getSession?.()?.autoCompactionEnabled ?? tel.autoCompact; } catch (_) {}
    emit({
      note: `thinking start | ${entity}`,
      status_line: `thinking | ${entity} | ${compactModel(id.currentProvider, id.currentModel)}`,
    });
    refresh();
  });

  pi.on("agent_end", (_event: any, ctx: any) => {
    tel.idle = true;
    tel.activeTool = "";
    tel.activePath = "";
    storeCtx(ctx);
    try { tel.autoCompact = ctx.sessionManager?.getSession?.()?.autoCompactionEnabled ?? tel.autoCompact; } catch (_) {}
    emit({
      note: `thinking finish | t${tel.turnCount} $${tel.totalCost.toFixed(4)}`,
      status_line: `idle | t${tel.turnCount} $${tel.totalCost.toFixed(4)}`,
    });
    flush();
    refresh();
  });

  pi.on("turn_start", (_event: any, ctx: any) => {
    storeCtx(ctx);
    const usage = ctx.getContextUsage();
    if (usage?.tokens !== undefined && usage?.contextWindow > 0) {
      tel.contextPct = Math.round((usage.tokens / usage.contextWindow) * 1000) / 10;
      tel.contextWindow = usage.contextWindow;
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
    // Cache hit rate: what fraction of input was served from cache?
    // pi's formula: cacheRead / (input + cacheWrite) — tokens from cache vs total input
    const totalInput = tel.tokensIn + tel.cacheRead + tel.cacheWrite;
    if (totalInput > 0) {
      tel.cacheHitRate = Math.round((tel.cacheRead / totalInput) * 1000) / 10;
    }
    refresh();

    // Push live stats to the control-tower flight record via DDP
    if (id.flightId && tel.turnCount > 0 && clients.control?.isConnected) {
      clients.control.call('dispatch.stats', id.flightId, {
        turns: tel.turnCount,
        toolCalls: tel.toolCount,
        inputTokens: tel.tokensIn,
        outputTokens: tel.tokensOut,
        cost: tel.totalCost,
      }, id.currentModel || undefined).catch(() => {});
    }
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
    emit({ note: `→ ${note}`, status_line: `${entity}│⚙${note.slice(0, 40)}` });
    storeCtx(ctx);
    _toolStarts.set(event.toolCallId, Date.now());
    refresh();
  });

  pi.on("tool_execution_end", (event: any, ctx: any) => {
    const startedAt = _toolStarts.get(event.toolCallId);
    if (startedAt) {
      const elapsedMs = Date.now() - startedAt;
      _toolStarts.delete(event.toolCallId);

      tel.lastToolMs = elapsedMs;
      tel.totalToolMs += elapsedMs;

      if (elapsedMs > tel.slowestToolMs) {
        tel.slowestToolMs = elapsedMs;
        tel.slowestToolName = event.toolName;
      }

      if (elapsedMs > SLOW_TOOL_THRESHOLD_MS) {
        tel.slowToolCount++;
        const elapsedFmt = elapsedMs >= 1000
          ? `${(elapsedMs / 1000).toFixed(1)}s`
          : `${elapsedMs}ms`;

        if (clients.control?.isConnected) {
          clients.control.call('emit.insert', {
            entity,
            type: "harness.slow-tool",
            body: `${event.toolName} took ${elapsedFmt}`,
            timestamp: new Date(),
            meta: {
              payload: {
                toolName: event.toolName,
                elapsedMs,
                threshold: SLOW_TOOL_THRESHOLD_MS,
                turnIndex: tel.turnCount,
                sessionId: process.env.HARNESS_SESSION_ID,
              },
              source: "pi-telemetry",
            },
          }).catch(() => {});
        }
      }
    }

    if (event.isError) {
      const errText = event.result?.content?.[0]?.text ?? event.result?.error ?? `tool ${event.toolName} failed`;
      recordError(typeof errText === "string" ? errText.slice(0, 200) : String(errText).slice(0, 200), event.toolName);
      emit({ note: `← ${event.toolName} ERROR` });
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
      if (d.closingNote) line += ` - ${theme.fg("dim", d.closingNote)}`;

      return new Text(line, 0, 0);
    },
  });

  // Start DDP connections
  clients.control.connect();
  clients.daemon.connect();

  return { id, tel, kingdom, startTimers, stopTimers, flushSession: flush, storeCtx };
}
