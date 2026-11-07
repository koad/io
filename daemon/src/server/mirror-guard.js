// server/mirror-guard.js — band-aid + instrument for Meteor 3's server-side DDP mirror.
//
// WHY THIS EXISTS
// The daemon mirrors remote kingdom collections through server-side
// `DDP.connect` + `new Mongo.Collection(name, { connection })` (see
// server/service-instances.js). Meteor's mirror store is strict: an upstream
// `changed`/`removed` for a document the local mirror does not hold throws
// (mongo/collection/methods_replication.js:192) inside the async write flush of
// ddp-client's `_performWritesServer`. Depending on which frame catches it, the
// app either logs `Exception in handling DDP message` and lives, or the
// rejection escapes and Node 22 exits 1.
//
// For a website that means a crash overlay. For the daemon it means the
// kingdom's single door is dark until someone notices — which is exactly what
// happened 2026-11-06 20:17 EST: ~3.5 hours down, no operator signal.
//
// Deaths on disk for this class of bug:
//   kingofalldata.com  2026-05-05, 2026-05-06
//   koad.live          2026-08-08 (x2), 2026-10-16 (2 caught + 1 fatal), 2026-10-27
//   daemon             2026-10-16 (x2), 2026-10-20 (x2), 2026-11-06
//
// The root fix is to stop mirroring (read REST into a cache) — filed as brief
// 2026-10-28-kill-the-server-side-ddp-mirrors. This is that brief's interim,
// third copy. Until the root fix lands: don't die, and leave a trail worth reading.
//
// WHAT THIS DOES
//   1. unhandledRejection guard — swallows ONLY the three mirror-desync messages.
//      Anything else keeps the old semantics (log + exit 1) so real bugs still crash.
//   2. console.error tap — Meteor's caught path ("Exception in handling DDP message")
//      is logged by ddp-client itself, so we detect it there and attach the same
//      context. Between 1 and 2, every desync now leaves a `[mirror-guard]` line.
//   3. Self-heal — a desync means the mirror is inconsistent. Force a DDP reconnect
//      (throttled) so ddp-client sets `_resetStores` (message_processors.js:36),
//      wipes the store and re-adds everything from a fresh subscription.
//   4. Instruments — timestamped connection status transitions, plus per-collection
//      doc counts captured at the moment of each desync.
//
// READING THE LOGS
//   grep '\[mirror-guard\]' logs/*.log
//   `STORE-DESYNC` — the throw, caught at source with the context that matters:
//                    bridge, collection, msg, _id, fields, how many docs the mirror
//                    held, whether that _id was present, and whether it landed
//                    inside the post-reset grace window.
//   `STORE-RESET`  — a mirror was wiped for a replay: bridge, collection, reset flag,
//                    batch size, and how many docs it held before the wipe.
//   `DESYNC`       — the crash we are band-aiding fired outside the store layer
//                    (source: rejection|caught|store)
//   `bridge ...`   — connection status + doc counts right then
//   `self-heal`    — the desyncing connection was reconnected (only that one, when
//                    we know which it was); the mirror is whole again after replay
//   `status ...`   — a bridge connection changed state (reconnect = desync weather)
//
// Every block is wrapped: an instrument must never be the reason the daemon dies.

const TAG = '[mirror-guard]';

// The three strict-store throws in mongo's replication layer. Same class of bug:
// the mirror and the upstream disagree about what it holds.
const DESYNC_MESSAGES = [
  'Expected to find a document already present for removed',
  'Expected not to find a document already present for an add',
  'Expected to find a document to change',
];

const HEAL_THROTTLE_MS = 5 * 60 * 1000; // no reconnect storms
const STATUS_POLL_MS = 30 * 1000;

const stats = {
  desyncs: 0,
  byRejection: 0,
  byMeteorCatch: 0,
  byStore: 0,
  heals: 0,
  firstAt: null,
  lastAt: null,
};

const nowIso = () => new Date().toISOString();

const messageOf = (err) => {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message || String(err);
};

const isDesync = (err) => {
  const hay = messageOf(err);
  return hay.length > 0 && DESYNC_MESSAGES.some((p) => hay.includes(p));
};

