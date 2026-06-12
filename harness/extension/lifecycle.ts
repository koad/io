/**
 * koad-io lifecycle event handlers (was hooks.ts).
 *
 * Bridges Pi's extension API to the kingdom bash hook scripts.
 * Mirrors Claude Code's hook model where possible:
 *
 *   session_start            → standing-watchers.sh (blocking) + session-harvest.sh (async)
 *   session_shutdown         → session-end.sh       (fire-and-forget — cleanup + final harvest)
 *   before_agent_start       → prompt-awareness.sh  (blocking — injects context as message) + telemetry
 *   agent_start              → thinking-start telemetry emission
 *   agent_end                → agent-aftermath.sh   (async — completion telemetry + notification)
 *   turn_start               → turn-start telemetry
 *   turn_end                 → per-turn tool telemetry to daemon
 *   message_end              → per-message token telemetry (assistant only)
 *   context                  → dynamic pulse injection every turn (flight count, daemon health)
 *   model_select             → provider/model telemetry back to daemon
 *   thinking_level_select    → reasoning level change telemetry
 *   tool_execution_start     → tool-start telemetry
 *   tool_result              → flight artifact recording (every tool result → daemon)
 *   session_before_compact   → compaction-before.sh (optional — observes compaction, fire-and-forget)
 *   session_compact          → compaction result telemetry
 *   session_tree             → branch navigation telemetry
 *   after_provider_response  → provider health watch (rate-limit / error detection)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = os.homedir();
const FORGE_HOOKS = path.join(HOME, ".forge", "hooks");
const EMIT_URL = (process.env.KOAD_IO_CONTROL_URL ?? `http://${process.env.KOAD_IO_BIND_IP ?? "10.10.10.10"}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`) + "/emit";
const ENTITY = process.env.ENTITY ?? "";
const EMIT_ENABLED = process.env.KOAD_IO_EMIT === "1";

function hookPath(name: string): string {
  return path.join(FORGE_HOOKS, name);
}

function hookExists(name: string): boolean {
  try {
    fs.accessSync(hookPath(name), fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function runHook(name: string, opts?: { blocking?: boolean; timeout?: number; env?: Record<string, string> }): void {
  if (!hookExists(name)) return;
  const timeout = opts?.timeout ?? 8000;
  const env = { ...process.env, ...(opts?.env ?? {}) };

  if (opts?.blocking) {
    try {
      execSync(hookPath(name), { env, stdio: "ignore", timeout });
    } catch (_) {}
  } else {
    try {
      spawn(hookPath(name), [], { env, stdio: "ignore", detached: true }).unref();
    } catch (_) {}
  }
}

function runHookCapture(name: string, timeout?: number): string {
  if (!hookExists(name)) return "";
  try {
    return execSync(hookPath(name), {
      env: process.env,
      encoding: "utf-8",
      timeout: timeout ?? 8000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_) {
    return "";
  }
}

function emitTelemetry(type: string, body: string, meta?: Record<string, unknown>): void {
  if (!EMIT_ENABLED) return;
  fetch(EMIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity: ENTITY,
      type,
      body,
      timestamp: new Date().toISOString(),
      meta: { payload: meta ?? {}, source: "pi-hooks" },
    }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}

// Track turn state for telemetry
let _turnIndex = 0;
let _agentStartedAt = 0;
let _promptText = "";

export function registerHooks(pi: ExtensionAPI): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // session_start
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("session_start", (_event, ctx) => {
    // Write kingdom lifecycle IDs as a CustomEntry so the Pi session jsonl is
    // self-describing. Does NOT enter LLM context — extension state only.
    try {
      pi.appendEntry("koad-io", {
        flightId: process.env.HARNESS_CONTROL_FLIGHT_ID || undefined,
        emissionId: process.env.HARNESS_EMISSION_ID || undefined,
        parentEmissionId: process.env.HARNESS_PARENT_EMISSION_ID || undefined,
        sessionToken: process.env.KOAD_IO_MCP_SESSION_TOKEN || undefined,
        harnessSessionId: process.env.HARNESS_SESSION_ID || undefined,
        entity: ENTITY || undefined,
      });
    } catch (_) {}

    // Register standing watchers (blocking — must complete before agent runs)
    runHook("standing-watchers.sh", { blocking: true, timeout: 8000 });

    // Session harvest — fire-and-forget (writes session state to disk async)
    runHook("session-harvest.sh");

    // Emit session-start telemetry
    emitTelemetry("harness.session-start", `session started — entity=${ENTITY}`, {
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // session_shutdown — cleanup + final harvest (critical gap — was missing)
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("session_shutdown", async (event) => {
    // Fire session-end hook (fire-and-forget — shutdown cannot block)
    runHook("session-end.sh", {
      env: {
        KOAD_IO_SHUTDOWN_REASON: event.reason ?? "quit",
        KOAD_IO_TARGET_SESSION: event.targetSessionFile ?? "",
      },
    });

    // Final harvest — capture session state one last time
    runHook("session-harvest.sh");

    // Emit shutdown telemetry
    emitTelemetry("harness.session-end", `session ended — reason=${event.reason ?? "quit"}`, {
      reason: event.reason,
      targetSession: event.targetSessionFile,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // before_agent_start — inject awareness as a displayed message
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("before_agent_start", (event) => {
    _agentStartedAt = Date.now();
    _promptText = event.prompt ?? "";
    _turnIndex = 0;

    // Emit prompt-received telemetry (before awareness, which may block)
    emitTelemetry("harness.prompt-received", `prompt received | ${_promptText.slice(0, 120)}`, {
      prompt: _promptText.slice(0, 500),
      systemPromptTokens: event.systemPrompt?.length ?? 0,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });

    const awareness = runHookCapture("prompt-awareness.sh", 8000);
    if (!awareness) return;

    return {
      message: {
        customType: "koad-io-awareness",
        content: awareness,
        display: true,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // agent_start — thinking phase begins (emission + awareness pulse)
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("agent_start", async (_event) => {
    emitTelemetry("harness.agent-start", `thinking started | prompt: ${_promptText.slice(0, 120)}`, {
      prompt: _promptText.slice(0, 500),
      turnIndex: 0,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // agent_end — aftermath hook + completion notification
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("agent_end", async (event) => {
    const elapsed = Math.round((Date.now() - _agentStartedAt) / 1000);
    const messageCount = event.messages?.length ?? 0;

    // Fire aftermath hook (async — don't block the next prompt)
    runHook("agent-aftermath.sh", {
      env: {
        KOAD_IO_AGENT_ELAPSED_S: String(elapsed),
        KOAD_IO_AGENT_MESSAGE_COUNT: String(messageCount),
        KOAD_IO_AGENT_PROMPT: _promptText.slice(0, 500),
      },
    });

    // Emit completion telemetry
    emitTelemetry("harness.agent-end", `agent completed — ${messageCount} messages in ${elapsed}s`, {
      elapsedS: elapsed,
      messageCount,
      turnCount: _turnIndex,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // turn_start — turn-start telemetry (latency baseline)
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("turn_start", async (event) => {
    emitTelemetry("harness.turn-start", `turn ${event.turnIndex} start`, {
      turnIndex: event.turnIndex,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // turn_end — per-turn telemetry
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("turn_end", async (event) => {
    _turnIndex = event.turnIndex ?? _turnIndex + 1;
    const toolCount = event.toolResults?.length ?? 0;
    const tools = event.toolResults?.map((r: any) => r.toolName ?? "?").join(", ") ?? "";

    emitTelemetry("harness.turn-end", `turn ${_turnIndex} — ${toolCount} tool(s): ${tools || "none"}`, {
      turnIndex: _turnIndex,
      toolCount,
      tools,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // message_end — per-message token telemetry (assistant only)
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("message_end", async (event) => {
    if (event.message.role !== "assistant") return;
    const u = event.message.usage;
    if (!u) return;

    const input = u.input ?? u.input_tokens ?? u.prompt_tokens ?? 0;
    const output = u.output ?? u.output_tokens ?? u.completion_tokens ?? 0;
    const cacheRead = u.cacheRead ?? u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cacheWrite ?? u.cache_creation_input_tokens ?? 0;
    const cost = u.cost?.total;

    emitTelemetry("harness.message-end", `assistant message | in=${input} out=${output}${cacheRead ? ` cache=${cacheRead}` : ""}${cost !== undefined ? ` $${cost.toFixed(6)}` : ""}`, {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      cost: cost ?? 0,
      turnIndex: _turnIndex,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // context — inject dynamic kingdom state before every LLM call
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Unlike before_agent_start (fires once per prompt), context fires every
  // turn — after each tool call batch, right before the LLM sees the results.
  // This is where you inject live state that changes during an agent loop:
  //   - flight counts changing as sub-flights land
  //   - questions getting answered mid-turn
  //   - daemon health degrading
  //
  // The messages array is a deep copy — mutations are non-destructive.
  // Best practice: inject as a "system" role message right before the user's
  // last message so the LLM sees it as fresh context each turn.
  pi.on("context", async (event) => {
    // Build a compact kingdom pulse line from environment / DDP state
    const flightId = process.env.HARNESS_CONTROL_FLIGHT_ID;
    const pulse: string[] = [];

    // Harvest hook output for dynamic context (lightweight — must be fast)
    const dynamicCtx = runHookCapture("context-pulse.sh", 3000);
    if (dynamicCtx) {
      pulse.push(dynamicCtx);
    }

    // Always include our own flight marker if dispatched
    if (flightId) {
      pulse.push(`Flight: \`${flightId}\``);
    }

    if (pulse.length === 0) return;

    // Inject as a system-level context line. Appended to messages so
    // the LLM sees it in-scope for the next reasoning step.
    const pulseMessage = {
      role: "system" as const,
      content: [
        {
          type: "text" as const,
          text: `[kingdom context — turn ${_turnIndex + 1}]\n${pulse.join("\n")}`,
        },
      ],
      timestamp: Date.now(),
    };

    return {
      messages: [...event.messages, pulseMessage],
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // model_select — track which model is active for daemon telemetry
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The harness server's access gate routes to a provider. This hook closes
  // the loop by reporting back which model actually got selected — whether
  // via /model, Ctrl+P cycling, or session restore on resume.
  pi.on("model_select", async (event) => {
    const prev = event.previousModel
      ? `${event.previousModel.provider}/${event.previousModel.id}`
      : "none";
    const next = `${event.model.provider}/${event.model.id}`;

    emitTelemetry("harness.model-select", `${prev} → ${next} (${event.source})`, {
      previous: prev,
      current: next,
      source: event.source,           // "set" | "cycle" | "restore"
      provider: event.model.provider,
      model: event.model.id,
      reasoning: event.model.reasoning ?? false,
      contextWindow: event.model.contextWindow,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // thinking_level_select — reasoning level change telemetry
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("thinking_level_select", async (event) => {
    emitTelemetry("harness.thinking-level", `${event.previousLevel} → ${event.level}`, {
      previous: event.previousLevel,
      current: event.level,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // tool_execution_start — tool-start telemetry (latency baseline)
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("tool_execution_start", async (event) => {
    emitTelemetry("harness.tool-start", `→ ${event.toolName}`, {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      turnIndex: _turnIndex,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // tool_result — flight artifact recording
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Every tool result → daemon emission so the flight has a complete,
  // auditable record of what tools ran, their outcomes, and timing.
  // This is the per-tool complement to turn_end's aggregate telemetry.
  //
  // Important: handler return value passes through to next handler unchanged
  // unless we explicitly return a patch. We DON'T modify the result here —
  // bond-gate.ts already handles secret scrubbing. This is observation only.
  pi.on("tool_result", async (event) => {
    const toolName = event.toolName ?? "?";
    const isError = event.isError === true;

    // Build summary based on tool type — metadata only, never raw content
    let summary: string;
    if (isError) {
      summary = "error";
    } else if (toolName === "read") {
      const path = ((event.input as any)?.path ?? "?").replace(/^\/home\/[^/]+/, "~");
      const text = typeof event.content?.[0]?.text === "string" ? event.content[0].text : "";
      const lines = text ? text.split("\n").length : 0;
      const kb = text ? `${(text.length / 1024).toFixed(1)}KB` : "?";
      summary = `${path} (${lines}L ${kb})`;
    } else if (toolName === "write" || toolName === "edit") {
      const path = ((event.input as any)?.path ?? (event.input as any)?.filePath ?? "?").replace(/^\/home\/[^/]+/, "~");
      const text = typeof event.content?.[0]?.text === "string" ? event.content[0].text : "";
      const kb = text ? `${(text.length / 1024).toFixed(1)}KB` : "";
      summary = `${path}${kb ? ` (${kb})` : ""}`;
    } else if (toolName === "bash") {
      const cmd = ((event.input as any)?.command ?? "?").replace(/\n/g, " ").slice(0, 80);
      const exitCode = (event.details as any)?.exitCode;
      summary = exitCode !== undefined ? `${cmd} (exit ${exitCode})` : cmd;
    } else if (toolName === "search") {
      const mode = (event.input as any)?.mode ?? "text";
      const query = (event.input as any)?.query ?? "";
      summary = query ? `search ${mode} "${String(query).slice(0, 50)}"` : `search ${mode}`;
    } else if (toolName === "status") {
      const sub = (event.input as any)?.sub ?? "";
      summary = sub ? `status ${sub}` : "status";
    } else if (toolName === "sin") {
      const dir = ((event.input as any)?.path ?? "?").replace(/^\/home\/[^/]+/, "~");
      const query = (event.input as any)?.query ?? "?";
      summary = `search in ${dir} for "${String(query).slice(0, 60)}"`;
    } else if (toolName === "ls") {
      const dir = ((event.input as any)?.path ?? ".").replace(/^\/home\/[^/]+/, "~");
      const text = typeof event.content?.[0]?.text === "string" ? event.content[0].text : "";
      const entries = text ? text.split("\n").filter(Boolean).length : 0;
      summary = `ls ${dir} (${entries} entries)`;
    } else if (toolName === "mkdir") {
      const p = ((event.input as any)?.path ?? "?").replace(/^\/home\/[^/]+/, "~");
      summary = `mkdir ${p}`;
    } else if (toolName === "cp") {
      const s = ((event.input as any)?.src ?? "?").replace(/^\/home\/[^/]+/, "~");
      const d = ((event.input as any)?.dst ?? "?").replace(/^\/home\/[^/]+/, "~");
      summary = `cp ${s} → ${d}`;
    } else if (toolName === "mv") {
      const s = ((event.input as any)?.src ?? "?").replace(/^\/home\/[^/]+/, "~");
      const d = ((event.input as any)?.dst ?? "?").replace(/^\/home\/[^/]+/, "~");
      summary = `mv ${s} → ${d}`;
    } else if (toolName === "rm") {
      const p = ((event.input as any)?.path ?? "?").replace(/^\/home\/[^/]+/, "~");
      summary = `rm ${p}`;
    } else if (toolName === "chmod") {
      const m = (event.input as any)?.mode ?? "?";
      const p = ((event.input as any)?.path ?? "?").replace(/^\/home\/[^/]+/, "~");
      summary = `chmod ${m} ${p}`;
    } else {
      const sub = (event.input as any)?.sub ?? (event.input as any)?.command ?? "";
      summary = sub ? `${toolName} ${String(sub).slice(0, 60)}` : toolName;
    }

    emitTelemetry("harness.tool-result", `[${toolName}] ${summary}`, {
      toolName,
      isError,
      summary: summary.slice(0, 200),
      turnIndex: _turnIndex,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });

    // Don't modify the result — let bond-gate.ts handle scrubbing
    return undefined;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // session_before_compact — optional custom compaction instructions
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("session_before_compact", async (event) => {
    // Emit compaction-start with token state before compaction
    emitTelemetry("harness.compaction-start", `compaction starting — ${event.preparation.tokensBefore ?? "?"} tokens → target ${event.preparation.tokensTarget ?? "?"}`, {
      tokensBefore: event.preparation.tokensBefore,
      tokensTarget: event.preparation.tokensTarget,
      branchEntries: event.branchEntries?.length ?? 0,
      customInstructions: event.customInstructions?.slice(0, 200),
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });

    // Only intervene if a custom compaction script exists
    if (!hookExists("compaction-before.sh")) return;

    // Run the hook script as an observer (fire-and-forget).
    // The script runs in the background and can emit telemetry or log,
    // but we cannot return customInstructions through this event result
    // because SessionBeforeCompactResult.compaction expects a full
    // CompactionResult ({ summary, tokensBefore }), not instructions.
    runHook("compaction-before.sh", { timeout: 5000 });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // session_compact — compaction result telemetry
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("session_compact", async (event) => {
    const c = event.compactionEntry;
    emitTelemetry("harness.compaction-end", `compaction done — ${c.tokensAfter ?? "?"} tokens`, {
      tokensBefore: c.tokensBefore,
      tokensAfter: c.tokensAfter,
      summaryLength: c.summary?.length ?? 0,
      fromExtension: event.fromExtension ?? false,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // session_tree — branch navigation telemetry
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("session_tree", async (event) => {
    emitTelemetry("harness.tree-navigation", `tree navigation — old leaf: ${event.oldLeafId?.slice(-12) ?? "none"} → new leaf: ${event.newLeafId?.slice(-12) ?? "none"}`, {
      oldLeafId: event.oldLeafId,
      newLeafId: event.newLeafId,
      hasSummary: !!event.summaryEntry,
      fromExtension: event.fromExtension ?? false,
      flightId: process.env.HARNESS_CONTROL_FLIGHT_ID,
      sessionId: process.env.HARNESS_SESSION_ID,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // after_provider_response — provider health monitoring
  // ═══════════════════════════════════════════════════════════════════════════
  pi.on("after_provider_response", (event) => {
    const status = event.status ?? 0;

    // Detect rate limiting or quota exhaustion
    if (status === 429) {
      const retryAfter = (event.headers as any)?.["retry-after"] ?? "unknown";
      emitTelemetry("harness.provider-rate-limited", `HTTP 429 — retry-after: ${retryAfter}`, {
        status,
        retryAfter,
      });
    }

    if (status === 402 || status === 403) {
      emitTelemetry("harness.provider-blocked", `HTTP ${status} — possible quota/payment issue`, {
        status,
      });
    }

    if (status >= 500) {
      emitTelemetry("harness.provider-error", `HTTP ${status} — upstream error`, {
        status,
      });
    }
  });
}
