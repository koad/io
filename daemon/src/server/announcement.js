// AnnouncementSurface — STUB (moved to dance-hall)
//
// As of Round 12, announcement data is owned by the dance-hall service
// (port 28383), which has real persistent Mongo storage.
//
// The daemon no longer accepts announcement writes. All REST endpoints
// return 410 Gone so callers fail loudly and know to re-point at dance-hall.
//
// DDP publications are retained here as stubs so existing forge subscribers
// don't crash — they just return empty cursors until the forge bridge is
// updated to subscribe via _danceHall instead of _daemon.
//
// dance-hall REST: POST/GET http://10.10.10.10:28383/api/announcement/...
// dance-hall DDP:  http://10.10.10.10:28383

const SURFACE_ID = 'current';

// Preserve collection globals so downstream code referencing them doesn't crash.
// These are in-memory collections on the daemon side — empty by design.
// The forge bridge reads from dance-hall collections, not these.
globalThis.AnnouncementSurface = new Mongo.Collection('AnnouncementSurface', { connection: null });
globalThis.AnnouncementArchive = new Mongo.Collection('AnnouncementArchive', { connection: null });

const Surface = globalThis.AnnouncementSurface;
const Archive = globalThis.AnnouncementArchive;

// ---------------------------------------------------------------------------
// DDP Publications — stub (returns empty cursors)
// The forge bridge now subscribes to dance-hall, not daemon, for announcements.
// These stubs prevent "unknown publication" errors from any stale subscribers.
// ---------------------------------------------------------------------------

Meteor.publish('announcement.current', function () {
  console.warn('[ANNOUNCEMENT] daemon stub: subscriber should re-point to dance-hall');
  return Surface.find({ _id: SURFACE_ID });
});

Meteor.publish('announcement.archive.recent', function () {
  console.warn('[ANNOUNCEMENT] daemon stub: subscriber should re-point to dance-hall');
  const twelveWeeksAgo = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000);
  return Archive.find({ publishedAt: { $gte: twelveWeeksAgo } });
});

// ---------------------------------------------------------------------------
// REST handlers — all return 410 Gone
// ---------------------------------------------------------------------------

Meteor.startup(() => {
  const { WebApp } = require('meteor/webapp');
  const app = WebApp.connectHandlers;

  const GONE_MESSAGE = 'Announcement data moved to dance-hall service (http://10.10.10.10:28383). This daemon endpoint is retired.';

  function gone(res) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(410);
    res.end(JSON.stringify({
      status: 'gone',
      message: GONE_MESSAGE,
      redirect: 'http://10.10.10.10:28383/api/announcement/',
    }));
  }

  app.use('/api/announcement', (req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      res.writeHead(204);
      return res.end();
    }
    const url = req.originalUrl || req.url || '';
    if (!url.startsWith('/api/announcement')) return next();
    console.warn('[ANNOUNCEMENT] 410 stub hit:', req.method, url);
    gone(res);
  });

  console.log('[ANNOUNCEMENT] daemon stub loaded — all endpoints return 410 Gone');
  console.log('[ANNOUNCEMENT] dance-hall at http://10.10.10.10:28383 is the authoritative store');
});
