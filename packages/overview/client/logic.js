import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { Tracker } from 'meteor/tracker';

// Shorthand — collections are declared by the host app (daemon via application-logic.js
// and overview.js; forge via daemon-bridge.js). Package reads, never owns.
function _col(name) { return globalThis[name] || null; }


// =====================================================================
// Additional collections — not in initial package.js but used by host apps
// =====================================================================
// These follow the same pattern as other collections — host provides, package reads.

const _crossKingdomBonds = new ReactiveVar('list');
const _envIndex = _col('EnvIndex');

// Reactive clocks — same convention as koad:io-templating constants.
const tick1s = new Tracker.Dependency();
const tick1m = new Tracker.Dependency();
Meteor.setInterval(function () { tick1s.changed(); }, 1000);
Meteor.setInterval(function () { tick1m.changed(); }, 60000);

// Hostname reactive var — populated by the host app calling a Meteor method.
// Daemon sets this via 'getHostname'; forge can set it directly via
// KoadOverview.setHostname().
const _hostname = new ReactiveVar('...');
KoadOverview.setHostname = function (name) { _hostname.set(name); };

const _currentView = new ReactiveVar('entities');
const _selectedEntity = new ReactiveVar(null);
const _flightFilter = new ReactiveVar('all');
const _bondView = new ReactiveVar('graph');
const _searchQuery = new ReactiveVar('');
const _kingdomFilter = new ReactiveVar('');

// =====================================================================
// KingdomOverview template
// =====================================================================

Template.KingdomOverview.onCreated(function () {
  // Host app is responsible for subscriptions — package does not subscribe.
  // Daemon wires subs in application-logic.js or a startup block.
  // Forge inherits data from the null publication in daemon-bridge.js.

  // Ask host for hostname if the method exists
  if (Meteor.call) {
    Meteor.call('getHostname', function (err, result) {
      if (!err && result) _hostname.set(result);
    });
  }

  // Fetch health data from daemon
  if (Meteor.call) {
    Meteor.call('getHealth', function (err, result) {
      if (!err && result) {
        KoadOverview._health = result;
      }
    });
  }

  // Esc key deselects the current entity. Bound on document because focus
  // may be anywhere (or nowhere). Stored on the template instance so the
  // onDestroyed hook can remove it cleanly on teardown.
  this._escHandler = function (e) {
    if (e.key === 'Escape' && _selectedEntity.get()) {
      _selectedEntity.set(null);
    }
  };
  document.addEventListener('keydown', this._escHandler);
});

Template.KingdomOverview.onDestroyed(function () {
  if (this._escHandler) document.removeEventListener('keydown', this._escHandler);
});

Template.KingdomOverview.events({
  'click .nav-tab'(event) {
    const view = event.currentTarget.dataset.view;
    if (view) _currentView.set(view);
  },
  'click .overview-header .glyph'() {
    _currentView.set('entities');
  },
  'click .entity-profile-link'(event) {
    event.stopPropagation();
  },
  'click .entity-card'(event) {
    const handle = event.currentTarget.dataset.handle;
    if (!handle) return;
    _selectedEntity.set(_selectedEntity.get() === handle ? null : handle);
  },
  'click .deselect-entity'() {
    _selectedEntity.set(null);
  },
  'click .flight-filter'(event) {
    const filter = event.currentTarget.dataset.filter;
    if (filter) _flightFilter.set(filter);
    const bondView = event.currentTarget.dataset.bondView;
    if (bondView) _bondView.set(bondView);
  },
  'click .cross-kingdom-filter'(event) {
    const view = event.currentTarget.dataset.crossKingdomView;
    if (view) _crossKingdomBonds.set(view);
  },
  'input .search-input'(event) {
    _searchQuery.set(event.currentTarget.value);
  },
  'input .kingdom-filter-input'(event) {
    _kingdomFilter.set(event.currentTarget.value);
  },
  'click .clear-search'(event) {
    _searchQuery.set('');
  },
});