// Every bridge in service-instances.js is one DDP connection carrying one or more
// mirror collections. `koad.bridges` is published by that file (name → bridge);
// a bridge exposes `.conn` (the DDP connection), `.remoteInstance` (the
// koad.instance mirror) and `.mirrorCols` (mission mirrors created on demand).
//
// Any other server-side mirror can register itself on `koad.mirrorConnections`
// as `{ name, connection }` and it shows up here too.
const mirrorCollections = () => {
  const out = [];
  try {
    const bridges = (typeof koad !== 'undefined' && koad.bridges) || null;
    if (bridges && typeof bridges.forEach === 'function') {
      for (const [bridgeName, bridge] of bridges) {
        try {
          const conn = bridge && bridge.conn;
          if (!conn) continue;
          if (bridge.remoteInstance) {
            out.push({ bridgeName, conn, name: bridge.remoteInstance._name, coll: bridge.remoteInstance });
          }
          for (const coll of bridge.mirrorCols || []) {
            if (coll && coll._name) out.push({ bridgeName, conn, name: coll._name, coll });
          }
        } catch (err) {
          /* one bad bridge must not blind the instrument */
        }
      }
    }
  } catch (err) {
    /* koad not up yet */
  }
  return out;
};

const bridgeGroups = () => {
  const groups = new Map(); // DDP connection → [{ name, coll }]

  for (const entry of mirrorCollections()) {
    if (!groups.has(entry.conn)) groups.set(entry.conn, []);
    groups.get(entry.conn).push({ name: `${entry.bridgeName}.${entry.name}`, coll: entry.coll });
  }

  // Any mirror that lives outside koad.bridges (other packages, future bridges).
  try {
    const registered = (typeof koad !== 'undefined' && Array.isArray(koad.mirrorConnections))
      ? koad.mirrorConnections
      : [];
    for (const reg of registered) {
      try {
        const conn = reg && reg.connection;
        if (!conn) continue;
        if (!groups.has(conn)) groups.set(conn, []);
        const list = groups.get(conn);
        if (list.length === 0) list.push({ name: reg.name || 'registered', coll: null });
      } catch (err) {
        /* ditto */
      }
    }
  } catch (err) {
    /* ditto */
  }

  return groups;
};

// ── Store-level instrumentation — the part that makes the log worth reading ──
//
// Catching the rejection gives a stack made of ddp-client frames and nothing else:
// it does not name the collection, the document, or the message that disagreed.
// The throw itself happens in mongo's replication store
// (`wrappedStoreServer.update(msg)`, methods_replication.js:192), which ddp-client
// reaches through `conn._stores[name].update(msg)` (livedata_connection.js:1166).
// Wrapping that one method at source turns
//
//   Exception in handling DDP message: Error: Expected to find a document to change
//
// into
//
//   [mirror-guard] STORE-DESYNC bridge=control-tower collection=HarnessSessions
//                  msg=changed id=abc123 held=11 docPresent=false fields=signals,status
//
// and swallowing it there lets the REST of the batch apply (a rejection aborts the
// flush mid-way and silently drops every remaining message in it). The heal then
// refills whatever the mirror was missing.
const WRAPPED = Symbol('mirrorGuardStore');
const stats2 = { storeDesyncs: 0, resets: 0 };

const describeMsg = (msg) => {
  if (!msg || typeof msg !== 'object') return 'msg=? id=? ';
  const fields = msg.fields && typeof msg.fields === 'object' ? Object.keys(msg.fields).join(',') : '';
  return `msg=${msg.msg || '?'} id=${msg.id || '?'} fields=${fields}`;
};

const docPresent = async (coll, id) => {
  try {
    if (coll.findOneAsync) return !!(await coll.findOneAsync(id));
    return !!coll.findOne(id);
  } catch (err) {
    return '?';
  }
};

const countWrapped = () => {
  let total = 0;
  let wrapped = 0;
  for (const entry of mirrorCollections()) {
    total += 1;
    try {
      const store = entry.conn && entry.conn._stores && entry.conn._stores[entry.name];
      if (store && store[WRAPPED]) wrapped += 1;
    } catch (err) {
      /* best effort */
    }
  }
  return { total, wrapped };
};

