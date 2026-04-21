// AnnouncementSurface — weekly top-chrome slot for entity publications.
//
// Two collections:
//   AnnouncementSurface  — single active doc (upserted in place)
//   AnnouncementArchive  — append-only history keyed by {week, year}
//
// REST endpoints (no auth — inside ZeroTier/Netbird hard shell):
//   POST /api/announcement/publish       — write surface + archive previous
//   GET  /api/announcement/current       — active surface doc
//   GET  /api/announcement/archive       — all archived (desc by week)
//   GET  /api/announcement/archive/:yw   — single archive entry (e.g. 2026-W17)
//
// DDP publications:
//   announcement.current                — single surface doc for forge bridge
//   announcement.archive.recent         — last 12 weeks

const SURFACE_ID = 'current'; // singleton _id

globalThis.AnnouncementSurface = new Mongo.Collection('AnnouncementSurface', { connection: null });
globalThis.AnnouncementArchive = new Mongo.Collection('AnnouncementArchive', { connection: null });

const Surface = globalThis.AnnouncementSurface;
const Archive = globalThis.AnnouncementArchive;

// ---------------------------------------------------------------------------
// DDP Publications
// ---------------------------------------------------------------------------

Meteor.publish('announcement.current', function () {
  return Surface.find({ _id: SURFACE_ID });
});

Meteor.publish('announcement.archive.recent', function () {
  // No sort+limit on minimongo publish — use date-range selector instead.
  // Last 12 weeks: ~84 days back from now.
  const twelveWeeksAgo = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000);
  return Archive.find({ publishedAt: { $gte: twelveWeeksAgo } });
});

// ---------------------------------------------------------------------------
// REST handlers — registered on WebApp.connectHandlers via app (from api.js).
// api.js is loaded first (Meteor alphabetical load order within server/).
// We declare our handlers after api.js runs by attaching to the same app ref.
// ---------------------------------------------------------------------------

