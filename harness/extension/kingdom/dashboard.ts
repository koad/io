// Kingdom dashboard — interactive TUI component.
//
// Tabs: Summary | Flights | Bonds | Scope | Health | Errors
//
// The Scope tab shows the current entity's resolved bond scope —
// file read/write/exec paths, tool grants, entity capabilities,
// blocked paths, env lanes, and device/bond counts.

import { DDPClient } from "../ddp";
import type { BondScope } from "../bond-gate/types";
import type { KingdomState } from "../identity/telemetry";
import { entityStyle } from "../utils/outfit";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

type Tab = "all" | "flights" | "bonds" | "scope" | "health" | "errors";

function healthDot(state: string): string {
  if (state === "ok") return "●";
  if (state === "degraded" || state === "starting") return "◐";
  return "○";
}

function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm}m`;
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function shortPath(p: string): string {
  return p.replace(/^\/home\/[^/]+/, "~");
}

export class KingdomDashboard {
  ddp: DDPClient;
  tab: Tab;
  kingdom: KingdomState;
  selectedIdx = 0;
  selectedTabIdx = 0;
  lastFetched: Date;
  getScope: () => BondScope | null;

  onClose?: () => void;

  private tabs: Tab[] = ["all", "flights", "bonds", "scope", "health", "errors"];

  constructor(ddp: DDPClient, tab: Tab, kingdom: KingdomState, getScope: () => BondScope | null) {
    this.ddp = ddp;
    this.tab = tab;
    this.kingdom = kingdom;
    this.getScope = getScope;
    this.selectedTabIdx = this.tabs.indexOf(this.tab);
    this.lastFetched = new Date();
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.right) || data === "l") {
      this.selectedTabIdx = (this.selectedTabIdx + 1) % this.tabs.length;
      this.tab = this.tabs[this.selectedTabIdx];
      this.selectedIdx = 0;
      return true;
    }
    if (matchesKey(data, Key.left) || data === "h") {
      this.selectedTabIdx = (this.selectedTabIdx - 1 + this.tabs.length) % this.tabs.length;
      this.tab = this.tabs[this.selectedTabIdx];
      this.selectedIdx = 0;
      return true;
    }
    if (data === "\x1b" || data === "\x03" || data === "\x04" ||
        matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("d")) ||
        data === "q" || data === "Q") {
      this.onClose?.();
      return true;
    }

    const list = this.currentList();
    if (list.length > 0) {
      if (matchesKey(data, Key.up) || data === "k") {
        if (this.selectedIdx > 0) this.selectedIdx--;
        return true;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        if (this.selectedIdx < list.length - 1) this.selectedIdx++;
        return true;
      }
    }

    return false;
  }

  private currentList(): any[] {
    switch (this.tab) {
      case "flights": return this.ddp.flights;
      case "bonds": return this.ddp.bondsList;
      default: return [];
    }
  }

  invalidate() {}

  private t(theme: any) {
    return {
      accent: (s: string) => theme.fg("accent", s),
      dim: (s: string) => theme.fg("dim", s),
      muted: (s: string) => theme.fg("muted", s),
      green: (s: string) => theme.fg("success", s),
      red: (s: string) => theme.fg("error", s),
      yellow: (s: string) => theme.fg("warning", s),
      bold: (s: string) => theme.bold(s),
    };
  }

  render(width: number, theme: any): string[] {
    const t = this.t(theme);
    const lines: string[] = [];
    const pad = (s: string) => truncateToWidth(s, width - 2);
    const gap = () => lines.push("");
    const w = width;

    const flights = this.ddp.flights;
    const bonds = this.ddp.bondsList;
    const sessions = this.ddp.sessionsList;
    const entities = this.ddp.entitiesList;
    const scope = this.getScope();
    const h = this.kingdom;

    // ── Header ──
    lines.push(pad(t.accent("╭── " + t.bold("kingdom") + " " + "─".repeat(Math.max(0, w - 16)) + "╮")));

    // ── Summary strip (always visible) ──
    const dColor = h.daemon === "ok" ? "green" : h.daemon === "down" ? "red" : "yellow";
    const cColor = h.control === "ok" ? "green" : h.control === "down" ? "red" : "yellow";

    let summary = "";
    summary += ` ${t[dColor](healthDot(h.daemon))} daemon`;
    summary += `  ${t[cColor](healthDot(h.control))} control`;
    summary += `  ${t.accent(`⟐${this.ddp.flightCount}`)} flights`;
    summary += `  ${t.green(`◈${this.ddp.bondCount}`)} bonds`;
    if (sessions.length > 0) summary += `  ${t.muted(`▤${sessions.length}`)} sessions`;
    if (entities.length > 0) summary += `  ${t.muted(`◎${entities.length}`)} entities`;
    if (scope) {
      const modeTag = scope.mode === "bypass" ? t.red("BYPASS") : scope.mode === "bonded" ? t.green(`⛓${scope.bondCount}`) : scope.mode === "env-var" ? t.yellow("env") : t.dim("none");
      summary += `  ${modeTag}`;
      const rw = scope.file.read.length + scope.file.write.length + scope.file.exec.length;
      if (rw > 0) summary += ` ${t.dim(`r${scope.file.read.length}w${scope.file.write.length}e${scope.file.exec.length}`)}`;
    }
    lines.push(pad(summary));

    // ── Tabs ──
    const tabBar = this.tabs.map((tab) => {
      const label = tab === "all" ? "Summary" : tab.charAt(0).toUpperCase() + tab.slice(1);
      return tab === this.tab ? t.bold(`[ ${label} ]`) : t.dim(`  ${label}  `);
    }).join(" ");
    lines.push(pad(`  ${tabBar}`));
    gap();

    // ── Tab content ──
    switch (this.tab) {
      case "all": this.renderSummary(lines, pad, t, gap, w); break;
      case "flights": this.renderFlights(lines, pad, t, gap, w, flights); break;
      case "bonds": this.renderBonds(lines, pad, t, gap, w, bonds); break;
      case "scope": this.renderScope(lines, pad, t, gap, w, scope); break;
      case "health": this.renderHealth(lines, pad, t, gap, w); break;
      case "errors": this.renderErrors(lines, pad, t, gap, w); break;
    }

    // ── Footer ──
    lines.push("");
    const daemonSock = this.ddp.isConnected ? "d●" : "d○";
    const controlSock = this.ddp.isConnected ? "c●" : "c○";
    lines.push(pad(`  ${t.dim(`${daemonSock} ${controlSock}  updated ${ago(this.lastFetched.toISOString())}`)}`));
    lines.push(pad(`  ${t.dim("←→ tabs  j/k nav  esc/q close")}`));
    lines.push(pad(t.accent("╰" + "─".repeat(Math.max(0, w - 2)) + "╯")));

    return lines;
  }

  // ── Summary tab ──────────────────────────────────────────────

  private renderSummary(lines: string[], pad: (s: string) => string, t: any, gap: () => void, w: number) {
    const flights = this.ddp.flights;
    const bonds = this.ddp.bondsList;
    const scope = this.getScope();
    const h = this.kingdom;

    // Health mini
    const dColor = h.daemon === "ok" ? "green" : h.daemon === "down" ? "red" : "yellow";
    const cColor = h.control === "ok" ? "green" : h.control === "down" ? "red" : "yellow";
    lines.push(pad(`  ${t.bold("Health")}  ${t[dColor](healthDot(h.daemon))} daemon ↑${fmtUptime(h.daemonUptimeS)}  ${t[cColor](healthDot(h.control))} control ↑${fmtUptime(h.controlUptimeS)}`));

    // Scope mini
    if (scope) {
      gap();
      lines.push(pad(`  ${t.bold("Scope")}  ${scope.mode === "bypass" ? t.red("▪ bypass — ALL ACCESS") : scope.mode === "bonded" ? t.green(`▪ bonded · ${scope.bondCount} bonds · @${scope.deviceId}`) : scope.mode === "env-var" ? t.yellow("▪ env-var lanes") : t.dim("▪ default — no access")}`));
      if (scope.file.read.length > 0) lines.push(pad(`    read:  ${t.dim(scope.file.read.map(shortPath).join(", "))}`));
      if (scope.file.write.length > 0) lines.push(pad(`    write: ${t.dim(scope.file.write.map(shortPath).join(", "))}`));
      if (scope.file.exec.length > 0) lines.push(pad(`    exec:  ${t.dim(scope.file.exec.map(shortPath).join(", "))}`));
      const grants: string[] = [];
      if (scope.tools.bash) grants.push("bash");
      if (scope.tools.dispatch) grants.push(`dispatch→${scope.entity_capabilities.dispatch_targets.length}`);
      if (scope.tools.koadio_tools.length > 0) grants.push(`tools:${scope.tools.koadio_tools.join(",")}`);
      if (grants.length > 0) lines.push(pad(`    grants: ${t.accent(grants.join(" "))}`));
      if (scope.envLanes.length > 0) lines.push(pad(`    env: ${t.yellow(scope.envLanes.join(", "))}`));
    }

    // Recent flights (top 4)
    if (flights.length > 0) {
      gap();
      lines.push(pad(`  ${t.bold("Recent Flights")} ${t.dim(`(${this.ddp.flightCount})`)}`));
      for (const f of flights.slice(0, 4)) {
        const e = f.entity ? entityStyle(f.entity, f.entity.padEnd(8)) : t.accent("?".padEnd(8));
        const summary = (f.briefSummary ?? f.completionSummary ?? f.briefSlug ?? "").slice(0, 40).replace(/\n/g, " ");
        const status = f.status === "flying" ? t.yellow("●") : f.status === "landed" ? t.green("●") : t.dim("○");
        lines.push(pad(`    ${status} ${e} ${t.dim(summary)}`));
      }
    }

    // Recent bonds (top 4)
    if (bonds.length > 0) {
      gap();
      lines.push(pad(`  ${t.bold("Active Bonds")} ${t.dim(`(${this.ddp.bondCount})`)}`));
      for (const b of bonds.slice(0, 4)) {
        const from = b.from ? entityStyle(b.from, b.from.padEnd(8)) : t.dim("?".padEnd(8));
        const to = b.to ? entityStyle(b.to, b.to.padEnd(8)) : t.dim("?".padEnd(8));
        lines.push(pad(`    ${from} → ${to}  ${t.dim(b.type ?? "")}`));
      }
    }

    // Errors mini
    if (h.errorCount > 0) {
      gap();
      lines.push(pad(`  ${t.red(`⚠ ${h.errorCount} errors`)} ${t.dim("— see Errors tab")}`));
    }
  }

  // ── Flights tab ──────────────────────────────────────────────

  private renderFlights(lines: string[], pad: (s: string) => string, t: any, gap: () => void, w: number, flights: any[]) {
    lines.push(pad(`  ${t.bold("⟐ Flights")} ${t.dim(`(${this.ddp.flightCount})`)}`));
    if (flights.length === 0) {
      lines.push(pad(`    ${t.dim("no active flights")}`));
      return;
    }
    lines.push("");
    for (let i = 0; i < Math.min(flights.length, 20); i++) {
      const f = flights[i];
      const sel = i === this.selectedIdx ? t.accent("▶") : " ";
      const status = f.status === "flying" ? t.yellow("● flying") : f.status === "landed" ? t.green("● landed") : t.dim(`○ ${f.status ?? "?"}`);
      const e = f.entity ? entityStyle(f.entity, f.entity) : t.accent("?");
      const dur = f.elapsed ? ` ${t.dim(fmtUptime(f.elapsed))}` : "";
      const host = f.host ? ` ${t.dim("@" + f.host)}` : "";
      lines.push(pad(`  ${sel} ${status} ${e}${host}${dur}`));
      if (f.briefSlug) lines.push(pad(`      ${t.dim("brief:")} ${f.briefSlug}`));
      const summary = (f.briefSummary ?? f.completionSummary ?? "").replace(/\n/g, " ").slice(0, 60);
      if (summary) lines.push(pad(`      ${t.dim(summary)}`));
    }
    if (flights.length > 20) {
      lines.push(pad(`    ${t.dim(`... and ${flights.length - 20} more`)}`));
    }
  }

  // ── Bonds tab ────────────────────────────────────────────────

  private renderBonds(lines: string[], pad: (s: string) => string, t: any, gap: () => void, w: number, bonds: any[]) {
    lines.push(pad(`  ${t.bold("◈ Bonds")} ${t.dim(`(${this.ddp.bondCount})`)}`));
    if (bonds.length === 0) {
      lines.push(pad(`    ${t.dim("no active bonds")}`));
      return;
    }
    lines.push("");
    for (let i = 0; i < Math.min(bonds.length, 20); i++) {
      const b = bonds[i];
      const sel = i === this.selectedIdx ? t.accent("▶") : " ";
      const from = b.from ? entityStyle(b.from, b.from) : t.accent("?");
      const to = b.to ? entityStyle(b.to, b.to) : t.accent("?");
      const status = b.status === "ACTIVE" ? t.green("● active") : t.dim(`○ ${b.status ?? "?"}`);
      const type = t.dim(b.type ?? "?");
      lines.push(pad(`  ${sel} ${status} ${from} → ${to}  ${type}`));
      if (b.createdAt) lines.push(pad(`      ${t.dim("created")} ${ago(b.createdAt)}`));
    }
    if (bonds.length > 20) {
      lines.push(pad(`    ${t.dim(`... and ${bonds.length - 20} more`)}`));
    }
  }

  // ── Scope tab ────────────────────────────────────────────────

  private renderScope(lines: string[], pad: (s: string) => string, t: any, gap: () => void, w: number, scope: BondScope | null) {
    if (!scope) {
      lines.push(pad(`  ${t.bold("Scope")}`));
      lines.push(pad(`    ${t.dim("no scope resolved — bond-gate may be disabled (ENTITY unset)")}`));
      return;
    }

    const modeLabel = scope.mode === "bypass" ? t.red("▪ BYPASS — ALL ACCESS GRANTED")
      : scope.mode === "bonded" ? t.green(`▪ BONDED — ${scope.bondCount} bond${scope.bondCount !== 1 ? "s" : ""}`)
      : scope.mode === "env-var" ? t.yellow("▪ ENV-VAR — temporary lanes")
      : t.dim("▪ DEFAULT — no access");

    lines.push(pad(`  ${t.bold("Scope")} ${modeLabel}`));
    lines.push(pad(`    ${t.dim(`device: @${scope.deviceId}`)}`));

    if (scope.errors.length > 0) {
      lines.push("");
      gap();
      lines.push(pad(`    ${t.red("⚠ errors:")}`));
      for (const err of scope.errors.slice(0, 5)) {
        lines.push(pad(`      ${t.red(err.slice(0, 60))}`));
      }
      if (scope.errors.length > 5) lines.push(pad(`      ${t.dim(`... and ${scope.errors.length - 5} more`)}`));
    }

    lines.push("");

    // File scope
    gap();
    lines.push(pad(`  ${t.bold("File Scope")}`));
    if (scope.file.read.length > 0) {
      lines.push(pad(`    ${t.green("read:")}`));
      for (const p of scope.file.read) lines.push(pad(`      ${t.dim(shortPath(p))}`));
    } else {
      lines.push(pad(`    ${t.dim("read: (none)")}`));
    }
    if (scope.file.write.length > 0) {
      lines.push(pad(`    ${t.yellow("write:")}`));
      for (const p of scope.file.write) lines.push(pad(`      ${t.dim(shortPath(p))}`));
    } else {
      lines.push(pad(`    ${t.dim("write: (none)")}`));
    }
    if (scope.file.exec.length > 0) {
      lines.push(pad(`    ${t.red("exec:")}`));
      for (const p of scope.file.exec) lines.push(pad(`      ${t.dim(shortPath(p))}`));
    } else {
      lines.push(pad(`    ${t.dim("exec: (none)")}`));
    }
    if (scope.file.blocked.length > 0) {
      lines.push(pad(`    ${t.muted("blocked:")}`));
      lines.push(pad(`      ${t.dim(scope.file.blocked.join(", "))}`));
    }

    // Tool grants
    gap();
    lines.push(pad(`  ${t.bold("Tool Grants")}`));
    lines.push(pad(`    bash:       ${scope.tools.bash ? t.green("✓") : t.dim("✗")}`));
    lines.push(pad(`    dispatch:   ${scope.tools.dispatch ? t.green("✓") : t.dim("✗")}`));
    if (scope.tools.dispatch_followup) lines.push(pad(`    dispatch followup: ${t.green("✓")}`));
    if (scope.tools.dispatch_complete) lines.push(pad(`    dispatch complete:  ${t.green("✓")}`));
    if (scope.tools.koadio_tools.length > 0) {
      const tools = scope.tools.koadio_tools.includes("*") ? "ALL (*)" : scope.tools.koadio_tools.join(", ");
      lines.push(pad(`    koadio tools:  ${t.accent(tools)}`));
    } else {
      lines.push(pad(`    koadio tools:  ${t.dim("(none)")}`));
    }
    if (scope.tools.koadio_commands.length > 0) {
      const cmds = scope.tools.koadio_commands.includes("*") ? "ALL (*)" : scope.tools.koadio_commands.join(", ");
      lines.push(pad(`    koadio cmds:   ${t.accent(cmds)}`));
    }
    if (scope.tools.channels.moderate.length > 0) {
      lines.push(pad(`    channel mod:   ${t.accent(scope.tools.channels.moderate.join(", "))}`));
    }
    if (scope.tools.channels.participate.length > 0) {
      lines.push(pad(`    channel part:  ${t.accent(scope.tools.channels.participate.join(", "))}`));
    }

    // Entity capabilities
    if (scope.entity_capabilities.dispatch_targets.length > 0) {
      gap();
      lines.push(pad(`  ${t.bold("Dispatch Targets")}`));
      const targets = scope.entity_capabilities.dispatch_targets.includes("*")
        ? "ALL (*)"
        : scope.entity_capabilities.dispatch_targets.map(e => entityStyle(e, e)).join(", ");
      lines.push(pad(`    ${targets}`));
    }

    // Env lanes
    if (scope.envLanes.length > 0) {
      gap();
      lines.push(pad(`  ${t.yellow("Env Lanes")}`));
      lines.push(pad(`    ${t.dim(scope.envLanes.join(", "))}`));
    }
    if (scope.envReadTools.length > 0) {
      lines.push(pad(`    read tools:  ${t.dim(scope.envReadTools.join(", "))}`));
    }
    if (scope.envWriteTools.length > 0) {
      lines.push(pad(`    write tools: ${t.dim(scope.envWriteTools.join(", "))}`));
    }
  }

  // ── Health tab ───────────────────────────────────────────────

  private renderHealth(lines: string[], pad: (s: string) => string, t: any, gap: () => void, w: number) {
    const h = this.kingdom;
    const dColor = h.daemon === "ok" ? "green" : h.daemon === "down" ? "red" : "yellow";
    const cColor = h.control === "ok" ? "green" : h.control === "down" ? "red" : "yellow";

    lines.push(pad(`  ${t.bold("Health")}`));
    lines.push("");
    gap();
    lines.push(pad(`  ${t.bold("Daemon")}  ${t[dColor](healthDot(h.daemon))} ${h.daemon}`));
    lines.push(pad(`    ready:   ${h.daemonReady ? t.green("yes") : t.red("no")}`));
    lines.push(pad(`    uptime:  ${t.dim(fmtUptime(h.daemonUptimeS))}`));
    gap();
    lines.push(pad(`  ${t.bold("Control Tower")}  ${t[cColor](healthDot(h.control))} ${h.control}`));
    lines.push(pad(`    ready:   ${h.controlReady ? t.green("yes") : t.red("no")}`));
    lines.push(pad(`    uptime:  ${t.dim(fmtUptime(h.controlUptimeS))}`));
    gap();
    if (h.lastPollAt) lines.push(pad(`  ${t.dim(`last poll: ${ago(h.lastPollAt)}`)}`));

    // Entities list
    const entities = this.ddp.entitiesList;
    if (entities.length > 0) {
      gap();
      lines.push(pad(`  ${t.bold("Known Entities")} ${t.dim(`(${entities.length})`)}`));
      for (const e of entities.slice(0, 15)) {
        const handle = e.handle ? entityStyle(e.handle, e.handle) : t.dim("?");
        const role = e.role ? t.dim(`[${e.role}]`) : "";
        const host = e.host ? t.dim(`@${e.host}`) : "";
        lines.push(pad(`    ${handle} ${role} ${host}`));
      }
    }

    // Sessions list
    const sessions = this.ddp.sessionsList;
    if (sessions.length > 0) {
      gap();
      lines.push(pad(`  ${t.bold("Active Sessions")} ${t.dim(`(${sessions.length})`)}`));
      for (const s of sessions.slice(0, 10)) {
        const e = s.entity ? entityStyle(s.entity, s.entity) : t.dim("?");
        const status = s.status === "active" ? t.green("●") : t.dim("○");
        const host = s.host ? t.dim(`@${s.host}`) : "";
        lines.push(pad(`    ${status} ${e} ${host} ${t.dim(s.sessionId?.slice(-8) ?? "")}`));
      }
    }
  }

  // ── Errors tab ───────────────────────────────────────────────

  private renderErrors(lines: string[], pad: (s: string) => string, t: any, gap: () => void, w: number) {
    const errs = this.kingdom.errorLog;
    lines.push(pad(`  ${t.bold("⚠ Errors")} ${t.dim(`(${errs.length})`)}`));
    if (errs.length === 0) {
      lines.push(pad(`    ${t.dim("no errors recorded")}`));
      return;
    }
    lines.push("");
    const shown = [...errs].reverse().slice(0, 20);
    for (let i = 0; i < shown.length; i++) {
      const e = shown[i];
      const ts = e.at.slice(11, 19);
      const toolTag = e.toolName ? t.dim(` [${e.toolName}]`) : "";
      const body = truncateToWidth(e.msg.replace(/\n/g, " "), Math.max(10, w - 24), "…");
      lines.push(pad(`    ${t.dim(ts)} ${t.red("⚠")} ${body}${toolTag}`));
    }
    if (errs.length > 20) {
      lines.push(pad(`    ${t.dim(`... and ${errs.length - 20} more`)}`));
    }
  }
}
