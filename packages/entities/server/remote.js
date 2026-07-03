// server/remote.js — Remote mode: DDP subscribe + vanity endpoint proxy.
//
// When KOAD_IO_ENTITY_REMOTE is set (comma-separated list of upstream URLs):
//   1. DDP-connect to each upstream
//   2. Subscribe to entity publications from each
//   3. Observe → sync into koad.library.{entities,kingdoms,bonds}
//   4. Proxy vanity URLs (/.png, /.json, /.keys, /.atom) to the entity's
//      home upstream (resolved from source.url on the entity record).
//
// Upstreams are opaque — they may be daemons, musium instances, or any
// DDP endpoint that publishes entity collections. The package doesn't
// assume what's on the other end.
//
// Activated only when EntityPackage.isRemote === true.

if (!EntityPackage || !EntityPackage.isRemote) {
  return; // Not in remote mode — this file is a no-op
}

const http  = Npm.require('http');
const https = Npm.require('https');
const url   = Npm.require('url');

// Downstream indexers (koad:io-daemon-indexers) read EntityScanner.Entities.
// In remote mode, we point it at koad.library.entities — the DDP-synced
// collection populated by the observe loops below.
EntityScanner = { Entities: koad.library.entities };

const REMOTE_LIST = EntityPackage.remoteList;

// ── DDP subscription — one connection per upstream ────────────────────────

// Track connections + observers so we can close on shutdown
const _connections = [];

Meteor.startup(() => {
  koad.ready.register('entities');

  let readyCount = 0;
  const total = REMOTE_LIST.length;

  for (const remoteUrl of REMOTE_LIST) {
    bridgeOneUpstream(remoteUrl, () => {
      readyCount++;
      if (readyCount >= total) {
        log.debug(`entities remote: all ${total} upstream(s) ready — ${koad.library.entities.find().count()} entities`);
        koad.ready.signal('entities');
        globalThis.indexerReady = globalThis.indexerReady || {};
        globalThis.indexerReady.entities = new Date().toISOString();
      }
    });
  }

  // Safety: signal readiness even if all daemons timeout
  Meteor.setTimeout(() => {
    if (!globalThis.indexerReady || !globalThis.indexerReady.entities) {
      log.warn('entities remote: timeout waiting for upstreams — signalling ready with partial data');
      koad.ready.signal('entities');
      globalThis.indexerReady = globalThis.indexerReady || {};
      globalThis.indexerReady.entities = new Date().toISOString();
    }
  }, Math.max(total * 15000, 30000));
});

function bridgeOneUpstream(remoteUrl, onReady) {
  log.debug(`entities remote: connecting to ${remoteUrl}`);

  let conn;
  try {
    conn = DDP.connect(remoteUrl);
  } catch (e) {
    log.error(`entities remote: DDP.connect failed for ${remoteUrl} — ${e.message}`);
    onReady();
    return;
  }

  _connections.push(conn);

  const RemoteEntities = new Mongo.Collection('entities', { connection: conn });
  const RemoteKingdoms = new Mongo.Collection('kingdoms', { connection: conn });
  const RemoteBonds    = new Mongo.Collection('bonds',    { connection: conn });
  const RemoteKeys     = new Mongo.Collection('keys',     { connection: conn });
  const RemoteAlerts   = new Mongo.Collection('alerts',   { connection: conn });
  const RemoteEnv      = new Mongo.Collection('env',      { connection: conn });

  let subReady = false;
  const observers = [];

  const sub = conn.subscribe('entities', {
    onReady: () => {
      log.debug(`entities remote: ${remoteUrl} entities subscription ready`);
      subReady = true;
    },
    onError: (err) => {
      log.error(`entities remote: ${remoteUrl} entities sub error — ${err.reason || err.message}`);
    },
  });

  // Additional entity-data subs — keys, env, alerts. Graceful degradation.
  for (const pubName of ['keys', 'env', 'alerts', 'bonds']) {
    conn.subscribe(pubName, {
      onReady: () => log.debug(`entities remote: ${remoteUrl} ${pubName} sub ready`),
      onError: (err) => log.warn(`entities remote: ${remoteUrl} ${pubName} sub error — ${err.message}`),
    });
  }

  // Timeout safety per upstream
  Meteor.setTimeout(() => {
    if (!subReady) {
      log.warn(`entities remote: ${remoteUrl} subscription timed out`);
      // Start observing anyway — data may trickle in
      startObserving();
      onReady();
    }
  }, 15000);

  function startObserving() {
    observers.push(RemoteEntities.find().observe({
      added:   (doc) => { try {
        doc.source = appendOriginToSource(doc.source);  // add our hop to the chain
        koad.library.entities.upsert({ _id: doc._id }, doc);
      } catch(e) {} },
      changed: (doc) => { try {
        doc.source = appendOriginToSource(doc.source);
        koad.library.entities.upsert({ _id: doc._id }, doc);
      } catch(e) {} },
      removed: (doc) => {
        // Only remove if this upstream was the source. If another upstream
        // also claims this entity, removing from one shouldn't delete.
        const existing = koad.library.entities.findOne(doc._id);
        if (existing && existing.source && existing.source.url === remoteUrl) {
          try { koad.library.entities.remove(doc._id); } catch(e) {}
        }
      },
    }));

    observers.push(RemoteKingdoms.find().observe({
      added:   (doc) => { try { koad.library.kingdoms.upsert({ _id: doc._id }, doc); } catch(e) {} },
      changed: (doc) => { try { koad.library.kingdoms.upsert({ _id: doc._id }, doc); } catch(e) {} },
      removed: (doc) => { try { koad.library.kingdoms.remove(doc._id); } catch(e) {} },
    }));

    observers.push(RemoteBonds.find().observe({
      added:   (doc) => { try { koad.library.bonds.upsert({ _id: doc._id }, doc); } catch(e) {} },
      changed: (doc) => { try { koad.library.bonds.upsert({ _id: doc._id }, doc); } catch(e) {} },
      removed: (doc) => { try { koad.library.bonds.remove(doc._id); } catch(e) {} },
    }));

    observers.push(RemoteKeys.find().observe({
      added:   (doc) => { try { koad.library.keys.upsert({ _id: doc._id }, doc); } catch(e) {} },
      changed: (doc) => { try { koad.library.keys.upsert({ _id: doc._id }, doc); } catch(e) {} },
      removed: (doc) => { try { koad.library.keys.remove(doc._id); } catch(e) {} },
    }));

    observers.push(RemoteAlerts.find().observe({
      added:   (doc) => { try { koad.library.alerts.upsert({ _id: doc._id }, doc); } catch(e) {} },
      changed: (doc) => { try { koad.library.alerts.upsert({ _id: doc._id }, doc); } catch(e) {} },
      removed: (doc) => { try { koad.library.alerts.remove(doc._id); } catch(e) {} },
    }));

    observers.push(RemoteEnv.find().observe({
      added:   (doc) => { try { koad.library.env.upsert({ _id: doc._id }, doc); } catch(e) {} },
      changed: (doc) => { try { koad.library.env.upsert({ _id: doc._id }, doc); } catch(e) {} },
      removed: (doc) => { try { koad.library.env.remove(doc._id); } catch(e) {} },
    }));
  }

  // Wait for subscription, then observe
  const checkInterval = Meteor.setInterval(() => {
    if (subReady) {
      Meteor.clearInterval(checkInterval);
      startObserving();
      log.debug(`entities remote: ${remoteUrl} — ${koad.library.entities.find().count()} total entities`);
      onReady();
    }
  }, 200);
}

