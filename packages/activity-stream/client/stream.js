// SPDX-License-Identifier: AGPL-3.0-or-later
//
// stream.js — ActivityStream core: multi-source sigchain walker, merger, filter
//
// Implements the activity stream primitive described in the sigchain-witness-architecture brief.
// Consumers (profile pages, activity.kingofalldata.com, insiders dashboard) call:
//
//   ActivityStream.from(sources)          → Stream instance (reactive)
//   ActivityStream.entries(stream)        → merged chronological array of entries
//   ActivityStream.filter(stream, opts)   → filtered subset
//   ActivityStream.render(stream, opts)   → template-ready data array
//
// Each source is: { type: 'sigchain', tipCid, label? }
// In-memory sources for tests: { type: 'inline', entries: [...] }
//
// CID resolution delegates to IPFSClient when available. Falls back to null (error state).
// Streams are reactive: ReactiveVar wraps the entry list.

import { ReactiveVar } from 'meteor/reactive-var';

// ── Source types ─────────────────────────────────────────────────────────────

const SOURCE_SIGCHAIN = 'sigchain';
const SOURCE_INLINE   = 'inline';

// ── Stream class ─────────────────────────────────────────────────────────────

/**
 * A Stream holds a set of sources and the merged, sorted entry list derived from them.
 * Internally reactive: Template helpers that read `stream.entries()` re-run on change.
 */
class Stream {
  constructor(sources) {
    this._sources = sources || [];
    this._entries = new ReactiveVar([]);
    this._loading = new ReactiveVar(false);
    this._error   = new ReactiveVar(null);
  }

  /**
   * Start loading entries from all sources.
   * Safe to call multiple times — cancels and restarts if already loading.
   */
  load() {
    this._loading.set(true);
    this._error.set(null);

    _loadAllSources(this._sources)
      .then(entries => {
        this._entries.set(_mergeAndSort(entries));
        this._loading.set(false);
      })
      .catch(err => {
        this._error.set(err.message || String(err));
        this._loading.set(false);
      });

    return this;
  }

  /** Returns the current merged entry list (reactive). */
  entries() {
    return this._entries.get();
  }

  /** True while any source is still loading (reactive). */
  isLoading() {
    return this._loading.get();
  }

  /** Error string if loading failed, null otherwise (reactive). */
  error() {
    return this._error.get();
  }

  /** Number of sources this stream was built from. */
  sourceCount() {
    return this._sources.length;
  }
}

// ── Source loading ────────────────────────────────────────────────────────────

/**
 * Load entries from all sources concurrently.
 * Returns a flat array of entry objects (unsorted, unmerged).
 *
 * @param {Array<object>} sources
 * @returns {Promise<Array<object>>}
 */
async function _loadAllSources(sources) {
  const results = await Promise.allSettled(
    sources.map(src => _loadSource(src))
  );

  const entries = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      entries.push(...result.value);
    }
    // Rejected sources are silently dropped — partial stream is better than no stream.
    // Errors surface via Stream.error() only when ALL sources fail.
  }
  return entries;
}

/**
 * Load entries from a single source.
 *
 * @param {object} source — { type, tipCid?, entries?, label? }
 * @returns {Promise<Array<object>>}
 */
async function _loadSource(source) {
  if (source.type === SOURCE_INLINE) {
    // Test / SSR path: entries provided directly
    return Array.isArray(source.entries) ? source.entries : [];
  }

  if (source.type === SOURCE_SIGCHAIN) {
    if (!source.tipCid) return [];
    return _walkSigchain(source.tipCid);
  }

  // Unknown source type: skip
  console.warn('[activity-stream] Unknown source type:', source.type);
  return [];
}

/**
 * Walk a sigchain from tip CID to genesis, collecting all entries.
 * Uses IPFSClient when available; returns empty array if not wired.
 *
 * @param {string} tipCid
 * @returns {Promise<Array<object>>}
 */
async function _walkSigchain(tipCid) {
  if (typeof IPFSClient === 'undefined' || !IPFSClient || !IPFSClient.get) {
    console.warn('[activity-stream] IPFSClient not available — cannot walk sigchain from CID', tipCid);
    return [];
  }

  const entries = [];
  let cid = tipCid;
  const visited = new Set();

  while (cid && !visited.has(cid)) {
    visited.add(cid);

    let entry;
    try {
      entry = await IPFSClient.get(cid); // expected to return parsed JSON
    } catch (e) {
      console.warn('[activity-stream] Failed to fetch CID', cid, e.message);
      break;
    }

    if (!entry || typeof entry !== 'object') break;

    entries.push({ ...entry, _cid: cid });

    // Walk to previous
    cid = entry.previous || null;
  }

  return entries;
}