Meteor.startup(() => {
  const { WebApp } = require('meteor/webapp');
  const app = WebApp.connectHandlers;

  function jsonOk(res, payload) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);
    res.end(JSON.stringify(payload));
  }

  function jsonErr(res, code, message) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(code);
    res.end(JSON.stringify({ status: 'error', message }));
  }

  function pathIs(req, target) {
    const url = req.originalUrl || req.url || '';
    const i = url.indexOf('?');
    const p = i === -1 ? url : url.slice(0, i);
    return p === target || p === target + '/';
  }

  // ---------------------------------------------------------------------------
  // POST /api/announcement/publish
  // Body: { week, author, title, copy, contentHtml? }
  //   week — ISO week string, e.g. "2026-W17"
  // ---------------------------------------------------------------------------
  app.use('/api/announcement/publish', async (req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      res.writeHead(204);
      return res.end();
    }
    if (req.method !== 'POST') return next();

    const { week, author, title, copy, contentHtml, scheduledStart, scheduledEnd } = req.body || {};

    if (!week || typeof week !== 'string') return jsonErr(res, 400, 'Missing "week" (e.g. "2026-W17")');
    if (!author || typeof author !== 'string') return jsonErr(res, 400, 'Missing "author"');
    if (title === undefined) return jsonErr(res, 400, 'Missing "title"');
    if (!copy || typeof copy !== 'string') return jsonErr(res, 400, 'Missing "copy"');

    const now = new Date();

    // Parse week string to derive year and week number
    const weekMatch = week.match(/^(\d{4})-W(\d{1,2})$/);
    if (!weekMatch) return jsonErr(res, 400, '"week" must be ISO format e.g. "2026-W17"');
    const year = parseInt(weekMatch[1], 10);
    const weekNum = parseInt(weekMatch[2], 10);

    // Archive the previous surface doc (if any)
    try {
      const existing = await Surface.findOneAsync({ _id: SURFACE_ID });
      if (existing) {
        const archiveKey = `${existing.week}-${existing.year || year}`;
        const alreadyArchived = await Archive.findOneAsync({ week: existing.week, year: existing.year || year });
        if (!alreadyArchived) {
          await Archive.insertAsync({
            week: existing.week,
            year: existing.year || year,
            author: existing.author,
            title: existing.title,
            copy: existing.copy,
            contentHtml: existing.contentHtml || null,
            scheduledStart: existing.scheduledStart || null,
            scheduledEnd: existing.scheduledEnd || null,
            publishedAt: existing.publishedAt || now,
            archivedAt: now,
          });
          console.log(`[ANNOUNCEMENT] archived previous surface: ${existing.week}`);
        }
      }
    } catch (archErr) {
      console.error('[ANNOUNCEMENT] archive step failed (non-fatal):', archErr.message);
    }

    // Write new surface doc
    const doc = {
      week,
      year,
      weekNum,
      author,
      title: title || '',
      copy,
      contentHtml: contentHtml || null,
      scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
      scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
      publishedAt: now,
      updatedAt: now,
    };

    await Surface.upsertAsync({ _id: SURFACE_ID }, { $set: doc });
    console.log(`[ANNOUNCEMENT] surface published: ${week} by ${author}`);

    jsonOk(res, { status: 'success', week, author });
  });

  // ---------------------------------------------------------------------------
  // GET /api/announcement/current
  // ---------------------------------------------------------------------------
  app.use('/api/announcement/current', async (req, res, next) => {
    if (req.method !== 'GET' || !pathIs(req, '/api/announcement/current')) return next();
    try {
      const doc = await Surface.findOneAsync({ _id: SURFACE_ID });
      if (!doc) return jsonOk(res, { status: 'ok', surface: null });
      jsonOk(res, { status: 'ok', surface: doc });
    } catch (err) {
      console.error('[API/announcement/current] error:', err.message);
      jsonErr(res, 500, err.message);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/announcement/archive/:yearWeek  — single archive entry
  // Register BEFORE /api/announcement/archive list handler (prefix ordering).
  // ---------------------------------------------------------------------------
  app.use('/api/announcement/archive', async (req, res, next) => {
    if (req.method !== 'GET') return next();

    const url = req.originalUrl || req.url || '';
    const m = url.match(/^\/api\/announcement\/archive\/([^/?]+)/);
    if (!m) return next(); // fall through to list handler

    const yearWeek = decodeURIComponent(m[1]);
    // yearWeek expected as "2026-W17" or "2026-W17-2026" (legacy)
    const parsed = yearWeek.match(/^(\d{4})-W(\d{1,2})/);
    if (!parsed) return jsonErr(res, 400, 'Invalid yearWeek format. Use "2026-W17".');

    const year = parseInt(parsed[1], 10);
    const weekNum = parseInt(parsed[2], 10);
    const week = `${year}-W${String(weekNum).padStart(2, '0')}`;

    try {
      // Try both zero-padded and non-padded week strings
      const doc = await Archive.findOneAsync({
        $or: [
          { week, year },
          { week: `${year}-W${weekNum}`, year },
        ]
      });
      if (!doc) return jsonErr(res, 404, `Archive entry for ${yearWeek} not found`);
      jsonOk(res, { status: 'ok', entry: doc });
    } catch (err) {
      console.error('[API/announcement/archive/:yw] error:', err.message);
      jsonErr(res, 500, err.message);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/announcement/archive — all archived surfaces, desc by week
  // ---------------------------------------------------------------------------
  app.use('/api/announcement/archive', async (req, res, next) => {
    if (req.method !== 'GET' || !pathIs(req, '/api/announcement/archive')) return next();
    try {
      const entries = await Archive.find({}, { sort: { publishedAt: -1 } }).fetchAsync();
      jsonOk(res, { status: 'ok', count: entries.length, entries });
    } catch (err) {
      console.error('[API/announcement/archive] error:', err.message);
      jsonErr(res, 500, err.message);
    }
  });
});

// ---------------------------------------------------------------------------
// Seed helper — called at startup to ensure a placeholder exists.
// Only inserts if no surface doc is present.
// ---------------------------------------------------------------------------
Meteor.startup(async () => {
  // Wait a tick so the collection is fully wired
  Meteor.defer(async () => {
    try {
      const existing = await Surface.findOneAsync({ _id: SURFACE_ID });
      if (!existing) {
        await Surface.upsertAsync({ _id: SURFACE_ID }, {
          $set: {
            week: '2026-W17',
            year: 2026,
            weekNum: 17,
            author: 'iris',
            title: '',
            copy: '(composition in progress)',
            contentHtml: null,
            scheduledStart: new Date('2026-04-22T00:00:00Z'),
            scheduledEnd: new Date('2026-04-28T23:59:59Z'),
            publishedAt: new Date(),
            updatedAt: new Date(),
          }
        });
        console.log('[ANNOUNCEMENT] seeded initial surface: 2026-W17 by iris');
      } else {
        console.log('[ANNOUNCEMENT] surface already exists:', existing.week);
      }
    } catch (err) {
      console.error('[ANNOUNCEMENT] seed error:', err.message);
    }
  });
});
