/**
 * Semantic kingdom query layer — dual-backend (embedded direct / gated DDP).
 *
 * All query functions return a consistent result schema regardless of backend:
 *   { results: T[], count: number, backend: "embedded"|"ddp", degraded: boolean, degraded_reason?: string }
 *
 * Backend cascade:
 *   - Embedded: direct REST to control-tower (questions) + daemon REST (bonds)
 *               + DDP-reactive collections (flights, sessions, emissions, entities)
 *   - Remote:   gated DDP only (no REST fallback)
 */

import type { DDPClient, FlightRecord, SessionRecord, EmissionRecord, BondRecord, EntityRecord } from "./ddp";

const DAEMON_URL = process.env.KOAD_IO_DAEMON_URL || `http://${process.env.KOAD_IO_BIND_IP || "10.10.10.10"}:${process.env.KOAD_IO_PORT || "28282"}`;
const CONTROL_URL = process.env.KOAD_IO_CONTROL_URL || `http://${process.env.KOAD_IO_BIND_IP || "10.10.10.10"}:${process.env.KOAD_IO_CONTROL_PORT || "28283"}`;

// ---------------------------------------------------------------------------
// Common result envelope
// ---------------------------------------------------------------------------

export interface QueryResult<T> {
  results: T[];
  count: number;
  backend: "embedded" | "ddp";
  degraded: boolean;
  degraded_reason?: string;
}

// ---------------------------------------------------------------------------
// Backend detection — can we reach control-tower locally?
// ---------------------------------------------------------------------------

let _backendChecked = false;
let _isLocal = false;

