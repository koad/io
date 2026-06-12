// koad-io channel tools — cue operations: wait_for_cue, channel_cue_deliver.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { clipText as clip, formatDurationSeconds as formatDuration } from "../../utils/tool-render";
import {
  readChannelState, pollForCue, deliverCue,
} from "../../channels/client";
import {
  backendReady,
  WaitForCueParams, ChannelCueDeliverParams,
  isAbortError, throwIfAborted, sleep,
} from "./index";

export function registerCueTools(pi: ExtensionAPI): void {

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

    renderCall(args: any, theme: any) {
      const transport = args.transport || "poll";
      const keepalive = Math.max(60, Math.min(1800, args.keepalive_interval ?? 300));
      return new Text([
        theme.fg("toolTitle", theme.bold("wait_for_cue ")) + theme.fg("accent", `${args.entity || "?"}@${args.slug || "?"}`),
        `  ${theme.fg("dim", `transport: ${transport} · waiting for moderator cue or new event`)}`,
        `  ${theme.fg("dim", `timeout: ${formatDuration(keepalive)} · poll: every 3s · Esc cancels local wait`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded, isPartial }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const slug = details.channel ?? details.slug ?? "?";
      const entity = details.entity ?? "?";
      const elapsed = formatDuration(details.elapsed_s ?? 0);
      const timeout = formatDuration(details.keepalive_s ?? 300);
      const lines: string[] = [];

      if (isPartial || details.status === "waiting") {
        lines.push(theme.fg("warning", `⏳ waiting for cue`));
        lines.push(`  ${theme.fg("accent", `${entity}@${slug}`)} ${theme.fg("dim", `· elapsed: ${elapsed} · timeout: ${timeout} · poll: 3s`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "stream-active") {
        lines.push(theme.fg("success", `✓ SSE stream active for ${entity}@${slug}`));
        if (expanded && details.transport) lines.push(`  ${theme.fg("dim", `transport: ${details.transport}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }
      if (details.status === "stream-missing") {
        lines.push(theme.fg("warning", `⏸ no SSE stream for ${entity}@${slug}`));
        if (expanded && details.transport) lines.push(`  ${theme.fg("dim", `transport: ${details.transport}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }
      if (details.status === "cancelled") {
        lines.push(theme.fg("warning", `⏸ local wait cancelled`));
        lines.push(`  ${theme.fg("accent", `${entity}@${slug}`)} ${theme.fg("dim", `· elapsed: ${elapsed}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }
      if (details.trigger === "timeout") {
        lines.push(theme.fg("warning", `⏳ no cue after ${elapsed}`));
        lines.push(`  ${theme.fg("accent", `${entity}@${slug}`)} ${theme.fg("dim", `· timeout: ${timeout}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      const cueText = details.yourTurn ? "✓ your turn" : `✓ cue: ${details.trigger ?? "event"}`;
      const turnInfo = details.newTurnCount > 0 ? ` · new turns: ${details.newTurnCount}` : "";
      lines.push(theme.fg("success", cueText));
      lines.push(`  ${theme.fg("accent", `${entity}@${slug}`)} ${theme.fg("dim", `${turnInfo}${details.junoNote ? ` · ${clip(details.junoNote)}` : ""}`)}`);
      if (expanded && details.queuedHands?.length) lines.push(`  ${theme.fg("dim", `queue: ${details.queuedHands.join(", ")}`)}`);
      if (expanded && details.yourPosition != null) lines.push(`  ${theme.fg("dim", `your position: ${details.yourPosition}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, signal, onUpdate) {
      const { slug, entity, keepalive_interval, transport = "poll" } = params;

      if (!backendReady) {
        return {
          content: [{ type: "text", text: "channel backend not yet available — Vulcan is building the daemon channel API" }],
          details: { pending: true },
        };
      }

      let keepalive = keepalive_interval ?? 300;
      keepalive = Math.max(60, Math.min(1800, keepalive));
      const meta = { slug, channel: slug, entity, transport, keepalive_s: keepalive };

      if (transport === "sse") {
        try {
          const state = await readChannelState(slug);
          const sseEntry = state.sseStreams?.[entity];
          if (sseEntry) {
            return {
              content: [{ type: "text", text: `SSE stream active for ${entity}@${slug}` }],
              details: { ...meta, stream_active: true, status: "stream-active" },
            };
          }
          return {
            content: [{ type: "text", text: `No SSE stream for ${entity}@${slug}. Open GET /api/channels/${slug}/stream?entity=${entity} first.` }],
            details: { ...meta, stream_active: false, status: "stream-missing" },
          };
        } catch (e: any) {
          throw new Error(`wait_for_cue SSE: ${e.message}`);
        }
      }

      const POLL_MS = 3000;
      const maxAttempts = Math.ceil((keepalive * 1000) / POLL_MS);
      let latestElapsed = 0;
      onUpdate?.({ content: [{ type: "text", text: "waiting for cue..." }], details: { ...meta, status: "waiting", elapsed_s: latestElapsed } });

      try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await sleep(POLL_MS, signal);
          const elapsed = (attempt + 1) * (POLL_MS / 1000);
          latestElapsed = elapsed;
          onUpdate?.({ content: [{ type: "text", text: "waiting for cue..." }], details: { ...meta, status: "waiting", elapsed_s: elapsed } });
          try {
            throwIfAborted(signal);
            const cue = await pollForCue(slug, entity);
            if (cue) {
              const turnMsg = cue.yourTurn ? "🎤 your turn" : `cue: ${cue.trigger}`;
              const turnInfo = cue.newTurnCount > 0 ? ` (${cue.newTurnCount} new turns)` : "";
              return {
                content: [{ type: "text", text: `${turnMsg}${turnInfo} @ ${slug}` }],
                details: { ...meta, ...cue, status: "cue", elapsed_s: elapsed },
              };
            }
          } catch (err: any) {
            if (isAbortError(err)) throw err;
          }
        }
      } catch (err: any) {
        if (isAbortError(err)) {
          return {
            content: [{ type: "text", text: `wait cancelled — no cue yet for ${entity}@${slug}` }],
            details: { ...meta, status: "cancelled", interrupted: true, elapsed_s: latestElapsed },
          };
        }
        throw err;
      }

      return {
        content: [{ type: "text", text: `⏳ no cue after ${keepalive}s in ${slug}` }],
        details: { ...meta, trigger: "timeout", status: "timeout", elapsed_s: keepalive },
      };
    },
  });

  // ── channel_cue_deliver ─────────────────────────────────────────
  pi.registerTool({
    name: "channel_cue_deliver",
    label: "Channel Cue Deliver",
    description: "Deliver a your-turn cue to a specific entity in the channel. Moderator only. Updates entity's cue flag and optionally passes context via juno_note.",
    promptSnippet: "Grant turn to entity in channel (slug, entity, juno_note?)",
    promptGuidelines: [
      "Use by moderator to grant the floor to a specific entity.",
      "Fires a your-turn cue to the target entity's wait_for_cue or SSE stream.",
    ],
    parameters: ChannelCueDeliverParams,

    renderCall(args: any, theme: any) {
      const slug = args.slug || "?";
      const entity = args.entity || "?";
      const lines = [
        theme.fg("toolTitle", theme.bold("channel_cue_deliver ")) + theme.fg("accent", `${entity}@${slug}`),
        args.juno_note ? `  ${theme.fg("dim", `note: ${clip(args.juno_note)}`)}` : "",
      ].filter(Boolean);
      return new Text(lines.join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const slug = details.slug ?? "?";
      const entity = details.entity ?? "?";
      const lines = [
        theme.fg("success", `✓ cue delivered → ${entity}@${slug}`),
      ];
      if (details.juno_note) lines.push(`  ${theme.fg("dim", `note: ${clip(details.juno_note)}`)}`);
      if (expanded && details.result) lines.push(`  ${theme.fg("dim", `status: ${JSON.stringify(details.result)}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, entity, juno_note } = params;
      const result = await deliverCue(slug, entity, juno_note ?? undefined);
      return {
        content: [{ type: "text", text: `cue delivered to ${entity}@${slug}` }],
        details: { slug, channel: slug, entity, juno_note, result, status: "delivered" },
      };
    },
  });
}
