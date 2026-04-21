// Rituals — static registry + derived-state method.
//
// Rituals are recurring patterns imposed on existing data.
// No new Mongo collection — state is derived from emissions, ticklers, and
// AnnouncementSurface/Archive at call time.
//
// DDP method:
//   rituals.index()  — returns array of ritual summaries with derived state
//
// REST endpoints:
//   GET /api/rituals        — JSON ritual index
//   GET /api/rituals/:slug  — JSON single ritual with archive tail

// ---------------------------------------------------------------------------
// Static registry — one entry per ritual
// ---------------------------------------------------------------------------

const RITUAL_REGISTRY = [
  {
    slug: 'wednesday',
    name: 'Wednesday Announcement',
    cadence: 'weekly',
    dayOfWeek: 3,       // ISO Wednesday (0=Sun)
    entities: ['iris', 'muse', 'mercury', 'alice'],
    description: 'Every Wednesday a kingdom entity authors this space. Authorship rotates.',
    dataSource: 'AnnouncementSurface + AnnouncementArchive',
    route: '/rituals/wednesday',
  },
  {
    slug: 'weekly-review',
    name: 'Weekly Review',
    cadence: 'weekly',
    dayOfWeek: 1,       // Monday
    entities: ['juno'],
    description: 'Monday morning rhythm — open flights, entity briefs, active blockers.',
    dataSource: 'Emissions (tag: weekly-review) + Tickler',
    route: '/rituals/weekly-review',
  },
  {
    slug: 'monthly-close',
    name: 'Monthly Close',
    cadence: 'monthly',
    dayOfMonth: 1,
    entities: ['copia'],
    description: "Copia's ledger close — month-over-month entity activity and flight completion.",
    dataSource: 'Emissions (tag: monthly-close)',
    route: '/rituals/monthly-close',
  },
  {
    slug: 'daily-sweep',
    name: 'Daily Sweep',
    cadence: 'daily',
    entities: ['janus', 'salus'],
    description: 'Janus + Salus overnight checks — entity session states and anomalies.',
    dataSource: 'Emissions (tag: daily-sweep) + HarnessSessions',
    route: '/rituals/daily-sweep',
  },
];

// ---------------------------------------------------------------------------
// Derived state helpers
// ---------------------------------------------------------------------------

// Returns the next UTC occurrence of dayOfWeek (0=Sun..6=Sat) from now.
function _nextWeeklyOccurrence(dayOfWeek) {
  const now = new Date();
  const day = now.getUTCDay();
  let daysUntil = (dayOfWeek - day + 7) % 7;
  if (daysUntil === 0) daysUntil = 7; // already today → next week
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntil);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function _nextMonthlyOccurrence(dayOfMonth) {
  const now = new Date();
  let next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth));
  if (next <= now) {
    next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, dayOfMonth));
  }
  return next;
}

function _nextDailyOccurrence() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function _computeNextOccurrence(ritual) {
  if (ritual.cadence === 'weekly') return _nextWeeklyOccurrence(ritual.dayOfWeek);
  if (ritual.cadence === 'monthly') return _nextMonthlyOccurrence(ritual.dayOfMonth || 1);
  if (ritual.cadence === 'daily') return _nextDailyOccurrence();
  return null;
}

// Derive state: in-progress / idle / overdue
// Uses Emissions collection (tag: ritual:<slug>) and cadence math.
function _deriveState(ritual) {
  const Emissions = globalThis.Emissions;
  if (!Emissions) return 'idle';

  // Check for an open emission tagged with this ritual
  const open = Emissions.findOne({ tags: 'ritual:' + ritual.slug, status: { $in: ['open', 'active'] } });
  if (open) return 'in-progress';

  // Check overdue: has the cadence window elapsed without a recent emission?
  const now = Date.now();
  let windowMs;
  if (ritual.cadence === 'weekly') windowMs = 7 * 24 * 60 * 60 * 1000;
  else if (ritual.cadence === 'monthly') windowMs = 31 * 24 * 60 * 60 * 1000;
  else windowMs = 24 * 60 * 60 * 1000; // daily

  const windowStart = new Date(now - windowMs);
  const recent = Emissions.findOne({
    tags: 'ritual:' + ritual.slug,
    createdAt: { $gte: windowStart },
  });
  if (!recent) {
    // No emission within cadence window — but only overdue if a window has passed since epoch start
    // Use a simpler heuristic: if any emission exists at all, check last one.
    const last = Emissions.findOne({ tags: 'ritual:' + ritual.slug }, { sort: { createdAt: -1 } });
    if (last && new Date(last.createdAt) < windowStart) return 'overdue';
  }

  return 'idle';
}