Template.KingdomOverview.helpers({

  // --- Navigation ---
  hostname() { return _hostname.get(); },
  viewIs(name) { return _currentView.get() === name; },
  activeClass(name) { return _currentView.get() === name ? 'active' : ''; },
  bondViewIs(name) { return _bondView.get() === name; },
  bondViewClass(name) { return _bondView.get() === name ? 'active' : ''; },

  // Profile URL helper — uses KoadOverview._entityProfileUrl
  entityProfileUrl(handle) { return KoadOverview._entityProfileUrl(handle); },

  // --- Search & Filter ---
  searchQuery() { return _searchQuery.get(); },
  hasSearch() { return _searchQuery.get().length > 0; },
  kingdomFilter() { return _kingdomFilter.get(); },
  hasKingdomFilter() { return _kingdomFilter.get().length > 0; },
  clearSearch() { _searchQuery.set(''); },

  // --- Aggregate stats ---
  entityCount() {
    const Entities = _col('Entities');
    return Entities ? Entities.find().count() : 0;
  },

  flyingCount() {
    const Flights = _col('Flights');
    if (!Flights) return 0;
    const sel = _selectedEntity.get();
    const q = { status: 'flying' };
    if (sel) q.entity = sel;
    return Flights.find(q).count();
  },

  totalBonds() {
    const BondsIndex = _col('BondsIndex');
    if (!BondsIndex) return 0;
    let t = 0;
    BondsIndex.find().forEach(function (d) { t += (d.count || 0); });
    return t;
  },

  totalKeys() {
    const KeysIndex = _col('KeysIndex');
    if (!KeysIndex) return 0;
    let t = 0;
    KeysIndex.find().forEach(function (d) { t += (d.count || 0); });
    return t;
  },

  totalTickles() {
    const TicklerIndex = _col('TicklerIndex');
    if (!TicklerIndex) return 0;
    let t = 0;
    TicklerIndex.find().forEach(function (d) { t += (d.count || 0); });
    return t;
  },

  alertCount() {
    const Alerts = _col('Alerts');
    if (!Alerts) return 0;
    let t = 0;
    Alerts.find().forEach(function (d) { t += (d.items ? d.items.length : 0); });
    return t;
  },

  // --- System Health ---
  healthUptime() {
    return KoadOverview._health ? KoadOverview._health.uptime : '—';
  },
  healthPid() {
    return KoadOverview._health ? KoadOverview._health.pid : '—';
  },
  healthNode() {
    return KoadOverview._health ? KoadOverview._health.node : '—';
  },
  indexerStatus() {
    if (!KoadOverview._health || !KoadOverview._health.indexers) return [];
    return Object.entries(KoadOverview._health.indexers).map(function (entry) {
      return { name: entry[0], ready: !!entry[1], updated: entry[1] || '—' };
    });
  },
  collectionStats() {
    const stats = [];
    if (KoadOverview._health && KoadOverview._health.counts) {
      const names = ['flights', 'emissions', 'passengers', 'sessions'];
      for (const name of names) {
        if (KoadOverview._health.counts[name] != null) {
          stats.push({ name: name, count: KoadOverview._health.counts[name] });
        }
      }
    }
    // Add from collections
    const Entities = _col('Entities');
    const Flights = _col('Flights');
    const Emissions = _col('Emissions');
    if (Entities) stats.push({ name: 'entities', count: Entities.find().count() });
    if (Flights) stats.push({ name: 'flights', count: Flights.find().count() });
    if (Emissions) stats.push({ name: 'emissions', count: Emissions.find().count() });
    return stats;
  },

  // --- Kingdoms ---
  hasKingdoms() {
    const Kingdoms = _col('Kingdoms');
    return Kingdoms ? Kingdoms.find().count() > 0 : false;
  },
  kingdoms() {
    const Kingdoms = _col('Kingdoms');
    const Flights = _col('Flights');
    const Emissions = _col('Emissions');
    const Entities = _col('Entities');
    if (!Kingdoms) return [];
    tick1m.depend();
    return Kingdoms.find().fetch().map(function (k) {
      // Count entities in this kingdom
      const entityCount = Entities ? Entities.find({ kingdomId: k.name }).count() : 0;
      // Count flights in last 24h for kingdom entities
      let flights24h = 0;
      if (Flights && entityCount > 0) {
        const cutoff = new Date(Date.now() - 86400000);
        const handles = Entities ? Entities.find({ kingdomId: k.name }, { fields: { handle: 1 } }).fetch().map(function (e) { return e.handle; }) : [];
        flights24h = Flights.find({ entity: { $in: handles }, started: { $gte: cutoff } }).count();
      }
      // Count emissions in last 24h
      let emissions24h = 0;
      if (Emissions && entityCount > 0) {
        const cutoff = new Date(Date.now() - 86400000);
        const handles = Entities ? Entities.find({ kingdomId: k.name }, { fields: { handle: 1 } }).fetch().map(function (e) { return e.handle; }) : [];
        emissions24h = Emissions.find({ entity: { $in: handles }, timestamp: { $gte: cutoff } }).count();
      }
      return Object.assign({}, k, {
        memberCount: entityCount,
        flights24h: flights24h,
        emissions24h: emissions24h,
      });
    });
  },

  // --- Cross-kingdom bonds ---
  crossKingdomBondsView() { return _crossKingdomBonds.get(); },
  crossKingdomViewClass(name) { return _crossKingdomBonds.get() === name ? 'active' : ''; },
  crossKingdomCount() {
    const CrossKingdomBonds = _col('CrossKingdomBonds');
    return CrossKingdomBonds ? CrossKingdomBonds.find().count() : 0;
  },
  crossKingdomBondsGrouped() {
    const CrossKingdomBonds = _col('CrossKingdomBonds');
    if (!CrossKingdomBonds) return [];
    return CrossKingdomBonds.find().fetch();
  },

  // --- Env vars (injected identity) ---
  entityEnv(handle) {
    const EnvIndex = _col('EnvIndex');
    if (!EnvIndex) return null;
    return EnvIndex.findOne({ handle });
  },
  entityRole(handle) {
    const entityEnv = Template.KingdomOverview.helpers.entityEnv(handle);
    return entityEnv ? entityEnv.role : null;
  },
  entityPurpose(handle) {
    const entityEnv = Template.KingdomOverview.helpers.entityEnv(handle);
    return entityEnv ? entityEnv.purpose : null;
  },
  entityHarness(handle) {
    const entityEnv = Template.KingdomOverview.helpers.entityEnv(handle);
    return entityEnv ? entityEnv.harness : null;
  },

  // --- Entities view ---
  activeEntities() {
    const q = _searchQuery.get().toLowerCase();
    const kf = _kingdomFilter.get().toLowerCase();
    return _computeAllEntities().filter(function (e) {
      // Search filter
      if (q && e.handle.toLowerCase().indexOf(q) === -1 &&
          (!e.tagline || e.tagline.toLowerCase().indexOf(q) === -1) &&
          (!e.role || e.role.toLowerCase().indexOf(q) === -1) &&
          (!e.purpose || e.purpose.toLowerCase().indexOf(q) === -1)) return false;
      // Kingdom filter
      if (kf && (!e.kingdomId || e.kingdomId.toLowerCase().indexOf(kf) === -1)) return false;
      return e.flights24h > 0 || e.emissions24h > 0 || e.activeFlight;
    });
  },

  bullpenEntities() {
    const q = _searchQuery.get().toLowerCase();
    const kf = _kingdomFilter.get().toLowerCase();
    return _computeAllEntities().filter(function (e) {
      // Search filter
      if (q && e.handle.toLowerCase().indexOf(q) === -1 &&
          (!e.tagline || e.tagline.toLowerCase().indexOf(q) === -1) &&
          (!e.role || e.role.toLowerCase().indexOf(q) === -1) &&
          (!e.purpose || e.purpose.toLowerCase().indexOf(q) === -1)) return false;
      // Kingdom filter
      if (kf && (!e.kingdomId || e.kingdomId.toLowerCase().indexOf(kf) === -1)) return false;
      return !(e.flights24h > 0 || e.emissions24h > 0 || e.activeFlight);
    });
  },

  entities() {
    const q = _searchQuery.get().toLowerCase();
    const kf = _kingdomFilter.get().toLowerCase();
    return _computeAllEntities().filter(function (e) {
      // Search filter
      if (q && e.handle.toLowerCase().indexOf(q) === -1 &&
          (!e.tagline || e.tagline.toLowerCase().indexOf(q) === -1) &&
          (!e.role || e.role.toLowerCase().indexOf(q) === -1) &&
          (!e.purpose || e.purpose.toLowerCase().indexOf(q) === -1)) return false;
      // Kingdom filter
      if (kf && (!e.kingdomId || e.kingdomId.toLowerCase().indexOf(kf) === -1)) return false;
      return true;
    });
  },

  // --- Flights view ---
  allFlightsCount() {
    const Flights = _col('Flights');
    return Flights ? Flights.find().count() : 0;
  },

  flightFilterClass(name) { return _flightFilter.get() === name ? 'active' : ''; },

  flightRows() {
    const Flights = _col('Flights');
    if (!Flights) return [];
    const filter = _flightFilter.get();
    const selector = {};
    if (filter === 'flying') selector.status = 'flying';
    else if (filter === 'stale') selector.status = 'stale';
    else if (filter === 'landed') selector.status = { $in: ['landed', 'closed'] };

    tick1s.depend();
    return Flights.find(selector, { sort: { started: -1 }, limit: 200 }).map(function (f) {
      return {
        status: f.status,
        entity: f.entity,
        entityColor: KoadOverview._entityColor(f.entity),
        briefSlug: f.briefSlug || '',
        briefSummary: f.briefSummary || '',
        startedFmt: KoadOverview._shortDate(f.started),
        elapsed: f.status === 'flying' ? KoadOverview._elapsed(f.started) : KoadOverview._formatElapsed(f.elapsed),
        model: f.model || '',
      };
    });
  },

  // --- Bonds view ---
  bondsGrouped() {
    const BondsIndex = _col('BondsIndex');
    if (!BondsIndex) return [];
    return BondsIndex.find({}, { sort: { handle: 1 } }).map(function (doc) {
      return {
        handle: doc.handle,
        entityColor: KoadOverview._entityColor(doc.handle),
        count: doc.count || 0,
        bonds: doc.bonds || [],
      };
    }).filter(function (g) { return g.count > 0; });
  },

  // --- Keys view ---
  keysGrouped() {
    const KeysIndex = _col('KeysIndex');
    if (!KeysIndex) return [];
    return KeysIndex.find({}, { sort: { handle: 1 } }).map(function (doc) {
      return {
        handle: doc.handle,
        entityColor: KoadOverview._entityColor(doc.handle),
        count: doc.count || 0,
        keys: doc.keys || [],
      };
    }).filter(function (g) { return g.count > 0; });
  },

  // --- Tickles view ---
  ticklesGrouped() {
    const TicklerIndex = _col('TicklerIndex');
    if (!TicklerIndex) return [];
    return TicklerIndex.find({}, { sort: { handle: 1 } }).map(function (doc) {
      return {
        handle: doc.handle,
        entityColor: KoadOverview._entityColor(doc.handle),
        count: doc.count || 0,
        tickles: doc.tickles || [],
      };
    }).filter(function (g) { return g.count > 0; });
  },

  // --- Alerts view ---
  alertsGrouped() {
    const Alerts = _col('Alerts');
    if (!Alerts) return [];
    var groups = [];
    Alerts.find({}, { sort: { entity: 1 } }).forEach(function (doc) {
      if (!doc.items || doc.items.length === 0) return;
      var items = doc.items.map(function (item) {
        var text = typeof item === 'string' ? item : (item.message || item.body || item.text || JSON.stringify(item));
        return { source: doc.source, text: text };
      });
      groups.push({
        entity: doc.entity,
        entityColor: KoadOverview._entityColor(doc.entity),
        items: items,
      });
    });
    return groups;
  },

  // --- Activity panel ---
  selectedEntityHandle() {
    return _selectedEntity.get();
  },

  selectedEntityData() {
    const handle = _selectedEntity.get();
    if (!handle) return null;
    const Entities = _col('Entities');
    const Passengers = _col('Passengers');
    const EnvIndex = _col('EnvIndex');
    const BondsIndex = _col('BondsIndex');
    const KeysIndex = _col('KeysIndex');
    const TicklerIndex = _col('TicklerIndex');
    const entity = Entities ? Entities.findOne({ handle }) : null;
    if (!entity) return null;
    const passenger = Passengers ? Passengers.findOne({ handle }) : null;
    const envDoc = EnvIndex ? EnvIndex.findOne({ handle }) : null;
    const bondsDoc = BondsIndex ? BondsIndex.findOne({ handle }) : null;
    const keysDoc = KeysIndex ? KeysIndex.findOne({ handle }) : null;
    const tickleDoc = TicklerIndex ? TicklerIndex.findOne({ handle }) : null;
    const outfit = passenger && passenger.outfit;
    const hue = outfit ? outfit.hue : 0;
    const sat = outfit ? outfit.saturation : 0;
    const bri = outfit ? outfit.brightness : 30;
    return {
      handle,
      avatarImage: passenger ? passenger.image : null,
      firstLetter: handle.charAt(0).toUpperCase(),
      accentColor: 'hsl(' + hue + ', ' + sat + '%, ' + Math.min(bri + 20, 60) + '%)',
      tagline: entity.tagline || null,
      role: entity.role || null,
      kingdomId: entity.kingdomId || null,
      host: entity.homeMachine || null,
      // Env-derived
      purpose: envDoc ? envDoc.purpose : null,
      harness: envDoc ? envDoc.harness : null,
      // Counts
      bondCount: bondsDoc ? bondsDoc.count : 0,
      keyCount: keysDoc ? keysDoc.count : 0,
      tickleCount: tickleDoc ? tickleDoc.count : 0,
      // Full lists for detail view
      bonds: bondsDoc ? bondsDoc.bonds || [] : [],
      keys: keysDoc ? keysDoc.keys || [] : [],
      tickles: tickleDoc ? tickleDoc.tickles || [] : [],
    };
  },

  activeFlightsList() {
    const Flights = _col('Flights');
    if (!Flights) return [];
    tick1s.depend();
    const sel = _selectedEntity.get();
    const q = { status: 'flying' };
    if (sel) q.entity = sel;
    return Flights.find(q, { sort: { started: -1 } }).map(function (flight) {
      return {
        entity: flight.entity,
        entityColor: KoadOverview._entityColor(flight.entity),
        briefSlug: flight.briefSlug || '',
        briefSummary: flight.briefSummary || '',
        model: flight.model || '',
        elapsed: KoadOverview._elapsed(flight.started),
      };
    });
  },

  activeSessions() {
    const Sessions = _col('HarnessSessions');
    if (!Sessions) return [];
    tick1s.depend();
    const sel = _selectedEntity.get();
    const q = { status: 'active' };
    if (sel) q.entity = sel;
    return Sessions.find(q, { sort: { lastSeen: -1 } }).map(function (s) {
      // Rate limits breakdown
      var rateFive = s.rateLimits && s.rateLimits.fiveHour ? s.rateLimits.fiveHour : null;
      var rateSeven = s.rateLimits && s.rateLimits.sevenDay ? s.rateLimits.sevenDay : null;
      return {
        entity: s.entity,
        entityColor: KoadOverview._entityColor(s.entity),
        model: s.model || '?',
        modelId: s.modelId || '',
        host: s.host || '',
        cwd: s.cwd || '',
        version: s.version || '',
        contextPct: s.contextPct != null ? Math.round(s.contextPct) : 0,
        contextSize: s.contextSize || 0,
        tokensIn: s.tokensIn || 0,
        tokensOut: s.tokensOut || 0,
        durationMs: s.durationMs || 0,
        cost: s.cost || null,
        rateFiveHourPct: rateFive ? rateFive.usedPct : null,
        rateFiveHourResetsAt: rateFive && rateFive.resetsAt ? KoadOverview._relativeTime(rateFive.resetsAt) : null,
        rateSevenDayPct: rateSeven ? rateSeven.usedPct : null,
        rateSevenDayResetsAt: rateSeven && rateSeven.resetsAt ? KoadOverview._relativeTime(rateSeven.resetsAt) : null,
        lastSeenAgo: KoadOverview._relativeTime(s.lastSeen),
      };
    });
  },

  activeSessionCount() {
    const Sessions = _col('HarnessSessions');
    if (!Sessions) return 0;
    const sel = _selectedEntity.get();
    const q = { status: 'active' };
    if (sel) q.entity = sel;
    return Sessions.find(q).count();
  },

  alertFeed() {
    const Alerts = _col('Alerts');
    if (!Alerts) return [];
    const sel = _selectedEntity.get();
    const q = sel ? { entity: sel } : {};
    var items = [];
    Alerts.find(q).forEach(function (doc) {
      if (!doc.items) return;
      doc.items.forEach(function (item) {
        var text = typeof item === 'string' ? item : (item.message || item.body || item.text || JSON.stringify(item));
        items.push({
          entity: doc.entity,
          entityColor: KoadOverview._entityColor(doc.entity),
          source: doc.source,
          text: text,
          bodyClass: doc.source === 'alerts' ? 'alert-body' : 'notif-body',
        });
      });
    });
    return items;
  },

  emissions() {
    const Emissions = _col('Emissions');
    if (!Emissions) return [];
    tick1m.depend();
    const sel = _selectedEntity.get();
    const q = sel ? { entity: sel } : {};
    return Emissions.find(q, { sort: { timestamp: -1 }, limit: 3 }).map(function (em) {
      return {
        entity: em.entity,
        type: em.type,
        body: em.body,
        entityColor: KoadOverview._entityColor(em.entity),
        relativeTime: KoadOverview._relativeTime(em.timestamp),
      };
    });
  },

  landedFlights() {
    const Flights = _col('Flights');
    if (!Flights) return [];
    tick1m.depend();
    const sel = _selectedEntity.get();
    const q = { status: { $ne: 'flying' } };
    if (sel) q.entity = sel;
    return Flights.find(q, { sort: { started: -1 }, limit: 18 }).map(function (flight) {
      const hasStats = flight.stats && (
        flight.stats.toolCalls || flight.stats.inputTokens || flight.stats.outputTokens ||
        flight.stats.cost || flight.stats.linesAdded || flight.stats.linesRemoved ||
        flight.stats.contextTokens || flight.stats.apiDurationMs
      );
      return {
        entity: flight.entity,
        entityColor: KoadOverview._entityColor(flight.entity),
        briefSlug: flight.briefSlug || '',
        status: flight.status,
        model: flight.model || '',
        elapsed: KoadOverview._formatElapsed(flight.elapsed),
        relativeTime: KoadOverview._relativeTime(flight.started),
        completionSummary: flight.completionSummary || '',
        hasStats: !!hasStats,
        stats: flight.stats || {},
      };
    });
  },

  formatTokens(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return '' + n;
  },

  formatCost(n) {
    if (!n) return '0.00';
    return n.toFixed(2);
  },

  publicTierHint() {
    return !!(KoadOverview._settings && KoadOverview._settings.publicTierHint);
  },
});

