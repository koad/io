import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';

import './indexers.html';
import './indexers.css';

// Reactive state
const _indexers     = new ReactiveVar([]);
const _loading      = new ReactiveVar(true);
const _error        = new ReactiveVar(null);
const _reloadStatus = new ReactiveVar(null);  // null | { msg, ok }
const _expanded     = new ReactiveVar(null);   // currently-expanded indexer name
const _yamlCache    = new ReactiveVar({});     // name → { loading, content, error }

// ---------------------------------------------------------------------------
// Fetch indexer list from GET /api/indexers
// ---------------------------------------------------------------------------

function fetchIndexers() {
  _loading.set(true);
  _error.set(null);

  fetch('/api/indexers')
    .then(r => r.json())
    .then(data => {
      _loading.set(false);
      if (data.status === 'ok') {
        _indexers.set(data.indexers || []);
      } else {
        _error.set(data.message || 'unknown error');
        _indexers.set([]);
      }
    })
    .catch(err => {
      _loading.set(false);
      _error.set(err.message || 'fetch failed');
      _indexers.set([]);
    });
}

// ---------------------------------------------------------------------------
// Fetch YAML content for a single indexer's source file
// ---------------------------------------------------------------------------

function fetchYaml(name, yamlPath) {
  const cache = _yamlCache.get();

  // Already loaded or loading
  if (cache[name]) return;

  // Not a real file path (e.g. _source === 'settings') — skip
  if (!yamlPath || yamlPath === 'settings') {
    const next = Object.assign({}, _yamlCache.get());
    next[name] = { loading: false, content: null, error: 'source is settings.json — no YAML file' };
    _yamlCache.set(next);
    return;
  }

  // Mark loading
  const loading = Object.assign({}, _yamlCache.get());
  loading[name] = { loading: true, content: null, error: null };
  _yamlCache.set(loading);

  fetch('/api/indexers/yaml?path=' + encodeURIComponent(yamlPath))
    .then(r => r.json())
    .then(data => {
      const next = Object.assign({}, _yamlCache.get());
      if (data.status === 'ok') {
        next[name] = { loading: false, content: data.content, error: null };
      } else {
        next[name] = { loading: false, content: null, error: data.message || 'error' };
      }
      _yamlCache.set(next);
    })
    .catch(err => {
      const next = Object.assign({}, _yamlCache.get());
      next[name] = { loading: false, content: null, error: err.message || 'fetch failed' };
      _yamlCache.set(next);
    });
}

// ---------------------------------------------------------------------------
// Template lifecycle
// ---------------------------------------------------------------------------

Template.IndexersAdmin.onCreated(function () {
  fetchIndexers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

Template.IndexersAdmin.helpers({
  loading() {
    return _loading.get();
  },

  error() {
    return _error.get();
  },

  hasIndexers() {
    return _indexers.get().length > 0;
  },

  indexers() {
    const expandedName = _expanded.get();
    const cache = _yamlCache.get();

    return _indexers.get().map(idx => {
      const expanded = (idx.name === expandedName);
      const yc = cache[idx.name] || {};

      return Object.assign({}, idx, {
        isExpanded:   expanded,
        yamlLoading:  yc.loading || false,
        yamlContent:  yc.content || null,
        yamlError:    yc.error   || null,
        docCountDisplay: (idx.docCount !== null && idx.docCount !== undefined) ? idx.docCount : '—',
        sourceShort: shortenPath(idx.source),
      });
    });
  },

  reloadStatus() {
    const s = _reloadStatus.get();
    return s ? s.msg : null;
  },

  reloadStatusClass() {
    const s = _reloadStatus.get();
    return s ? (s.ok ? 'ok' : 'error') : '';
  },
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

Template.IndexersAdmin.events({
  'click .indexers-reload-btn'(event, instance) {
    _reloadStatus.set({ msg: 'reloading…', ok: true });

    fetch('/api/indexers/reload', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.status === 'ok') {
          _reloadStatus.set({ msg: `reloaded ${data.reloaded} indexer(s)`, ok: true });
        } else {
          _reloadStatus.set({ msg: data.message || 'error', ok: false });
        }
        // Refresh the list after reload
        _yamlCache.set({});
        fetchIndexers();
        // Clear status after a few seconds
        Meteor.setTimeout(() => _reloadStatus.set(null), 4000);
      })
      .catch(err => {
        _reloadStatus.set({ msg: err.message || 'reload failed', ok: false });
        Meteor.setTimeout(() => _reloadStatus.set(null), 4000);
      });
  },

  'click .indexers-row'(event, instance) {
    const name = this.name;
    const current = _expanded.get();

    if (current === name) {
      // Collapse
      _expanded.set(null);
    } else {
      // Expand and load YAML if needed
      _expanded.set(name);
      fetchYaml(name, this._source);
    }
  },
});

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function shortenPath(p) {
  if (!p) return '—';
  // Replace $HOME with ~
  try {
    const home = (typeof process !== 'undefined' && process.env && process.env.HOME)
      ? process.env.HOME
      : null;
    if (home && p.startsWith(home)) {
      p = '~' + p.slice(home.length);
    }
  } catch (_) { /* skip */ }
  // Truncate long paths from the left
  if (p.length > 60) return '…' + p.slice(p.length - 57);
  return p;
}
