/**
 * koad-io extension for the Pi harness.
 *
 * Single entry point that wires:
 *   - Identity footer + telemetry (DDP-driven kingdom state)
 *   - Dispatch tools (dispatch, dispatch_followup, dispatch_complete, wait)
 *   - Question tools (ask_question, wait_for_answer, answer_question)
 *   - Channel tools (wait_for_cue, raise_hand, channel_leave, channel_state_read,
 *     channel_cue_deliver, channel_broadcast, channel_wait_for_next_turn,
 *     channel_wait_for_state_change, channel_event_fire)
 *   - Conversation stream (DDP events → system messages mid-session)
 *   - /kingdom command (interactive dashboard overlay)
 *
 * Directory structure:
 *   koad-io/
 *   ├── index.ts           # ← this file
 *   ├── ddp.ts             # DDP WebSocket client
 *   ├── questions.ts       # Question queue tools (daemon /api/questions)
 *   ├── identity/
 *   │   ├── footer.ts      # Footer renderer
 *   │   ├── telemetry.ts   # Telemetry state + Pi event handlers
 *   │   └── git.ts         # Git polling helpers
 *   ├── dispatch/
 *   │   ├── tools.ts       # Tool registrations
 *   │   ├── flight.ts      # Flight assembly + launch logic
 *   │   └── watcher.ts     # Background flight watcher
 *   ├── channels/
 *   │   ├── tools.ts       # Channel tool registrations
 *   │   └── client.ts      # HTTP client for channel service
 *   ├── kingdom/
 *   │   ├── dashboard.ts   # KingdomDashboard component
 *   │   └── command.ts     # /kingdom command
 *   └── utils/
 *       ├── ansi.ts        # ANSI color helpers
 *       ├── format.ts      # Formatting helpers
 *       └── outfit.ts      # Outfit/persona helpers
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createDDPClient } from "./ddp";
import { createTelemetrySession } from "./identity/telemetry";
import { registerDispatchTools } from "./dispatch/tools";
import { registerQuestionTools } from "./questions";
import { registerChannelTools } from "./channels/tools";
import { startConversationStream } from "./stream";
import { startLivePrompt } from "./live-prompt";
import { registerKoadioTool } from "./koad-io-tool";
import { registerSearchTool } from "./search";
import { registerStatusTool } from "./status";
import { registerMusicTool } from "./music";
import { registerKingdomCommand } from "./kingdom/command";

const CONTROL_WS = (process.env.KOAD_IO_CONTROL_URL ?? "http://10.10.10.10:28283")
  .replace(/^http/, "ws") + "/websocket";
const DAEMON_WS = (process.env.KOAD_IO_DAEMON_URL ?? "http://10.10.10.10:28282")
  .replace(/^http/, "ws") + "/websocket";

export default function (pi: ExtensionAPI) {
  // ── DDP to control-tower (flights, bonds, sessions, health) ────
  const ddp = createDDPClient(CONTROL_WS);

  // ── DDP to daemon (raw emissions, channel cues, questions) ─────
  const daemonDDP = createDDPClient(DAEMON_WS);

  // ── Identity + telemetry (footer, token stats, kingdom state) ─
  const telemetry = createTelemetrySession(pi, ddp);

  // ── Dispatch tools ────────────────────────────────────────────
  registerDispatchTools(pi);

  // ── Question tools (daemon /api/questions) ─────────────────────
  registerQuestionTools(pi);

  // ── Channel tools (SPEC-154/156 — daemon backend live) ─────────
  registerChannelTools(pi);

  // ── Conversation stream (DDP events → system messages) ─────────
  startConversationStream(pi, ddp);
  startConversationStream(pi, daemonDDP);

  // ── Live prompt (stream typing to daemon → storefront) ─────────
  startLivePrompt(pi);

  // ── koad-io tool (typed gateway to command cascade) ────────────
  registerKoadioTool(pi);

  // ── Kingdom search (waterfall grep / frontmatter / atlas) ───────
  registerSearchTool(pi);

  // ── Kingdom status (daemon pulse — flights, sessions, emissions) ─
  registerStatusTool(pi);

  // ── Music control (Groove Basin @ disco.koad.sh:16242) ──────────
  registerMusicTool(pi);

  // ── /kingdom command ──────────────────────────────────────────
  registerKingdomCommand(pi, ddp, telemetry.kingdom);
}
