// Kingdom dashboard — interactive TUI component for flights, bonds, health.
// Uses DDPClient for live reactive data instead of REST polling.

import { DDPClient } from "../ddp";
import type { KingdomState } from "../identity/telemetry";
import { entityStyle } from "../utils/outfit";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

type Tab = "all" | "flights" | "bonds" | "health" | "errors";

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

export class KingdomDashboard {
  ddp: DDPClient;
  tab: Tab;
  kingdom: KingdomState;
  selectedFlightIdx = 0;
  selectedBondIdx = 0;
  selectedTabIdx = 0;
  lastFetched: Date;

  onClose?: () => void;

  private tabs: Tab[] = ["all", "flights", "bonds", "health", "errors"];

  constructor(ddp: DDPClient, tab: Tab, kingdom: KingdomState) {
    this.ddp = ddp;
    this.tab = tab;
    this.kingdom = kingdom;
    this.selectedTabIdx = this.tabs.indexOf(this.tab);
    this.lastFetched = new Date();
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.right) || data === "l") {
      this.selectedTabIdx = (this.selectedTabIdx + 1) % this.tabs.length;
      this.tab = this.tabs[this.selectedTabIdx];
      return true;
    }
    if (matchesKey(data, Key.left) || data === "h") {
      this.selectedTabIdx = (this.selectedTabIdx - 1 + this.tabs.length) % this.tabs.length;
      this.tab = this.tabs[this.selectedTabIdx];
      return true;
    }
    // Close: raw escape byte, Escape key, Ctrl+C, Ctrl+D, q
    if (data === "\x1b" || data === "\x03" || data === "\x04" ||
        matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("d")) ||
        data === "q" || data === "Q") {
      this.onClose?.();
      return true;
    }

    const flights = this.ddp.flights;
    const bonds = this.ddp.bondsList;

    if (this.tab === "flights" || (this.tab === "all" && flights.length > 0)) {
      if (matchesKey(data, Key.up) || data === "k") {
        if (this.selectedFlightIdx > 0) this.selectedFlightIdx--;
        return true;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        if (this.selectedFlightIdx < flights.length - 1) this.selectedFlightIdx++;
        return true;
      }
    }
    if (this.tab === "bonds" || (this.tab === "all" && bonds.length > 0)) {
      if (matchesKey(data, Key.up) || data === "k") {
        if (this.selectedBondIdx > 0) this.selectedBondIdx--;
        return true;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        if (this.selectedBondIdx < bonds.length - 1) this.selectedBondIdx++;
        return true;
      }
    }

    return false;
  }

  invalidate() {}

  private themed(theme: any) {
    return {
      accent: (s: string) => theme.fg("accent", s),
      dim: (s: string) => theme.fg("dim", s),
      green: (s: string) => theme.fg("success", s),
      red: (s: string) => theme.fg("error", s),
      yellow: (s: string) => theme.fg("warning", s),
      bold: (s: string) => theme.bold(s),
    };
  }

  render(width: number, theme: any): string[] {
    const t = this.themed(theme);
    const lines: string[] = [];
    const pad = (s: string) => truncateToWidth(s, width - 2);
    const gap = () => lines.push("");

    const h = this.kingdom;
    const flights = this.ddp.flights;
    const bonds = this.ddp.bondsList;

    // ── Header ──
    lines.push(pad(t.accent("╭──── " + t.bold("kingdom") + " " + "─".repeat(Math.max(0, width - 15)) + "╮")));

    // ── Health ──
    const dColor = h.daemon === "ok" ? "green" : h.daemon === "down" ? "red" : "yellow";
    const cColor = h.control === "ok" ? "green" : h.control === "down" ? "red" : "yellow";
    const dLabel = h.daemon === "ok" && h.daemonReady ? "online" : h.daemon === "down" ? "offline" : h.daemon === "starting" ? "connecting" : "degraded";
    const cLabel = h.control === "ok" && h.controlReady ? "online" : h.control === "down" ? "offline" : h.control === "starting" ? "connecting" : "degraded";

    lines.push(pad(`  ${t.bold("Health")}`));
    lines.push(pad(`  ${t[dColor](healthDot(h.daemon))} daemon   ${t[dColor](dLabel)}  ${t.dim(`↑ ${fmtUptime(h.daemonUptimeS)}`)}`));
    lines.push(pad(`  ${t[cColor](healthDot(h.control))} control  ${t[cColor](cLabel)}  ${t.dim(`↑ ${fmtUptime(h.controlUptimeS)}`)}`));
    if (h.daemonUptimeS > 0 || h.controlUptimeS > 0) {
      lines.push(pad(`  ${t.dim(`polled ${ago(h.lastPollAt)}`)}`));
    }
    lines.push(pad(`  ${t.accent(`⟐ ${this.ddp.flightCount} flights`)}    ${t.green(`◈ ${this.ddp.bondCount} bonds`)}`));

    // ── Tabs ──
    const tabBar = this.tabs.map((tab) => {
      const label = tab === "all" ? "All" : tab === "flights" ? "Flights" : tab === "bonds" ? "Bonds" : tab === "health" ? "Health" : "Errors";
      return tab === this.tab ? t.bold(`[ ${label} ]`) : t.dim(`  ${label}  `);
    }).join(" ");
    lines.push(pad(`  ${tabBar}`));
    gap();

    const showFlights = this.tab === "all" || this.tab === "flights";
    const showBonds = this.tab === "all" || this.tab === "bonds";
    const showHealth = this.tab === "all" || this.tab === "health";
    const showErrors = this.tab === "all" || this.tab === "errors";

    if (showFlights) {
      lines.push(pad(`  ${t.bold("⟐ Flights")} ${t.dim(`(${this.ddp.flightCount})`)}`));
      if (flights.length === 0) {
        lines.push(pad(`    ${t.dim("no active flights")}`));
      } else {
        const maxShow = this.tab === "flights" ? 20 : 8;
        const shown = flights.slice(0, maxShow);
        for (let i = 0; i < shown.length; i++) {
          const f = shown[i];
          const sel = this.tab === "flights" && i === this.selectedFlightIdx ? t.accent("▶") : " ";
          const idShort = (f._id ?? "").slice(-12) || "?";
          const entity = f.entity ? entityStyle(f.entity, f.entity) : t.accent("?");
          const body = (f.body ?? "").slice(0, 40).replace(/\n/g, " ");
          const plan = f.plan ? t.dim(` ${f.plan.slice(0, 20)}`) : "";
          lines.push(pad(`  ${sel} ${idShort} ${entity}${plan}  ${t.dim(body)}`));
        }
        if (flights.length > maxShow) {
          lines.push(pad(`    ${t.dim(`... and ${flights.length - maxShow} more`)}`));
        }
      }
      gap();
    }

    if (showBonds) {
      lines.push(pad(`  ${t.bold("◈ Bonds")} ${t.dim(`(${this.ddp.bondCount})`)}`));
      if (bonds.length === 0) {
        lines.push(pad(`    ${t.dim("no active bonds")}`));
      } else {
        const maxShow = this.tab === "bonds" ? 20 : 8;
        const shown = bonds.slice(0, maxShow);
        for (let i = 0; i < shown.length; i++) {
          const b = shown[i];
          const sel = this.tab === "bonds" && i === this.selectedBondIdx ? t.accent("▶") : " ";
          const from = b.from ? entityStyle(b.from, b.from) : t.accent("?");
          const to = b.to ? entityStyle(b.to, b.to) : t.accent("?");
          const type = t.dim(b.type ?? "?");
          const status = b.status === "active" ? t.green("●") : t.dim("○");
          lines.push(pad(`  ${sel} ${status} ${from} → ${to}  ${type}`));
        }
        if (bonds.length > maxShow) {
          lines.push(pad(`    ${t.dim(`... and ${bonds.length - maxShow} more`)}`));
        }
      }
      gap();
    }

    if (showHealth) {
      lines.push(pad(`  ${t.bold("Health")}`));
      const dC = t[h.daemon === "ok" ? "green" : h.daemon === "degraded" || h.daemon === "starting" ? "yellow" : "red"];
      const cC = t[h.control === "ok" ? "green" : h.control === "degraded" || h.control === "starting" ? "yellow" : "red"];
      lines.push(pad(`  ${dC(healthDot(h.daemon))} daemon   ${fmtUptime(h.daemonUptimeS)}  ${h.daemonReady ? t.green("ready") : t.yellow("...")}`));
      lines.push(pad(`  ${cC(healthDot(h.control))} control  ${fmtUptime(h.controlUptimeS)}  ${h.controlReady ? t.green("ready") : t.yellow("...")}`));
      gap();
    }

    if (showErrors) {
      const errs = this.kingdom.errorLog;
      lines.push(pad(`  ${t.bold("⚠ Errors")} ${t.dim(`(${errs.length})`)}`));
      if (errs.length === 0) {
        lines.push(pad(`    ${t.dim("no errors recorded")}`));
      } else {
        const maxShow = this.tab === "errors" ? 20 : 5;
        const shown = [...errs].reverse().slice(0, maxShow);
        for (let i = 0; i < shown.length; i++) {
          const e = shown[i];
          const ts = e.at.slice(11, 19); // HH:MM:SS
          const toolTag = e.toolName ? t.dim(` [${e.toolName}]`) : "";
          const body = truncateToWidth(e.msg.replace(/\n/g, " "), Math.max(10, width - 24), "…");
          lines.push(pad(`    ${t.dim(ts)} ${t.red("⚠")} ${body}${toolTag}`));
        }
        if (errs.length > maxShow) {
          lines.push(pad(`    ${t.dim(`... and ${errs.length - maxShow} more`)}`));
        }
      }
      gap();
    }

    const agoStr = ago(this.lastFetched.toISOString());
    lines.push(pad(`  ${t.dim(`${this.ddp.isConnected ? "● live" : "○ disconnected"}  updated ${agoStr}`)}  ${t.dim("·")}  ${t.dim("←→=tabs")}  ${t.dim("j/k=nav")}  ${t.dim("esc/q=close")}`));
    lines.push(pad(t.accent("╰" + "─".repeat(Math.max(0, width - 2)) + "╯")));

    return lines;
  }
}
