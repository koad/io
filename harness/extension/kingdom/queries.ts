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

import type { DDPClient, FlightRecord, SessionRecord, EmissionRecord, BondRecord, EntityRecord } from "../ddp";

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
let _backendCheckedAt = 0;

async function checkLocal(): Promise<boolean> {
  // Re-check every 30s — control-tower may have restarted
  if (_backendChecked && (Date.now() - _backendCheckedAt) < 30000) return _isLocal;
  _backendChecked = true;
  _backendCheckedAt = Date.now();
  try {
    const ctrl = new URL("/api/questions?limit=1", CONTROL_URL.replace(/^http/, "http"));
    const res = await fetch(ctrl.toString(), { signal: AbortSignal.timeout(5000) });
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

    // If no filter (no id, entity, status, active_only, since), default to last 24h
    const hasFilter = filters.id || filters.entity || filters.status || filters.active_only || filters.since;
    if (!hasFilter) {
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      flights = flights.filter(f => (f.started || "") >= cutoff);
    }

    // Sort by started desc
    flights.sort((a, b) => String(b.started || "").localeCompare(String(a.started || "")));
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

    // Wait for DDP subscriptions to warm, then return what we have.
    await ddp.waitForWarm(5000);
    const warm = ddp.isWarm;

    return {
      results, count: results.length, backend,
      degraded: !warm,
      degraded_reason: warm ? undefined : `warming up — ${ddp.warmProgress.ready}/${ddp.warmProgress.total} subscriptions ready`,
    };
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

    if (!ddp.isWarm) {
      const { ready, total } = ddp.warmProgress;
      return { results, count: results.length, backend, degraded: true, degraded_reason: `warming up — ${ready}/${total} subscriptions ready` };
    }

    return { results, count: results.length, backend, degraded: false };
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
  mission_id?: string;
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

  if (local) {
    // Try control-tower REST first (daemon doesn't have an emissions REST endpoint)
    const params = new URLSearchParams();
    if (filters.entity) params.set("entity", filters.entity);
    if (filters.type) params.set("type", filters.type);
    params.set("limit", String(limit));

    const url = `${CONTROL_URL}/api/emissions?${params.toString()}`;
    const { ok, data } = await safeRestGet(url);

    if (ok && data && Array.isArray(data.emissions)) {
      let results: EmissionResult[] = data.emissions.map((e: any) => ({
        id: e._id || "?",
        entity: e.entity || "?",
        type: e.type || "?",
        body: e.body || "",
        status: e.status || undefined,
        started: e.timestamp || undefined,
        mission_id: e.meta?.missionId || e.mission_id || undefined,
      }));

      if (filters.since) results = results.filter(e => (e.started || "") >= (filters.since || ""));
      if (filters.active_only) results = results.filter(e => e.status === "open" || e.status === "active");

      return { results, count: results.length, backend, degraded: false };
    }

    // REST failed or returned no data — fall back to DDP
    if (ddp) {
      let emissions = ddp.emissionsList;
      if (filters.entity) emissions = emissions.filter(e => e.entity === filters.entity);
      if (filters.type) emissions = emissions.filter(e => e.type === filters.type);
      if (filters.since) emissions = emissions.filter(e => (e.startedAt || "") >= (filters.since || ""));
      emissions = emissions.slice(0, limit);
      const results: EmissionResult[] = emissions.map(e => ({
        id: e._id, entity: e.entity || "unknown", type: e.type || "unknown",
        body: e.body, status: e.status,
        started: e.startedAt, mission_id: (e as any).missionId,
      }));
      return { results, count: results.length, backend, degraded: !ddp.isWarm };
    }
  }

  return { results: [], count: 0, backend, degraded: true, degraded_reason: "no backend" };
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

    if (!ddp.isWarm) {
      const { ready, total } = ddp.warmProgress;
      return { results, count: results.length, backend, degraded: true, degraded_reason: `warming up — ${ready}/${total} subscriptions ready` };
    }

    return { results, count: results.length, backend, degraded: false };
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

  // ── Embedded: read JSONL directly ───────────────────────
  if (local) {
    const RUNTIME_PATH = process.env.KOAD_IO_RUNTIME_PATH || path.join(require("node:os").homedir(), ".local", "share", "koad-io", "runtime");
    const QUESTIONS_FILE = path.join(RUNTIME_PATH, "questions", "index.jsonl");
    let questions: any[] = [];
    try {
      const raw = require("node:fs").readFileSync(QUESTIONS_FILE, "utf-8");
      questions = raw.split("\n").filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    } catch {}

    // Filter
    if (filters.from) questions = questions.filter(q => q.from === filters.from);
    if (filters.to) questions = questions.filter(q => q.to === filters.to);
    if (filters.status) questions = questions.filter(q => q.status === filters.status);
    if (filters.id) questions = questions.filter(q => q._id === filters.id);

    // Sort newest first
    questions.sort((a, b) => (b.filed || "").localeCompare(a.filed || ""));
    questions = questions.slice(0, limit);

    const results: QuestionResult[] = questions.map((q: any) => ({
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

      return { results, count: results.length, backend, degraded: false, source: "filesystem" };
    }

    // No results — not an error, just empty
    return { results: [], count: 0, backend, degraded: false, source: "filesystem" };
  }

  // ── Remote/DDP — attempt REST anyway (may be reachable) ──
  // Soft-degrade: try the control-tower REST with a shorter timeout.
  // If it fails, degrade honestly rather than returning a hollow placeholder.
  {
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

      let filtered = results;
      if (filters.id) filtered = results.filter(r => r.id === filters.id);

      return { results: filtered, count: filtered.length, backend, degraded: false };
    }

    // REST unreachable in remote mode — honest degradation
    return { results: [], count: 0, backend, degraded: true, degraded_reason: data?.error || "control-tower unreachable from remote" };
  }
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

    if (!ddp.isWarm) {
      const { ready, total } = ddp.warmProgress;
      return { results, count: results.length, backend, degraded: true, degraded_reason: `warming up — ${ready}/${total} subscriptions ready` };
    }

    return { results, count: results.length, backend, degraded: false };
  }

  return { results: [], count: 0, backend, degraded: true, degraded_reason: "no DDP connection" };
}
