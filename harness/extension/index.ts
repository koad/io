/**
 * koad-io extension for the Pi harness.
 *
 * Single entry point that wires:
 *   - Identity footer + telemetry (DDP-driven kingdom state)
 *   - Tool suite (questions, dispatch, channels, koad-io, body, kingdom-query, search, status, sin, music)
 *   - Conversation stream (DDP events → system messages mid-session)
 *   - Tool inspection (`list_tools`, `/tools`)
 *   - /kingdom command (interactive dashboard overlay)
 *   - System infra (bond-gate, hooks, context-budget, circuit-breaker)
 *
 * Directory structure:
 *   extension/
 *   ├── index.ts           # ← this file (entry point)
 *   ├── ddp.ts             # DDP WebSocket client
 *   ├── lifecycle.ts       # Lifecycle events + telemetry dispatch (was hooks.ts)
 *   ├── bond-gate.ts       # Permission enforcement
 *   ├── context-budget.ts  # Context monitoring + auto-compaction
 *   ├── circuit-breaker.ts # Provider failure recovery
 *   ├── live-prompt.ts     # Stream typing to daemon
 *   ├── tools/             # LLM-callable tools
 *   │   ├── questions.ts   # ask_question, wait_for_answer, answer_question
 *   │   ├── dispatch.ts    # dispatch, dispatch_followup, dispatch_complete, wait
 *   │   ├── channels.ts    # wait_for_cue, raise_hand, channel_*, etc
 *   │   ├── koad-io.ts     # koad-io passthrough
 *   │   ├── body-motions.ts # surface_now, intake_digest, obligation_*, brief_issue
 *   │   ├── kingdom-query.ts # mission_query, session_query, emission_query, etc
 *   │   ├── search.ts      # Kingdom search (waterfall grep/frontmatter/atlas)
 *   │   ├── status.ts      # Kingdom operational pulse
 *   │   ├── sin.ts         # Recursive grep in explicit directory
 *   │   ├── music.ts       # Groove Basin REST control
 *   │   └── list-tools.ts  # list_tools tool + /tools command
 *   ├── dispatch/          # Dispatch backend
 *   │   ├── flight.ts      # Flight assembly + launch
 *   │   └── watcher.ts     # Background flight watcher
 *   ├── channels/          # Channel backend
 *   │   └── client.ts      # HTTP client for channel service
 *   ├── identity/          # Footer + telemetry + git polling
 *   │   ├── footer.ts, telemetry.ts, git.ts
 *   ├── kingdom/           # Kingdom UI + query backend
 *   │   ├── dashboard.ts, command.ts, queries.ts
 *   ├── streams/           # Real-time event streams
 *   │   └── conversation.ts # DDP events → system messages
 *   └── utils/             # Shared utilities
 *       ├── ansi.ts, format.ts, outfit.ts, tool-render.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createDDPClient } from "./ddp";
import type { DDPClient } from "./ddp";
import { createTelemetrySession } from "./identity/telemetry";
import { registerDispatchTools } from "./tools/dispatch";
import { registerQuestionTools } from "./tools/questions";
import { registerChannelTools } from "./tools/channels";
import { startConversationStream } from "./streams/conversation";
import { startLivePrompt } from "./live-prompt";
import { registerKoadioTool } from "./tools/koad-io";
import { registerToolsInspect } from "./tools/list-tools";
import { registerSearchTool } from "./tools/search";
import { registerStatusTool } from "./tools/status";
import { registerMusicTool, registerMusicShortcuts } from "./tools/music";
import { registerSinTool } from "./tools/sin";
import { registerKingdomCommand } from "./kingdom/command";
import { registerBondGate } from "./bond-gate";
import type { VisitorConfig } from "./bond-gate/types";
import { registerHooks } from "./lifecycle";
import { registerContextBudget } from "./context-budget";
import { registerProviderCircuitBreaker } from "./circuit-breaker";
import { registerBodyTools } from "./tools/body-motions";
import { registerKingdomQueryTools } from "./tools/kingdom-query";
import { registerFileOpTools } from "./tools/file-ops";

const _BIND_IP = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
const CONTROL_WS = (process.env.KOAD_IO_CONTROL_URL ?? `http://${_BIND_IP}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`)
  .replace(/^http/, "ws") + "/websocket";
const DAEMON_WS = (process.env.KOAD_IO_DAEMON_URL ?? `http://${_BIND_IP}:${process.env.KOAD_IO_PORT ?? "28282"}`)
  .replace(/^http/, "ws") + "/websocket";

function toolName(tool: any): string {
  return typeof tool === "string" ? tool : String(tool?.name ?? "");
}

function sdkMode(): boolean {
  if (process.env.KOAD_IO_HARNESS_SDK === "1") return true;
  return !!process.env.KOAD_IO_VISITOR_SCOPE?.trim() || !!process.env.KOAD_IO_VISITOR_CALLER?.trim();
}

function resolveVisitorConfig(): VisitorConfig | null {
  const raw = process.env.KOAD_IO_VISITOR_SCOPE?.trim();
  const callerRaw = process.env.KOAD_IO_VISITOR_CALLER?.trim();
  if (!raw && !callerRaw && !sdkMode()) return null;

  // Parse visitor scope from env var (JSON) or use empty scope
  let accessScope = { read: [] as string[], write: [] as string[], exec: [] as string[], blocked: [] as string[] };
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      accessScope = {
        read: Array.isArray(parsed.read) ? parsed.read : [],
        write: Array.isArray(parsed.write) ? parsed.write : [],
        exec: Array.isArray(parsed.exec) ? parsed.exec : [],
        blocked: Array.isArray(parsed.blocked) ? parsed.blocked : [],
      };
    } catch {
      // Invalid JSON — use empty scope
    }
  }

  const entity = process.env.ENTITY ?? "entity";
  const caller = callerRaw ? { handle: callerRaw } : null;

  return {
    entityHandle: entity,
    accessScope,
    caller,
    noBondFiles: true,
  };
}

function enforceHarnessToolPolicy(pi: ExtensionAPI): void {
  const available = new Set(pi.getAllTools().map((tool: any) => toolName(tool)));
  const active = new Set(pi.getActiveTools().map((tool: any) => toolName(tool)));

  if (available.has("ls")) active.add("ls");
  active.delete("grep");
  active.delete("find");

  pi.setActiveTools([...active]);
}

export default function (pi: ExtensionAPI) {
  const inSdkMode = sdkMode();

  // ── File operation tools (mkdir, cp, mv, rm, chmod) ──────────
  registerFileOpTools(pi);

  // ── Dispatch tools ────────────────────────────────────────────
  registerDispatchTools(pi);

  // ── Question tools (daemon /api/questions) ─────────────────────
  registerQuestionTools(pi);

  // ── Channel tools (SPEC-154/156 — daemon backend live) ─────────
  registerChannelTools(pi);

  // ── koad-io tool (typed gateway to command cascade) ────────────
  registerKoadioTool(pi);

  // ── Harness default tool policy ────────────────────────────────
  pi.on("session_start", async () => { enforceHarnessToolPolicy(pi); });
  pi.on("session_tree", async () => { enforceHarnessToolPolicy(pi); });

  // ── Kingdom search (waterfall grep / frontmatter / atlas) ───────
  registerSearchTool(pi);

  // ── Kingdom status (daemon pulse — flights, sessions, emissions) ─
  registerStatusTool(pi);

  // DDP clients — explicit split:
  //   control-tower → flights / harness sessions / mission coordination
  //   daemon        → emissions / bonds / entities / kingdom index
  let controlDDP: DDPClient | null = null;
  let daemonDDP: DDPClient | null = null;

  if (!inSdkMode) {
    // ── DDP to control-tower (flights, harnesses, mission coordination) ─
    controlDDP = createDDPClient(CONTROL_WS, "control");

    // ── DDP to daemon (emissions, bonds, entities, kingdom index) ──────
    daemonDDP = createDDPClient(DAEMON_WS, "daemon");

    // ── Identity + telemetry (footer, token stats, kingdom state) ──────
    const telemetry = createTelemetrySession(pi, { control: controlDDP, daemon: daemonDDP });

    // ── Conversation stream (daemon emissions → system messages) ───────
    startConversationStream(pi, daemonDDP);

    // ── Live prompt (stream typing to daemon → storefront) ─────────
    startLivePrompt(pi);

    // ── Tool inspection (`list_tools`, `/tools`) ───────────────────
    registerToolsInspect(pi);

    // ── Music control (Groove Basin @ disco.koad.sh:16242) ──────────
    registerMusicTool(pi);
    registerMusicShortcuts(pi);

    // ── Sin search (recursive grep in one explicit directory) ──────
    registerSinTool(pi);

    // ── /kingdom command ──────────────────────────────────────────
    registerKingdomCommand(pi, { control: controlDDP, daemon: daemonDDP }, telemetry.kingdom);
  }

  // ── Bond gate (runs in ALL modes — entity bonds or visitor scope) ─
  const visitorConfig = resolveVisitorConfig();
  registerBondGate(pi, daemonDDP ?? controlDDP, visitorConfig);

  // ── Lifecycle hooks (watchers, harvest, awareness, telemetry) ─
  registerHooks(pi);

  // ── Context budget manager (warn/compact/switch on pressure) ───
  registerContextBudget(pi);

  // ── Provider circuit breaker (detect + recover from failures) ──
  registerProviderCircuitBreaker(pi);

  // ── Body tools (surface, inbox, obligation, brief — kingdom motions) ──
  registerBodyTools(pi);

  // ── Kingdom query tools (mission, session, emission, bond, question, entity) ──
  // Explicit routing: control-tower for mission/session surfaces; daemon for index surfaces.
  registerKingdomQueryTools(pi, { daemon: daemonDDP, control: controlDDP });
}
