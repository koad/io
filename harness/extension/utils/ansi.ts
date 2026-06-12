// ANSI color helpers — shared across all koad-io extensions.

const CSI = "\x1b[";
const R   = "\x1b[0m";
export const c = (code: string, s: string) => `${CSI}${code}m${s}${R}`;

export const dim            = (s: string) => c("2",   s);
export const bold           = (s: string) => c("1",   s);
export const cyan           = (s: string) => c("36",  s);
export const white          = (s: string) => c("37",  s);
export const yellow         = (s: string) => c("33",  s);
export const green          = (s: string) => c("32",  s);
export const red            = (s: string) => c("31",  s);
export const magenta        = (s: string) => c("35",  s);
export const brightCyan     = (s: string) => c("1;36",s);
export const brightWhite    = (s: string) => c("1;37",s);
export const brightYellow   = (s: string) => c("1;33",s);
export const brightGreen    = (s: string) => c("1;32",s);
export const brightRed      = (s: string) => c("1;31",s);
export const brightMagenta  = (s: string) => c("1;35",s);
export const brightBlue     = (s: string) => c("1;34",s);

export type HealthState = "ok" | "starting" | "degraded" | "down";

export function healthDot(state: HealthState): string {
  if (state === "ok") return brightGreen("●");
  if (state === "degraded") return brightYellow("◐");
  if (state === "starting") return brightYellow("◐");
  return brightRed("○");
}

export function ctxColor(pct: number, s: string): string {
  if (pct > 85) return brightRed(s);
  if (pct > 70) return brightYellow(s);
  if (pct > 50) return yellow(s);
  return green(s);
}

export function providerColor(provider: string): (s: string) => string {
  const m: Record<string, (s: string) => string> = {
    anthropic: brightYellow, openai: brightGreen, "openai-codex": green,
    deepseek: brightBlue, google: brightRed, groq: brightMagenta,
    xai: brightCyan,
  };
  return m[provider] || brightWhite;
}