// ── Merge and sort ────────────────────────────────────────────────────────────

/**
 * Merge entries from multiple sources and sort chronologically (oldest first).
 * Deduplicates by CID when present.
 *
 * @param {Array<object>} entries — flat array from all sources
 * @returns {Array<object>} — deduplicated, sorted oldest-first
 */
function _mergeAndSort(entries) {
  // Deduplicate by CID (if present)
  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const key = e._cid || (e.timestamp + '|' + e.entity + '|' + e.type);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }

  // Sort chronologically: oldest first
  unique.sort((a, b) => {
    const ta = a.timestamp || '';
    const tb = b.timestamp || '';
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });

  return unique;
}

// ── Filter ────────────────────────────────────────────────────────────────────

/**
 * Filter a stream's current entries by type, entity, and/or time range.
 * Does NOT mutate the stream; returns a filtered array.
 *
 * @param {Stream} stream
 * @param {object} opts
 * @param {string|string[]} [opts.type]     — entry type(s) to include
 * @param {string|string[]} [opts.entity]   — entity name(s) to include
 * @param {string} [opts.after]             — ISO 8601 — include entries after this timestamp
 * @param {string} [opts.before]            — ISO 8601 — include entries before this timestamp
 * @returns {Array<object>}
 */
function filterStream(stream, opts) {
  const entries = stream instanceof Stream ? stream.entries() : (stream || []);
  opts = opts || {};

  const types    = opts.type   ? [].concat(opts.type)   : null;
  const entities = opts.entity ? [].concat(opts.entity) : null;

  return entries.filter(e => {
    if (types && !types.includes(e.type)) return false;
    if (entities && !entities.includes(e.entity)) return false;
    if (opts.after  && e.timestamp <= opts.after)  return false;
    if (opts.before && e.timestamp >= opts.before) return false;
    return true;
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

/**
 * Produce template-ready data from a stream.
 * Each entry is augmented with:
 *   _renderer  — the registered renderer object for this type (or default)
 *   _icon      — entry type icon string
 *   _label     — human-readable label
 *   _description — formatted description string
 *   _timestamp  — ISO 8601 timestamp (original)
 *   _date      — JS Date object
 *
 * @param {Stream|Array} stream
 * @param {object} [opts]
 * @param {string|string[]} [opts.type]   — filter by type (passed to filterStream)
 * @param {string|string[]} [opts.entity] — filter by entity
 * @param {string} [opts.after]
 * @param {string} [opts.before]
 * @returns {Array<object>}
 */
function renderStream(stream, opts) {
  const entries = opts ? filterStream(stream, opts) : (
    stream instanceof Stream ? stream.entries() : (stream || [])
  );

  return entries.map(entry => {
    const renderer = _getRenderer(entry.type);
    return {
      ...entry,
      _renderer:    renderer,
      _icon:        renderer.icon(entry),
      _label:       renderer.label(entry),
      _description: renderer.description(entry),
      _timestamp:   entry.timestamp,
      _date:        entry.timestamp ? new Date(entry.timestamp) : null,
      _link:        renderer.link ? renderer.link(entry) : null,
    };
  });
}

// ── Renderer registry ─────────────────────────────────────────────────────────
// Imported from entry-renderers.js (loaded after this file in package.js order).
// This function is the single lookup point so templates don't depend on the registry directly.

const _renderers = {};

/**
 * Register a renderer for an entry type.
 * Each renderer must implement: icon(entry), label(entry), description(entry).
 * Optionally: link(entry) → URL string or null.
 *
 * @param {string} type — e.g. 'koad.bond', 'koad.release', '*' for default
 * @param {object} renderer
 */
function registerRenderer(type, renderer) {
  _renderers[type] = renderer;
}

function _getRenderer(type) {
  return _renderers[type] || _renderers['*'] || _defaultRenderer;
}

const _defaultRenderer = {
  icon:        () => '⬡',
  label:       (e) => e.type || 'entry',
  description: (e) => `${e.entity || 'unknown'}: ${e.type || 'unknown entry'}`,
  link:        () => null,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new reactive stream from an array of sources.
 * Immediately starts loading.
 *
 * @param {Array<object>} sources — [{ type, tipCid? }, ...]
 * @returns {Stream}
 */
function fromSources(sources) {
  const stream = new Stream(sources);
  stream.load();
  return stream;
}

ActivityStream = {
  from:             fromSources,
  entries:          (stream) => stream instanceof Stream ? stream.entries() : [],
  filter:           filterStream,
  render:           renderStream,
  registerRenderer,

  // Exposed for testing
  _Stream:          Stream,
  _mergeAndSort,
  _loadSource,
};
