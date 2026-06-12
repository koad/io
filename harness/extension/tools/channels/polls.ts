// koad-io channel tools — polling operations: channel_wait_for_next_turn, channel_wait_for_state_change.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { clipText as clip, formatDurationSeconds as formatDuration } from "../../utils/tool-render";
import {
  readChannelState, readTurnsSince,
  type ChannelState,
} from "../../channels/client";
import {
  backendReady,
  ChannelWaitForNextTurnParams, ChannelWaitForStateChangeParams,
  buildStateSnapshot, summarizeMembers, summarizeHands,
  isAbortError, throwIfAborted, sleep,
} from "./index";

export function registerPollTools(pi: ExtensionAPI): void {

  // ── channel_wait_for_next_turn ──────────────────────────────────
  pi.registerTool({
    name: "channel_wait_for_next_turn",
    label: "Channel Wait For Next Turn",
    description: "Block until new turns are appended to the channel since a baseline count or turnId.",
    promptSnippet: "Wait for new turn in channel (slug, since_turn_id?, timeout_seconds?)",
    promptGuidelines: [
      "Use by moderator or entity to block until the channel advances.",
      "Esc cancels local wait.",
    ],
    parameters: ChannelWaitForNextTurnParams,

    renderCall(args: any, theme: any) {
      const slug = args.slug || "?";
      const timeout = Math.max(10, Math.min(1800, args.timeout_seconds ?? 300));
      return new Text([
        theme.fg("toolTitle", theme.bold("channel_wait_for_next_turn ")) + theme.fg("accent", slug),
        `  ${theme.fg("dim", `waiting for new turns · timeout: ${formatDuration(timeout)} · poll: 3s`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded, isPartial }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const slug = details.slug ?? "?";
      const elapsed = formatDuration(details.elapsed_s ?? 0);
      const timeout = formatDuration(details.timeout_seconds ?? 300);
      const lines: string[] = [];

      if (isPartial || details.status === "waiting") {
        lines.push(theme.fg("warning", `⏳ waiting for turns`));
        lines.push(`  ${theme.fg("accent", slug)} ${theme.fg("dim", `· elapsed: ${elapsed} · timeout: ${timeout}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "cancelled") {
        lines.push(theme.fg("warning", `⏸ local wait cancelled`));
        lines.push(`  ${theme.fg("accent", slug)} ${theme.fg("dim", `· elapsed: ${elapsed}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "new-turn") {
        const last = details.lastTurnId ?? "?";
        lines.push(theme.fg("success", `✓ ${details.turns?.length ?? 0} new turn(s)`));
        lines.push(`  ${theme.fg("accent", slug)} ${theme.fg("dim", `· last: ${last}`)}`);
        if (expanded && details.turns) {
          for (const t of details.turns) {
            lines.push(`  ${theme.fg("dim", `${t.entity}: ${clip(t.body, 60)} (${t.turnId})`)}`);
          }
        }
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.trigger === "timeout") {
        lines.push(theme.fg("warning", `⏳ no new turn after ${elapsed}`));
        lines.push(`  ${theme.fg("accent", slug)} ${theme.fg("dim", `· timeout: ${timeout}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      return new Text(theme.fg("success", `✓ turn check complete`), 0, 0);
    },

    async execute(_toolCallId, params, signal, onUpdate) {
      if (!backendReady) {
        return { content: [{ type: "text", text: "channel backend pending" }], details: { pending: true } };
      }
      const { slug, since_turn_id, timeout_seconds } = params;
      let timeout = timeout_seconds ?? 300;
      timeout = Math.max(10, Math.min(1800, timeout));

      const POLL_MS = 3000;
      const maxAttempts = Math.ceil((timeout * 1000) / POLL_MS);

      let sinceCount: number;
      try {
        const init = await readTurnsSince(slug, since_turn_id);
        sinceCount = init.currentCount;
        const meta = { slug, channel: slug, since_turn_id: since_turn_id ?? null, baseline_turn_count: sinceCount, timeout_seconds: timeout };
        if (init.turns.length > 0) {
          const lastTurn = init.turns[init.turns.length - 1];
          return {
            content: [{ type: "text", text: `${init.turns.length} new turn(s) — last: \`${lastTurn.turnId}\`` }],
            details: { ...meta, trigger: "new-turn", status: "new-turn", turns: init.turns, lastTurnId: lastTurn.turnId, elapsed_s: 0 },
          };
        }

        let latestElapsed = 0;
        onUpdate?.({ content: [{ type: "text", text: "waiting for next turn..." }], details: { ...meta, status: "waiting", elapsed_s: latestElapsed } });

        try {
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await sleep(POLL_MS, signal);
            const elapsed = (attempt + 1) * (POLL_MS / 1000);
            latestElapsed = elapsed;
            onUpdate?.({ content: [{ type: "text", text: "waiting for next turn..." }], details: { ...meta, status: "waiting", elapsed_s: elapsed } });
            try {
              throwIfAborted(signal);
              const data = await readTurnsSince(slug, undefined, sinceCount);
              if (data.turns.length > 0) {
                const lastTurn = data.turns[data.turns.length - 1];
                return {
                  content: [{ type: "text", text: `${data.turns.length} new turn(s) — last: \`${lastTurn.turnId}\`` }],
                  details: { ...meta, trigger: "new-turn", status: "new-turn", turns: data.turns, lastTurnId: lastTurn.turnId, elapsed_s: elapsed },
                };
              }
            } catch (err: any) {
              if (isAbortError(err)) throw err;
            }
          }
        } catch (err: any) {
          if (isAbortError(err)) {
            return {
              content: [{ type: "text", text: `wait cancelled — still listening for turns in ${slug}` }],
              details: { ...meta, status: "cancelled", interrupted: true, elapsed_s: latestElapsed },
            };
          }
          throw err;
        }

        return {
          content: [{ type: "text", text: `⏳ no new turns after ${timeout}s in ${slug}` }],
          details: { ...meta, trigger: "timeout", status: "timeout", elapsed_s: timeout },
        };
      } catch (e: any) {
        throw new Error(`channel_wait_for_next_turn: ${e.message}`);
      }
    },
  });

  // ── channel_wait_for_state_change ───────────────────────────────
  pi.registerTool({
    name: "channel_wait_for_state_change",
    label: "Channel Wait For State Change",
    description: "Block until the channel state changes (member join/leave, hand raised/cleared, floor granted, channel closed, auto-pass). Diffs snapshot before vs after each poll cycle.",
    promptSnippet: "Wait for channel state change (slug, change_types?, timeout_seconds?)",
    promptGuidelines: [
      "Use by moderator to block until channel structure changes.",
      "Valid change_types: member_joined, member_left, hand_raised, hand_cleared, floor_granted, channel_closed, auto_passed.",
    ],
    parameters: ChannelWaitForStateChangeParams,

    renderCall(args: any, theme: any) {
      const slug = args.slug || "?";
      const timeout = Math.max(10, Math.min(1800, args.timeout_seconds ?? 300));
      const changeTypes = args.change_types?.length ? ` · watching: ${args.change_types.join(", ")}` : " · watching: all";
      return new Text([
        theme.fg("toolTitle", theme.bold("channel_wait_for_state_change ")) + theme.fg("accent", slug),
        `  ${theme.fg("dim", `timeout: ${formatDuration(timeout)} · poll: 3s${changeTypes}`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const slug = details.slug ?? "?";
      const elapsed = formatDuration(details.elapsed_s ?? 0);
      const timeout = formatDuration(details.timeout_seconds ?? 300);
      const lines: string[] = [];

      if (details.status === "waiting") {
        lines.push(theme.fg("warning", `⏳ waiting for state change`));
        lines.push(`  ${theme.fg("accent", slug)} ${theme.fg("dim", `· elapsed: ${elapsed} · timeout: ${timeout}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "cancelled") {
        lines.push(theme.fg("warning", `⏸ local wait cancelled`));
        lines.push(`  ${theme.fg("accent", slug)} ${theme.fg("dim", `· elapsed: ${elapsed}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.trigger) {
        lines.push(theme.fg("success", `✓ state changed: ${details.trigger}`));
        lines.push(`  ${theme.fg("accent", slug)} ${theme.fg("dim", `· after ${elapsed}`)}`);
        if (expanded && details.changes) {
          for (const [type, diff] of Object.entries(details.changes as Record<string, any>)) {
            lines.push(`  ${theme.fg("dim", `${type}: ${JSON.stringify(diff)}`)}`);
          }
        }
        if (expanded && details.snapshot) {
          lines.push(`  ${theme.fg("dim", `members: ${summarizeMembers(details.snapshot)}`)}`);
          lines.push(`  ${theme.fg("dim", `hands: ${summarizeHands(details.snapshot)}`)}`);
        }
        return new Text(lines.join("\n"), 0, 0);
      }

      lines.push(theme.fg("warning", `⏳ no state change after ${elapsed}`));
      lines.push(`  ${theme.fg("accent", slug)} ${theme.fg("dim", `· timeout: ${timeout}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, signal, onUpdate) {
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

      let prev: ChannelState;
      try {
        prev = await readChannelState(slug);
      } catch (e: any) {
        throw new Error(`channel_wait_for_state_change: ${e.message}`);
      }

      const POLL_MS = 3000;
      const maxAttempts = Math.ceil((timeout * 1000) / POLL_MS);
      const meta = { slug, channel: slug, change_types: change_types ?? null, timeout_seconds: timeout };
      let latestElapsed = 0;
      onUpdate?.({ content: [{ type: "text", text: "waiting for state change..." }], details: { ...meta, status: "waiting", elapsed_s: latestElapsed } });

      try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await sleep(POLL_MS, signal);
          const elapsed = (attempt + 1) * (POLL_MS / 1000);
          latestElapsed = elapsed;
          onUpdate?.({ content: [{ type: "text", text: "waiting for state change..." }], details: { ...meta, status: "waiting", elapsed_s: elapsed } });
          try {
            throwIfAborted(signal);
            const curr = await readChannelState(slug);

            const changes: Record<string, any> = {};
            const filter = change_types ? new Set(change_types) : null;

            if (!filter || filter.has("member_joined")) {
              const prevIds = new Set(prev.members.filter(m => m.status === "present").map(m => m.entity));
              const currIds = new Set(curr.members.filter(m => m.status === "present").map(m => m.entity));
              const joined = [...currIds].filter(id => !prevIds.has(id));
              if (joined.length) changes.member_joined = joined;
            }
            if (!filter || filter.has("member_left")) {
              const prevIds = new Set(prev.members.filter(m => m.status === "present").map(m => m.entity));
              const currIds = new Set(curr.members.filter(m => m.status === "present").map(m => m.entity));
              const left = [...prevIds].filter(id => !currIds.has(id));
              if (left.length) changes.member_left = left;
            }
            if (!filter || filter.has("hand_raised")) {
              const prevHands = new Set(prev.raisedHands.map(h => h.entity));
              const currHands = new Set(curr.raisedHands.map(h => h.entity));
              const raised = [...currHands].filter(id => !prevHands.has(id));
              if (raised.length) changes.hand_raised = raised;
            }
            if (!filter || filter.has("hand_cleared")) {
              const prevHands = new Set(prev.raisedHands.map(h => h.entity));
              const currHands = new Set(curr.raisedHands.map(h => h.entity));
              const cleared = [...prevHands].filter(id => !currHands.has(id));
              if (cleared.length) changes.hand_cleared = cleared;
            }
            if (!filter || filter.has("floor_granted")) {
              if (curr.currentSpeaker && curr.currentSpeaker !== prev.currentSpeaker) {
                changes.floor_granted = { from: prev.currentSpeaker ?? null, to: curr.currentSpeaker };
              }
            }
            if (!filter || filter.has("channel_closed")) {
              if (curr.status === "closed" && prev.status !== "closed") {
                changes.channel_closed = true;
              }
            }
            const prevAp = prev.autoPassTimer;
            const currAp = curr.autoPassTimer;
            const prevArmed = prevAp?.armed ?? false;
            const currArmed = currAp?.armed ?? false;
            if (!filter || filter.has("auto_passed")) {
              if (currArmed && !prevArmed) {
                changes.auto_passed = { armed: true, secondsRemaining: currAp?.secondsRemaining ?? null };
              }
            }

            if (Object.keys(changes).length > 0) {
              const triggers = Object.keys(changes);
              return {
                content: [{ type: "text", text: `state changed: ${triggers.join(", ")} @ ${slug}` }],
                details: {
                  ...meta,
                  trigger: triggers[0],
                  triggers,
                  changes,
                  snapshot: buildStateSnapshot(slug, curr),
                  status: "state-change",
                  elapsed_s: elapsed,
                },
              };
            }

            prev = curr;
          } catch (err: any) {
            if (isAbortError(err)) throw err;
          }
        }
      } catch (err: any) {
        if (isAbortError(err)) {
          return {
            content: [{ type: "text", text: `wait cancelled — still watching ${slug}` }],
            details: { ...meta, status: "cancelled", interrupted: true, elapsed_s: latestElapsed },
          };
        }
        throw err;
      }

      return {
        content: [{ type: "text", text: `⏳ no state change after ${timeout}s in ${slug}` }],
        details: { ...meta, trigger: "timeout", status: "timeout", elapsed_s: timeout },
      };
    },
  });
}