const instrumentStores = () => {
  let wrapped = 0;
  for (const entry of mirrorCollections()) {
    try {
      const stores = entry.conn && entry.conn._stores;
      const store = stores && stores[entry.name];
      if (!store || typeof store.update !== 'function') continue;
      if (store[WRAPPED]) continue;

      const originalUpdate = store.update;
      store.update = async (msg) => {
        try {
          return await originalUpdate(msg);
        } catch (err) {
          if (!isDesync(err)) throw err;
          stats2.storeDesyncs += 1;
          let held = '?';
          let present = '?';
          try { held = await entry.coll.find().countAsync(); } catch (e) { /* best effort */ }
          present = await docPresent(entry.coll, msg && msg.id);
          const sinceReset = Date.now() - (lastResetAt.get(entry.conn) || 0);
          const duringReset = sinceReset < RESET_GRACE_MS;
          console.error(
            `${TAG} STORE-DESYNC bridge=${entry.bridgeName} collection=${entry.name} `
            + `${describeMsg(msg)} held=${held} docPresent=${present} duringReset=${duringReset} at ${nowIso()}`
          );
          // Inside the grace window the replay that follows the reset is the repair.
          // Healing there is what manufactured the 05:03:51 wave: heal -> reset ->
          // in-flight changes -> desync -> heal. Outside it, heal only this connection.
          report('store', err, duringReset ? { heal: false } : { conn: entry.conn }).catch(() => {});
          // Swallow: the document is gone for this message; the heal refills.
          return;
        }
      };

      // A store reset is the other half of the suspected mechanism: ddp-client wipes
      // the mirror before applying the batch that reset it. Logging the reset with the
      // batch size and pre-reset doc count proves or kills that theory next time.
      const originalBegin = store.beginUpdate;
      if (typeof originalBegin === 'function') {
        store.beginUpdate = async (batchSize, reset) => {
          try {
            if (reset) {
              stats2.resets += 1;
              lastResetAt.set(entry.conn, Date.now());
              let held = '?';
              try { held = await entry.coll.find().countAsync(); } catch (e) { /* best effort */ }
              console.error(`${TAG} STORE-RESET bridge=${entry.bridgeName} collection=${entry.name} reset=${String(reset)} batch=${batchSize} held=${held} at ${nowIso()}`);
            }
          } catch (e) { /* never let the instrument throw */ }
          return originalBegin(batchSize, reset);
        };
      }

      store[WRAPPED] = true;
      wrapped += 1;
    } catch (err) {
      console.error(`${TAG} instrument ${entry && entry.name} failed: ${messageOf(err)}`);
    }
  }
  return wrapped;
};

const statusOf = (conn) => {
  try {
    const s = conn.status();
    return (s && s.status) || String(s);
  } catch (err) {
    return 'unknown';
  }
};

const snapshot = async () => {
  const lines = [];
  let n = 0;
  for (const [conn, entries] of bridgeGroups()) {
    n += 1;
    const parts = [];
    for (const entry of entries) {
      if (!entry.coll) {
        parts.push(`${entry.name}(registered)`);
        continue;
      }
      let count = '?';
      try {
        count = await entry.coll.find().countAsync();
      } catch (err) {
        count = 'read-err';
      }
      parts.push(`${entry.name}=${count}`);
    }
    const bridgeName = entries.length && entries[0].name.split('.')[0];
    lines.push(`bridge ${bridgeName || `conn#${n}`} status=${statusOf(conn)} ${parts.join(' ')}`);
  }
  return lines.length ? lines : ['(no mirror connections registered yet)'];
};

const lastHeal = new WeakMap();
const healPending = new WeakSet();
const lastResetAt = new WeakMap();
// A store reset is followed by the replay that refills it. Desyncs that land inside
// that window are the replay catching up, not drift — healing them makes more of them.
const RESET_GRACE_MS = 10000;

// `targetConn` narrows the heal to the one connection that actually desynced. The
// first copy of this guard could not identify it and reconnected every mirror on
// every desync; measured here 2026-11-07 — one synthetic desync on control-tower
// reconnected all 8 connections, wiped 11 mirror collections, and manufactured 4
// fresh desyncs out of the in-flight traffic they disturbed.
const scheduleHeal = (source, targetConn) => {
  const targets = targetConn ? [targetConn] : [...bridgeGroups().keys()];
  for (const conn of targets) {
    const last = lastHeal.get(conn) || 0;
    if (healPending.has(conn)) continue;
    if (Date.now() - last < HEAL_THROTTLE_MS) continue;
    healPending.add(conn);
    // Let the in-flight write flush settle before tearing the connection down.
    Meteor.setTimeout(() => {
      healPending.delete(conn);
      lastHeal.set(conn, Date.now());
      stats.heals += 1;
      console.error(`${TAG} self-heal #${stats.heals} (${source}) at ${nowIso()} → reconnect; stores reset and re-add`);
      try {
        conn.disconnect();
        conn.reconnect();
      } catch (err) {
        console.error(`${TAG} self-heal failed: ${messageOf(err)}`);
      }
    }, 2000);
  }
};

let reporting = false;

const report = async (source, err, opts) => {
  if (reporting) return;
  reporting = true;
  try {
    stats.desyncs += 1;
    if (source === 'rejection') stats.byRejection += 1;
    else if (source === 'store') stats.byStore += 1;
    else stats.byMeteorCatch += 1;
    stats.lastAt = nowIso();
    if (!stats.firstAt) stats.firstAt = stats.lastAt;

    console.error(`${TAG} DESYNC (${source}) #${stats.desyncs} at ${stats.lastAt}: ${messageOf(err)}`);

    const stack = String((err && err.stack) || '')
      .split('\n')
      .slice(1, 5)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' | ');
    if (stack) console.error(`${TAG}   stack: ${stack}`);

    for (const line of await snapshot()) console.error(`${TAG}   ${line}`);

    if (!opts || opts.heal !== false) scheduleHeal(source, opts && opts.conn);
  } catch (err) {
    console.error(`${TAG} report failed: ${messageOf(err)}`);
  } finally {
    reporting = false;
  }
};

