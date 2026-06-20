// Footer renderer — 3-row prompt-style status footer.
//
//   koad on wonderland with juno …/.juno 🐏 19GiB/31GiB            ant/s4.5 · high
//     keybase://team/…/self 📦3 🗑️1 ●40 🌱1                         ↑12k ↓8k $0.023 c45%
//     YY:MM:DD:HH:MM:SS ◊ koad:io                                   t12 ⚙bash src/foo.ts

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { dim, bold, cyan, white, yellow, green, red, magenta, brightCyan, brightWhite, brightYellow, brightGreen, brightRed, brightMagenta, ctxColor, providerColor } from "../utils/ansi";
import { compactModel, fmtTok, sanitizeStatusText } from "../utils/format";
import { entityStyle } from "../utils/outfit";
import { pollGit, type GitState } from "./git";
import type { Telemetry, KingdomState } from "./telemetry";
import { getNowPlaying } from "../tools/music";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Identity types (exported for telemetry.ts)
// ---------------------------------------------------------------------------

export interface FooterIdentity {
  operator: string;
  entity: string;
  host: string;
  piSessionCwd: string;
  piSessionId: string;
  piSessionVersion: number;
  flightId: string;
  flightPlan: string;
  sessionStartedAt: Date;
  currentProvider: string;
  currentModel: string;
  ownSessionId: string;
}

export function footerIdentityDefaults(): FooterIdentity {
  return {
    operator: process.env.USERNAME ?? process.env.USER ?? process.env.LOGNAME ?? "",
    entity: process.env.ENTITY ?? "",
    host: os.hostname(),
    piSessionCwd: "",
    piSessionId: "",
    piSessionVersion: 0,
    flightId: process.env.HARNESS_CONTROL_FLIGHT_ID ?? "",
    flightPlan: process.env.HARNESS_FLIGHT_PLAN ?? "",
    sessionStartedAt: new Date(),
    currentProvider: process.env.ENTITY_PI_PROVIDER ?? process.env.PROVIDER ?? "",
    currentModel: process.env.ENTITY_PI_MODEL ?? process.env.MODEL ?? "",
    ownSessionId: "",
  };
}

