// Formatting helpers — shared across all koad-io extensions.

import { dim } from "./ansi";

export function compactModel(provider: string, model: string): string {
  const ps: Record<string, string> = {
    deepseek: "ds", anthropic: "ant", openai: "oai",
    "openai-codex": "codex", google: "g", groq: "grq", xai: "xai",
  };
  const p = (provider || "").trim();
  const m = (model || "").trim();
  if (!p && !m) return 'unarmed';
  let ms = m
    .replace(/^(deepseek-|claude-|gpt-|gemini-)/, "")
    .replace(/^v/, "")
    .replace(/deepseek-v4-pro/, "v4p")
    .replace(/sonnet-4-5/, "s4.5")
    .replace(/grok-/, "grk");
  if (ms.length > 8) ms = ms.slice(0, 6) + "…";
  const shortProvider = ps[p] || p.slice(0, 3);
  if (!shortProvider) return ms || "?";
  if (!ms) return shortProvider;
  return `${shortProvider}/${ms}`;
}

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

export function fmtDurationShort(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h < 24) return `${h}h${String(min).padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d${String(rh).padStart(2, "0")}h`;
}

export function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}
