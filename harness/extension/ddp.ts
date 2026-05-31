/**
 * koad-io DDP client — shared reactive WebSocket layer for koad:io daemon.
 *
 * Connects to the Meteor DDP endpoint, subscribes to publications, and
 * maintains local Minimongo-style collections. Emits typed events on every
 * added/changed/removed record so UI components can react immediately.
 *
 * Usage from any extension in the same directory:
 *   import { createDDPClient } from "./koad-io-ddp";
 *
 *   const ddp = createDDPClient();
 *   ddp.on("emission", (event, record) => { ... });
 *   ddp.on("bond",    (event, record) => { ... });
 *   ddp.on("health",  (health)         => { ... });
 *   ddp.connect();
 */

import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmissionRecord {
  _id:        string;
  entity?:    string;
  type?:      string;
  body?:      string;
  plan?:      string;
  status?:    string;
  startedAt?: string;
  updatedAt?: string;
  missionId?: string;
}

export interface BondRecord {
  _id:        string;
  from?:      string;
  to?:        string;
  type?:      string;
  status?:    string;
  createdAt?: string;
}

export interface FlightRecord {
  _id:               string;
  entity?:           string;
  briefSlug?:        string;
  briefSummary?:     string;
  status?:           string;
  host?:             string;
  model?:            string;
  started?:          string;
  ended?:            string;
  elapsed?:          number;
  completionSummary?:string;
  stats?:            Record<string, unknown>;
}

export interface SessionRecord {
  _id:        string;
  entity?:    string;
  sessionId?: string;
  status?:    string;
  host?:      string;
  model?:     string;
  lastSeen?:  string;
  startedAt?: string;
  endedAt?:   string;
}

export interface EntityRecord {
  _id:        string;
  handle?:    string;
  name?:      string;
  role?:      string;
  host?:      string;
  status?:    string;
  createdAt?: string;
}

export interface HealthSnapshot {
  daemon:       "ok" | "degraded" | "down";
  daemonReady:  boolean;
  daemonUptime: number;
  control:      "ok" | "degraded" | "down";
  controlReady: boolean;
  controlUptime: number;
}

export type DDPEvent = "added" | "changed" | "removed";

export interface DDPClientEvents {
  emission:    [event: DDPEvent, record: EmissionRecord];
  bond:        [event: DDPEvent, record: BondRecord];
  flight:      [event: DDPEvent, record: FlightRecord];
  session:     [event: DDPEvent, record: SessionRecord];
  entity:      [event: DDPEvent, record: EntityRecord];
  health:      [health: HealthSnapshot];
  connected:   [];
  disconnected:[];
}

// ---------------------------------------------------------------------------
// DDP message types
// ---------------------------------------------------------------------------

type DDPMessage =
  | { msg: "connected"; session: string }
  | { msg: "failed"; version?: string }
  | { msg: "added";    collection: string; id: string; fields?: Record<string, unknown> }
  | { msg: "changed";  collection: string; id: string; fields?: Record<string, unknown>; cleared?: string[] }
  | { msg: "removed";  collection: string; id: string }
  | { msg: "ready";    subs: string[] }
  | { msg: "nosub";    id: string; error?: { error: string } }
  | { msg: "pong";     id?: string }
  | { msg: "result";   id: string; result?: unknown; error?: unknown };

// ---------------------------------------------------------------------------
// DDP Client
// ---------------------------------------------------------------------------

export class DDPClient extends EventEmitter<DDPClientEvents> {
  private url:        string;
  private ws:         WebSocket | null = null;
  private session:    string | null = null;
  private nextId      = 1;
  private pendingSubs = new Map<string, { name: string; resolve: () => void; reject: (e: Error) => void }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer:      ReturnType<typeof setInterval>  | null = null;
  private _running        = false;

  // Subscription readiness — tracks which subs have received their 'ready' message.
  // An empty map means we haven't subscribed yet (not connected).
  // Keys = sub name, value = true when ready.
  private _subsReady = new Map<string, boolean>();
  private _subsTotal = 0;

