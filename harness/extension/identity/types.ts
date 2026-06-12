// koad-io identity — types and default state for telemetry + kingdom.

import type { HealthState } from "../../utils/ansi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Telemetry {
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  cacheHitRate: number;     // CH% — fraction of input served from cache (0-100)
  turnCount: number;
  toolCount: number;
  contextPct: number;
  contextWindow: number;
  autoCompact: boolean;
  thinkingLevel: string;
  activeTool: string;
  activePath: string;
  idle: boolean;
  lastToolMs: number;
  slowestToolMs: number;
  slowestToolName: string;
  slowToolCount: number;
  totalToolMs: number;
}

export interface ErrorEntry {
  at: string;
  msg: string;
  toolName?: string;
}

export interface KingdomState {
  flightCount: number;
  bondCount: number;
  lastTool: string;
  lastToolEntity: string;
  daemon: HealthState;
  daemonReady: boolean;
  daemonUptimeS: number;
  control: HealthState;
  controlReady: boolean;
  controlUptimeS: number;
  lastPollAt: string;
  lastError: string;
  errorLog: ErrorEntry[];
  errorCount: number;
  lastEmission: { text: string; at: number } | null;
}

// ---------------------------------------------------------------------------
// Health types
// ---------------------------------------------------------------------------

export interface KoadIOHealth {
  health?: { status?: string; uptime?: number };
  upstart?: string;
  asof?: string;
}

export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthResult {
  status: HealthStatus;
  ready: boolean;
  uptimeS: number;
  responseMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const EMPTY_KINGDOM: KingdomState = {
  flightCount: 0,
  bondCount: 0,
  lastTool: "",
  lastToolEntity: "",
  daemon: "starting",
  daemonReady: false,
  daemonUptimeS: 0,
  control: "starting",
  controlReady: false,
  controlUptimeS: 0,
  lastPollAt: "",
  lastError: "",
  errorLog: [],
  errorCount: 0,
  lastEmission: null,
};

export const EMPTY_TELEMETRY: Telemetry = {
  totalCost: 0,
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cacheHitRate: 0,
  turnCount: 0,
  toolCount: 0,
  contextPct: 0,
  contextWindow: 0,
  autoCompact: false,
  thinkingLevel: "",
  activeTool: "",
  activePath: "",
  idle: true,
  lastToolMs: 0,
  slowestToolMs: 0,
  slowestToolName: "",
  slowToolCount: 0,
  totalToolMs: 0,
};
