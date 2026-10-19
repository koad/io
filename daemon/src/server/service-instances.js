// server/service-instances.js — Kingdom service mesh connector
//
// The daemon watches the runtime service registry
// (~/.local/share/koad-io/runtime/services.jsonl) and DDP-connects to every
// Meteor service in it:
//
//   • koad.instance — core's instance-awareness publication. Each service
//     publishes its own live health snapshot (registered item counts,
//     readiness, eventLoop, gc, identity) → koad.indexes.instances.
//   • dispatches / sessions / conversations — mission stores, bridged from
//     services whose instance doc advertises matching health items
//     (control-tower registers flights/sessions/conversations) →
//     koad.indexes.flights / .sessions / .conversations.
//
// Both are re-published to browsers, so the daemon is the single door for
// kingdom awareness: entities, passengers, bonds, keys, every service's live
// state, and missions. Down services get an offline doc; DDP auto-reconnects
// and re-subscribes, so the mesh heals itself.
//
// Registry-driven: any service in services.jsonl is picked up automatically;
// any service advertising flight/session/conversation items gets mission
// bridging. No hardcoded upstreams — same shape as the entities package's
// remote mode, but for the whole kingdom.

const fs = Npm.require('fs');
const path = Npm.require('path');
import { WebApp } from 'meteor/webapp';

const BIND_IP       = process.env.KOAD_IO_BIND_IP || '10.10.10.10';
const SELF_PORT     = parseInt(process.env.KOAD_IO_PORT || '28282', 10);
const RUNTIME_DIR   = process.env.KOAD_IO_RUNTIME_PATH || path.join(process.env.HOME || '/home/koad', '.local/share/koad-io/runtime');
const SERVICES_FILE = path.join(RUNTIME_DIR, 'services.jsonl');

const HEARTBEAT_MS = 10000;

// Mission publication per advertised health item name.
const MISSION_PUB_BY_ITEM = {
  flights:       'dispatches',
  sessions:      'sessions',
  conversations: 'conversations',
};

// Remote collection names for those publications (what control-tower's pubs return).
const MISSION_REMOTE_COLLECTION = {
  dispatches:     'HarnessDispatches',
  sessions:       'HarnessSessions',
  conversations:  'HarnessConversations',
};

// Local in-memory stores — the daemon is connection:null everywhere.
// (collection name 'harnessSessions' avoids core's ApplicationSessions 'sessions'.)
koad.indexes.instances     = new Mongo.Collection('instances',      { connection: null });
koad.indexes.flights       = new Mongo.Collection('flights',        { connection: null });
koad.indexes.sessions      = new Mongo.Collection('harnessSessions',{ connection: null });
koad.indexes.conversations = new Mongo.Collection('conversations',  { connection: null });

const bridges = new Map(); // service name → bridge
let watcher = null;
let rescanTimer = null;

// ── Readiness signalers (mirror entities/server/remote.js) ────────────────
const readySignals = { instances: null, missions: null };

function makeSignaler(key) {
  let remaining = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    koad.ready.signal(key);
  };
  return {
    expect(n) { remaining += n; },
    oneDone() { remaining = Math.max(0, remaining - 1); if (remaining === 0) finish(); },
    timeout(ms) { Meteor.setTimeout(finish, ms); },
  };
}

// ── Registry ──────────────────────────────────────────────────────────────

