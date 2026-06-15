/**
 * /model command — interactive model picker overlay with pricing.
 *
 * Replaces the built-in /model with a scrollable overlay showing:
 *   - Provider · model name
 *   - Cost per 1M tokens (input / output / cache read / cache write)
 *   - Context window, max tokens, reasoning badge, input modalities
 *   - Active model highlighted
 *
 * Keyboard:
 *   ↑/↓ or j/k — move selection
 *   Enter       — select model
 *   /           — filter by name/provider
 *   Escape      — close
 *
 * Built-in interactive commands (/model, /settings) can't be shadowed
 * via registerCommand — we intercept the input event instead.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { bold, dim, white, yellow, green, cyan, magenta, brightWhite, brightYellow, brightGreen, brightCyan, brightMagenta, ctxColor } from "../utils/ansi";

// ── Helpers ────────────────────────────────────────────────────────

function fmtCost(per1m: number): string {
  if (per1m === 0) return dim("free");
  if (per1m < 0.01) return green(`$${per1m.toFixed(4)}`);
  if (per1m < 1) return green(`$${per1m.toFixed(2)}`);
  if (per1m < 10) return yellow(`$${per1m.toFixed(1)}`);
  return brightYellow(`$${per1m.toFixed(1)}`);
}

function fmtContext(win: number): string {
  if (win >= 1_000_000) return `${(win / 1_000_000).toFixed(1)}M`;
  if (win >= 1_000) return `${(win / 1_000).toFixed(1)}K`;
  return String(win);
}

function fmtMaxTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function inputBadge(input: string[]): string {
  const parts: string[] = [];
  if (input.includes("image")) parts.push("🖼");
  parts.push("📝");
  return parts.join("");
}

function providerColor(provider: string): (s: string) => string {
  const map: Record<string, (s: string) => string> = {
    anthropic: brightYellow,
    openai: brightGreen,
    "openai-codex": brightGreen,
    google: brightCyan,
    deepseek: brightMagenta,
    groq: brightCyan,
    mistral: cyan,
    xai: white,
    cerebras: yellow,
  };
  return map[provider] ?? white;
}

function padRow(left: string, right: string, width: number): string {
  const lw = [...left].length;
  const rw = [...right].length;
  if (lw + rw >= width) return left.slice(0, width - rw - 1) + " " + right;
  return left + " ".repeat(width - lw - rw) + right;
}

// ── Overlay logic ──────────────────────────────────────────────────

interface Row {
  model: Model<any>;
  providerLabel: string;
  isAvailable: boolean;
  isActive: boolean;
}

async function openModelOverlay(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const registry = ctx.modelRegistry;
  if (!registry) {
    ctx.ui.notify("model registry unavailable", "error");
    return;
  }

  const allModels = registry.getAll();
  const available = registry.getAvailable();
  const availableIds = new Set(available.map((m) => `${m.provider}/${m.id}`));

  const currentProvider = process.env.ENTITY_PI_PROVIDER ?? process.env.PROVIDER ?? "";
  const currentModelId = process.env.ENTITY_PI_MODEL ?? process.env.MODEL ?? "";

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const m of allModels) {
    const key = `${m.provider}/${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      model: m,
      providerLabel: registry.getProviderDisplayName(m.provider) ?? m.provider,
      isAvailable: availableIds.has(key),
      isActive: m.provider === currentProvider && m.id === currentModelId,
    });
  }

  rows.sort((a, b) => {
    if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
    if (a.model.provider !== b.model.provider) return a.model.provider.localeCompare(b.model.provider);
    return a.model.name.localeCompare(b.model.name);
  });

  let filter = "";
  let selected = 0;
  let scrollOffset = 0;

  const filteredRows = (): Row[] => {
    if (!filter) return rows;
    const q = filter.toLowerCase();
    return rows.filter(
      (r) =>
        r.model.name.toLowerCase().includes(q) ||
        r.model.provider.toLowerCase().includes(q) ||
        r.providerLabel.toLowerCase().includes(q),
    );
  };

  const clampSelection = (list: Row[]) => {
    if (selected >= list.length) selected = Math.max(0, list.length - 1);
    if (selected < 0) selected = 0;
  };

  await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (v?: any) => void) => {
    return {
      render(width: number) {
        const w = Math.min(width, 90);
        const list = filteredRows();
        clampSelection(list);

        const maxVisible = 24;
        const visibleRows = Math.min(maxVisible, list.length);

        if (selected < scrollOffset) scrollOffset = selected;
        if (selected >= scrollOffset + visibleRows) scrollOffset = selected - visibleRows + 1;
        if (scrollOffset < 0) scrollOffset = 0;
        if (scrollOffset > Math.max(0, list.length - visibleRows)) {
          scrollOffset = Math.max(0, list.length - visibleRows);
        }

        const lines: string[] = [];

        // Header
        const title = bold(" model  ") + dim("— switch models");
        const rightHead = filter
          ? dim(`filter: "${filter}"  ${list.length} match${list.length !== 1 ? "es" : ""}`)
          : dim(`${list.length} model${list.length !== 1 ? "s" : ""}`);
        lines.push(padRow(title, rightHead, w));

        const colHdr =
          dim(" provider · model") +
          " ".repeat(Math.max(0, w - 52)) +
          dim("cost/1M$  ") +
          dim("ctx   maxT  ");
        lines.push(colHdr);

        // Rows
        const slice = list.slice(scrollOffset, scrollOffset + visibleRows);
        for (let i = 0; i < slice.length; i++) {
          const r = slice[i];
          const idx = scrollOffset + i;
          const isSel = idx === selected;
          const provCol = providerColor(r.model.provider);

          const selMark = isSel ? brightWhite("▶ ") : "  ";
          const availMark = r.isAvailable
            ? r.isActive ? brightGreen("●") : green("○")
            : dim("◌");
          const reasoningBadge = r.model.reasoning ? magenta(" 🧠") : "";
          const oauthBadge = registry.isUsingOAuth(r.model) ? dim(" 🔑") : "";
          const inBadge = " " + inputBadge(r.model.input);

          const left = `${selMark}${availMark} ${provCol(r.providerLabel)} ${dim("·")} ${white(r.model.name)}${reasoningBadge}${oauthBadge}${inBadge}`;

          const c = r.model.cost;
          const costStr =
            fmtCost(c.input) + dim("/") + fmtCost(c.output) +
            (c.cacheRead > 0 || c.cacheWrite > 0
              ? dim(" R") + fmtCost(c.cacheRead) + dim(" W") + fmtCost(c.cacheWrite)
              : "");

          const ctxStr = fmtContext(r.model.contextWindow);
          const right =
            costStr +
            "  " +
            ctxColor(Math.min(100, Math.round((r.model.contextWindow / 2_000_000) * 100)), ctxStr.padStart(5)) +
            "  " +
            dim(fmtMaxTokens(r.model.maxTokens).padStart(5));

          const line = padRow(left, right, w);
          if (isSel) lines.push(theme.bg("selection", line));
          else if (!r.isAvailable) lines.push(dim(line));
          else lines.push(line);
        }

        // Footer
        if (list.length > visibleRows) {
          const pct = list.length > 0 ? Math.round(((scrollOffset + visibleRows) / list.length) * 100) : 100;
          lines.push(dim(
            ` ↑↓ navigate  / filter  enter select  esc close  ` +
            `${scrollOffset + 1}-${Math.min(scrollOffset + visibleRows, list.length)} of ${list.length} (${pct}%)`,
          ));
        } else {
          lines.push(dim(" ↑↓ navigate  / filter  enter select  esc close"));
        }

        return lines.map((l) => l.padEnd(w, " "));
      },

      invalidate() {},

      handleInput(data: string) {
        if (data === "\x1b" || data === "\x03") { done(); return true; }

        if (data === "\r" || data === "\n") {
          const list = filteredRows();
          clampSelection(list);
          if (list.length > 0 && selected < list.length) {
            const r = list[selected];
            pi.setModel(r.model).then((ok) => {
              ctx.ui.notify(
                ok
                  ? `switched to ${r.model.provider}/${r.model.id}`
                  : `no API key for ${r.model.provider}/${r.model.id}`,
                ok ? "info" : "error",
              );
            });
          }
          done();
          return true;
        }

        if (data === "\x1b[A" || data === "k") { selected--; clampSelection(filteredRows()); tui.requestRender(); return true; }
        if (data === "\x1b[B" || data === "j") { selected++; clampSelection(filteredRows()); tui.requestRender(); return true; }

        if (data === "/") { filter = ""; selected = 0; scrollOffset = 0; tui.requestRender(); return true; }

        if (data === "\x7f" || data === "\b") {
          if (filter.length > 0) { filter = filter.slice(0, -1); selected = 0; scrollOffset = 0; tui.requestRender(); }
          return true;
        }

        if (data.length === 1 && data >= " " && data <= "~") {
          filter += data; selected = 0; scrollOffset = 0; tui.requestRender();
          return true;
        }

        return false;
      },
    };
  }, {
    overlay: true,
    overlayOptions: {
      anchor: "right-center",
      width: 90,
      maxHeight: "95%",
      margin: { top: 1, right: 1, bottom: 1, left: 1 },
    },
  });
}

// ── Registration ───────────────────────────────────────────────────

export function registerModelPicker(pi: ExtensionAPI): void {
  // Intercept /model before the built-in handler sees it.
  // Built-in interactive commands (/model, /settings) are handled
  // outside the extension command system and can't be shadowed via
  // registerCommand — the input event fires first.
  pi.on("input", async (event, ctx) => {
    const text = (event.text ?? "").trim();
    if (text === "/model" || text.startsWith("/model ")) {
      await openModelOverlay(pi, ctx);
      return { preventDefault: true };
    }
    return undefined;
  });

  // No registerCommand — built-in interactive commands (/model,
  // /settings) can't be shadowed. The input interceptor above is
  // the only path that fires. RPC mode uses the built-in /model.
}
