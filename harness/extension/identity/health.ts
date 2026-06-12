// koad-io identity — health polling (daemon + control-tower) and DDP event handlers.

import type { KingdomState, KoadIOHealth, HealthResult } from "./types";
import type { DDPClient } from "../../ddp";
import type { HealthState } from "../../utils/ansi";

// ---------------------------------------------------------------------------
// HTTP health check
// ---------------------------------------------------------------------------

export async function fetchHealth(url: string): Promise<HealthResult | null> {
  const start = Date.now();
  try {
    const res = await fetch(`${url}/.well-known/koad-io.json`, {
      signal: AbortSignal.timeout(5000),
    });
    const responseMs = Date.now() - start;

    let json: KoadIOHealth | null = null;
    try { json = await res.json() as KoadIOHealth; } catch (_) {}

    if (!json?.health?.status) {
      return { status: "degraded", ready: false, uptimeS: 0, responseMs };
    }
    const up = json.health.status === "up";
    if (!up) {
      return { status: "degraded", ready: false, uptimeS: json.health.uptime ?? 0, responseMs };
    }
    if (responseMs > 2000) {
      return { status: "degraded", ready: true, uptimeS: json.health.uptime ?? 0, responseMs };
    }
    return { status: "ok", ready: true, uptimeS: json.health.uptime ?? 0, responseMs };
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Poll daemon + control-tower health
// ---------------------------------------------------------------------------

export async function pollHealth(
  daemonHttpUrl: string,
  controlHttpUrl: string,
  kingdom: KingdomState,
  updateStatus: (kingdom: KingdomState) => void,
  requestRender?: () => void,
): Promise<void> {
  const [daemonH, controlH] = await Promise.all([
    fetchHealth(daemonHttpUrl),
    fetchHealth(controlHttpUrl),
  ]);

  if (daemonH) {
    kingdom.daemon = daemonH.status;
    kingdom.daemonReady = daemonH.ready;
    kingdom.daemonUptimeS = daemonH.uptimeS;
  } else {
    kingdom.daemon = "down";
    kingdom.daemonReady = false;
  }

  if (controlH) {
    kingdom.control = controlH.status;
    kingdom.controlReady = controlH.ready;
    kingdom.controlUptimeS = controlH.uptimeS;
  } else {
    kingdom.control = "down";
    kingdom.controlReady = false;
  }

  kingdom.lastPollAt = new Date().toISOString();
  updateStatus(kingdom);
  requestRender?.();
}

// ---------------------------------------------------------------------------
// Update status indicators
// ---------------------------------------------------------------------------

export function updateStatusIndicators(kingdom: KingdomState, cachedCtx: any): void {
  if (!cachedCtx) return;
  try {
    const bothOk = kingdom.daemon === "ok" && kingdom.control === "ok" && kingdom.daemonReady && kingdom.controlReady;
    const bothDown = kingdom.daemon === "down" && kingdom.control === "down";
    const bothStarting = kingdom.daemon === "starting" && kingdom.control === "starting";

    let text: string;
    if (bothOk) {
      text = "koad:io online";
    } else if (bothDown) {
      text = "koad:io offline";
    } else if (bothStarting) {
      text = "koad:io connecting...";
    } else {
      const dot = (s: HealthState) => s === "ok" ? "●" : s === "degraded" || s === "starting" ? "◐" : "○";
      text = `d${dot(kingdom.daemon)} c${dot(kingdom.control)}`;
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Wire DDP event handlers explicitly by backend role
// ---------------------------------------------------------------------------

export function wireDDPHandlers(
  clients: { control: DDPClient; daemon: DDPClient },
  kingdom: KingdomState,
  requestRender?: () => void,
): void {
  const { control, daemon } = clients;

  daemon.on("emission", (event, record) => {
    if (event === "added" || event === "changed") {
      if (record.body?.startsWith("→ ")) {
        kingdom.lastTool = record.body.slice(2).slice(0, 36);
        kingdom.lastToolEntity = record.entity ?? "";
      }
      const body = record.body || "";
      const entity = record.entity || "?";
      const type = record.type || "";
      if (body && type !== "session") {
        kingdom.lastEmission = {
          text: `[${entity}] ${type}: ${body}`,
          at: Date.now(),
        };
      }
    }
    kingdom.lastPollAt = new Date().toISOString();
    requestRender?.();
  });

  daemon.on("bond", () => {
    kingdom.bondCount = daemon.bondCount;
    kingdom.lastPollAt = new Date().toISOString();
    requestRender?.();
  });

  control.on("flight", () => {
    kingdom.flightCount = control.flightCount;
    kingdom.lastPollAt = new Date().toISOString();
    requestRender?.();
  });

  control.on("session", () => {
    kingdom.lastPollAt = new Date().toISOString();
    requestRender?.();
  });

  daemon.on("connected", () => {
    kingdom.bondCount = daemon.bondCount;
    kingdom.lastPollAt = new Date().toISOString();
    requestRender?.();
  });

  control.on("connected", () => {
    kingdom.flightCount = control.flightCount;
    kingdom.lastPollAt = new Date().toISOString();
    requestRender?.();
  });
}
