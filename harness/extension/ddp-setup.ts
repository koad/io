/**
 * koad-io ddp-setup — DDP client creation and DDP-dependent registrations.
 *
 * The harness maintains two explicit DDP (WebSocket) connections:
 *   - control-tower → flights, harness sessions, mission coordination
 *   - daemon        → emissions, bonds, entities, kingdom index
 *
 * DDP is auxiliary — the harness runs without it (SDK/visitor mode).
 * When DDP is available, this module wires:
 *   - Live telemetry (footer, health polling, session flush)
 *   - Conversation stream (DDP emission events → mid-session system messages)
 *   - Live prompt streaming (entity typing → daemon → storefront observability)
 *   - /kingdom command (interactive TUI overlay)
 *
 *   - Scope-gated tools (only registered if bond scope allows):
 *     list_tools (always), music, sin, body tools, kingdom query tools
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BondScope } from "./bond-gate/types";
import { createDDPClient, type DDPClient } from "./ddp";
import { canRegister } from "./tool-registry";
import { createTelemetrySession } from "./identity/telemetry";
import { startConversationStream } from "./streams/conversation";
import { startLivePrompt } from "./live-prompt";
import { registerToolsInspect } from "./tools/list-tools";
import { registerMusicTool, registerMusicShortcuts } from "./tools/music";
import { registerSinTool } from "./tools/sin";
import { registerKingdomCommand } from "./kingdom/command";
import { registerKingdomQueryTools } from "./tools/kingdom-query";
import { registerBodyTools } from "./tools/body-motions";
import { registerDDPTool } from "./tools/ddp";
import { registerMeteorShellTool } from "./tools/meteor-shell";

const _BIND_IP = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
const CONTROL_WS = (process.env.KOAD_IO_CONTROL_URL ?? `http://${_BIND_IP}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`)
  .replace(/^http/, "ws") + "/websocket";
const DAEMON_WS = (process.env.KOAD_IO_DAEMON_URL ?? `http://${_BIND_IP}:${process.env.KOAD_IO_PORT ?? "28282"}`)
  .replace(/^http/, "ws") + "/websocket";

export interface DdpSetup {
  control: DDPClient;
  daemon: DDPClient;
}

/**
 * Create DDP clients and register DDP-dependent plugins.
 *
 * Called only when not in SDK/visitor mode (where DDP is irrelevant).
 * Tool registrations are scope-gated — only list_tools is always-on
 * (self-awareness tool so entities can discover their capabilities).
 */
export function setupDdp(pi: ExtensionAPI, scope: BondScope | null): DdpSetup {
  // ── DDP to control-tower (flights, harnesses, mission coordination) ─
  const control = createDDPClient(CONTROL_WS, "control");

  // ── DDP to daemon (emissions, bonds, entities, kingdom index) ──────
  const daemon = createDDPClient(DAEMON_WS, "daemon");

  // ── Identity + telemetry (footer, token stats, kingdom state) ──────
  const telemetry = createTelemetrySession(pi, { control, daemon });

  // ── Conversation stream (daemon emissions → system messages) ───────
  startConversationStream(pi, daemon);

  // ── Live prompt (stream typing to daemon → storefront) ─────────
  startLivePrompt(pi);

  // ── /kingdom command (TUI overlay — not an LLM tool) ───────────
  registerKingdomCommand(pi, { control, daemon }, telemetry.kingdom);

  // ── Tool: list_tools (always-on — self-awareness) ──────────────
  registerToolsInspect(pi);

  // ── Tool: ddp (always-on — DDP connection inspection) ────────────
  registerDDPTool(pi);

  // ── Tool: meteor_shell (scope-gated — runs JS on Meteor server) ──
  if (canRegister("meteor_shell", scope)) {
    registerMeteorShellTool(pi);
  }

  // ── Tools: scope-gated ─────────────────────────────────────────
  if (canRegister("music", scope)) {
    registerMusicTool(pi);
    registerMusicShortcuts(pi);
  }
  if (canRegister("sin", scope)) {
    registerSinTool(pi);
  }
  if (canRegister("surface_now", scope)) {
    registerBodyTools(pi);
  }
  if (canRegister("mission_query", scope)) {
    registerKingdomQueryTools(pi, { daemon, control });
  }

  return { control, daemon };
}