// Compute per-entity render data, shared by activeEntities/bullpenEntities.
function _computeAllEntities() {
  const Entities = _col('Entities');
  const Passengers = _col('Passengers');
  const KeysIndex = _col('KeysIndex');
  const BondsIndex = _col('BondsIndex');
  const TicklerIndex = _col('TicklerIndex');
  const Alerts = _col('Alerts');
  const Flights = _col('Flights');
  const Emissions = _col('Emissions');
  const EnvIndex = _col('EnvIndex');

  if (!Entities) return [];

  const selected = _selectedEntity.get();
  return Entities.find({}, { sort: { handle: 1 } }).map(function (entity) {
    const passenger = Passengers ? Passengers.findOne({ handle: entity.handle }) : null;
    const keysDoc = KeysIndex ? KeysIndex.findOne({ handle: entity.handle }) : null;
    const bondsDoc = BondsIndex ? BondsIndex.findOne({ handle: entity.handle }) : null;
    const ticklerDoc = TicklerIndex ? TicklerIndex.findOne({ handle: entity.handle }) : null;
    const alertDocs = Alerts ? Alerts.find({ entity: entity.handle }).fetch() : [];
    const envDoc = EnvIndex ? EnvIndex.findOne({ handle: entity.handle }) : null;

    const outfit = passenger && passenger.outfit;
    const hue = outfit ? outfit.hue : 0;
    const sat = outfit ? outfit.saturation : 0;
    const bri = outfit ? outfit.brightness : 30;
    const accent = 'hsl(' + hue + ', ' + sat + '%, ' + Math.min(bri + 20, 60) + '%)';

    const activeFlights = Flights ? Flights.find({ entity: entity.handle, status: 'flying' }, { sort: { started: -1 } }).fetch() : [];
    const isSelected = selected === entity.handle;

    tick1s.depend();
    const now = Date.now();
    const lastAct = entity.lastActivity ? new Date(entity.lastActivity).getTime() : 0;
    const ageMs = lastAct ? (now - lastAct) : Infinity;
    const isActiveNow = ageMs < 60000;
    const isActive5m = ageMs < 300000;

    let statusLevel, statusLabel;
    if (ageMs < 60000) { statusLevel = 'live'; statusLabel = 'active now'; }
    else if (ageMs < 3600000) { statusLevel = 'recent'; statusLabel = 'recent activity'; }
    else if (ageMs < 86400000) { statusLevel = 'idle'; statusLabel = 'idle'; }
    else { statusLevel = 'cold'; statusLabel = lastAct ? 'dormant' : 'never seen'; }

    const lastSeenText = lastAct ? KoadOverview._lastSeen(ageMs) : '';
    const host = entity.homeMachine || null;

    const cutoff24h = new Date(now - 86400000);
    const flights24h = Flights ? Flights.find({ entity: entity.handle, started: { $gte: cutoff24h } }).count() : 0;
    const emissions24h = Emissions ? Emissions.find({ entity: entity.handle, timestamp: { $gte: cutoff24h } }).count() : 0;

    const lastFlight = Flights ? Flights.findOne({ entity: entity.handle }, { sort: { started: -1 } }) : null;
    const lastFlightAge = lastFlight ? KoadOverview._lastSeen(now - new Date(lastFlight.started).getTime()) : '';

    let alertItemCount = 0;
    alertDocs.forEach(function (d) { alertItemCount += (d.items ? d.items.length : 0); });

    const result = {
      handle: entity.handle,
      avatarImage: passenger ? passenger.image : null,
      firstLetter: entity.handle.charAt(0).toUpperCase(),
      accentColor: accent,
      entityHue: hue,
      entitySat: sat,
      tagline: entity.tagline || null,
      role: entity.role || null,
      kingdomId: entity.kingdomId || null,
      host: host,
      purpose: envDoc ? envDoc.purpose : null,
      harness: envDoc ? envDoc.harness : null,
      keyCount: keysDoc ? keysDoc.count : 0,
      bondCount: bondsDoc ? bondsDoc.count : 0,
      tickleCount: ticklerDoc ? ticklerDoc.count : 0,
      isSelected: isSelected,
      isActiveNow: isActiveNow,
      isActive5m: isActive5m,
      statusLevel: statusLevel,
      statusLabel: statusLabel,
      lastSeenText: lastSeenText,
      flights24h: flights24h,
      emissions24h: emissions24h,
      lastFlightAge: lastFlightAge,
      alertItemCount: alertItemCount,
      hasAlerts: alertItemCount > 0,
    };

    if (activeFlights.length) {
      result.activeFlight = true;
      result.activeFlightCount = activeFlights.length;
      result.activeFlightsList = activeFlights.map(function (f) {
        return {
          flightBrief: f.briefSlug || '',
          flightSummary: f.briefSummary || '',
          flightElapsed: KoadOverview._elapsed(f.started),
          flightModel: f.model || '',
          accentColor: accent,
        };
      });
      // Keep single-flight fields for backward compat with card summary
      result.flightBrief = activeFlights[0].briefSlug || '';
      result.flightSummary = activeFlights[0].briefSummary || '';
      result.flightElapsed = KoadOverview._elapsed(activeFlights[0].started);
      result.flightModel = activeFlights[0].model || '';
    }

    return result;
  });
}

