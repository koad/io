// SPDX-License-Identifier: AGPL-3.0-or-later
//
// activity-stream-tests.js — Tinytest suite for ActivityStream.
//
// Tests run in the Meteor client context (Tinytest browser harness).
// IPFS fetches are stubbed via inline sources — no daemon required.
//
// Coverage:
//   1. Stream creation with multiple inline sources
//   2. Chronological merging (oldest first)
//   3. Deduplication by CID
//   4. Filter by type
//   5. Filter by entity
//   6. Filter by time range (after / before)
//   7. Empty state (zero entries)
//   8. Entry renderer registration and lookup
//   9. Render output shape (required fields present)
//  10. ActivityStream.entries() returns correct array from Stream
//  11. ActivityStream.filter() with combined type + entity filter
//  12. Inline source loads without IPFS client

// ── Test fixtures ─────────────────────────────────────────────────────────────

const ENTRY_GENESIS = {
  version: 1, entity: 'juno', timestamp: '2026-04-16T00:00:00Z',
  type: 'koad.genesis',
  payload: { entity: 'juno', pubkey: 'abc', created: '2026-04-16T00:00:00Z', description: 'test' },
  previous: null, signature: 'sig1',
  _cid: 'bagutest001'
};

const ENTRY_BOND = {
  version: 1, entity: 'juno', timestamp: '2026-04-16T01:00:00Z',
  type: 'koad.bond',
  payload: { action: 'filed', from: 'juno', to: 'vulcan', bond_type: 'authorized-builder', bond_cid: 'bagutest099' },
  previous: 'bagutest001', signature: 'sig2',
  _cid: 'bagutest002'
};

const ENTRY_RELEASE = {
  version: 1, entity: 'vulcan', timestamp: '2026-04-16T02:00:00Z',
  type: 'koad.release',
  payload: { package: 'koad:io-activity-stream', version: '0.1.0', url: 'https://kingofalldata.com' },
  previous: 'bagutest001', signature: 'sig3',
  _cid: 'bagutest003'
};

const ENTRY_STATE = {
  version: 1, entity: 'vulcan', timestamp: '2026-04-16T03:00:00Z',
  type: 'koad.state-update',
  payload: { scope: 'profile', data: { name: 'Vulcan' } },
  previous: 'bagutest003', signature: 'sig4',
  _cid: 'bagutest004'
};

const ENTRY_DEVICE_ADD = {
  version: 1, entity: 'juno', timestamp: '2026-04-16T04:00:00Z',
  type: 'koad.device-key-add',
  payload: {
    device_id: 'wonderland',
    device_pubkey: 'devpub',
    device_description: 'wonderland — primary workstation',
    key_type: 'ed25519',
    authorized_by: 'rootpub',
    reverse_sig: 'reversesig'
  },
  previous: 'bagutest002', signature: 'sig5',
  _cid: 'bagutest005'
};

const ENTRY_DEVICE_REVOKE = {
  version: 1, entity: 'juno', timestamp: '2026-04-16T05:00:00Z',
  type: 'koad.device-key-revoke',
  payload: { device_id: 'wonderland', device_pubkey: 'devpub', reason: 'decommissioned' },
  previous: 'bagutest005', signature: 'sig6',
  _cid: 'bagutest006'
};

