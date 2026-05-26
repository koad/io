/**
 * koad-io channel tools — pi extension registration.
 *
 * VESTA-SPEC-154 v2.3 + SPEC-156 channel tools migrated from
 * ~/.forge/dance-hall/src/mcp/channel-tools.js.
 *
 * Entity tools (called from channel join loop):
 *   wait_for_cue     — blocks until a cue arrives (poll transport)
 *   raise_hand       — signals intent to speak; non-blocking
 *   channel_leave    — graceful entity departure
 *
 * Moderator tools (called by Juno):
 *   channel_state_read         — full channel state
 *   channel_cue_deliver        — targeted your-turn delivery
 *   channel_broadcast          — fire new-event to all
 *   channel_wait_for_next_turn — block until new turn
 *   channel_wait_for_state_change — block until structural change
 *
 * Internal:
 *   channel_event_fire — triggers cue delivery on append
 *
 * Backend: talks to daemon /api/channels/* endpoints.
 * Until Vulcan builds those, tools return clear "backend pending" errors.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  readChannelState, raiseHand, pollForCue, deliverCue,
  broadcastCue, leaveChannel, readTurnsSince, fireChannelEvent,
  type ChannelState, type Cue, type TurnRecord,
} from "./client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a state-change snapshot for wait_for_state_change responses. */
function buildStateSnapshot(slug: string, state: ChannelState) {
  return {
    channel: slug,
    status: state.status,
    members: state.members,
    raisedHands: state.raisedHands,
    turnCount: state.turnCount,
    autoPassTimer: state.autoPassTimer ?? {
      armed: false, oldestHandRaisedAt: null, secondsRemaining: null, timeoutSeconds: 180,
    },
  };
}

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

const WaitForCueParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  entity: Type.String({ description: "Entity handle (caller self-declares)." }),
  keepalive_interval: Type.Optional(Type.Number({ description: "Seconds before timeout cue if no event. Default 300. Clamped to [60, 1800].", default: 300 })),
  transport: Type.Optional(Type.String({ description: '"sse" or "poll" (default "poll"). SSE confirms open stream and returns immediately; poll blocks until cue arrives.', default: "poll" })),
});

const RaiseHandParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  entity: Type.String({ description: "Entity handle." }),
  intent: Type.Optional(Type.String({ description: "Optional short label (e.g. \"question\", \"concern\")." })),
});

const ChannelLeaveParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  entity: Type.String({ description: "Entity handle." }),
  reason: Type.Optional(Type.String({ description: "Optional reason for leaving." })),
});

const ChannelStateReadParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  turns_from: Type.Optional(Type.Number({ description: "Read turns from this offset. Default shows last 20." })),
});

const ChannelCueDeliverParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  entity: Type.String({ description: "Entity to grant the floor to." }),
  juno_note: Type.Optional(Type.String({ description: "Optional context delivered in the cue." })),
});

const ChannelBroadcastParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  reason: Type.Optional(Type.String({ description: "Optional reason for audit." })),
});

const ChannelWaitForNextTurnParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  since_turn_id: Type.Optional(Type.String({ description: "Wait for turns strictly after this turnId. If omitted, captures current count and blocks until it increases." })),
  timeout_seconds: Type.Optional(Type.Number({ description: "Seconds before returning with trigger='timeout'. Default 300. Clamped to [10, 1800].", default: 300 })),
});

const ChannelWaitForStateChangeParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  change_types: Type.Optional(Type.Array(Type.String(), { description: "Subset of change types to wait for. Default: all. Valid: member_joined, member_left, hand_raised, hand_cleared, floor_granted, channel_closed, auto_passed." })),
  timeout_seconds: Type.Optional(Type.Number({ description: "Seconds before returning with trigger='timeout'. Default 300. Clamped to [10, 1800].", default: 300 })),
});

const ChannelEventFireParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  event_type: Type.Optional(Type.String({ description: "Event type: new-event, channel-closed, member_joined, member_left. Default new-event.", default: "new-event" })),
  entity: Type.Optional(Type.String({ description: "Entity that appended the turn." })),
  addressee: Type.Optional(Type.String({ description: "Optional: entity to pass the floor to (conch-pass)." })),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerChannelTools(pi: ExtensionAPI): void {
  const backendReady = !!process.env.KOAD_IO_CHANNEL_BACKEND;

  // ── wait_for_cue ────────────────────────────────────────────────
  pi.registerTool({
    name: "wait_for_cue",
    label: "Wait For Cue",
    description: "Block until a channel cue arrives (poll transport). Returns a cue payload with newTurns, yourTurn flag, and hand queue state. With transport='sse', confirms the open SSE stream and returns immediately.",
    promptSnippet: "Wait for channel cue (slug, entity) — blocks on poll, immediate on SSE",
    promptGuidelines: [
      "Use in channel join loops to block until the moderator grants a turn.",
      "With transport='sse', returns immediately if stream is open — cues arrive via SSE.",
      "Call raise_hand before wait_for_cue to enter the queue.",
    ],
    parameters: WaitForCueParams,

    async execute(_toolCallId, params) {
      const { slug, entity, keepalive_interval, transport = "poll" } = params;

      if (!backendReady) {
        return {
          content: [{ type: "text", text: "channel backend not yet available — Vulcan is building the daemon channel API" }],
          details: { pending: true },
        };
      }

      let keepalive = keepalive_interval ?? 300;
      keepalive = Math.max(60, Math.min(1800, keepalive));

      if (transport === "sse") {
        // SSE: confirm stream, return immediately
        try {
          const state = await readChannelState(slug);
          const sseEntry = state.sseStreams?.[entity];
          if (sseEntry) {
            return {
              content: [{ type: "text", text: `SSE stream active for ${entity}@${slug}` }],
              details: { stream_active: true, channel: slug, entity },
            };
          }
          return {
            content: [{ type: "text", text: `No SSE stream for ${entity}@${slug}. Open GET /api/channels/${slug}/stream?entity=${entity} first.` }],
            details: { stream_active: false, channel: slug, entity },
          };
        } catch (e: any) {
          throw new Error(`wait_for_cue SSE: ${e.message}`);
        }
      }

      // Poll transport — loop until cue or timeout
      const POLL_MS = 3000;
      const maxAttempts = Math.ceil((keepalive * 1000) / POLL_MS);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, POLL_MS));
        try {
          const cue = await pollForCue(slug, entity);
          if (cue) {
            const turnMsg = cue.yourTurn ? "🎤 your turn" : `cue: ${cue.trigger}`;
            const turnInfo = cue.newTurnCount > 0 ? ` (${cue.newTurnCount} new turns)` : "";
            return {
              content: [{ type: "text", text: `${turnMsg}${turnInfo} @ ${slug}` }],
              details: cue,
            };
          }
        } catch (_) {
          // Backend error — keep polling
        }
      }

      return {
        content: [{ type: "text", text: `⏳ no cue after ${keepalive}s in ${slug}` }],
        details: { trigger: "timeout", channel: slug, entity },
      };
    },
  });

  // ── raise_hand ──────────────────────────────────────────────────
  pi.registerTool({
    name: "raise_hand",
    label: "Raise Hand",
    description: "Signal intent to speak in the channel. Non-blocking. Returns queue position. Moderator will deliver a your-turn cue when granting.",
    promptSnippet: "Raise hand in channel (slug, entity, intent?)",
    promptGuidelines: [
      "Call before wait_for_cue to enter the hand queue.",
      "intent is optional — use for context (\"question\", \"concern\", \"ready to decide\").",
    ],
    parameters: RaiseHandParams,

    async execute(_toolCallId, params) {
      if (!backendReady) {
        return {
          content: [{ type: "text", text: "channel backend pending" }],
          details: { pending: true },
        };
      }
      const { slug, entity, intent } = params;
      const result = await raiseHand(slug, entity, intent);
      return {
        content: [{ type: "text", text: `✋ hand raised in ${slug} (position ${result.queuePosition}/${result.queueLength})` }],
        details: result,
      };
    },
  });

  // ── channel_leave ───────────────────────────────────────────────
  pi.registerTool({
    name: "channel_leave",
    label: "Leave Channel",
    description: "Gracefully leave a channel. Marks entity absent, cancels pending waits.",
    promptSnippet: "Leave channel (slug, entity, reason?)",
    promptGuidelines: ["Call when done participating in a channel."],
    parameters: ChannelLeaveParams,

    async execute(_toolCallId, params) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, entity, reason } = params;
      const result = await leaveChannel(slug, entity, reason);
      return {
        content: [{ type: "text", text: `left ${slug}` }],
        details: result,
      };
    },
  });

  // ── channel_state_read (moderator) ──────────────────────────────
  pi.registerTool({
    name: "channel_state_read",
    label: "Read Channel State",
    description: "Full channel state for moderation: metadata, members, raised hands, recent turns, SSE stream status, auto-pass timer, grantPending.",
    promptSnippet: "Read full channel state (slug)",
    promptGuidelines: [
      "Primary channel awareness tool for moderators (Juno).",
      "Returns members, hand queue, recent turns, and timing state.",
    ],
    parameters: ChannelStateReadParams,

    async execute(_toolCallId, params) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, turns_from } = params;
      const state = await readChannelState(slug, turns_from);
      const memberList = state.members.map(m => `${m.entity} (${m.status})`).join(", ");
      const handList = state.raisedHands.map(h => h.entity).join(", ") || "(none)";
      return {
        content: [{
          type: "text",
          text: [
            `**${slug}** · ${state.status} · ${state.turnCount} turns`,
            `members: ${memberList || "(none)"}`,
            `hands: ${handList}`,
            state.autoPassTimer?.armed ? `⏱ auto-pass in ${state.autoPassTimer.secondsRemaining}s` : "",
          ].filter(Boolean).join("\n"),
        }],
        details: state,
      };
    },
  });

  // ── channel_cue_deliver (moderator) ─────────────────────────────
  pi.registerTool({
    name: "channel_cue_deliver",
    label: "Deliver Channel Cue",
    description: "Grant a specific entity the floor. Delivers a targeted your-turn cue. The entity receives yourTurn=true.",
    promptSnippet: "Grant floor to entity (slug, entity, juno_note?)",
    promptGuidelines: [
      "Use to grant a turn to a specific entity in the hand queue.",
      "Disarms the auto-pass timer — moderator is in control.",
    ],
    parameters: ChannelCueDeliverParams,

    async execute(_toolCallId, params) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, entity, juno_note } = params;
      const result = await deliverCue(slug, entity, juno_note);
      return {
        content: [{ type: "text", text: result.delivered ? `🎤 floor granted to ${entity} in ${slug}` : `could not reach ${entity} in ${slug}` }],
        details: result,
      };
    },
  });

  // ── channel_broadcast (moderator) ───────────────────────────────
  pi.registerTool({
    name: "channel_broadcast",
    label: "Broadcast Channel Cue",
    description: "Fire a new-event cue to all present members without appending a turn.",
    promptSnippet: "Broadcast to all channel members (slug, reason?)",
    promptGuidelines: [
      "Use to notify all members of a structural change or announcement.",
      "Does not append a turn — purely a push notification.",
    ],
    parameters: ChannelBroadcastParams,

    async execute(_toolCallId, params) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, reason } = params;
      const result = await broadcastCue(slug, reason);
      return {
        content: [{ type: "text", text: `broadcast to ${result.memberCount} members in ${slug}` }],
        details: result,
      };
    },
  });

  // ── channel_wait_for_next_turn (moderator v2.3) ─────────────────
  pi.registerTool({
    name: "channel_wait_for_next_turn",
    label: "Wait For Next Turn",
    description: "Block until at least one new turn lands in the channel past a reference point. Eliminates polling loops for moderators.",
    promptSnippet: "Wait for new turn (slug, since_turn_id?, timeout_seconds?)",
    promptGuidelines: [
      "Use when a moderator needs to know the moment an entity has spoken.",
      "since_turn_id: wait for turns after this ID. Omit to use current count.",
    ],
    parameters: ChannelWaitForNextTurnParams,

    async execute(_toolCallId, params) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, since_turn_id, timeout_seconds } = params;
      let timeout = timeout_seconds ?? 300;
      timeout = Math.max(10, Math.min(1800, timeout));

      const POLL_MS = 3000;
      const maxAttempts = Math.ceil((timeout * 1000) / POLL_MS);

      // Get baseline
      let sinceCount: number;
      try {
        const init = await readTurnsSince(slug, since_turn_id);
        sinceCount = init.currentCount;
        // Already new turns?
        if (init.turns.length > 0) {
          const lastTurn = init.turns[init.turns.length - 1];
          return {
            content: [{ type: "text", text: `${init.turns.length} new turn(s) — last: \`${lastTurn.turnId}\`` }],
            details: { trigger: "new-turn", channel: slug, turns: init.turns, lastTurnId: lastTurn.turnId },
          };
        }
      } catch (e: any) {
        throw new Error(`channel_wait_for_next_turn: ${e.message}`);
      }

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, POLL_MS));
        try {
          const data = await readTurnsSince(slug, undefined, sinceCount);
          if (data.turns.length > 0) {
            const lastTurn = data.turns[data.turns.length - 1];
            return {
              content: [{ type: "text", text: `${data.turns.length} new turn(s) — last: \`${lastTurn.turnId}\`` }],
              details: { trigger: "new-turn", channel: slug, turns: data.turns, lastTurnId: lastTurn.turnId },
            };
          }
        } catch (_) {}
      }

      return {
        content: [{ type: "text", text: `⏳ no new turns after ${timeout}s in ${slug}` }],
        details: { trigger: "timeout", channel: slug, turns: [], lastTurnId: null },
      };
    },
  });

  // ── channel_wait_for_state_change (moderator v2.3) ──────────────
  pi.registerTool({
    name: "channel_wait_for_state_change",
    label: "Wait For State Change",
    description: "Block until a structural change occurs in the channel. Returns change_type, entity, timestamp, and full snapshot. Valid change_types: member_joined, member_left, hand_raised, hand_cleared, floor_granted, channel_closed, auto_passed.",
    promptSnippet: "Wait for channel state change (slug, change_types?, timeout_seconds?)",
    promptGuidelines: [
      "Use for event-driven supervision without polling channel_state_read.",
      "change_types filters to specific events. Omit for all.",
    ],
    parameters: ChannelWaitForStateChangeParams,

    async execute(_toolCallId, params) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, change_types, timeout_seconds } = params;
      let timeout = timeout_seconds ?? 300;
      timeout = Math.max(10, Math.min(1800, timeout));

      const VALID = new Set([
        "member_joined", "member_left", "hand_raised", "hand_cleared",
        "floor_granted", "channel_closed", "auto_passed",
      ]);
      if (change_types) {
        for (const ct of change_types) {
          if (!VALID.has(ct)) {
            throw new Error(`Unknown change_type: '${ct}'. Valid: ${[...VALID].join(", ")}`);
          }
        }
      }

      // Snapshot baseline for diff detection
      let prev: ChannelState;
      try {
        prev = await readChannelState(slug);
      } catch (e: any) {
        throw new Error(`channel_wait_for_state_change: ${e.message}`);
      }

      const POLL_MS = 3000;
      const maxAttempts = Math.ceil((timeout * 1000) / POLL_MS);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, POLL_MS));
        try {
          const curr = await readChannelState(slug);

          // Detect changes by diffing state
          const events: Array<{ change_type: string; entity?: string; ts: string; snapshot: any }> = [];

          // Members: joined or left
          const prevEntities = new Set(prev.members.filter(m => m.status === "present").map(m => m.entity));
          const currEntities = new Set(curr.members.filter(m => m.status === "present").map(m => m.entity));
          for (const e of currEntities) {
            if (!prevEntities.has(e)) events.push({ change_type: "member_joined", entity: e, ts: new Date().toISOString(), snapshot: buildStateSnapshot(slug, curr) });
          }
          for (const e of prevEntities) {
            if (!currEntities.has(e)) events.push({ change_type: "member_left", entity: e, ts: new Date().toISOString(), snapshot: buildStateSnapshot(slug, curr) });
          }

          // Hands: raised or cleared
          const prevHands = new Set(prev.raisedHands.map(h => h.entity));
          const currHands = new Set(curr.raisedHands.map(h => h.entity));
          for (const e of currHands) {
            if (!prevHands.has(e)) events.push({ change_type: "hand_raised", entity: e, ts: new Date().toISOString(), snapshot: buildStateSnapshot(slug, curr) });
          }
          for (const e of prevHands) {
            if (!currHands.has(e)) events.push({ change_type: "hand_cleared", entity: e, ts: new Date().toISOString(), snapshot: buildStateSnapshot(slug, curr) });
          }

          // Grant pending appeared
          if (!prev.grantPending && curr.grantPending) {
            events.push({ change_type: "floor_granted", entity: curr.grantPending.entity, ts: curr.grantPending.grantedAt, snapshot: buildStateSnapshot(slug, curr) });
          }

          // Status change to closed
          if (prev.status !== "closed" && curr.status === "closed") {
            events.push({ change_type: "channel_closed", ts: new Date().toISOString(), snapshot: buildStateSnapshot(slug, curr) });
          }

          // Filter by change_types if specified
          const matches = change_types
            ? events.filter(e => change_types.includes(e.change_type))
            : events;

          if (matches.length > 0) {
            const match = matches[0];
            return {
              content: [{ type: "text", text: `${match.change_type}${match.entity ? ` → ${match.entity}` : ""} @ ${slug}` }],
              details: match,
            };
          }

          prev = curr;
        } catch (_) {}
      }

      return {
        content: [{ type: "text", text: `⏳ no state change after ${timeout}s in ${slug}` }],
        details: { trigger: "timeout", channel: slug, ts: new Date().toISOString(), snapshot: buildStateSnapshot(slug, prev) },
      };
    },
  });

  // ── channel_event_fire (internal) ───────────────────────────────
  pi.registerTool({
    name: "channel_event_fire",
    label: "Fire Channel Event",
    description: "Internal: fire cue delivery after a turn is appended. Called by the channel append command. Handles conch-pass (addressee floor transfer).",
    promptSnippet: "Fire channel event after turn append (slug, event_type?, entity?, addressee?)",
    promptGuidelines: [
      "Internal tool — called by channel append bash command.",
      "event_type: new-event, channel-closed, member_joined, member_left.",
      "addressee: entity to pass the floor to (conch-pass).",
    ],
    parameters: ChannelEventFireParams,

    async execute(_toolCallId, params) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, event_type, entity, addressee } = params;
      const result = await fireChannelEvent(slug, event_type, entity, addressee);
      return {
        content: [{ type: "text", text: `event fired: ${event_type ?? "new-event"} @ ${slug}` }],
        details: result,
      };
    },
  });
}
