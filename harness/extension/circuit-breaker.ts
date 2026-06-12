/**
 * koad-io provider circuit breaker.
 *
 * Detects repeated provider failures and implements staged recovery:
 *   - First 429 → retry after 5s (one-shot)
 *   - 3x 429 in 60s → circuit OPEN: switch to fallback provider for rest of session
 *   - 402/403 → immediate circuit OPEN (payment/auth issues won't self-resolve)
 *   - 5xx → retry once, then circuit OPEN
 *   - Billing/quota errors in model response → emit to daemon + switch to fallback
 *   - All providers exhausted → notify operator + graceful shutdown
 *
 * Billing errors (out of credits, quota exceeded, payment required) can come
 * through as HTTP 200 with an error body from some providers. The agent_end
 * hook catches those by scanning assistant messages for billing keywords.
 * The entity can't fix money problems — it notifies the operator and degrades.
 *
 * Unlike the harness server's providerDown flag (which retries after 60s),
 * this is session-scoped — the circuit resets on session_start. The harness
 * server handles cross-session provider health; this handles in-session
 * resilience.
 *
 * Fallback provider chain: KOAD_IO_FALLBACK_PROVIDER env var, or defaults to
 * the next available provider from the model registry.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CIRCUIT_WINDOW_MS = 60_000;        // 60 second sliding window
const CIRCUIT_THRESHOLD = 3;             // 3 failures → open circuit
const RETRY_DELAY_MS = 5_000;            // 5 second single-retry delay
const FALLBACK_DEFAULTS = ["openai", "anthropic", "groq", "xai", "deepseek"];

const _BIND_IP = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
const CONTROL_URL = process.env.KOAD_IO_CONTROL_URL ?? `http://${_BIND_IP}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`;

interface CircuitState {
  failures: Array<{ status: number; at: number }>;
  open: boolean;
  openedAt: number;
  originalProvider: string;
  originalModel: string;
  retryCount: number;
  totalFallbacksExhausted: boolean;
  billingNotified: boolean;
}

export function registerProviderCircuitBreaker(pi: ExtensionAPI): void {
  const state: CircuitState = {
    failures: [],
    open: false,
    openedAt: 0,
    originalProvider: "",
    originalModel: "",
    retryCount: 0,
    totalFallbacksExhausted: false,
    billingNotified: false,
  };

  // Reset on new session
  pi.on("session_start", () => {
    state.failures = [];
    state.open = false;
    state.openedAt = 0;
    state.originalProvider = "";
    state.originalModel = "";
    state.retryCount = 0;
    state.totalFallbacksExhausted = false;
    state.billingNotified = false;
  });

  // Track model changes so we know what to restore
  pi.on("model_select", (event) => {
    if (!state.open) {
      state.originalProvider = event.model?.provider ?? state.originalProvider;
      state.originalModel = event.model?.id ?? state.originalModel;
    }
  });

  // ── Emit to daemon (fire-and-forget, 2s timeout) ────────────────────────
  function emitToOperator(type: string, body: string, meta?: Record<string, unknown>): void {
    fetch(`${CONTROL_URL}/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity: process.env.ENTITY ?? "unknown",
        type,
        body: body.slice(0, 1000),
        timestamp: new Date().toISOString(),
        meta: meta ?? {},
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});
  }

  // ── Billing error keywords (checked against error text) ─────────────────
  function isBillingError(text: string): boolean {
    const lower = text.toLowerCase();
    return /billing|quota|credits?|insufficient.*fund|payment|usage.*limit|exceeded.*quota|account.*balance|no.*credits|check.*billing|top.up/i.test(lower);
  }

  // ── after_provider_response — HTTP-level failures ────────────────────────
  pi.on("after_provider_response", async (event, ctx) => {
    const status = event.status ?? 0;
    if (status < 400) return; // all good

    const now = Date.now();

    // Prune old failures outside the window
    state.failures = state.failures.filter(f => now - f.at < CIRCUIT_WINDOW_MS);
    state.failures.push({ status, at: now });

    // 402/403: immediate circuit open — payment/auth won't self-heal
    if (status === 402 || status === 403) {
      state.open = true;
      state.openedAt = now;

      const label = status === 402 ? "payment required" : "forbidden";
      if (!state.billingNotified && status === 402) {
        emitToOperator(
          "provider.billing",
          `${state.originalProvider}: HTTP 402 payment required — entity may be out of credits`,
          { provider: state.originalProvider, status },
        );
        state.billingNotified = true;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(
          `⚠ provider ${label} — switching to fallback`,
          "error",
        );
      }
      await switchToFallback(pi, ctx, state);
      return;
    }

    // 429: retry once, then open circuit on threshold
    if (status === 429) {
      const recent429s = state.failures.filter(f => f.status === 429).length;

      if (recent429s === 1 && !state.open) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `⏳ rate limited — will retry after ${RETRY_DELAY_MS / 1000}s`,
            "warning",
          );
        }
        return; // let pi's built-in retry handle it
      }

      if (recent429s >= CIRCUIT_THRESHOLD) {
        state.open = true;
        state.openedAt = now;
        if (ctx.hasUI) {
          ctx.ui.notify(
            `⚠ ${recent429s} rate limits in ${CIRCUIT_WINDOW_MS / 1000}s — ` +
            `circuit open, switching to fallback`,
            "error",
          );
        }
        await switchToFallback(pi, ctx, state);
      }
      return;
    }

    // 5xx: retry once, then open circuit
    if (status >= 500) {
      if (state.retryCount === 0 && !state.open) {
        state.retryCount++;
        if (ctx.hasUI) {
          ctx.ui.notify(
            `⚠ upstream error (HTTP ${status}) — retrying once`,
            "warning",
          );
        }
        return; // let pi retry
      }

      state.open = true;
      state.openedAt = now;
      if (ctx.hasUI) {
        ctx.ui.notify(
          `⚠ persistent upstream errors — switching to fallback`,
          "error",
        );
      }
      await switchToFallback(pi, ctx, state);
    }
  });

  // ── agent_end — catch billing/quota errors hidden in 200 responses ──────
  pi.on("agent_end", async (event, ctx) => {
    if (state.totalFallbacksExhausted) return;

    for (const msg of event.messages) {
      if (msg.role !== "assistant") continue;
      if (msg.stopReason !== "error" && msg.stopReason !== "aborted") continue;

      const errorText = (msg as any).errorMessage ?? "";
      const textContent = (msg.content as any[])
        ?.filter((c: any) => c?.type === "text")
        .map((c: any) => c.text)
        .join(" ") ?? "";

      const fullError = `${errorText} ${textContent}`;

      if (isBillingError(fullError)) {
        state.open = true;
        state.openedAt = Date.now();

        if (!state.billingNotified) {
          emitToOperator(
            "provider.billing",
            `${state.originalProvider}/${state.originalModel}: billing error in model response — ${fullError.slice(0, 400)}`,
            { provider: state.originalProvider, model: state.originalModel },
          );
          state.billingNotified = true;
        }

        if (ctx.hasUI) {
          ctx.ui.notify(
            `💸 billing/quota error — entity cannot resolve. Notifying operator.`,
            "error",
          );
        }

        await switchToFallback(pi, ctx, state);
        return;
      }
    }
  });

  // ── message_end — catch billing text in assistant responses ─────────────
  pi.on("message_end", async (event, ctx) => {
    if (state.totalFallbacksExhausted) return;
    if (event.message.role !== "assistant") return;
    if (event.message.stopReason !== "error") return;

    const text = (event.message.content as any[])
      ?.filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join(" ") ?? "";

    if (isBillingError(text) && !state.billingNotified) {
      emitToOperator(
        "provider.billing",
        `${state.originalProvider}/${state.originalModel}: billing text in assistant response`,
        { provider: state.originalProvider, model: state.originalModel },
      );
      state.billingNotified = true;
      // Don't switch here — agent_end will handle the full recovery
    }
  });

  // ── Manual model selection clears the circuit ────────────────────────────
  pi.on("model_select", (event) => {
    if (state.open && event.source === "set") {
      state.open = false;
      state.failures = [];
      state.retryCount = 0;
      state.totalFallbacksExhausted = false;
      state.billingNotified = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Fallback switching
// ---------------------------------------------------------------------------

async function switchToFallback(
  pi: ExtensionAPI,
  ctx: any,
  state: CircuitState,
): Promise<void> {
  if (state.totalFallbacksExhausted) return;

  // Try explicit fallback from env
  const envFallback = process.env.KOAD_IO_FALLBACK_PROVIDER?.trim();
  if (envFallback) {
    const [provider, model] = envFallback.includes("/")
      ? envFallback.split("/")
      : [envFallback, undefined];

    const found = ctx.modelRegistry.find(provider, model ?? undefined);
    if (found) {
      await pi.setModel(found);
      return;
    }
  }

  // Try default chain — first available provider that isn't the current one
  for (const provider of FALLBACK_DEFAULTS) {
    if (provider === state.originalProvider) continue;
    const models = ctx.modelRegistry
      .list(provider)
      ?.filter((m: any) => !m.reasoning && (m.input?.includes?.("text") ?? true));

    if (models?.length) {
      await pi.setModel(models[0]);
      return;
    }
  }

  // Last resort: try any provider
  const all = ctx.modelRegistry.list();
  for (const provider of Object.keys(all ?? {})) {
    if (provider === state.originalProvider) continue;
    const models = all[provider]?.filter(
      (m: any) => !m.reasoning && (m.input?.includes?.("text") ?? true),
    );
    if (models?.length) {
      await pi.setModel(models[0]);
      return;
    }
  }

  // ── Total failure: all providers exhausted ─────────────────────────────
  state.totalFallbacksExhausted = true;

  const entity = process.env.ENTITY ?? "unknown";
  const msg = [
    `⛔ ${entity}: all providers exhausted`,
    `   original: ${state.originalProvider}/${state.originalModel}`,
    `   tried fallback chain: ${FALLBACK_DEFAULTS.join(", ")}`,
    `   entity cannot continue until operator resolves billing/auth`,
    `   restart session or /reload to retry`,
  ].join("\n");

  // Emit to daemon
  fetch(`${CONTROL_URL}/emit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity,
      type: "provider.exhausted",
      body: msg,
      timestamp: new Date().toISOString(),
      meta: {
        originalProvider: state.originalProvider,
        originalModel: state.originalModel,
        fallbackChain: FALLBACK_DEFAULTS,
      },
    }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});

  if (ctx.hasUI) {
    ctx.ui.notify(msg, "error");
  }

  // Graceful shutdown — don't loop. Operator fixes billing, entity resumes.
  // Deferred until agent becomes idle (processes any queued messages first).
  ctx.shutdown();
}