  // Local reactive collections
  private emissions = new Map<string, EmissionRecord>();
  private bonds     = new Map<string, BondRecord>();
  private flights   = new Map<string, FlightRecord>();
  private sessions  = new Map<string, SessionRecord>();
  private entities  = new Map<string, EntityRecord>();
  private _health:  HealthSnapshot = {
    daemon: "down", daemonReady: false, daemonUptime: 0,
    control: "down", controlReady: false, controlUptime: 0,
  };

  constructor(url?: string) {
    super();
    const _ip = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
    this.url = url ?? (process.env.KOAD_IO_DAEMON_URL ?? `http://${_ip}:${process.env.KOAD_IO_PORT ?? "28282"}`)
      .replace(/^http/, "ws") + "/websocket";
  }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------

  get health()         { return { ...this._health }; }
  get flightCount()    { return this.emissions.size; }  // dashboard compat — was always emissions count
  get missionCount()   { return this.flights.size; }   // actual Flights collection count
  get bondCount()      { return this.bonds.size; }
  get sessionCount()   { return this.sessions.size; }
  get entityCount()    { return this.entities.size; }
  get flights()        { return Array.from(this.emissions.values()); }  // dashboard compat — was emissions
  get flightsList()    { return Array.from(this.flights.values()); }    // actual Flights records
  get sessionsList()   { return Array.from(this.sessions.values()); }
  get entitiesList()   { return Array.from(this.entities.values()); }
  get emissionsList()  { return Array.from(this.emissions.values()); }
  get bondsList()      { return Array.from(this.bonds.values()); }
  get isConnected()    { return this.ws?.readyState === WebSocket.OPEN; }

  /** True when all expected subscriptions have received their 'ready' message. */
  get isWarm(): boolean {
    if (this._subsTotal === 0) return false;
    return this._subsReady.size === this._subsTotal &&
      [...this._subsReady.values()].every(v => v === true);
  }

  /** Number of subscriptions that have received 'ready' out of total expected. */
  get warmProgress(): { ready: number; total: number } {
    const ready = [...this._subsReady.values()].filter(v => v).length;
    return { ready, total: this._subsTotal };
  }

  connect(): this {
    if (this._running) return this;
    this._running = true;
    this.doConnect();
    return this;
  }

  disconnect(): void {
    this._running = false;
    this.clearTimers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // -----------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------

  private doConnect(): void {
    if (!this._running) return;
    this.clearTimers();

    try {
      this.ws = new WebSocket(this.url);
    } catch (_) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.send({ msg: "connect", version: "1", support: ["1", "pre2", "pre1"] });
      this.startPing();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: DDPMessage = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch (_) {}
    };

    this.ws.onclose = () => {
      this.session = null;
      this.emit("disconnected");
      this.clearTimers();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire next
    };
  }

