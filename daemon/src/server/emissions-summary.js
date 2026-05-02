// GET /api/emissions/summary — aggregate emission counts over the archive layer
// Designed for Janus's cadence-drift detection:
//   "Vulcan emitted 12 flights last week, 0 this week"
//
// Query params:
//   entity  (required) — entity name to summarize
//   window  (optional, default 7d) — duration: Nh, Nd, Nw (hours, days, weeks)
//
// Sources:
//   1. Archive JSONL files: ~/.koad-io/daemon/archive/emissions/YYYY-MM-DD.jsonl
//   2. Active in-memory Emissions collection (not yet archived)
// Both are scanned; records falling outside the window are skipped.
//
// Response shape:
// {
//   "entity": "vulcan",
//   "window": "7d",
//   "since": "<ISO>",
//   "until": "<ISO>",
//   "count": 87,
//   "types": { "flight": 23, "session": 12, ... },
//   "first_seen": "<ISO>",
//   "last_seen": "<ISO>",
//   "by_status": { "open": 0, "active": 1, "closed": 86 }
// }

import { WebApp } from 'meteor/webapp';

const fs = Npm.require('fs');
const path = Npm.require('path');
const os = Npm.require('os');

const ARCHIVE_DIR = process.env.KOAD_IO_ARCHIVE_DIR ||
  path.join(process.env.HOME || os.homedir(), '.koad-io/daemon/archive');

// Parse a window string like "1h", "24h", "7d", "2w" into milliseconds.
// Supports: Nh (hours), Nd (days), Nw (weeks).
// Returns null if unparseable (caller falls back to default 7d).
function parseWindowMs(w) {
  if (!w || typeof w !== 'string') return null;
  const m = w.trim().match(/^(\d+)([hdw])$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!n || n < 1) return null;
  const unit = m[2].toLowerCase();
  if (unit === 'h') return n * 3600 * 1000;
  if (unit === 'd') return n * 24 * 3600 * 1000;
  if (unit === 'w') return n * 7 * 24 * 3600 * 1000;
  return null;
}

// Generate an array of YYYY-MM-DD strings for dates in [since, until].
// Inclusive on both ends (UTC days).
function dateBuckets(since, until) {
  const dates = [];
  const d = new Date(since);
  d.setUTCHours(0, 0, 0, 0); // start of day
  const end = new Date(until);
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

// Read and parse one JSONL archive file, returning records as objects.
// Returns [] on any read/parse error (graceful).
function readArchiveFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const records = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { records.push(JSON.parse(trimmed)); } catch (e) { /* skip malformed */ }
    }
    return records;
  } catch (e) {
    // File doesn't exist or can't be read — normal for days before archiver ran
    return [];
  }
}

// Accumulate a single emission doc into the running tallies (mutates in place).
function accumulateDoc(doc, since, until, acc) {
  const ts = new Date(doc.timestamp || doc.closedAt || doc.startedAt);
  if (isNaN(ts.getTime())) return;
  if (ts < since || ts > until) return; // outside window

  acc.count++;

  // type tally
  const t = doc.type || 'unknown';
  acc.types[t] = (acc.types[t] || 0) + 1;

  // status tally
  const s = doc.status || 'fire-and-forget';
  acc.by_status[s] = (acc.by_status[s] || 0) + 1;

  // first/last seen
  if (!acc.first_seen || ts < acc.first_seen) acc.first_seen = ts;
  if (!acc.last_seen  || ts > acc.last_seen)  acc.last_seen  = ts;
}

const app = WebApp.connectHandlers;

// Register BEFORE the generic /api/emissions handler (connect matches prefix-first).
app.use('/api/emissions/summary', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  // Build a pathIs check — only handle exact /api/emissions/summary
  const url = req.originalUrl || req.url || '';
  const urlPath = url.indexOf('?') === -1 ? url : url.slice(0, url.indexOf('?'));
  if (urlPath !== '/api/emissions/summary' && urlPath !== '/api/emissions/summary/') {
    return next();
  }

  // Parse query string manually (connect has no req.query)
  const q = {};
  const qi = url.indexOf('?');
  if (qi !== -1) {
    for (const pair of url.slice(qi + 1).split('&')) {
      const [k, v] = pair.split('=');
      if (k) q[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    }
  }

  const entity = q.entity;
  if (!entity || typeof entity !== 'string' || !/^[a-z0-9_-]+$/i.test(entity)) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing or invalid "entity" query param' }));
  }

  const windowStr = q.window || '7d';
  let windowMs = parseWindowMs(windowStr);
  if (!windowMs) {
    // Unrecognised window — reject with clear message rather than silently defaulting
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(400);
    return res.end(JSON.stringify({
      status: 'error',
      message: `Invalid window "${windowStr}". Use Nh, Nd, or Nw (e.g. 1h, 24h, 7d, 2w)`,
    }));
  }

  const until = new Date();
  const since = new Date(until.getTime() - windowMs);

  // Running accumulator
  const acc = {
    count: 0,
    types: {},
    by_status: {},
    first_seen: null,
    last_seen: null,
  };

  try {
    // --- Source 1: archive JSONL files ---
    const emissionsArchiveDir = path.join(ARCHIVE_DIR, 'emissions');
    const buckets = dateBuckets(since, until);
    for (const bucket of buckets) {
      const filePath = path.join(emissionsArchiveDir, `${bucket}.jsonl`);
      const docs = readArchiveFile(filePath);
      for (const doc of docs) {
        if (doc.entity !== entity) continue;
        accumulateDoc(doc, since, until, acc);
      }
    }

    // --- Source 2: in-memory Emissions collection ---
    const Emissions = globalThis.EmissionsCollection;
    if (Emissions) {
      const inMemory = await Emissions.find({
        entity,
        timestamp: { $gte: since, $lte: until },
      }).fetchAsync();
      for (const doc of inMemory) {
        accumulateDoc(doc, since, until, acc);
      }
    }

    const response = {
      entity,
      window: windowStr,
      since: since.toISOString(),
      until: until.toISOString(),
      count: acc.count,
      types: acc.types,
      first_seen: acc.first_seen ? acc.first_seen.toISOString() : null,
      last_seen: acc.last_seen ? acc.last_seen.toISOString() : null,
      by_status: acc.by_status,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);
    res.end(JSON.stringify(response));

  } catch (err) {
    console.error('[API/emissions/summary] error:', err.message);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(500);
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});

// CORS preflight
app.use('/api/emissions/summary', (req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.writeHead(204);
  res.end();
});