async function checkLocal(): Promise<boolean> {
  if (_backendChecked) return _isLocal;
  _backendChecked = true;
  try {
    const ctrl = new URL("/api/questions?limit=1", CONTROL_URL.replace(/^http/, "http"));
    const res = await fetch(ctrl.toString(), { signal: AbortSignal.timeout(2000) });
    _isLocal = res.ok || res.status === 503; // 503 = PgSessions not ready, still reachable
    return _isLocal;
  } catch {
    _isLocal = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

async function restGet(url: string, timeoutMs = 5000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`REST ${res.status}: ${res.statusText}`);
  return res.json();
}

async function safeRestGet(url: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const data = await restGet(url);
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ===================================================================
// MISSION QUERY
// ===================================================================

export interface MissionResult {
  id: string;
  entity: string;
  status: string;           // flying | landed | stale
  shape: string;            // "flight" (others later)
  brief_slug: string;
  brief_summary: string;
  started: string;
  ended?: string;
  elapsed?: number;
  completion_summary?: string;
  model?: string;
  host?: string;
  stats?: Record<string, unknown>;
}

export interface MissionFilters {
  id?: string;
  entity?: string;
  status?: string;          // flying | landed | stale
  active_only?: boolean;
  shape?: string;
  limit?: number;
  since?: string;           // ISO timestamp
}

export async function missionQuery(
  ddp: DDPClient | null,
  filters: MissionFilters = {}
): Promise<QueryResult<MissionResult>> {
  const local = await checkLocal();
  const backend = local ? "embedded" : "ddp";
  const limit = filters.limit || 50;

  // ── Embedded path ──────────────────────────────────────────
  if (local && ddp) {
    let flights = ddp.flightsList;

    // Apply filters
    if (filters.id) flights = flights.filter(f => f._id === filters.id);
    if (filters.entity) flights = flights.filter(f => f.entity === filters.entity);
    if (filters.status) flights = flights.filter(f => f.status === filters.status);
    if (filters.active_only) flights = flights.filter(f => f.status === "flying");
    if (filters.since) flights = flights.filter(f => (f.started || "") >= filters.since);

    // Sort by started desc
    flights.sort((a, b) => (b.started || "").localeCompare(a.started || ""));
    flights = flights.slice(0, limit);

    const results: MissionResult[] = flights.map(f => ({
      id: f._id,
      entity: f.entity || "unknown",
      status: f.status || "unknown",
      shape: "flight",
      brief_slug: f.briefSlug || "",
      brief_summary: f.briefSummary || "",
      started: f.started || "",
      ended: f.ended || undefined,
      elapsed: f.elapsed || undefined,
      completion_summary: f.completionSummary || undefined,
      model: f.model || undefined,
      host: f.host || undefined,
      stats: f.stats || undefined,
    }));

    return { results, count: results.length, backend, degraded: false };
  }

  // ── Remote/DDP path ────────────────────────────────────────
  if (ddp) {
    let flights = ddp.flightsList;

    if (filters.id) flights = flights.filter(f => f._id === filters.id);
    if (filters.entity) flights = flights.filter(f => f.entity === filters.entity);
    if (filters.status) flights = flights.filter(f => f.status === filters.status);
    if (filters.active_only) flights = flights.filter(f => f.status === "flying");
    if (filters.since) flights = flights.filter(f => (f.started || "") >= filters.since);

    flights.sort((a, b) => (b.started || "").localeCompare(a.started || ""));
    flights = flights.slice(0, limit);

    const results: MissionResult[] = flights.map(f => ({
      id: f._id,
      entity: f.entity || "unknown",
      status: f.status || "unknown",
      shape: "flight",
      brief_slug: f.briefSlug || "",
      brief_summary: f.briefSummary || "",
      started: f.started || "",
      ended: f.ended || undefined,
      elapsed: f.elapsed || undefined,
      completion_summary: f.completionSummary || undefined,
      model: f.model || undefined,
      host: f.host || undefined,
      stats: f.stats || undefined,
    }));

    return { results, count: results.length, backend, degraded: flights.length === 0 };
  }

  // ── No backend ─────────────────────────────────────────────
  return { results: [], count: 0, backend, degraded: true, degraded_reason: "no DDP connection" };
}

// ===================================================================
// SESSION QUERY
// ===================================================================

export interface SessionResult {
  id: string;
  entity: string;
  status: string;           // active | stale
  host?: string;
  model?: string;
  last_seen?: string;
  started?: string;
  ended?: string;
}

export interface SessionFilters {
  id?: string;
  entity?: string;
  active_only?: boolean;
  limit?: number;
}

export async function sessionQuery(
  ddp: DDPClient | null,
  filters: SessionFilters = {}
): Promise<QueryResult<SessionResult>> {
  const local = await checkLocal();
  const backend = local ? "embedded" : "ddp";
  const limit = filters.limit || 50;

  if (ddp) {
    let sessions = ddp.sessionsList;

    if (filters.id) sessions = sessions.filter(s => s._id === filters.id || s.sessionId === filters.id);
    if (filters.entity) sessions = sessions.filter(s => s.entity === filters.entity);
    if (filters.active_only) {
      const cutoff = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      sessions = sessions.filter(s => (s.lastSeen || "") >= cutoff);
    }

    sessions.sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
    sessions = sessions.slice(0, limit);

    const results: SessionResult[] = sessions.map(s => ({
      id: s._id || s.sessionId || "unknown",
      entity: s.entity || "unknown",
      status: ((s.lastSeen || "") >= new Date(Date.now() - 2 * 3600 * 1000).toISOString()) ? "active" : "stale",
      host: s.host || undefined,
      model: s.model || undefined,
      last_seen: s.lastSeen || undefined,
      started: s.startedAt || undefined,
      ended: s.endedAt || undefined,
    }));

    return { results, count: results.length, backend, degraded: sessions.length === 0 };
  }

  return { results: [], count: 0, backend, degraded: true, degraded_reason: "no DDP connection" };
}

// ===================================================================
// EMISSION QUERY
// ===================================================================

export interface EmissionResult {
  id: string;
  entity: string;
  type: string;
  body?: string;
  status?: string;
  started?: string;
  updated?: string;
}

export interface EmissionFilters {
  id?: string;
  entity?: string;
  type?: string;
  status?: string;
  mission_id?: string;
  limit?: number;
  since?: string;
  active_only?: boolean;
}

export async function emissionQuery(
  ddp: DDPClient | null,
  filters: EmissionFilters = {}
): Promise<QueryResult<EmissionResult>> {
  const local = await checkLocal();
  const backend = local ? "embedded" : "ddp";
  const limit = filters.limit || 50;

  if (ddp) {
    let emissions = ddp.emissionsList;

    if (filters.id) emissions = emissions.filter(e => e._id === filters.id);
    if (filters.entity) emissions = emissions.filter(e => e.entity === filters.entity);
    if (filters.type) emissions = emissions.filter(e => e.type === filters.type);
    if (filters.status) emissions = emissions.filter(e => e.status === filters.status);
    if (filters.active_only) emissions = emissions.filter(e => e.status === "open" || e.status === "active");
    if (filters.since) emissions = emissions.filter(e => (e.startedAt || "") >= filters.since);

    emissions.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
    emissions = emissions.slice(0, limit);

    const results: EmissionResult[] = emissions.map(e => ({
      id: e._id,
      entity: e.entity || "unknown",
      type: e.type || "unknown",
      body: e.body || undefined,
      status: e.status || undefined,
      started: e.startedAt || undefined,
      updated: e.updatedAt || undefined,
    }));

    return { results, count: results.length, backend, degraded: emissions.length === 0 };
  }

  return { results: [], count: 0, backend, degraded: true, degraded_reason: "no DDP connection" };
}

// ===================================================================
// BOND QUERY
// ===================================================================

export interface BondResult {
  id: string;
  from: string;
  to: string;
  type: string;
  status: string;
  signed: boolean;
  created?: string;
  visibility?: string;
}

export interface BondFilters {
  id?: string;
  entity?: string;          // filter bonds where entity is "from" or "to"
  from?: string;
  to?: string;
  type?: string;
  status?: string;          // ACTIVE | REVOKED
  limit?: number;
}

export async function bondQuery(
  ddp: DDPClient | null,
  filters: BondFilters = {}
): Promise<QueryResult<BondResult>> {
  const local = await checkLocal();
  const backend = local ? "embedded" : "ddp";
  const limit = filters.limit || 50;

  // ── Embedded: try daemon REST first (richer bond data) ─────
  if (local) {
    const entityParam = filters.entity ? `?entity=${filters.entity}` : "";
    const url = `${DAEMON_URL}/api/bonds${entityParam}`;
    const { ok, data } = await safeRestGet(url);

    if (ok && data && Array.isArray(data.bonds)) {
      // daemon returns bonds grouped by handle: { handle, bonds: [...] }
      let allBonds: any[] = [];
      for (const group of data.bonds) {
        for (const bond of group.bonds || []) {
          allBonds.push({ ...bond, handle: group.handle });
        }
      }

      // Filter (REST doesn't support all filters server-side)
      if (filters.from) allBonds = allBonds.filter(b => b.from === filters.from);
      if (filters.to) allBonds = allBonds.filter(b => b.to === filters.to);
      if (filters.type) allBonds = allBonds.filter(b => b.type === filters.type);
      if (filters.status) allBonds = allBonds.filter(b => b.status === filters.status);
      if (filters.id) allBonds = allBonds.filter(b => b.file === filters.id || b.base === filters.id);

      allBonds = allBonds.slice(0, limit);

      const results: BondResult[] = allBonds.map(b => ({
        id: b.base || b.file || "unknown",
        from: b.from || "unknown",
        to: b.to || "unknown",
        type: b.type || "unknown",
        status: b.status || "unknown",
        signed: !!b.signed,
        created: b.created || undefined,
        visibility: b.visibility || undefined,
      }));

      return { results, count: results.length, backend, degraded: false };
    }
  }

  // ── DDP fallback ───────────────────────────────────────────
  if (ddp) {
    let bonds = ddp.bondsList;

    if (filters.from) bonds = bonds.filter(b => b.from === filters.from);
    if (filters.to) bonds = bonds.filter(b => b.to === filters.to);
    if (filters.type) bonds = bonds.filter(b => b.type === filters.type);
    if (filters.status) bonds = bonds.filter(b => b.status === filters.status);
    if (filters.id) bonds = bonds.filter(b => b._id === filters.id);

    bonds = bonds.slice(0, limit);

    const results: BondResult[] = bonds.map(b => ({
      id: b._id,
      from: b.from || "unknown",
      to: b.to || "unknown",
      type: b.type || "unknown",
      status: b.status || "unknown",
      signed: false, // DDP doesn't expose signed field
      created: b.createdAt || undefined,
    }));

    return { results, count: results.length, backend, degraded: bonds.length === 0 };
  }

  return { results: [], count: 0, backend, degraded: true, degraded_reason: "no backend available" };
}

// ===================================================================
// QUESTION QUERY
// ===================================================================

export interface QuestionResult {
  id: string;
  from: string;
  to: string;
  question: string;
  status: string;           // open | answered | cancelled | resumed
  answer?: string;
  answered_by?: string;
  answered_at?: string;
  filed?: string;
  workdir?: string;
  context_ref?: string;
  options?: string[];
}

export interface QuestionFilters {
  id?: string;
  from?: string;
  to?: string;
  status?: string;
  limit?: number;
}

export async function questionQuery(
  _ddp: DDPClient | null,
  filters: QuestionFilters = {}
): Promise<QueryResult<QuestionResult>> {
  const local = await checkLocal();
  const backend = local ? "embedded" : "ddp";
  const limit = filters.limit || 50;

  // ── Embedded: control-tower REST ──────────────────────────
  if (local) {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.status) params.set("status", filters.status);
    params.set("limit", String(limit));

    const url = `${CONTROL_URL}/api/questions?${params.toString()}`;
    const { ok, data } = await safeRestGet(url);

    if (ok && data && Array.isArray(data.questions)) {
      const results: QuestionResult[] = data.questions.map((q: any) => ({
        id: q._id || "unknown",
        from: q.from || "unknown",
        to: q.to || "unknown",
        question: q.question || "",
        status: q.status || "unknown",
        answer: q.answer || undefined,
        answered_by: q.answered_by || undefined,
        answered_at: q.answered_at || undefined,
        filed: q.filed || undefined,
        workdir: q.workdir || undefined,
        context_ref: q.context_ref || undefined,
        options: q.options || undefined,
      }));

      // Client-side filtering for id
      let filtered = results;
      if (filters.id) filtered = results.filter(r => r.id === filters.id);

      return { results: filtered, count: filtered.length, backend, degraded: false };
    }

    // 503 or other error — degraded but not failing
    return { results: [], count: 0, backend, degraded: true, degraded_reason: data?.error || "control-tower unreachable" };
  }

  // ── Remote/DDP — not yet wired ────────────────────────────
  return { results: [], count: 0, backend, degraded: true, degraded_reason: "question_query requires embedded mode (control-tower REST)" };
}

// ===================================================================
// ENTITY QUERY (optional)
// ===================================================================

export interface EntityResult {
  id: string;
  handle: string;
  name?: string;
  role?: string;
  host?: string;
  status?: string;
  bond_count?: number;
}

export interface EntityFilters {
  id?: string;
  handle?: string;
  limit?: number;
}

export async function entityQuery(
  ddp: DDPClient | null,
  filters: EntityFilters = {}
): Promise<QueryResult<EntityResult>> {
  const local = await checkLocal();
  const backend = local ? "embedded" : "ddp";
  const limit = filters.limit || 50;

  if (ddp) {
    let entities = ddp.entitiesList;

    if (filters.handle) entities = entities.filter(e => e.handle === filters.handle);
    if (filters.id) entities = entities.filter(e => e._id === filters.id);

    entities = entities.slice(0, limit);

    const results: EntityResult[] = entities.map(e => ({
      id: e._id,
      handle: e.handle || "unknown",
      name: e.name || undefined,
      role: e.role || undefined,
      host: e.host || undefined,
      status: e.status || undefined,
    }));

    return { results, count: results.length, backend, degraded: entities.length === 0 };
  }

  return { results: [], count: 0, backend, degraded: true, degraded_reason: "no DDP connection" };
}
