/**
 * koad-io context budget manager.
 *
 * Monitors context usage and takes action when approaching limits:
 *   - 75%+ → inject a system message warning the LLM to wrap up
 *   - 85%+ → trigger preemptive compaction via ctx.compact()
 *   - 95%+ → auto-switch to the fallback model (typically larger context)
 *   - Overflow recovery → if pi's built-in recovery compacts, track it
 *
 * Complements telemetry.ts (which tracks contextPct for the footer) by
 * adding active intervention instead of just passive observation.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FALLBACK_MODEL = process.env.KOAD_IO_FALLBACK_MODEL ?? "gpt-4o";

interface BudgetState {
  warnedAt75: boolean;
  compactedAt85: boolean;
  switchedAt95: boolean;
  lastPct: number;
  lastLimit: number;
  lastTokens: number;
  overflowCount: number;
  fallbackActive: boolean;
  originalModel: { provider: string; id: string } | null;
}

export function registerContextBudget(pi: ExtensionAPI): void {
  const state: BudgetState = {
    warnedAt75: false,
    compactedAt85: false,
    switchedAt95: false,
    lastPct: 0,
    lastLimit: 0,
    lastTokens: 0,
    overflowCount: 0,
    fallbackActive: false,
    originalModel: null,
  };

  // Reset state each new agent run
  pi.on("before_agent_start", () => {
    state.warnedAt75 = false;
    state.compactedAt85 = false;
    state.switchedAt95 = false;
  });

  // ── context hook — inject warnings when budget is tight ──────────────────
  pi.on("context", async (event, ctx) => {
    const usage = ctx.getContextUsage();
    if (!usage || !usage.limit) return;

    const pct = Math.round((usage.tokens / usage.limit) * 100);
    state.lastPct = pct;
    state.lastLimit = usage.limit;
    state.lastTokens = usage.tokens;

    // Stage 3: Critical — auto-switch to fallback model (larger context window)
    if (pct >= 95 && !state.switchedAt95 && !state.fallbackActive) {
      state.switchedAt95 = true;

      const fallback = ctx.modelRegistry.find(
        FALLBACK_MODEL.includes("/")
          ? FALLBACK_MODEL.split("/")[0]
          : process.env.KOAD_IO_HARNESS_PI_PROVIDER ?? "openai",
        FALLBACK_MODEL.includes("/")
          ? FALLBACK_MODEL.split("/")[1]
          : FALLBACK_MODEL,
      );

      if (fallback && (fallback.contextWindow ?? 0) > usage.limit) {
        // Remember original model so we can switch back on new session
        if (!state.originalModel) {
          state.originalModel = {
            provider: ctx.model?.provider ?? "unknown",
            id: ctx.model?.id ?? "unknown",
          };
        }
        state.fallbackActive = true;
        await pi.setModel(fallback);

        if (ctx.hasUI) {
          ctx.ui.notify(
            `⚠ context ${pct}% → switched to ${fallback.name ?? fallback.id} ` +
            `(${(fallback.contextWindow ?? 0) / 1000}k window)`,
            "warning",
          );
        }
      }
    }

    // Stage 2: Severe — trigger preemptive compaction
    if (pct >= 85 && !state.compactedAt85 && !state.switchedAt95) {
      state.compactedAt85 = true;

      ctx.compact({
        customInstructions: [
          "Context is critically full. Summarize aggressively.",
          "Keep: active file paths, recent tool results, errors, current task.",
          "Discard: conversation history older than 2 turns, verbose tool output.",
          "Output the summary directly — no narration.",
        ].join(" "),
        onComplete: () => {
          if (ctx.hasUI) ctx.ui.notify("✓ compaction complete — context reclaimed", "info");
        },
        onError: (err) => {
          if (ctx.hasUI) ctx.ui.notify(`compaction failed: ${err.message}`, "error");
        },
      });

      if (ctx.hasUI) {
        ctx.ui.notify(
          `⚠ context ${pct}% — triggering preemptive compaction`,
          "warning",
        );
      }
      return;
    }

    // Stage 1: Warning — inject system message nudging the LLM to be concise
    if (pct >= 75 && !state.warnedAt75) {
      state.warnedAt75 = true;

      const warning = {
        role: "system" as const,
        content: [{
          type: "text" as const,
          text: [
            `[context warning: ${pct}% full — ${usage.tokens}/${usage.limit} tokens]`,
            "Be concise. Skip verbose explanations. Prefer edit over write+read. ",
            "Combine tool calls where possible. Avoid re-reading unchanged files.",
          ].join(" "),
        }],
        timestamp: Date.now(),
      };

      return { messages: [...event.messages, warning] };
    }
  });

  // ── agent_end — reset fallback state (new prompt = fresh context) ────────
  pi.on("agent_end", () => {
    // Don't reset fallback here — keep it for the session
    // Reset warning/compaction flags so they can fire again next prompt
    state.warnedAt75 = false;
    state.compactedAt85 = false;
    state.switchedAt95 = false;
    state.overflowCount = 0;
  });

  // ── session_start — restore original model on fresh session ─────────────
  pi.on("session_start", async (_event, ctx) => {
    if (state.fallbackActive && state.originalModel) {
      const original = ctx.modelRegistry.find(
        state.originalModel.provider,
        state.originalModel.id,
      );
      if (original) {
        await pi.setModel(original);
        state.fallbackActive = false;
        state.originalModel = null;
      }
    }

    // Full reset
    state.warnedAt75 = false;
    state.compactedAt85 = false;
    state.switchedAt95 = false;
    state.overflowCount = 0;
  });

  // ── model_select — track manual model changes ────────────────────────────
  pi.on("model_select", (event) => {
    if (state.fallbackActive && event.source === "set") {
      // User manually picked a model — trust them, clear fallback
      state.fallbackActive = false;
      state.originalModel = null;
    }
  });
}
