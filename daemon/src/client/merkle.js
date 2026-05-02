import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';

import './merkle.html';
import './merkle.css';

// Reactive state
const _treeState = new ReactiveVar(null);
const _loading   = new ReactiveVar(true);
const _error     = new ReactiveVar(null);

function fetchTreeState() {
  _loading.set(true);
  _error.set(null);
  Meteor.call('merkle.buildState', (err, result) => {
    _loading.set(false);
    if (err) {
      _error.set(err.message || 'Unknown error building tree');
      _treeState.set(null);
    } else {
      _treeState.set(result);
    }
  });
}

Template.MerkleView.onCreated(function () {
  fetchTreeState();
});

Template.MerkleView.helpers({
  loading() {
    return _loading.get();
  },

  error() {
    return _error.get();
  },

  kingdom() {
    const s = _treeState.get();
    return s ? s.kingdom : '';
  },

  status() {
    const s = _treeState.get();
    return s ? s.status : '';
  },

  statusLabel() {
    const s = _treeState.get();
    if (!s) return '';
    const labels = {
      built: 'built (unsigned)',
      no_published_tips: 'no published tips',
      error: 'error',
    };
    return labels[s.status] || s.status;
  },

  rootDisplay() {
    const s = _treeState.get();
    return (s && s.root) ? s.root : '—';
  },

  signatureDisplay() {
    const s = _treeState.get();
    return (s && s.signature) ? s.signature : '— (signing deferred, sovereign key not wired)';
  },

  seqnoDisplay() {
    const s = _treeState.get();
    return (s && s.seqno !== null && s.seqno !== undefined) ? s.seqno : '— (starts with signing)';
  },

  leaf_count() {
    const s = _treeState.get();
    return s ? s.leaf_count : 0;
  },

  timestamp() {
    const s = _treeState.get();
    return s ? s.timestamp : '';
  },

  message() {
    const s = _treeState.get();
    return s ? s.message : null;
  },

  specRef() {
    const s = _treeState.get();
    return s ? s.specRef : 'VESTA-SPEC-169';
  },

  skippedCount() {
    const s = _treeState.get();
    return s ? s.skippedCount : 0;
  },

  totalEntityCount() {
    const s = _treeState.get();
    return s && s.allEntities ? s.allEntities.length : 0;
  },

  allEntities() {
    const s = _treeState.get();
    return s ? s.allEntities : [];
  },

  hasEntities() {
    const s = _treeState.get();
    return s && s.allEntities && s.allEntities.length > 0;
  },

  // Used inside {{#each allEntities}} — `this` is the entity row object
  seqDisplay() {
    return (this.seq !== undefined && this.seq !== null && this.hasRealTip)
      ? this.seq
      : '—';
  },

  skipEntries() {
    const s = _treeState.get();
    if (!s || !s.skip) return [];
    return Object.entries(s.skip).map(([k, rootHex]) => ({ k, rootHex }));
  },

  hasSkip() {
    const s = _treeState.get();
    return s && s.skip && Object.keys(s.skip).length > 0;
  },
});

Template.MerkleView.events({
  'click .merkle-refresh-btn'() {
    fetchTreeState();
  },
});
