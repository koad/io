// Flight scanner — always on
// Watches ~/.<entity>/control/flights/*.json across all entities
// Syncs disk flight records into the in-memory Flights collection
// so the overview dashboard and DDP subscribers see real data.

const fs = Npm.require('fs');
const path = Npm.require('path');
const os = Npm.require('os');

// Hard time threshold — any flying flight older than this is stale, no questions.
const HARD_STALE_MS = 2 * 3600 * 1000; // 2 hours
// Grace period before we start trusting the pid-dead signal. The opener bash
// exits within milliseconds of flight-open, so pid-dead is meaningless in the
// first few minutes. After the grace period, pid-dead is a strong signal.
const PID_GRACE_MS = 5 * 60 * 1000; // 5 minutes

const watchers = new Map();

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function readFlightJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Trust the on-disk status. The pid in the record is the shell that ran
// `juno control flight open` — it exits immediately, so pid-based stale
// detection gives false positives. Time-based stale check runs separately
// in the periodic sweep.
function deriveStatus(record) {
  if (record.status === 'closed') return 'landed';
  return record.status;
}

function upsertFlight(record) {
  const Flights = globalThis.FlightsCollection;
  if (!Flights) return;

  const id = record.id;
  if (!id) return;

  const status = deriveStatus(record);

  const doc = {
    entity: record.entity || 'unknown',
    briefSlug: record.brief || '',
    briefSummary: record.note || '',
    status: status,
    host: record.host || '',
    pid: record.pid || null,
    model: record.model || '',
    started: record.started ? new Date(record.started) : new Date(),
    ended: record.ended ? new Date(record.ended) : null,
    elapsed: null,
    completionSummary: record.closingNote || null,
    stats: {
      toolCalls: null,
      contextTokens: null,
      inputTokens: null,
      outputTokens: null,
      cost: null,
    },
  };

  if (doc.ended && doc.started) {
    doc.elapsed = Math.floor((doc.ended - doc.started) / 1000);
  } else if (status === 'stale' && doc.started) {
    doc.elapsed = Math.floor((Date.now() - doc.started) / 1000);
  }

  const now = new Date();
  doc.lastActivity = now;

  const existing = Flights.findOne({ _id: id });
  if (existing) {
    Flights.update(id, { $set: doc });
  } else {
    Flights.insert(Object.assign({ _id: id }, doc));
  }

  if (doc.entity && doc.entity !== 'unknown') {
    EntityScanner.Entities.update({ handle: doc.entity }, { $set: { lastActivity: now } });
  }
}

function scanEntityFlights(handle, entityPath) {
  const flightsDir = path.join(entityPath, 'control', 'flights');
  try {
    fs.accessSync(flightsDir);
  } catch (e) {
    return;
  }

  try {
    const files = fs.readdirSync(flightsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const record = readFlightJson(path.join(flightsDir, file));
      if (record) upsertFlight(record);
    }
  } catch (e) {
    // Not readable
  }
}

function watchEntityFlights(handle, entityPath) {
  if (watchers.has(handle)) return;

  const flightsDir = path.join(entityPath, 'control', 'flights');
  try {
    fs.accessSync(flightsDir);
  } catch (e) {
    return;
  }

  try {
    const watcher = fs.watch(flightsDir, { persistent: false }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      Meteor.setTimeout(() => {
        const filePath = path.join(flightsDir, filename);
        const record = readFlightJson(filePath);
        if (record) {
          upsertFlight(record);
        } else {
          // File removed — remove from collection if it was there
          const id = filename.replace('.json', '');
          const Flights = globalThis.FlightsCollection;
          if (Flights) Flights.remove({ _id: id });
        }
      }, 300);
    });
    watchers.set(handle, watcher);
  } catch (e) {
    // Can't watch
  }
}

function scanAll() {
  const entities = EntityScanner.Entities.find().fetch();
  let total = 0;
  for (const entity of entities) {
    scanEntityFlights(entity.handle, entity.path);
    watchEntityFlights(entity.handle, entity.path);
  }
  const Flights = globalThis.FlightsCollection;
  total = Flights ? Flights.find().count() : 0;
  console.log(`[FLIGHT-SCANNER] Scan complete: ${total} flights across ${entities.length} entities`);
}

// A flight is considered stale if:
//   (a) it has been flying for longer than HARD_STALE_MS, OR
//   (b) same host + pid dead + past the PID_GRACE_MS grace period
// The grace period is critical: the pid on a flight record is the opener
// bash, which exits within milliseconds. Without the grace period, every
// fresh flight would be flagged stale immediately.
function isFlightStale(flight) {
  if (flight.status !== 'flying') return false;
  const ageMs = Date.now() - new Date(flight.started).getTime();
  if (ageMs > HARD_STALE_MS) return true;
  const sameHost = flight.host === os.hostname();
  if (sameHost && flight.pid && ageMs > PID_GRACE_MS && !pidAlive(flight.pid)) return true;
  return false;
}

// Land a zombie flight on disk — rewrites the JSON file so it says "closed"
// with an ended timestamp. Without this, every daemon restart re-imports the
// file as "flying" and the scanner has to mark it stale again — wasteful
// churn, and it shows up as "active" until the periodic sweep runs.
function landZombieOnDisk(flight) {
  const entity = flight.entity;
  if (!entity || entity === 'unknown') return;
  const homePath = process.env.HOME;
  const flightPath = path.join(homePath, '.' + entity, 'control', 'flights', flight._id + '.json');
  try {
    const raw = fs.readFileSync(flightPath, 'utf8');
    const record = JSON.parse(raw);
    if (record.status !== 'flying') return; // already landed
    record.status = 'closed';
    record.ended = new Date().toISOString();
    record.closingNote = 'auto-landed by daemon stale sweep (pid dead or >2h old)';
    fs.writeFileSync(flightPath, JSON.stringify(record, null, 2) + '\n');
    console.log(`[FLIGHT-SCANNER] zombie landed on disk: ${flight._id}`);
  } catch (e) {
    // File missing, unreadable, or in another entity dir — skip silently.
  }
}

function periodicStaleCheck() {
  const Flights = globalThis.FlightsCollection;
  if (!Flights) return;

  Flights.find({ status: 'flying' }).forEach(flight => {
    if (isFlightStale(flight)) {
      Flights.update(flight._id, { $set: { status: 'stale' } });
      landZombieOnDisk(flight);
    }
  });
}

Meteor.startup(() => {
  Meteor.setTimeout(() => {
    scanAll();

    // Sweep stale flights immediately after the initial scan — catches any
    // flights the process died during, or orphans from prior sessions.
    periodicStaleCheck();

    // Re-scan when new entities appear
    EntityScanner.Entities.find().observeChanges({
      added(id, fields) {
        if (fields.path && fields.handle) {
          scanEntityFlights(fields.handle, fields.path);
          watchEntityFlights(fields.handle, fields.path);
        }
      },
    });

    // Periodic stale-check every 60s
    Meteor.setInterval(() => periodicStaleCheck(), 60000);

    if (!globalThis.indexerReady) globalThis.indexerReady = {};
    globalThis.indexerReady.flights = new Date().toISOString();
  }, 1500);
});