const ALL_ENTRIES = [
  ENTRY_GENESIS, ENTRY_BOND, ENTRY_RELEASE, ENTRY_STATE, ENTRY_DEVICE_ADD, ENTRY_DEVICE_REVOKE
];

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeInlineStream(entriesArray) {
  return ActivityStream.from([{ type: 'inline', entries: entriesArray }]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Tinytest.add('activity-stream — ActivityStream is defined', function(test) {
  test.isTrue(typeof ActivityStream === 'object', 'ActivityStream should be an object');
  test.isTrue(typeof ActivityStream.from === 'function', '.from() should be a function');
  test.isTrue(typeof ActivityStream.entries === 'function', '.entries() should be a function');
  test.isTrue(typeof ActivityStream.filter === 'function', '.filter() should be a function');
  test.isTrue(typeof ActivityStream.render === 'function', '.render() should be a function');
  test.isTrue(typeof ActivityStream.registerRenderer === 'function', '.registerRenderer() should be a function');
});

Tinytest.addAsync('activity-stream — stream creation with inline source loads entries', function(test, done) {
  const stream = makeInlineStream(ALL_ENTRIES);

  // Allow one tick for the async load to complete
  Meteor.setTimeout(function() {
    const entries = ActivityStream.entries(stream);
    test.equal(entries.length, ALL_ENTRIES.length, 'Should have all entries');
    done();
  }, 50);
});

Tinytest.addAsync('activity-stream — multiple inline sources are merged', function(test, done) {
  const junoEntries = [ENTRY_GENESIS, ENTRY_BOND, ENTRY_DEVICE_ADD, ENTRY_DEVICE_REVOKE];
  const vulcanEntries = [ENTRY_RELEASE, ENTRY_STATE];

  const stream = ActivityStream.from([
    { type: 'inline', entries: junoEntries },
    { type: 'inline', entries: vulcanEntries },
  ]);

  Meteor.setTimeout(function() {
    const entries = ActivityStream.entries(stream);
    test.equal(entries.length, 6, 'Should merge 4 + 2 = 6 entries');
    done();
  }, 50);
});

Tinytest.addAsync('activity-stream — entries are sorted chronologically (oldest first)', function(test, done) {
  // Shuffle input deliberately
  const shuffled = [ENTRY_STATE, ENTRY_GENESIS, ENTRY_BOND, ENTRY_RELEASE];
  const stream = makeInlineStream(shuffled);

  Meteor.setTimeout(function() {
    const entries = ActivityStream.entries(stream);
    for (let i = 1; i < entries.length; i++) {
      test.isTrue(
        entries[i].timestamp >= entries[i - 1].timestamp,
        `Entry ${i} timestamp should be >= entry ${i - 1}`
      );
    }
    done();
  }, 50);
});

Tinytest.addAsync('activity-stream — deduplication by CID', function(test, done) {
  // Same entries in two sources
  const stream = ActivityStream.from([
    { type: 'inline', entries: [ENTRY_GENESIS, ENTRY_BOND] },
    { type: 'inline', entries: [ENTRY_BOND, ENTRY_RELEASE] }, // ENTRY_BOND duplicated
  ]);

  Meteor.setTimeout(function() {
    const entries = ActivityStream.entries(stream);
    test.equal(entries.length, 3, 'Should deduplicate: 2 + 2 = 3 unique entries');
    done();
  }, 50);
});

Tinytest.addAsync('activity-stream — filter by type', function(test, done) {
  const stream = makeInlineStream(ALL_ENTRIES);

  Meteor.setTimeout(function() {
    const bonds = ActivityStream.filter(stream, { type: 'koad.bond' });
    test.equal(bonds.length, 1, 'Should return exactly 1 bond entry');
    test.equal(bonds[0].type, 'koad.bond', 'Entry type should be koad.bond');

    const deviceEntries = ActivityStream.filter(stream, {
      type: ['koad.device-key-add', 'koad.device-key-revoke']
    });
    test.equal(deviceEntries.length, 2, 'Should return 2 device key entries');
    done();
  }, 50);
});

Tinytest.addAsync('activity-stream — filter by entity', function(test, done) {
  const stream = makeInlineStream(ALL_ENTRIES);

  Meteor.setTimeout(function() {
    const vulcanEntries = ActivityStream.filter(stream, { entity: 'vulcan' });
    test.equal(vulcanEntries.length, 2, 'Should return 2 vulcan entries (release + state-update)');

    const junoEntries = ActivityStream.filter(stream, { entity: 'juno' });
    test.equal(junoEntries.length, 4, 'Should return 4 juno entries');
    done();
  }, 50);
});

Tinytest.addAsync('activity-stream — filter by time range (after)', function(test, done) {
  const stream = makeInlineStream(ALL_ENTRIES);

  Meteor.setTimeout(function() {
    // Entries after the genesis timestamp
    const after = ActivityStream.filter(stream, { after: '2026-04-16T00:00:00Z' });
    test.isTrue(after.length < ALL_ENTRIES.length, 'Should exclude genesis and earlier entries');
    for (const e of after) {
      test.isTrue(e.timestamp > '2026-04-16T00:00:00Z', 'All returned entries should be after the cutoff');
    }
    done();
  }, 50);
});

Tinytest.addAsync('activity-stream — filter by time range (before)', function(test, done) {
  const stream = makeInlineStream(ALL_ENTRIES);

  Meteor.setTimeout(function() {
    const before = ActivityStream.filter(stream, { before: '2026-04-16T03:00:00Z' });
    for (const e of before) {
      test.isTrue(e.timestamp < '2026-04-16T03:00:00Z', 'All returned entries should be before the cutoff');
    }
    done();
  }, 50);
});

Tinytest.addAsync('activity-stream — empty state (zero entries)', function(test, done) {
  const stream = makeInlineStream([]);

  Meteor.setTimeout(function() {
    const entries = ActivityStream.entries(stream);
    test.equal(entries.length, 0, 'Empty source should produce empty stream');
    test.isFalse(stream.isLoading(), 'Stream should not be loading after empty inline load');
    test.isNull(stream.error(), 'Error should be null for empty inline load');
    done();
  }, 50);
});

Tinytest.add('activity-stream — renderer registration', function(test) {
  ActivityStream.registerRenderer('test.custom-type', {
    icon: () => 'T',
    label: () => 'Test entry',
    description: (e) => `custom: ${e.entity}`,
    link: () => null,
  });

  const entry = {
    version: 1, entity: 'testentity', timestamp: '2026-04-16T00:00:00Z',
    type: 'test.custom-type', payload: {}, previous: null, signature: 'sig',
  };

  const rendered = ActivityStream.render([entry]);
  test.equal(rendered.length, 1, 'Should render 1 entry');
  test.equal(rendered[0]._icon, 'T', 'Should use registered icon');
  test.equal(rendered[0]._label, 'Test entry', 'Should use registered label');
  test.equal(rendered[0]._description, 'custom: testentity', 'Should use registered description');
});

Tinytest.add('activity-stream — render output shape', function(test) {
  const rendered = ActivityStream.render(ALL_ENTRIES);
  test.equal(rendered.length, ALL_ENTRIES.length, 'Render should include all entries');

  for (const r of rendered) {
    test.isTrue('_icon' in r,        'Should have _icon');
    test.isTrue('_label' in r,       'Should have _label');
    test.isTrue('_description' in r, 'Should have _description');
    test.isTrue('_timestamp' in r,   'Should have _timestamp');
    test.isTrue('_date' in r,        'Should have _date');
    test.isTrue('_renderer' in r,    'Should have _renderer');
    test.isTrue('_link' in r,        'Should have _link (may be null)');
  }
});

Tinytest.addAsync('activity-stream — combined type + entity filter', function(test, done) {
  const stream = makeInlineStream(ALL_ENTRIES);

  Meteor.setTimeout(function() {
    const result = ActivityStream.filter(stream, {
      type: 'koad.state-update',
      entity: 'vulcan',
    });
    test.equal(result.length, 1, 'Should return exactly 1 vulcan state-update');
    test.equal(result[0].type, 'koad.state-update');
    test.equal(result[0].entity, 'vulcan');
    done();
  }, 50);
});

Tinytest.addAsync('activity-stream — inline source loads without IPFS client', function(test, done) {
  // Verify that inline sources work even if IPFSClient is undefined.
  // This simulates the test environment where the IPFS service worker isn't running.
  const stream = ActivityStream.from([
    { type: 'inline', entries: [ENTRY_GENESIS, ENTRY_BOND] }
  ]);

  Meteor.setTimeout(function() {
    const entries = ActivityStream.entries(stream);
    test.equal(entries.length, 2, 'Inline sources should load without IPFS client');
    test.isNull(stream.error(), 'Should have no error');
    done();
  }, 50);
});

Tinytest.add('activity-stream — _mergeAndSort deduplicates and sorts', function(test) {
  const mergeAndSort = ActivityStream._mergeAndSort;
  const input = [ENTRY_STATE, ENTRY_GENESIS, ENTRY_BOND, ENTRY_BOND]; // BOND duplicated
  const result = mergeAndSort(input);

  test.equal(result.length, 3, 'Should deduplicate: 4 entries → 3 unique');
  test.equal(result[0].type, 'koad.genesis', 'First entry should be genesis (oldest)');
  test.equal(result[2].type, 'koad.state-update', 'Last entry should be state-update (newest)');
});
