// Shared tool-render formatting helpers.

export function clipText(text: string | undefined, max = 90): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

export function clipPath(raw: string | undefined, max = 120): string {
  const s = (raw ?? "").replace(/^\/home\/koad/, "~");
  if (s.length <= max) return s;
  return "…" + s.slice(s.length - max + 1);
}

export function formatDurationSeconds(totalSeconds?: number): string {
  if (totalSeconds == null) return "?";
  if (!Number.isFinite(totalSeconds)) return "∞";
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (h > 0) return `${h}h ${m}m ${secs}s`;
  if (m > 0) return `${m}m ${secs}s`;
  return `${secs}s`;
}

export function statusLine(theme: any, tone: "success" | "warning" | "error" | "dim", text: string): string {
  return theme.fg(tone, text);
}

export function detailLine(theme: any, text: string): string {
  return `  ${theme.fg("dim", text)}`;
}

export function accentDetailLine(theme: any, accent: string, detail?: string): string {
  return `  ${theme.fg("accent", accent)}${detail ? ` ${theme.fg("dim", detail)}` : ""}`;
}