// =====================================================================
// EntityProfilePanel template
// =====================================================================

Template.EntityProfilePanel.helpers({
  entityData() {
    const handle = Template.instance().data && Template.instance().data.handle;
    if (!handle) return null;
    const Entities = _col('Entities');
    const Passengers = _col('Passengers');
    const KeysIndex = _col('KeysIndex');
    const BondsIndex = _col('BondsIndex');
    const Flights = _col('Flights');

    const entity = Entities ? Entities.findOne({ handle }) : null;
    if (!entity) return null;

    const passenger = Passengers ? Passengers.findOne({ handle }) : null;
    const keysDoc = KeysIndex ? KeysIndex.findOne({ handle }) : null;
    const bondsDoc = BondsIndex ? BondsIndex.findOne({ handle }) : null;
    const activeFlights = Flights ? Flights.find({ entity: handle, status: 'flying' }, { sort: { started: -1 } }).fetch() : [];

    const outfit = passenger && passenger.outfit;
    const hue = outfit ? outfit.hue : 0;
    const sat = outfit ? outfit.saturation : 0;
    const bri = outfit ? outfit.brightness : 30;
    const accent = 'hsl(' + hue + ', ' + sat + '%, ' + Math.min(bri + 20, 60) + '%)';

    tick1s.depend();
    const result = {
      handle,
      avatarImage: passenger ? passenger.image : null,
      firstLetter: handle.charAt(0).toUpperCase(),
      accentColor: accent,
      tagline: entity.tagline || null,
      role: entity.role || null,
      host: entity.homeMachine || null,
      keyCount: keysDoc ? keysDoc.count : 0,
      bondCount: bondsDoc ? bondsDoc.count : 0,
      activeFlight: activeFlights.length > 0,
      activeFlightsList: activeFlights.map(function (f) {
        return {
          flightBrief: f.briefSlug || '',
          flightSummary: f.briefSummary || '',
          flightElapsed: KoadOverview._elapsed(f.started),
          flightModel: f.model || '',
          accentColor: accent,
        };
      }),
    };
    if (activeFlights.length) {
      result.flightBrief = activeFlights[0].briefSlug || '';
      result.flightElapsed = KoadOverview._elapsed(activeFlights[0].started);
      result.flightModel = activeFlights[0].model || '';
    }
    return result;
  },

  entityFlights() {
    const handle = Template.instance().data && Template.instance().data.handle;
    const Flights = _col('Flights');
    if (!handle || !Flights) return [];
    tick1m.depend();
    return Flights.find(
      { entity: handle },
      { sort: { started: -1 }, limit: 50 }
    ).map(function (f) {
      const hasStats = f.stats && (f.stats.toolCalls || f.stats.cost);
      return {
        briefSlug: f.briefSlug || '(unnamed)',
        status: f.status,
        model: f.model || '',
        elapsed: KoadOverview._formatElapsed(f.elapsed),
        relativeTime: KoadOverview._relativeTime(f.started),
        hasStats: !!hasStats,
        stats: f.stats || {},
      };
    });
  },

  entityFlightsCount() {
    const handle = Template.instance().data && Template.instance().data.handle;
    const Flights = _col('Flights');
    if (!handle || !Flights) return 0;
    return Flights.find({ entity: handle }).count();
  },

  entityEmissions() {
    const handle = Template.instance().data && Template.instance().data.handle;
    const Emissions = _col('Emissions');
    if (!handle || !Emissions) return [];
    tick1m.depend();
    return Emissions.find(
      { entity: handle },
      { sort: { timestamp: -1 }, limit: 50 }
    ).map(function (em) {
      return {
        type: em.type,
        body: em.body,
        relativeTime: KoadOverview._relativeTime(em.timestamp),
      };
    });
  },

  entityBonds() {
    const handle = Template.instance().data && Template.instance().data.handle;
    const BondsIndex = _col('BondsIndex');
    if (!handle || !BondsIndex) return [];
    const doc = BondsIndex.findOne({ handle });
    return doc && doc.bonds ? doc.bonds : [];
  },

  entityKeys() {
    const handle = Template.instance().data && Template.instance().data.handle;
    const KeysIndex = _col('KeysIndex');
    if (!handle || !KeysIndex) return [];
    const doc = KeysIndex.findOne({ handle });
    return doc && doc.keys ? doc.keys : [];
  },

  formatCost(n) {
    if (!n) return '0.00';
    return n.toFixed(2);
  },
});