// Build index row for one ritual.
function _buildIndexRow(ritual) {
  const next = _computeNextOccurrence(ritual);
  const state = _deriveState(ritual);

  // Last occurrence: check archive for wednesday, emissions for others
  let lastOccurrence = null;
  if (ritual.slug === 'wednesday') {
    const Archive = globalThis.AnnouncementArchive;
    if (Archive) {
      const last = Archive.findOne({}, { sort: { publishedAt: -1 } });
      if (last) lastOccurrence = last.publishedAt;
    }
  } else {
    const Emissions = globalThis.Emissions;
    if (Emissions) {
      const last = Emissions.findOne(
        { tags: 'ritual:' + ritual.slug },
        { sort: { createdAt: -1 } }
      );
      if (last) lastOccurrence = last.createdAt;
    }
  }

  // Last 3 authors
  let lastAuthors = [];
  if (ritual.slug === 'wednesday') {
    const Archive = globalThis.AnnouncementArchive;
    if (Archive) {
      lastAuthors = Archive.find({}, { sort: { publishedAt: -1 }, limit: 3 }).fetch()
        .map(d => d.author || d.authoredBy || null)
        .filter(Boolean);
    }
  }

  return {
    slug: ritual.slug,
    name: ritual.name,
    cadence: ritual.cadence,
    description: ritual.description,
    route: ritual.route,
    state,
    nextOccurrence: next ? next.toISOString() : null,
    nextMs: next ? next.getTime() : null,
    lastOccurrence: lastOccurrence || null,
    lastAuthors,
    entities: ritual.entities || [],
  };
}

// ---------------------------------------------------------------------------
// DDP method
// ---------------------------------------------------------------------------

Meteor.methods({
  'rituals.index'() {
    return RITUAL_REGISTRY.map(_buildIndexRow);
  },

  'rituals.wednesday'() {
    const Surface = globalThis.AnnouncementSurface;
    const Archive = globalThis.AnnouncementArchive;

    const surface = Surface ? Surface.findOne({ _id: 'current' }) : null;
    const archiveRows = Archive
      ? Archive.find({}, { sort: { publishedAt: -1 }, limit: 8 }).fetch()
      : [];

    const ritual = RITUAL_REGISTRY.find(r => r.slug === 'wednesday');
    const next = _computeNextOccurrence(ritual);
    const state = _deriveState(ritual);

    return {
      ritual,
      state,
      nextOccurrence: next ? next.toISOString() : null,
      nextMs: next ? next.getTime() : null,
      surface: surface || null,
      archive: archiveRows,
    };
  },
});

// Export registry for REST handlers below.
globalThis.RITUAL_REGISTRY = RITUAL_REGISTRY;
globalThis.ritualsIndexRows = () => RITUAL_REGISTRY.map(_buildIndexRow);

// ---------------------------------------------------------------------------
// REST endpoints
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

  // GET /api/rituals
  app.use('/api/rituals', (req, res, next) => {
    const url = req.originalUrl || req.url || '';
    const path = url.split('?')[0];

    if (req.method !== 'GET') return next();

    // /api/rituals/:slug
    const slugMatch = path.match(/^\/api\/rituals\/([^/]+)\/?$/);
    if (slugMatch) {
      const slug = slugMatch[1];
      const ritual = RITUAL_REGISTRY.find(r => r.slug === slug);
      if (!ritual) return jsonErr(res, 404, 'ritual not found');
      const row = _buildIndexRow(ritual);
      // For wednesday, include surface + archive
      if (slug === 'wednesday') {
        const Surface = globalThis.AnnouncementSurface;
        const Archive = globalThis.AnnouncementArchive;
        row.surface = Surface ? Surface.findOne({ _id: 'current' }) : null;
        row.archive = Archive ? Archive.find({}, { sort: { publishedAt: -1 }, limit: 8 }).fetch() : [];
      }
      return jsonOk(res, row);
    }

    // /api/rituals
    if (path === '/api/rituals' || path === '/api/rituals/') {
      return jsonOk(res, RITUAL_REGISTRY.map(_buildIndexRow));
    }

    return next();
  });
});