// ── Vanity endpoint proxy ─────────────────────────────────────────────────
// Routes to the entity's home upstream (from source.url), falling back
// to the first remote if no entity match.

const VANITY_RE = /^\/([a-z][a-z0-9_-]{0,30})\.(png|json|keys|atom)$/;

WebApp.handlers.use((req, res, next) => {
  if (req.method !== 'GET') return next();

  const pathname = req.url.split('?')[0];
  const m = VANITY_RE.exec(pathname);
  if (!m) return next();

  const handle = m[1];
  const ext = m[2];

  // JSON is served locally from the library record (includes source chain).
  // Binary/file endpoints (png, keys, atom) proxy upstream to source[0].url.
  if (ext === 'json') return next();

  // Resolve the entity's home upstream from source[0].url (first hop = disk truth)
  let proxyBase = null;
  try {
    const entity = koad.library.entities.findOne({ handle });
    if (entity && Array.isArray(entity.source) && entity.source[0] && entity.source[0].url) {
      proxyBase = entity.source[0].url;
    }
  } catch (e) { /* collection may not be ready yet */ }

  if (!proxyBase) {
    // Fallback: use the first remote upstream
    proxyBase = REMOTE_LIST[0];
  }

  const proxyTarget = proxyBase.replace(/\/$/, '') + req.url;
  const getter = proxyTarget.startsWith('https') ? https.get : http.get;

  log.debug(`entities proxy: ${req.url} → ${proxyTarget} (home: ${proxyBase})`);

  getter(proxyTarget, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  }).on('error', (err) => {
    log.error(`entities proxy error for ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });
});

log.debug(`entities remote: proxy middleware registered (${REMOTE_LIST.length} upstream(s))`);

// ── Shutdown cleanup ──────────────────────────────────────────────────────

const cleanup = () => {
  _connections.forEach(c => { try { c.close(); } catch(e) {} });
};
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// ── Publications ──────────────────────────────────────────────────────────
// Serve koad.library.entities to clients (same shape as scanner publications,
// same publication names — consumers don't know which mode they're in).

Meteor.publish('entities', async function () {
  await koad.ready.await('entities');
  return koad.library.entities.find();
});

Meteor.publish('entities.byRole', async function (role) {
  check(role, String);
  await koad.ready.await('entities');
  return koad.library.entities.find({ role });
});

Meteor.publish('bonds', async function () {
  await koad.ready.await('entities');
  return koad.library.bonds.find();
});

Meteor.publish('keys', async function () {
  await koad.ready.await('entities');
  return koad.library.keys.find();
});