// 1. The crash we are band-aiding. Everything else keeps its old, fatal semantics.
process.on('unhandledRejection', (reason) => {
  if (isDesync(reason)) {
    report('rejection', reason).catch(() => {});
    return;
  }
  console.error(`${TAG} non-desync unhandled rejection — crash semantics preserved:`, reason);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 500);
});

// 2. Meteor catches some of these itself and logs them. Tap that path so both
//    outcomes leave the same trail.
const realConsoleError = console.error.bind(console);
console.error = (...args) => {
  try {
    if (!reporting) {
      const hay = args
        .map((a) => (typeof a === 'string' ? a : messageOf(a)))
        .join(' ');
      if (hay.includes('Exception in handling DDP message') && isDesync({ message: hay })) {
        report('meteor-caught', { message: 'caught by ddp-client: ' + messageOf(args.find((a) => typeof a === 'string') || '') }).catch(() => {});
      }
    }
  } catch (err) {
    /* never let the tap throw */
  }
  return realConsoleError(...args);
};

// 4. Connection status transitions — reconnects are exactly the weather the desync
//    lives in, so make them visible with timestamps.
const lastStatus = new WeakMap();

Meteor.startup(() => {
  try {
    // App files load alphabetically, so this file starts before
    // service-instances.js has created any bridge. Report the arming after the
    // bridge registry has had a beat to fill, otherwise the line reads
    // "0 mirror connections" and the baseline map stays empty.
    const arm = () => {
      const groups = bridgeGroups();
      const labels = [];
      for (const [conn, entries] of groups) {
        const label = `bridge[${entries.map((e) => e.name).join(',')}]`;
        labels.push(`${label}=${statusOf(conn)}`);
        lastStatus.set(conn, statusOf(conn));
      }
      const wrapped = instrumentStores();
      const cover = countWrapped();
      console.error(`${TAG} armed — ${groups.size} mirror connection(s), ${cover.wrapped}/${cover.total} store(s) instrumented (+${wrapped} just now): ${labels.join(' ') || '(none yet)'}`);
    };

    if (typeof koad !== 'undefined') {
      koad.mirrorGuard = {
        stats,
        stats2,
        arm,
        instrument: instrumentStores,
        snapshot: async () => (await snapshot()).forEach((line) => console.error(`${TAG} ${line}`)),
        heal: () => scheduleHeal('manual'),
      };
    }

    Meteor.setTimeout(arm, 2000);

    Meteor.setInterval(() => {
      let i = 0;
      // Mission mirrors are created when a service advertises them, which can be
      // long after arming — sweep for unwrapped stores on every tick.
      instrumentStores();
      for (const [conn, entries] of bridgeGroups()) {
        i += 1;
        const current = statusOf(conn);
        const previous = lastStatus.get(conn);
        // First sighting of a bridge is a baseline, not a transition.
        if (previous === undefined) {
          lastStatus.set(conn, current);
          continue;
        }
        if (previous !== current) {
          lastStatus.set(conn, current);
          const bridgeName = entries.length && entries[0].name.split('.')[0];
          console.error(`${TAG} status ${bridgeName || `conn#${i}`} ${previous} → ${current} at ${nowIso()}`);
        }
      }
    }, STATUS_POLL_MS);
  } catch (err) {
    console.error(`${TAG} arm failed: ${messageOf(err)}`);
  }
});
