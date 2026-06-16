// koad-io channel tools — shared helpers, parameter schemas, registration.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatDurationSeconds as formatDuration } from "../../utils/tool-render";
import type { ChannelState, TurnRecord } from "../../channels/client";

// ---------------------------------------------------------------------------
// Shared helpers (used by tool executions)
// ---------------------------------------------------------------------------

export function buildStateSnapshot(slug: string, state: ChannelState) {
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

export function summarizeMembers(state: ChannelState, max = 4): string {
  const present = state.members.filter(m => m.status === "present").map(m => m.entity);
  if (present.length === 0) return "none";
  const shown = present.slice(0, max).join(", ");
  const extra = present.length > max ? ` +${present.length - max}` : "";
  return `${shown}${extra}`;
}

export function summarizeHands(state: ChannelState, max = 4): string {
  if (state.raisedHands.length === 0) return "none";
  const shown = state.raisedHands.slice(0, max).map(h => h.entity).join(", ");
  const extra = state.raisedHands.length > max ? ` +${state.raisedHands.length - max}` : "";
  return `${shown}${extra}`;
}

export function summarizeLatestTurn(turns: Array<{ entity: string; body: string; turnId: string }>): string | null {
  if (!turns?.length) return null;
  const last = turns[turns.length - 1];
  return `${last.entity}: ${last.body} (${last.turnId})`;
}

export function isAbortError(err: any): boolean {
  return err?.name === "AbortError" || err?.code === "ABORT_ERR";
}

export function abortError(): Error {
  const err = new Error("aborted");
  (err as any).name = "AbortError";
  return err;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

export const WaitForCueParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  entity: Type.String({ description: "Entity handle (caller self-declares)." }),
  keepalive_interval: Type.Optional(Type.Number({ description: "Seconds before timeout cue if no event. Default 300. Clamped to [60, 1800].", default: 300 })),
  transport: Type.Optional(Type.String({ description: '"sse" or "poll" (default "poll"). SSE confirms open stream and returns immediately; poll blocks until cue arrives.', default: "poll" })),
});

export const RaiseHandParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  entity: Type.String({ description: "Entity handle." }),
  intent: Type.Optional(Type.String({ description: "Optional short label (e.g. \"question\", \"concern\")." })),
});

export const ChannelLeaveParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  entity: Type.String({ description: "Entity handle." }),
  reason: Type.Optional(Type.String({ description: "Optional reason for leaving." })),
});

export const ChannelStateReadParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  turns_from: Type.Optional(Type.Number({ description: "Read turns from this offset. Default shows last 20." })),
});

export const ChannelCueDeliverParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  entity: Type.String({ description: "Entity to grant the floor to." }),
  juno_note: Type.Optional(Type.String({ description: "Optional context delivered in the cue." })),
});

export const ChannelBroadcastParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  reason: Type.Optional(Type.String({ description: "Optional reason for audit." })),
});

export const ChannelWaitForNextTurnParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  since_turn_id: Type.Optional(Type.String({ description: "Wait for turns strictly after this turnId. If omitted, captures current count and blocks until it increases." })),
  timeout_seconds: Type.Optional(Type.Number({ description: "Seconds before returning with trigger='timeout'. Default 300. Clamped to [10, 1800].", default: 300 })),
});

export const ChannelWaitForStateChangeParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  change_types: Type.Optional(Type.Array(Type.String(), { description: "Subset of change types to wait for. Default: all. Valid: member_joined, member_left, hand_raised, hand_cleared, floor_granted, channel_closed, auto_passed." })),
  timeout_seconds: Type.Optional(Type.Number({ description: "Seconds before returning with trigger='timeout'. Default 300. Clamped to [10, 1800].", default: 300 })),
});

export const ChannelEventFireParams = Type.Object({
  slug: Type.String({ description: "Channel slug." }),
  event_type: Type.Optional(Type.String({ description: "Event type: new-event, channel-closed, member_joined, member_left. Default new-event.", default: "new-event" })),
  entity: Type.Optional(Type.String({ description: "Entity that appended the turn." })),
  addressee: Type.Optional(Type.String({ description: "Optional: entity to pass the floor to (conch-pass)." })),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

import { registerCueTools } from "./cues";
import { registerPollTools } from "./polls";
import { registerChannelActions } from "./actions";

const backendReady = !!process.env.KOAD_IO_CHANNEL_BACKEND;
export { backendReady };

export function registerChannelTools(pi: ExtensionAPI): void {
  registerCueTools(pi);
  registerPollTools(pi);
  registerChannelActions(pi);
}