function readServices() {
  try {
    if (!fs.existsSync(SERVICES_FILE)) return [];
    return fs.readFileSync(SERVICES_FILE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (err) {
    log.warn(`[service-instances] cannot read ${SERVICES_FILE}: ${err.message}`);
    return [];
  }
}

function isSelf(entry) {
  return entry.port === SELF_PORT || entry.name === 'daemon';
}

// ── Helpers ───────────────────────────────────────────────────────────────

function connStatus(conn) {
  try {
    const st = conn.status();
    if (st.connected) return 'online';
    if (st.status === 'failed' || st.status === 'offline' || st.retryCount > 2) return 'offline';
    return 'connecting';
  } catch (e) {
    return 'offline';
  }
}

function upsertLocal(col, selector, doc) {
  const mod = { $set: doc };
  const isLocal = !col._connection; // connection:null → in-memory LocalCollection
  try {
    if (isLocal) {
      // In-memory collection — the sync upsert runs atomically in the event
      // loop. The async variants on LocalCollection race (find → insert) and
      // throw MinimongoError Duplicate _id when the heartbeat and syncInstance
      // write the same doc concurrently.
      return col.upsert(selector, mod);
    }
    if (typeof col.upsertAsync === 'function') return col.upsertAsync(selector, mod);
    if (typeof col.updateAsync === 'function') return col.updateAsync(selector, mod, { upsert: true });
    return col.upsert(selector, mod);
  } catch (err) {
    // Raced insert — retry as a plain update (the doc exists by now).
    if (String(err.message).includes('Duplicate')) {
      try { col.update(selector, mod); return; } catch (e2) { /* fall through */ }
    }
    log.error(`[service-instances] upsert failed on ${col._name}: ${err.message}`);
    return null;
  }
}

function removeLocal(col, selector) {
  try {
    if (typeof col.removeAsync === 'function') return col.removeAsync(selector);
    return col.remove(selector);
  } catch (err) {
    log.error(`[service-instances] remove failed on ${col._name}: ${err.message}`);
    return null;
  }
}

// ── Instance bridging ─────────────────────────────────────────────────────

function syncInstance(bridge, remoteDoc) {
  // Cross-app guard: services sharing a mongo write their instanceHealth doc
  // into the SAME collection with _id 'self' — the last writer stomps, and
  // every app's koad.instance pub broadcasts whoever's doc is there. Only
  // sync a doc whose identity belongs to THIS bridge (match by port); skip
  // the rest so identity doesn't flip between sibling services.
  const rid = remoteDoc && remoteDoc.identity;
  if (rid && rid.port && bridge.entry.port && rid.port !== bridge.entry.port) {
    log.debug(`[service-instances] ${bridge.entry.name}: skipping foreign identity (port ${rid.port})`);
    return;
  }
  const st = connStatus(bridge.conn);
  const doc = {
    _id: bridge.entry.name,
    name: bridge.entry.name,
    port: bridge.entry.port,
    datadir: bridge.entry.datadir || null,
    url: bridge.url,
    status: st,
    identity: remoteDoc.identity || null,
    health: remoteDoc.health || null,
    time: remoteDoc.time || new Date().toISOString(),
    connectedAt: bridge.connectedAt || new Date(),
    lastSeen: new Date(),
    lastError: bridge.lastError || null,
  };
  upsertLocal(koad.indexes.instances, { _id: bridge.entry.name }, doc);
  maybeBridgeMissions(bridge, remoteDoc);
}

function maybeBridgeMissions(bridge, remoteDoc) {
  const items = (remoteDoc && remoteDoc.health && remoteDoc.health.items) || [];
  for (const item of Object.keys(MISSION_PUB_BY_ITEM)) {
    if (bridge.missions.has(item)) continue;     // already bridged
    if (!items.includes(item)) continue;         // service doesn't advertise it
    bridgeMission(bridge, item, MISSION_PUB_BY_ITEM[item], MISSION_REMOTE_COLLECTION[MISSION_PUB_BY_ITEM[item]]);
  }
}

function bridgeMission(bridge, itemName, pubName, remoteColName) {
  bridge.missions.add(itemName);
  const localCol = itemName === 'flights'       ? koad.indexes.flights
                 : itemName === 'sessions'      ? koad.indexes.sessions
                 : koad.indexes.conversations;

  let remoteCol;
  try {
    remoteCol = new Mongo.Collection(remoteColName, { connection: bridge.conn });
  } catch (err) {
    log.error(`[service-instances] ${bridge.entry.name}: cannot create remote col ${remoteColName}: ${err.message}`);
    if (readySignals.missions) readySignals.missions.oneDone();
    return;
  }

  let observing = false;
  let counted = false;
  const countOnce = () => {
    if (!counted) { counted = true; if (readySignals.missions) readySignals.missions.oneDone(); }
  };

  const startObserving = () => {
    if (observing) return;
    observing = true;
    try {
      bridge.observers.push(remoteCol.find().observe({
        added:   (doc) => syncMission(localCol, doc, bridge),
        changed: (doc) => syncMission(localCol, doc, bridge),
        removed: (doc) => removeLocal(localCol, { _id: doc._id }),
      }));
      // Catch any docs that arrived before the observer attached.
      remoteCol.find().fetch().forEach((doc) => syncMission(localCol, doc, bridge));
    } catch (err) {
      log.error(`[service-instances] ${bridge.entry.name}: observe ${pubName} failed: ${err.message}`);
    }
  };

  bridge.conn.subscribe(pubName, {
    onReady: () => {
      log.success(`[service-instances] ${bridge.entry.name}: ${pubName} sub ready`);
      startObserving();
      countOnce();
    },
    onError: (err) => {
      bridge.lastError = err.reason || err.message;
      log.warn(`[service-instances] ${bridge.entry.name}: ${pubName} sub error — ${bridge.lastError}`);
      countOnce();
    },
  });

  // Safety: if the sub never answers, count the attempt so readiness isn't blocked.
  Meteor.setTimeout(countOnce, 15000);
}

// ── Signal window ─────────────────────────────────────────────────────────
//
// A session doc carries its full signal history: one live session measured at
// 1,298 signals / 346KB inside a 369KB doc, and 94% of all session payload is
// signals. Because signals live in a single array field, every appended signal
// makes Meteor re-send the WHOLE array in one `changed`, and the browser must
// deep-clone the whole doc to apply it — measured at ~11ms per write, versus
// ~0.02ms for a small collection.
//
// The mirror therefore keeps only the most recent SIGNAL_WINDOW signals and
// reports the exact total in `signalCount`, so count-driven consumers stay
// truthful while the payload stays bounded. Full transcripts remain the
// property of control-tower and the SessionArchive.
const SIGNAL_WINDOW = parseInt(process.env.KOAD_IO_SIGNAL_WINDOW || '50', 10);

function shapeSessionForMirror(doc) {
  if (!doc || !Array.isArray(doc.signals)) return doc;
  const copy = Object.assign({}, doc);
  copy.signalCount = doc.signals.length;
  if (copy.signals.length > SIGNAL_WINDOW) {
    copy.signals = copy.signals.slice(-SIGNAL_WINDOW);
  }
  return copy;
}

function syncMission(localCol, doc, bridge) {
  const copy = Object.assign({}, shapeSessionForMirror(doc));
  copy.sourceService = bridge.entry.name;
  copy.sourceUrl = bridge.url;
  upsertLocal(localCol, { _id: doc._id }, copy);
}

// ── Bridge lifecycle ──────────────────────────────────────────────────────

function bridgeOne(entry) {
  // Cross-device: entries may carry a `host` (e.g. a lighthouse on citadel,
  // 10.10.10.100). Default is this machine's BIND_IP.
  const url = `http://${entry.host || BIND_IP}:${entry.port}`;
  const conn = DDP.connect(url);

  const bridge = {
    entry,
    url,
    conn,
    remoteInstance: new Mongo.Collection('instanceHealth', { connection: conn }),
    missions: new Set(),        // item names bridged
    observers: [],
    connectedAt: null,
    lastError: null,
  };
  bridges.set(entry.name, bridge);

  log.success(`[service-instances] connecting to ${entry.name} at ${url}`);

  let observingInstance = false;
  let counted = false;
  const countOnce = () => {
    if (!counted) { counted = true; if (readySignals.instances) readySignals.instances.oneDone(); }
  };

  const startObservingInstance = () => {
    if (observingInstance) return;
    observingInstance = true;
    try {
      bridge.observers.push(bridge.remoteInstance.find().observe({
        added:   (doc) => syncInstance(bridge, doc),
        changed: (doc) => syncInstance(bridge, doc),
        removed: () => { /* service gone — heartbeat marks offline */ },
      }));
      bridge.remoteInstance.find().fetch().forEach((doc) => syncInstance(bridge, doc));
    } catch (err) {
      log.error(`[service-instances] ${entry.name}: observe koad.instance failed: ${err.message}`);
    }
  };

  bridge.conn.subscribe('koad.instance', {
    onReady: () => {
      bridge.connectedAt = bridge.connectedAt || new Date();
      log.success(`[service-instances] ${entry.name}: koad.instance sub ready`);
      startObservingInstance();
      countOnce();
    },
    onError: (err) => {
      bridge.lastError = err.reason || err.message;
      log.warn(`[service-instances] ${entry.name}: koad.instance sub error — ${bridge.lastError}`);
      countOnce();
    },
  });

  // Safety: if the sub never becomes ready (service down), still count the
  // attempt so readiness isn't blocked forever.
  Meteor.setTimeout(countOnce, 15000);

  return bridge;
}

function teardownBridge(bridge) {
  try {
    bridge.observers.forEach((o) => { try { o.stop(); } catch (e) {} });
    bridge.observers = [];
    try { bridge.conn.close(); } catch (e) {}
    log.debug(`[service-instances] tore down bridge for ${bridge.entry.name}`);
  } catch (err) { /* ignore */ }
}

// ── Registry watching ─────────────────────────────────────────────────────

function rescan() {
  const entries = readServices().filter((e) => !isSelf(e));
  const seen = new Set();

  for (const entry of entries) {
    seen.add(entry.name);
    const existing = bridges.get(entry.name);
    if (existing) {
      if (existing.entry.port === entry.port && existing.entry.datadir === entry.datadir) continue; // unchanged
      teardownBridge(existing);
      bridges.delete(entry.name);
    }
    bridgeOne(entry);
    if (readySignals.instances) readySignals.instances.expect(1);
  }

  // Services that left the registry — tear down and drop their docs.
  for (const [name, bridge] of Array.from(bridges)) {
    if (!seen.has(name)) {
      teardownBridge(bridge);
      bridges.delete(name);
      removeLocal(koad.indexes.instances, { _id: name });
      removeLocal(koad.indexes.flights,       { sourceService: name });
      removeLocal(koad.indexes.sessions,      { sourceService: name });
      removeLocal(koad.indexes.conversations, { sourceService: name });
    }
  }
}

function scheduleRescan() {
  if (rescanTimer) Meteor.clearTimeout(rescanTimer);
  rescanTimer = Meteor.setTimeout(rescan, 500); // debounce rapid writes
}

function watchRegistry() {
  try {
    if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    watcher = fs.watch(RUNTIME_DIR, (eventType, filename) => {
      if (filename && String(filename).includes('services.jsonl')) scheduleRescan();
    });
    watcher.on('error', (err) => log.warn(`[service-instances] registry watcher error: ${err.message}`));
  } catch (err) {
    log.warn(`[service-instances] cannot watch ${RUNTIME_DIR}: ${err.message}`);
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────

function heartbeat() {
  const now = new Date();
  for (const [name, bridge] of bridges) {
    const st = connStatus(bridge.conn);
    let existing = {};
    try { existing = koad.indexes.instances.findOne(name) || {}; } catch (e) { /* ignore */ }
    const doc = {
      _id: name,
      name,
      port: bridge.entry.port,
      datadir: bridge.entry.datadir || null,
      url: bridge.url,
      status: st,
      identity: existing.identity || null,
      health: existing.health || null,
      time: existing.time || now.toISOString(),
      connectedAt: bridge.connectedAt || existing.connectedAt || null,
      lastSeen: now,
      lastError: st === 'online' ? null : (bridge.lastError || 'connection not established'),
    };
    upsertLocal(koad.indexes.instances, { _id: name }, doc);
  }
}

// ── Startup ───────────────────────────────────────────────────────────────

Meteor.startup(() => {
  // Health items — the daemon reports the mesh as its own index surface,
  // so /api/health and the /api/* aliases answer on the single door.
  koad.healthRegistry.register('instances', {
    collection: koad.indexes.instances,
    readyKey: 'instances',
    description: 'Service instances (DDP mesh from services.jsonl)',
    sortField: 'name',
    sortOrder: 1,
  });
  for (const [item, desc] of [
    ['flights',       'Flights (bridged from service dispatches)'],
    ['sessions',      'Harness sessions (bridged)'],
    ['conversations', 'Conversations (bridged)'],
  ]) {
    koad.healthRegistry.register(item, {
      collection: koad.indexes[item],
      readyKey: 'missions',
      description: desc,
    });
  }

  readySignals.instances = makeSignaler('instances');
  readySignals.missions  = makeSignaler('missions');

  rescan();
  watchRegistry();
  Meteor.setInterval(heartbeat, HEARTBEAT_MS);

  // Readiness safety: if a service never answers, don't block consumers forever.
  const n = bridges.size;
  readySignals.instances.timeout(Math.max(n * 15000, 30000));
  readySignals.missions.timeout(Math.max(n * 15000, 30000));
});

// ── Single-door publications ──────────────────────────────────────────────
// Browsers subscribe here — the daemon serves the whole kingdom.

Meteor.publish('instances', async function () {
  await koad.ready.await('instances');
  return koad.indexes.instances.find();
});

Meteor.publish('flights', async function () {
  await koad.ready.await('missions');
  return koad.indexes.flights.find();
});

// Alias matching control-tower's publication name — consumers that used to
// subscribe 'dispatches' on control-tower can point at the daemon unchanged.
Meteor.publish('dispatches', async function () {
  await koad.ready.await('missions');
  return koad.indexes.flights.find();
});

Meteor.publish('sessions', async function () {
  await koad.ready.await('missions');
  return koad.indexes.sessions.find();
});

Meteor.publish('conversations', async function () {
  await koad.ready.await('missions');
  return koad.indexes.conversations.find();
});

// ── Control proxy — daemon signals process-control events through lighthouses ──
//
// POST /api/control/:action   { service: "<name>" }   action ∈ restart | stop
//
// Routes: find the service in the registry → its host → the lighthouse on
// that host → POST to the lighthouse's /api/service/<action> → return its log.
// Wonderland-local services (no lighthouse on their host) get a clear 409.

const controlApp = WebApp.connectHandlers;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
  });
}

// The lighthouse that controls a given host — a registry entry whose name
// marks it as a lighthouse and whose host matches the service's host.
function lighthouseForHost(host) {
  return readServices().find((e) =>
    String(e.name).toLowerCase().includes('lighthouse') &&
    (e.host || BIND_IP) === host
  );
}

controlApp.use('/api/control', async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  };

  const parts = (req.url || '').split('?')[0].split('/').filter(Boolean);
  // connect strips the mount prefix — action is the LAST path part
  const action = parts[parts.length - 1]; // /api/control/<action>
  if (!['restart', 'stop'].includes(action)) {
    return send(400, { error: `unsupported control action: ${action || '(none)'}` });
  }

  let body = {};
  try { body = await readJsonBody(req); }
  catch (e) { return send(400, { error: e.message }); }

  const serviceName = body.service;
  if (!serviceName) return send(400, { error: 'service name required' });

  const svc = readServices().find((e) => e.name === serviceName);
  if (!svc) return send(404, { error: `service "${serviceName}" not in registry` });

  const host = svc.host || BIND_IP;
  const lighthouse = lighthouseForHost(host);
  if (!lighthouse) {
    return send(409, { error: `no lighthouse on ${host} — control unavailable for "${serviceName}"` });
  }

  const url = `http://${lighthouse.host || BIND_IP}:${lighthouse.port}/api/service/${action}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: serviceName }),
      timeout: 90000,
    });
    const data = await resp.json();
    send(200, { ok: true, via: url, ...data });
  } catch (e) {
    send(502, { error: `lighthouse ${url} unreachable: ${e.message}` });
  }
});

log.success('daemon control proxy ready (restart|stop → lighthouse)');


// ── Shutdown cleanup ──────────────────────────────────────────────────────

const cleanup = () => {
  for (const bridge of bridges.values()) teardownBridge(bridge);
  try { if (watcher) watcher.close(); } catch (e) {}
};
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

log.success('loaded daemon/service-instances');