  private scheduleReconnect(): void {
    if (!this._running) return;
    this.reconnectTimer = setTimeout(() => this.doConnect(), 3000);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pingTimer)      { clearInterval(this.pingTimer);   this.pingTimer = null; }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ msg: "ping" });
      }
    }, 20_000);
  }

  // -----------------------------------------------------------------
  // DDP message handler
  // -----------------------------------------------------------------

  private handleMessage(msg: DDPMessage): void {
    switch (msg.msg) {
      case "connected":
        this.session = msg.session;
        this.emit("connected");
        this.subscribeAll();
        break;

      case "added":
        if (msg.collection === "emissions") this.onEmissionAdded(msg);
        else if (msg.collection === "bonds") this.onBondAdded(msg);
        else if (msg.collection === "Flights") this.onFlightAdded(msg);
        else if (msg.collection === "HarnessSessions") this.onSessionAdded(msg);
        else if (msg.collection === "Entities") this.onEntityAdded(msg);
        else if (msg.collection === "health") this.onHealthUpdate(msg.fields as any);
        break;

      case "changed":
        if (msg.collection === "emissions") this.onEmissionChanged(msg);
        else if (msg.collection === "bonds") this.onBondChanged(msg);
        else if (msg.collection === "Flights") this.onFlightChanged(msg);
        else if (msg.collection === "HarnessSessions") this.onSessionChanged(msg);
        else if (msg.collection === "Entities") this.onEntityChanged(msg);
        else if (msg.collection === "health") this.onHealthUpdate(msg.fields as any);
        break;

      case "removed":
        if (msg.collection === "emissions") this.onEmissionRemoved(msg);
        else if (msg.collection === "bonds") this.onBondRemoved(msg);
        else if (msg.collection === "Flights") this.onFlightRemoved(msg);
        else if (msg.collection === "HarnessSessions") this.onSessionRemoved(msg);
        else if (msg.collection === "Entities") this.onEntityRemoved(msg);
        break;

      case "ready":
        for (const subId of msg.subs) {
          const pending = this.pendingSubs.get(subId);
          if (pending) {
            this._subsReady.set(pending.name, true);
            pending.resolve();
            this.pendingSubs.delete(subId);
          }
        }
        break;

      case "nosub":
        const err = this.pendingSubs.get(msg.id);
        if (err) { err.reject(new Error(msg.error?.error ?? "subscription failed")); this.pendingSubs.delete(msg.id); }
        break;

      case "pong":
        break; // keepalive ack
    }
  }

  // -----------------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------------

  private async subscribeAll(): Promise<void> {
    try {
      await Promise.all([
        this.sub("emissions"),
        this.sub("bonds"),
        this.sub("health"),
        this.sub("flights.active"),
        this.sub("flights.recent"),
        this.sub("harnesses.active"),
        this.sub("harnesses.recent"),
        this.sub("entities"),
      ]);
    } catch (_) {}
  }

  private sub(name: string): Promise<void> {
    this._subsReady.set(name, false);
    this._subsTotal = this._subsReady.size;
    return new Promise((resolve, reject) => {
      const id = this.nextId();
      this.pendingSubs.set(id, { name, resolve, reject });
      this.send({ msg: "sub", id, name, params: [] });
    });
  }

  // -----------------------------------------------------------------
  // Collection handlers
  // -----------------------------------------------------------------

  private onEmissionAdded(msg: { id: string; fields?: Record<string, unknown> }): void {
    const record = msg.fields as EmissionRecord ?? {} as EmissionRecord;
    record._id = msg.id;
    this.emissions.set(msg.id, record);
    this.emit("emission", "added", record);
  }

  private onEmissionChanged(msg: { id: string; fields?: Record<string, unknown>; cleared?: string[] }): void {
    const existing = this.emissions.get(msg.id);
    if (!existing) return;
    if (msg.fields) Object.assign(existing, msg.fields);
    if (msg.cleared) for (const key of msg.cleared) delete (existing as any)[key];
    this.emit("emission", "changed", existing);
  }

  private onEmissionRemoved(msg: { id: string }): void {
    const record = this.emissions.get(msg.id);
    this.emissions.delete(msg.id);
    if (record) this.emit("emission", "removed", record);
  }

  private onBondAdded(msg: { id: string; fields?: Record<string, unknown> }): void {
    const record = msg.fields as BondRecord ?? {} as BondRecord;
    record._id = msg.id;
    this.bonds.set(msg.id, record);
    this.emit("bond", "added", record);
  }

  private onBondChanged(msg: { id: string; fields?: Record<string, unknown>; cleared?: string[] }): void {
    const existing = this.bonds.get(msg.id);
    if (!existing) return;
    if (msg.fields) Object.assign(existing, msg.fields);
    if (msg.cleared) for (const key of msg.cleared) delete (existing as any)[key];
    this.emit("bond", "changed", existing);
  }

  private onBondRemoved(msg: { id: string }): void {
    const record = this.bonds.get(msg.id);
    this.bonds.delete(msg.id);
    if (record) this.emit("bond", "removed", record);
  }

  // ── Flight handlers ──────────────────────────────────────

  private onFlightAdded(msg: { id: string; fields?: Record<string, unknown> }): void {
    const record = (msg.fields ?? {}) as FlightRecord;
    record._id = msg.id;
    this.flights.set(msg.id, record);
    this.emit("flight", "added", record);
  }

  private onFlightChanged(msg: { id: string; fields?: Record<string, unknown>; cleared?: string[] }): void {
    const existing = this.flights.get(msg.id);
    if (!existing) return;
    if (msg.fields) Object.assign(existing, msg.fields);
    if (msg.cleared) for (const key of msg.cleared) delete (existing as any)[key];
    this.emit("flight", "changed", existing);
  }

  private onFlightRemoved(msg: { id: string }): void {
    const record = this.flights.get(msg.id);
    this.flights.delete(msg.id);
    if (record) this.emit("flight", "removed", record);
  }

  // ── Session handlers ──────────────────────────────────────

  private onSessionAdded(msg: { id: string; fields?: Record<string, unknown> }): void {
    const record = (msg.fields ?? {}) as SessionRecord;
    record._id = msg.id;
    this.sessions.set(msg.id, record);
    this.emit("session", "added", record);
  }

  private onSessionChanged(msg: { id: string; fields?: Record<string, unknown>; cleared?: string[] }): void {
    const existing = this.sessions.get(msg.id);
    if (!existing) return;
    if (msg.fields) Object.assign(existing, msg.fields);
    if (msg.cleared) for (const key of msg.cleared) delete (existing as any)[key];
    this.emit("session", "changed", existing);
  }

  private onSessionRemoved(msg: { id: string }): void {
    const record = this.sessions.get(msg.id);
    this.sessions.delete(msg.id);
    if (record) this.emit("session", "removed", record);
  }

  // ── Entity handlers ───────────────────────────────────────

  private onEntityAdded(msg: { id: string; fields?: Record<string, unknown> }): void {
    const record = (msg.fields ?? {}) as EntityRecord;
    record._id = msg.id;
    this.entities.set(msg.id, record);
    this.emit("entity", "added", record);
  }

  private onEntityChanged(msg: { id: string; fields?: Record<string, unknown>; cleared?: string[] }): void {
    const existing = this.entities.get(msg.id);
    if (!existing) return;
    if (msg.fields) Object.assign(existing, msg.fields);
    if (msg.cleared) for (const key of msg.cleared) delete (existing as any)[key];
    this.emit("entity", "changed", existing);
  }

  private onEntityRemoved(msg: { id: string }): void {
    const record = this.entities.get(msg.id);
    this.entities.delete(msg.id);
    if (record) this.emit("entity", "removed", record);
  }

  // ── Health handler ────────────────────────────────────────

  private onHealthUpdate(fields: Record<string, unknown> | undefined): void {
    if (!fields) return;
    const h: any = fields;
    this._health = {
      daemon:       this.normalizeHealth(h.daemonStatus, h.daemonReady),
      daemonReady:  !!h.daemonReady,
      daemonUptime: Number(h.daemonUptimeS ?? h.daemonUptime ?? 0),
      control:      this.normalizeHealth(h.controlStatus, h.controlReady),
      controlReady: !!h.controlReady,
      controlUptime: Number(h.controlUptimeS ?? h.controlUptime ?? 0),
    };
    this.emit("health", this._health);
  }

  private normalizeHealth(status?: string, ready?: boolean): "ok" | "degraded" | "down" {
    if (!status && ready === undefined) return "down";
    if (status === "starting" || ready === false) return "degraded";
    if (status === "ok") return "ok";
    return "down";
  }

  // -----------------------------------------------------------------
  // Wire helpers
  // -----------------------------------------------------------------

  private nextIdStr(): string {
    return String(this.nextId++);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

// ---------------------------------------------------------------------------
// Factory (no singleton — supports multiple named connections)
// ---------------------------------------------------------------------------

let _shared: DDPClient | null = null;

export function createDDPClient(url?: string): DDPClient {
  const client = new DDPClient(url);
  if (!_shared) _shared = client;
  return client;
}

export function getDDP(): DDPClient | null {
  return _shared;
}
