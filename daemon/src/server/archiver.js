// archiver.js — periodic sweep that archives terminal-status records to disk
// and removes them from in-memory collections. Keeps the daemon light without
// losing audit trail. Active records (open/active/flying) are never touched.
//
// Archive layout: ~/.koad-io/daemon/archive/<collection>/YYYY-MM-DD.jsonl
//   - One file per UTC day per collection
//   - Append-only JSONL — one record per line, easy to grep
//   - Files are addressable by date for restore tooling
//
// Config (env):
//   KOAD_IO_ARCHIVE_DAYS=7         retain last N days in memory (default 7)
//   KOAD_IO_ARCHIVE_DIR=...        archive root (default ~/.koad-io/daemon/archive)
//   KOAD_IO_ARCHIVE_INTERVAL_S=3600  sweep interval in seconds (default 1h)
//
// Manual trigger:
//   curl -X POST http://10.10.10.10:28282/api/archive/sweep

const fs = Npm.require('fs');
const path = Npm.require('path');
const os = Npm.require('os');

const ARCHIVE_DAYS = parseInt(process.env.KOAD_IO_ARCHIVE_DAYS || '7', 10);
const ARCHIVE_DIR = process.env.KOAD_IO_ARCHIVE_DIR ||
  path.join(process.env.HOME || os.homedir(), '.koad-io/daemon/archive');
const SWEEP_INTERVAL_S = parseInt(process.env.KOAD_IO_ARCHIVE_INTERVAL_S || '3600', 10);
const STARTUP_DELAY_S = 60; // wait for indexers to settle before first sweep

// Per-collection config: which globalThis collection, what selector defines
// "terminal and old enough", and which timestamp field buckets the archive.
const TARGETS = [
  {
    name: 'emissions',
    getCol: () => globalThis.EmissionsCollection,
    selector: (cutoff) => ({
      status: 'closed',
      closedAt: { $lt: cutoff },
    }),
    bucketField: 'closedAt',
  },
  {
    name: 'flights',
    getCol: () => globalThis.FlightsCollection,
    selector: (cutoff) => ({
      status: { $in: ['landed', 'stale'] },
      ended: { $lt: cutoff },
    }),
    bucketField: 'ended',
  },
  {
    name: 'sessions',
    getCol: () => globalThis.SessionsCollection,
    selector: (cutoff) => ({
      status: { $in: ['killed', 'ended', 'stale'] },
      lastSeen: { $lt: cutoff },
    }),
    bucketField: 'lastSeen',
  },
];

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
}

function bucketDate(doc, field) {
  const v = doc[field];
  const d = v ? new Date(v) : new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function archiveDocs(target, docs) {
  const collDir = path.join(ARCHIVE_DIR, target.name);
  ensureDir(collDir);

  // Group by UTC day of the bucket field
  const byDate = {};
  for (const doc of docs) {
    const bucket = bucketDate(doc, target.bucketField);
    if (!byDate[bucket]) byDate[bucket] = [];
    byDate[bucket].push(doc);
  }

  // Append each bucket — JSONL, one record per line
  for (const [date, dateDocs] of Object.entries(byDate)) {
    const file = path.join(collDir, `${date}.jsonl`);
    const lines = dateDocs.map(d => JSON.stringify(d)).join('\n') + '\n';
    fs.appendFileSync(file, lines);
  }

  return Object.keys(byDate).length;
}

async function sweepOnce(daysOverride) {
  const days = daysOverride != null ? daysOverride : ARCHIVE_DAYS;
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  const summary = { cutoff: cutoff.toISOString(), days, targets: {} };
  let totalArchived = 0;

  for (const target of TARGETS) {
    const col = target.getCol();
    if (!col) {
      summary.targets[target.name] = { skipped: 'collection not initialized' };
      continue;
    }

    const docs = await col.find(target.selector(cutoff)).fetchAsync();
    if (docs.length === 0) {
      summary.targets[target.name] = { archived: 0 };
      continue;
    }

    try {
      const buckets = archiveDocs(target, docs);
      // Remove from in-memory collection
      for (const doc of docs) {
        col.remove(doc._id);
      }
      totalArchived += docs.length;
      summary.targets[target.name] = { archived: docs.length, buckets };
      console.log(`[ARCHIVER] ${target.name}: archived ${docs.length} docs across ${buckets} day-buckets`);
    } catch (e) {
      summary.targets[target.name] = { error: e.message };
      console.error(`[ARCHIVER] ${target.name} archive failed:`, e.message);
    }
  }

  if (totalArchived > 0) {
    console.log(`[ARCHIVER] sweep complete: ${totalArchived} total docs archived`);
  }
  return summary;
}

Meteor.startup(() => {
  ensureDir(ARCHIVE_DIR);
  console.log(`[ARCHIVER] active — keeping last ${ARCHIVE_DAYS}d in memory, archiving older to ${ARCHIVE_DIR}`);

  // First sweep after a delay so indexers have time to populate
  Meteor.setTimeout(() => sweepOnce(), STARTUP_DELAY_S * 1000);

  // Then on interval
  Meteor.setInterval(() => sweepOnce(), SWEEP_INTERVAL_S * 1000);
});

// Manual trigger
Meteor.methods({
  'archiver.sweep'() {
    return sweepOnce();
  },
});

// REST trigger for ops/testing
import { WebApp } from 'meteor/webapp';
const app = WebApp.connectHandlers;

app.use('/api/archive/sweep', async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== 'POST') return next();
  try {
    // Optional ?days=N override (for testing — force records older than N days to archive)
    const url = req.originalUrl || req.url || '';
    const m = url.match(/[?&]days=(\d+)/);
    const daysOverride = m ? parseInt(m[1], 10) : undefined;

    const summary = await sweepOnce(daysOverride);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', ...summary }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});

// Read endpoint — list archive files for a date or all
app.use('/api/archive', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  // Don't intercept /api/archive/sweep (handled above as POST)
  const url = req.originalUrl || req.url || '';
  if (url.startsWith('/sweep')) return next();
  try {
    const result = {};
    for (const target of TARGETS) {
      const collDir = path.join(ARCHIVE_DIR, target.name);
      try {
        const files = fs.readdirSync(collDir)
          .filter(f => f.endsWith('.jsonl'))
          .sort()
          .reverse();
        result[target.name] = files.map(f => {
          const full = path.join(collDir, f);
          const stat = fs.statSync(full);
          return {
            date: f.replace('.jsonl', ''),
            file: full,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          };
        });
      } catch (e) {
        result[target.name] = [];
      }
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', archive_dir: ARCHIVE_DIR, ...result }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});
