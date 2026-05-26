/**
 * koad-io channel HTTP client — talks to the channel service.
 *
 * Currently targets the daemon (port 28282) as the planned channel runtime host.
 * Endpoints are TBD pending Vulcan building the channel API there.
 * Falls back to dance-hall URL if DAEMON_URL is unavailable.
 *
 * Endpoints:
 *   GET  /api/channels/:slug/state             — full channel state
 *   POST /api/channels/:slug/cue/deliver       — deliver targeted cue
 *   POST /api/channels/:slug/cue/broadcast     — broadcast to all
 *   POST /api/channels/:slug/hand              — raise hand
 *   GET  /api/channels/:slug/turns?since=      — poll for new turns
 *   GET  /api/channels/:slug/cue/:entity/poll  — poll for cue delivery
 */

// Control-tower is the forge plane — hosts channel endpoints
const CHANNEL_BASE =
  (process.env.KOAD_IO_CONTROL_URL ?? "http://10.10.10.10:28283");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChannelState {
  channel: string;
  status: string;
  mode?: string;
  topic?: string;
  members: MemberRecord[];
  raisedHands: HandRecord[];
  recentTurns: TurnRecord[];
  turnCount: number;
  pendingWaits: string[];
  sseStreams?: Record<string, { openedAt: string; lastFrameAt: string; lastAckAt: string }>;
  autoPassTimer?: { armed: boolean; oldestHandRaisedAt: string | null; secondsRemaining: number | null; timeoutSeconds: number };
  grantPending?: { entity: string; grantedAt: string } | null;
}

export interface MemberRecord {
  entity: string;
  status: "present" | "absent";
  joinedAt?: string;
  lastCueAt?: string;
}

export interface HandRecord {
  entity: string;
  channel: string;
  raisedAt: string;
  intent?: string;
}

export interface TurnRecord {
  ts: string;
  entity: string;
  role?: string;
  body: string;
  turnId: string;
  meta?: Record<string, unknown>;
}

export interface Cue {
  trigger: string;
  channel: string;
  deliveredAt: string;
  newTurns: TurnRecord[];
  newTurnCount: number;
  offsetAtCue?: number;
  queuedHands: string[];
  yourPosition: number | null;
  yourTurn: boolean;
  junoNote?: string;
  stream_active?: boolean;
}

export interface ChannelFile {
  slug: string;
  status: string;
  mode?: string;
  topic?: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function get(path: string): Promise<any> {
  const res = await fetch(`${CHANNEL_BASE}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`channel GET ${path}: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function post(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${CHANNEL_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `channel POST ${path}: HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Channel file index — channels are listed in ~/.channels/index.jsonl
// ---------------------------------------------------------------------------

export async function channelExists(slug: string): Promise<boolean> {
  try {
    const data = await get(`/api/channels/${encodeURIComponent(slug)}/state`);
    return !!data;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// State read
// ---------------------------------------------------------------------------

export async function readChannelState(slug: string, turnsFrom?: number): Promise<ChannelState> {
  const qs = turnsFrom !== undefined ? `?turns_from=${turnsFrom}` : "";
  return get(`/api/channels/${encodeURIComponent(slug)}/state${qs}`);
}

// ---------------------------------------------------------------------------
// Hand queue
// ---------------------------------------------------------------------------

export async function raiseHand(slug: string, entity: string, intent?: string): Promise<{ acknowledged: boolean; queuePosition: number; queueLength: number }> {
  return post(`/api/channels/${encodeURIComponent(slug)}/hand`, { entity, intent });
}

// ---------------------------------------------------------------------------
// Cue delivery — poll-based (for entities not using SSE)
// ---------------------------------------------------------------------------

export async function pollForCue(slug: string, entity: string): Promise<Cue | null> {
  try {
    return get(`/api/channels/${encodeURIComponent(slug)}/cue/${encodeURIComponent(entity)}/poll`);
  } catch (e: any) {
    if (e.message?.includes("404")) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Cue delivery — moderator grants floor
// ---------------------------------------------------------------------------

export async function deliverCue(slug: string, entity: string, junoNote?: string): Promise<{ delivered: boolean }> {
  return post(`/api/channels/${encodeURIComponent(slug)}/cue/deliver`, {
    entity,
    ...(junoNote ? { juno_note: junoNote } : {}),
  });
}

// ---------------------------------------------------------------------------
// Broadcast to all members
// ---------------------------------------------------------------------------

export async function broadcastCue(slug: string, reason?: string): Promise<{ broadcast: boolean; memberCount: number }> {
  return post(`/api/channels/${encodeURIComponent(slug)}/cue/broadcast`, { reason });
}

// ---------------------------------------------------------------------------
// Turn polling — for channel_wait_for_next_turn
// ---------------------------------------------------------------------------

export async function readTurnsSince(slug: string, sinceTurnId?: string, sinceCount?: number): Promise<{ turns: TurnRecord[]; currentCount: number }> {
  const params = new URLSearchParams();
  if (sinceTurnId) params.set("since_turn_id", sinceTurnId);
  if (sinceCount !== undefined) params.set("since_count", String(sinceCount));
  return get(`/api/channels/${encodeURIComponent(slug)}/turns?${params}`);
}

// ---------------------------------------------------------------------------
// Leave channel
// ---------------------------------------------------------------------------

export async function leaveChannel(slug: string, entity: string, reason?: string): Promise<{ left: boolean }> {
  return post(`/api/channels/${encodeURIComponent(slug)}/leave`, { entity, reason });
}

// ---------------------------------------------------------------------------
// Event fire (internal — called after turn append)
// ---------------------------------------------------------------------------

export async function fireChannelEvent(slug: string, eventType?: string, entity?: string, addressee?: string): Promise<any> {
  return post(`/api/channels/${encodeURIComponent(slug)}/event`, {
    event_type: eventType ?? "new-event",
    entity,
    addressee,
  });
}
