// koad-io channel tools — immediate actions: raise_hand, channel_leave, channel_state_read, channel_broadcast, channel_event_fire.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { clipText as clip, formatDurationSeconds as formatDuration } from "../../utils/tool-render";
import {
  readChannelState, raiseHand, leaveChannel,
  broadcastCue, fireChannelEvent,
} from "../../channels/client";
import {
  backendReady,
  RaiseHandParams, ChannelLeaveParams, ChannelStateReadParams,
  ChannelBroadcastParams, ChannelEventFireParams,
  buildStateSnapshot, summarizeMembers, summarizeHands, summarizeLatestTurn,
} from "./index";

export function registerChannelActions(pi: ExtensionAPI): void {

  // ── raise_hand ──────────────────────────────────────────────────
  pi.registerTool({
    name: "raise_hand",
    label: "Raise Hand",
    description: "Signal intent to speak in the channel. Non-blocking. Returns queue position. Moderator will deliver a your-turn cue when granting.",
    promptSnippet: "Raise hand in channel (slug, entity, intent?)",
    parameters: RaiseHandParams,

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("raise_hand ")) + theme.fg("accent", `${args.entity || "?"}@${args.slug || "?"}`),
        args.intent ? `  ${theme.fg("dim", `intent: ${clip(args.intent)}`)}` : "",
      ].filter(Boolean).join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const lines = [
        theme.fg("success", `✋ hand raised`),
        `  ${theme.fg("accent", `${details.entity ?? "?"}@${details.slug ?? "?"}`)}`,
      ];
      if (details.position != null) lines.push(`  ${theme.fg("dim", `position: ${details.position} of ${details.total ?? "?"}`)}`);
      if (expanded && details.intent) lines.push(`  ${theme.fg("dim", `intent: ${details.intent}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, entity, intent } = params;
      const result = await raiseHand(slug, entity, intent);
      return {
        content: [{ type: "text", text: `hand raised by ${entity} in ${slug}` }],
        details: { slug, channel: slug, entity, intent, ...result },
      };
    },
  });

  // ── channel_leave ───────────────────────────────────────────────
  pi.registerTool({
    name: "channel_leave",
    label: "Channel Leave",
    description: "Gracefully depart the channel. Removes entity from members list. If entity was speaker, floor becomes free.",
    promptSnippet: "Leave channel (slug, entity)",
    parameters: ChannelLeaveParams,

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("channel_leave ")) + theme.fg("accent", `${args.entity || "?"}@${args.slug || "?"}`),
        args.reason ? `  ${theme.fg("dim", `reason: ${clip(args.reason)}`)}` : "",
      ].filter(Boolean).join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const lines = [
        theme.fg("success", `🚪 departed`),
        `  ${theme.fg("accent", `${details.entity ?? "?"} ← ${details.slug ?? "?"}`)}`,
      ];
      if (details.reason) lines.push(`  ${theme.fg("dim", `reason: ${details.reason}`)}`);
      if (expanded && details.state) {
        lines.push(`  ${theme.fg("dim", `members: ${summarizeMembers(details.state)}`)}`);
        lines.push(`  ${theme.fg("dim", `hands: ${summarizeHands(details.state)}`)}`);
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, entity, reason } = params;
      const result = await leaveChannel(slug, entity, reason);
      return {
        content: [{ type: "text", text: `${entity} left ${slug}` }],
        details: { slug, channel: slug, entity, reason, state: result.state },
      };
    },
  });

  // ── channel_state_read ──────────────────────────────────────────
  pi.registerTool({
    name: "channel_state_read",
    label: "Channel State Read",
    description: "Read the full state of a channel: members, raised hands, current speaker, turn count, auto-pass timer, and recent turns.",
    promptSnippet: "Read channel state (slug)",
    parameters: ChannelStateReadParams,

    renderCall(args: any, theme: any) {
      return new Text(
        theme.fg("toolTitle", theme.bold("channel_state_read ")) + theme.fg("accent", args.slug || "?"),
        0, 0,
      );
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const state = details.state;
      const lines: string[] = [];
      if (state) {
        lines.push(theme.fg("success", `✓ ${state.status === "active" ? "active" : state.status}`));
        lines.push(`  ${theme.fg("accent", details.slug ?? "?")} ${theme.fg("dim", `· turns: ${state.turnCount ?? 0}`)}`);
        lines.push(`  ${theme.fg("dim", `members: ${summarizeMembers(state)}`)}`);
        lines.push(`  ${theme.fg("dim", `hands: ${summarizeHands(state)}`)}`);
        if (state.currentSpeaker) lines.push(`  ${theme.fg("dim", `speaker: ${state.currentSpeaker}`)}`);
        if (expanded && state.members) {
          for (const m of state.members) {
            const icon = m.status === "present" ? "●" : "○";
            lines.push(`  ${theme.fg("dim", `  ${icon} ${m.entity} (${m.status})${m.role ? ` · ${m.role}` : ""}${m.joinedAt ? ` · ${m.joinedAt}` : ""}`)}`);
          }
        }
        if (expanded && details.turns?.length) {
          const latest = summarizeLatestTurn(details.turns);
          if (latest) lines.push(`  ${theme.fg("dim", `latest: ${latest}`)}`);
        }
      } else {
        lines.push(theme.fg("warning", `⏸ channel backend pending`));
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, turns_from } = params;
      const state = await readChannelState(slug);
      const turns = turns_from != null ? state.turns.slice(turns_from) : (state.turns ?? []).slice(-20);
      return {
        content: [{ type: "text", text: `channel ${slug}: ${state.status}, ${state.members.length} members, ${state.turnCount} turns` }],
        details: {
          slug, channel: slug,
          state: buildStateSnapshot(slug, state),
          turns,
        },
      };
    },
  });

  // ── channel_broadcast ───────────────────────────────────────────
  pi.registerTool({
    name: "channel_broadcast",
    label: "Channel Broadcast",
    description: "Fire a new-event to all channel participants. Triggers cues for any waiting entities. Moderator only.",
    promptSnippet: "Broadcast new-event to channel (slug, reason?)",
    parameters: ChannelBroadcastParams,

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("channel_broadcast ")) + theme.fg("accent", args.slug || "?"),
        args.reason ? `  ${theme.fg("dim", `reason: ${clip(args.reason)}`)}` : "",
      ].filter(Boolean).join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const lines = [
        theme.fg("success", `📢 broadcast sent`),
        `  ${theme.fg("accent", details.slug ?? "?")} ${theme.fg("dim", `· event: ${details.event_type ?? "new-event"}`)}`,
      ];
      if (details.reason) lines.push(`  ${theme.fg("dim", `reason: ${details.reason}`)}`);
      if (expanded && details.result) lines.push(`  ${theme.fg("dim", `status: ${JSON.stringify(details.result)}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, reason } = params;
      const result = await broadcastCue(slug, reason);
      return {
        content: [{ type: "text", text: `broadcast sent to ${slug}` }],
        details: { slug, channel: slug, reason, event_type: "new-event", result },
      };
    },
  });

  // ── channel_event_fire ──────────────────────────────────────────
  pi.registerTool({
    name: "channel_event_fire",
    label: "Channel Event Fire",
    description: "Fire a named event on the channel (new-event, channel-closed, member_joined, member_left). This is the backend driver — wait_for_cue responds to these events.",
    promptSnippet: "Fire channel event (slug, event_type?, entity?, addressee?)",
    promptGuidelines: [
      "Internal use — drives cue delivery on event append.",
      "Use channel_broadcast for moderator-initiated new-event fire-and-forget.",
    ],
    parameters: ChannelEventFireParams,

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("channel_event_fire ")) + theme.fg("accent", args.slug || "?"),
        `  ${theme.fg("dim", `event: ${args.event_type || "new-event"}${args.entity ? ` · by: ${args.entity}` : ""}${args.addressee ? ` · addressee: ${args.addressee}` : ""}`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const lines = [
        theme.fg("success", `🔥 event fired`),
        `  ${theme.fg("accent", details.slug ?? "?")} ${theme.fg("dim", `· ${details.event_type ?? "new-event"}`)}`,
      ];
      if (details.entity) lines.push(`  ${theme.fg("dim", `entity: ${details.entity}`)}`);
      if (details.addressee) lines.push(`  ${theme.fg("dim", `addressee: ${details.addressee}`)}`);
      if (expanded && details.result) lines.push(`  ${theme.fg("dim", `status: ${JSON.stringify(details.result)}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, event_type, entity, addressee } = params;
      const result = await fireChannelEvent(slug, event_type, entity, addressee);
      return {
        content: [{ type: "text", text: `${event_type || "new-event"} fired on ${slug}` }],
        details: { slug, channel: slug, event_type: event_type || "new-event", entity, addressee, result },
      };
    },
  });
}