// =====================================================================
// Force-directed bond graph — vanilla JS, no d3
// =====================================================================

function parseBondPair(filename) {
  const base = filename.replace(/\.(md|asc|json)$/, '');
  const m = base.match(/^(.+?)-to-(.+)$/);
  if (!m) return null;
  return { from: m[1], to: m[2], name: base };
}

function buildBondGraph() {
  const Entities = _col('Entities');
  const BondsIndex = _col('BondsIndex');
  const Passengers = _col('Passengers');
  if (!BondsIndex || !Entities) return { nodes: [], edges: [] };

  const pairs = new Map();
  BondsIndex.find().forEach(doc => {
    if (!doc.bonds) return;
    doc.bonds.forEach(b => {
      const p = parseBondPair(b.filename || b.base || '');
      if (!p) return;
      const key = p.from + '->' + p.to;
      if (!pairs.has(key)) pairs.set(key, p);
    });
  });

  const nodeSet = new Set();
  pairs.forEach(p => { nodeSet.add(p.from); nodeSet.add(p.to); });
  Entities.find().forEach(e => nodeSet.add(e.handle));

  const nodes = Array.from(nodeSet).map(handle => {
    const entity = Entities.findOne({ handle }) || { handle };
    const passenger = Passengers ? Passengers.findOne({ handle }) : null;
    const outfit = passenger && passenger.outfit;
    const hue = outfit ? outfit.hue : 0;
    const sat = outfit ? outfit.saturation : 20;
    const bri = outfit ? outfit.brightness : 30;
    const lastAct = entity.lastActivity ? new Date(entity.lastActivity).getTime() : 0;
    const ageMs = lastAct ? (Date.now() - lastAct) : Infinity;
    return {
      handle,
      color: 'hsl(' + hue + ', ' + sat + '%, ' + Math.min(bri + 20, 60) + '%)',
      avatar: passenger ? passenger.image : null,
      firstLetter: handle.charAt(0).toUpperCase(),
      isActive: ageMs < 60000,
      x: 0, y: 0, vx: 0, vy: 0,
      pinned: false,
    };
  });

  const edges = Array.from(pairs.values()).map(p => ({ from: p.from, to: p.to, name: p.name }));
  return { nodes, edges };
}