export function briefSlug(flightPlan: string): string {
  if (!flightPlan) return "";
  const base = path.basename(flightPlan, ".md");
  const parts = base.split("-");
  return parts.length > 2 ? parts.slice(2).join("-").slice(0, 24) : base.slice(0, 24);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtRAM(): string {
  const total = os.totalmem();
  const free  = os.freemem();
  const used  = total - free;
  const gb = (n: number) => `${(n / (1024 ** 3)).toFixed(0)}GiB`;
  return `${gb(used)}/${gb(total)}`;
}

function fmtTimestamp(d?: Date): string {
  const t = d ?? new Date();
  const Y = String(t.getFullYear()).slice(-2);
  const M = String(t.getMonth() + 1).padStart(2, "0");
  const D = String(t.getDate()).padStart(2, "0");
  const h = String(t.getHours()).padStart(2, "0");
  const m = String(t.getMinutes()).padStart(2, "0");
  const s = String(t.getSeconds()).padStart(2, "0");
  return `${Y}:${M}:${D}:${h}:${m}:${s}`;
}

function shortCwd(piSessionCwd: string): string {
  const cwd = piSessionCwd || process.env.PWD || process.cwd();
  return cwd.replace(os.homedir(), "~");
}

function isDirty(g: GitState): boolean {
  return g.staged > 0 || g.modified > 0 || g.deleted > 0 || g.untracked > 0 || g.conflicted > 0;
}

// ---------------------------------------------------------------------------
// Kingdom health dots (individual daemon / control) ──────────────────────────
// ---------------------------------------------------------------------------

function daemonDot(k: KingdomState): string {
  if (k.daemon === "ok" && k.daemonReady)       return green("●");
  if (k.daemon === "degraded" || k.daemon === "starting") return yellow("◐");
  return red("○"); // down
}

function controlDot(k: KingdomState): string {
  if (k.control === "ok" && k.controlReady)      return green("●");
  if (k.control === "degraded" || k.control === "starting") return yellow("◐");
  return red("○"); // down
}

// ---------------------------------------------------------------------------
// Footer component factory
// ---------------------------------------------------------------------------

export function renderFooter(
  id: FooterIdentity,
  tel: Telemetry,
  kingdom: KingdomState,
  footerDataRef: any,
  width: number,
): string[] {
  const g = pollGit();
  const pw = (s: string) => s.padEnd(width, " ");

  const modelLabel = compactModel(id.currentProvider, id.currentModel);
  const provCol = providerColor(id.currentProvider);

  // ── Row 1: Identity ─────────────────────────────────────────────

  const entityCol = (s: string) => entityStyle(id.entity, s);

  let r1 = `${brightWhite(id.operator)} ${dim("on")} ${white(id.host)}`;
  r1 += ` ${dim("with")} ${entityCol(id.entity)}`;
  r1 += ` ${brightCyan(shortCwd(id.piSessionCwd))}`;
  if (isDirty(g)) r1 += ` ${brightYellow("🐏")}`;
  r1 += ` ${dim(fmtRAM())}`;

  // Right: model + thinking
  let r1right = provCol(modelLabel);
  if (tel.thinkingLevel && tel.thinkingLevel !== "off") {
    const tc: Record<string, (s: string) => string> = {
      minimal: dim, low: cyan, medium: yellow, high: brightYellow, xhigh: brightRed,
    };
    r1right += ` ${dim("·")} ${(tc[tel.thinkingLevel] || dim)(tel.thinkingLevel)}`;
  }

  r1 = layoutRow(r1, r1right, width);

  // ── Row 2: Git + tokens ─────────────────────────────────────────

  let r2 = "";

  if (g.isRepo) {
    // Remote URL
    if (g.remote) r2 += (r2 ? " " : "") + dim(g.remote);

    // Branch
    if (g.branch) r2 += (r2 ? " " : "") + magenta("⟐") + " " + white(g.branch);

    // Git status counters
    if (g.staged    > 0) r2 += (r2 ? " " : "") + brightGreen("+" + g.staged);
    if (g.deleted   > 0) r2 += (r2 ? " " : "") + brightRed("-" + g.deleted);
    if (g.modified  > 0) r2 += (r2 ? " " : "") + yellow("●" + g.modified);
    if (g.untracked > 0) r2 += (r2 ? " " : "") + brightCyan("~" + g.untracked);
    if (g.conflicted> 0) r2 += (r2 ? " " : "") + brightRed("!" + g.conflicted);
    if (g.ahead     > 0) r2 += (r2 ? " " : "") + dim("⇡" + g.ahead);
    if (g.behind    > 0) r2 += (r2 ? " " : "") + dim("⇣" + g.behind);
  }

  if (!r2) r2 = dim("  no git repo");

  // Right: tokens, cost, cache, context
  let r2right = "";
  const sp = () => r2right ? " " : "";
  if (tel.tokensIn)   r2right += sp() + dim("↑") + white(fmtTok(tel.tokensIn));
  if (tel.tokensOut)  r2right += sp() + dim("↓") + white(fmtTok(tel.tokensOut));
  const cacheTotal = tel.cacheRead + tel.cacheWrite;
  if (cacheTotal > 0) r2right += sp() + dim("R") + white(fmtTok(cacheTotal));
  if (tel.cacheHitRate > 0) {
    r2right += sp() + dim("CH") + white(`${tel.cacheHitRate.toFixed(1)}%`);
  }
  if (tel.totalCost > 0) r2right += sp() + green(`$${tel.totalCost.toFixed(3)}`);
  if (tel.contextWindow > 0) {
    const pctFmt = tel.contextPct.toFixed(1);
    const pctStr = `${pctFmt}%/${fmtTok(tel.contextWindow)}`;
    r2right += sp() + ctxColor(Math.round(tel.contextPct), pctStr);
    if (tel.autoCompact) r2right += ` ${dim("(auto)")}`;
  }

  r2 = layoutRow(r2, r2right, width);

  // ── Row 3: Timestamp + status ───────────────────────────────────

  let r3 = `${dim(fmtTimestamp())} ${brightMagenta("◊")} ${bold("koad:io")}`;

  // Right: turn count, active tool, kingdom health, error indicator
  let r3right = "";
  if (tel.turnCount > 0) r3right += `${dim("t")}${white(String(tel.turnCount))} `;
  if (!tel.idle && tel.activeTool) {
    const toolStr = tel.activePath
      ? `${tel.activeTool} ${tel.activePath.slice(0, 24)}`
      : tel.activeTool;
    r3right += `${yellow("⚙")}${white(toolStr)} `;
  }
  r3right += `${dim("d")}${daemonDot(kingdom)} ${dim("c")}${controlDot(kingdom)}`;
  if (kingdom.errorCount > 0) r3right += ` ${red(`⚠${kingdom.errorCount}`)}`;

  // Extension statuses (compact)
  if (footerDataRef) {
    try {
      const statuses: Map<string, string> = footerDataRef.getExtensionStatuses();
      if (statuses && statuses.size > 0) {
        const sorted = Array.from(statuses.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => sanitizeStatusText(text));
        if (sorted.length > 0) r3right += ` ${dim(sorted.join(" "))}`;
      }
    } catch (_) {}
  }

  r3 = layoutRow(r3, r3right, width);

  // ── Row 4: Last emission (fades after 60s) ──────────────────────
  const rows = [pw(r1), r2, r3];
  const em = kingdom.lastEmission;
  if (em && Date.now() - em.at < 60000) {
    const age = Math.round((Date.now() - em.at) / 1000);
    const prefix = `${dim(fmtTimestamp())} ${green("◊")} `;
    const prefixW = visibleWidth(prefix);
    const maxW = Math.max(10, width - prefixW);
    const clean = em.text.replace(/[\r\n]/g, " ");
    const txt = truncateToWidth(`${clean}  ${dim(`${age}s ago`)}`, maxW, dim("…"));
    rows.push(prefix + txt);
  }

  // ── Row 5: Now playing (from Groove Basin) ──────────────────────
  const np = getNowPlaying();
  if (np) {
    const prefix = `${dim(fmtTimestamp())} ${brightMagenta("♫")} `;
    const prefixW = visibleWidth(prefix);
    const maxW = Math.max(10, width - prefixW);
    const txt = truncateToWidth(np, maxW, dim("…"));
    rows.push(pw(prefix + txt));
  }

  return rows;
}

/** Layout: left text | pad | right text. Truncates right first if needed. */
function layoutRow(left: string, right: string, width: number): string {
  const lw = visibleWidth(left);
  const rw = visibleWidth(right);

  if (lw + 2 + rw <= width) {
    return left + " ".repeat(width - lw - rw) + right;
  }

  // Try truncating right
  const availRight = width - lw - 2;
  if (availRight > 4) {
    const trunc = truncateToWidth(right, availRight, "");
    return left + " ".repeat(Math.max(0, width - lw - visibleWidth(trunc))) + trunc;
  }

  // Fallback: truncate left
  return truncateToWidth(left, width, dim("…"));
}

// ---------------------------------------------------------------------------
// Footer component factory
// ---------------------------------------------------------------------------

export function createFooterComponent(
  id: FooterIdentity,
  tel: Telemetry,
  kingdom: KingdomState,
  footerDataRef: any,
) {
  return {
    invalidate() {},
    dispose() {},
    render(width: number): string[] {
      return renderFooter(id, tel, kingdom, footerDataRef, width);
    },
  };
}