let _bondSim = null;

function startBondGraph(container) {
  if (_bondSim) stopBondGraph();

  const svg = container.querySelector('.bond-graph-svg');
  const rect = container.getBoundingClientRect();
  let W = rect.width;
  let H = rect.height;

  const graph = buildBondGraph();
  if (graph.nodes.length === 0) return;

  const nodeMap = {};
  graph.nodes.forEach(n => { nodeMap[n.handle] = n; });

  const cx = W / 2, cy = H / 2;
  const radius = Math.min(W, H) * 0.35;
  graph.nodes.forEach((n, i) => {
    const angle = (i / graph.nodes.length) * Math.PI * 2;
    n.x = cx + Math.cos(angle) * radius;
    n.y = cy + Math.sin(angle) * radius;
  });

  svg.innerHTML = '';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = '<marker id="bondArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="bond-edge-arrow"></path></marker>';
  svg.appendChild(defs);

  const edgeEls = graph.edges.map(e => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'bond-edge');
    line.setAttribute('marker-end', 'url(#bondArrow)');
    svg.appendChild(line);
    e._el = line;
    e._fromNode = nodeMap[e.from];
    e._toNode = nodeMap[e.to];
    return e;
  }).filter(e => e._fromNode && e._toNode);

  container.querySelectorAll('.bond-node').forEach(el => el.remove());

  const nodeEls = graph.nodes.map(n => {
    const el = document.createElement('div');
    el.className = 'bond-node' + (n.isActive ? ' active-now' : '');
    el.style.background = n.color;
    el.dataset.handle = n.handle;
    if (n.avatar) {
      const img = document.createElement('img');
      img.src = n.avatar;
      img.alt = n.handle;
      el.appendChild(img);
    } else {
      el.textContent = n.firstLetter;
    }
    const label = document.createElement('div');
    label.className = 'bond-node-label';
    label.textContent = n.handle;
    el.appendChild(label);
    container.appendChild(el);
    n._el = el;
    return n;
  });

  let dragNode = null;
  let dragOffset = { x: 0, y: 0 };

  function onPointerDown(e) {
    const target = e.target.closest('.bond-node');
    if (!target) return;
    const handle = target.dataset.handle;
    dragNode = nodeMap[handle];
    if (!dragNode) return;
    dragNode.pinned = true;
    target.classList.add('dragging');
    const containerRect = container.getBoundingClientRect();
    dragOffset.x = e.clientX - containerRect.left - dragNode.x;
    dragOffset.y = e.clientY - containerRect.top - dragNode.y;
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragNode) return;
    const containerRect = container.getBoundingClientRect();
    dragNode.x = e.clientX - containerRect.left - dragOffset.x;
    dragNode.y = e.clientY - containerRect.top - dragOffset.y;
    dragNode.vx = 0;
    dragNode.vy = 0;
  }

  function onPointerUp() {
    if (dragNode && dragNode._el) dragNode._el.classList.remove('dragging');
    if (dragNode) dragNode.pinned = false;
    dragNode = null;
  }

  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  const REPULSION = 8000;
  const SPRING = 0.02;
  const REST_LENGTH = 140;
  const CENTER_GRAVITY = 0.002;
  const DAMPING = 0.85;
  const MAX_SPEED = 18;

  let rafId = null;
  let running = true;

  function step() {
    nodeEls.forEach(n => { n.fx = 0; n.fy = 0; });

    for (let i = 0; i < nodeEls.length; i++) {
      for (let j = i + 1; j < nodeEls.length; j++) {
        const a = nodeEls[i], b = nodeEls[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const d = Math.sqrt(d2);
        const f = REPULSION / d2;
        const fx = f * dx / d, fy = f * dy / d;
        a.fx += fx; a.fy += fy;
        b.fx -= fx; b.fy -= fy;
      }
    }

    edgeEls.forEach(e => {
      const a = e._fromNode, b = e._toNode;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const stretch = d - REST_LENGTH;
      const f = SPRING * stretch;
      const fx = f * dx / d, fy = f * dy / d;
      a.fx += fx; a.fy += fy;
      b.fx -= fx; b.fy -= fy;
    });

    nodeEls.forEach(n => {
      n.fx += (cx - n.x) * CENTER_GRAVITY;
      n.fy += (cy - n.y) * CENTER_GRAVITY;
    });

    nodeEls.forEach(n => {
      if (n.pinned) return;
      n.vx = (n.vx + n.fx) * DAMPING;
      n.vy = (n.vy + n.fy) * DAMPING;
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (speed > MAX_SPEED) { n.vx = n.vx / speed * MAX_SPEED; n.vy = n.vy / speed * MAX_SPEED; }
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(30, Math.min(W - 30, n.x));
      n.y = Math.max(30, Math.min(H - 30, n.y));
    });

    nodeEls.forEach(n => {
      n._el.style.left = n.x + 'px';
      n._el.style.top = n.y + 'px';
    });
    edgeEls.forEach(e => {
      const a = e._fromNode, b = e._toNode;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const shortening = 26;
      const ux = dx / d, uy = dy / d;
      e._el.setAttribute('x1', a.x + ux * shortening);
      e._el.setAttribute('y1', a.y + uy * shortening);
      e._el.setAttribute('x2', b.x - ux * shortening);
      e._el.setAttribute('y2', b.y - uy * shortening);
    });

    if (running) rafId = requestAnimationFrame(step);
  }

  rafId = requestAnimationFrame(step);

  function onResize() {
    const r = container.getBoundingClientRect();
    W = r.width;
    H = r.height;
  }
  window.addEventListener('resize', onResize);

  _bondSim = {
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', onResize);
    },
  };
}

function stopBondGraph() {
  if (_bondSim) { _bondSim.stop(); _bondSim = null; }
}

Template.KingdomOverview.onRendered(function () {
  const instance = this;
  instance.autorun(function () {
    const view = _currentView.get();
    const bondView = _bondView.get();
    const BondsIndex = _col('BondsIndex');
    const Entities = _col('Entities');
    if (BondsIndex) BondsIndex.find().count();
    if (Entities) Entities.find().count();

    if (view === 'bonds' && bondView === 'graph') {
      Tracker.afterFlush(function () {
        const container = instance.find('#bond-graph');
        if (container) startBondGraph(container);
      });
    } else {
      stopBondGraph();
    }
  });
});

Template.KingdomOverview.onDestroyed(function () {
  stopBondGraph();
});
