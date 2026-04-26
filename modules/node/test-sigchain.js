// test-sigchain.js — Flight D sigchain entry layer tests
//
// Tests:
//   1.  buildSpiritGenesis: required fields enforced, optional fields permitted
//   2.  buildLeafAuthorize: required fields enforced, optional device_label
//   3.  buildLeafRevoke: required fields enforced, optional reason
//   4.  buildPruneAll: required fields enforced, reason must be non-empty
//   5.  buildKeySuccession: required fields enforced, optional reason
//   6.  wrapEntry: canonical envelope shape
//   7.  canonicalDagJson: stable bytes — same input → same output; key order
//   8.  computeCID: stable CIDs — same entry → same CID; correct 'bagu' prefix
//   9.  signEntry end-to-end: create identity, sign spirit-genesis with master
//   10. verifyEntry round-trip: signEntry → verifyEntry returns valid=true
//   11. verifyEntry rejects modified entries (CID mismatch on tampered bytes)
//   12. verifyEntry rejects entries signed by wrong key
//
// Run: node modules/node/test-sigchain.js

import {
  buildSpiritGenesis,
  buildLeafAuthorize,
  buildLeafRevoke,
  buildPruneAll,
  buildKeySuccession,
  wrapEntry,
  canonicalDagJson,
  preImageBytes,
  computeCID,
  signEntry,
  verifyEntry,
} from './sigchain.js';

import { createKoadIdentity } from './identity.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

function assertThrows(fn, label) {
  try {
    fn();
    console.error(`  FAIL: ${label} (expected throw, got nothing)`);
    failed++;
  } catch (_) {
    console.log(`  PASS: ${label}`);
    passed++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: buildSpiritGenesis
// ---------------------------------------------------------------------------

async function test1_buildSpiritGenesis() {
  console.log('\n1. buildSpiritGenesis — shape + required field enforcement');

  const { type, payload } = buildSpiritGenesis({
    spirit_handle: 'koad',
    master_fingerprint: 'ABCD1234'.repeat(5),
    master_pubkey_armored: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nexample\n-----END PGP PUBLIC KEY BLOCK-----',
    created: '2026-04-25T22:00:00Z',
    description: 'test spirit',
  });

  assert(type === 'koad.spirit-genesis', 'type is koad.spirit-genesis');
  assert(payload.spirit_handle === 'koad', 'payload.spirit_handle set');
  assert(payload.master_fingerprint === 'ABCD1234'.repeat(5), 'payload.master_fingerprint set');
  assert(typeof payload.master_pubkey_armored === 'string', 'payload.master_pubkey_armored set');
  assert(payload.created === '2026-04-25T22:00:00Z', 'payload.created set');
  assert(payload.description === 'test spirit', 'optional description included when provided');

  // Without description
  const { payload: p2 } = buildSpiritGenesis({
    spirit_handle: 'koad',
    master_fingerprint: 'ABCD1234'.repeat(5),
    master_pubkey_armored: 'armored',
    created: '2026-04-25T22:00:00Z',
  });
  assert(!('description' in p2), 'description omitted when not provided');

  // Required field enforcement
  assertThrows(() => buildSpiritGenesis({}), 'throws when spirit_handle missing');
  assertThrows(
    () => buildSpiritGenesis({ spirit_handle: 'koad' }),
    'throws when master_fingerprint missing'
  );
  assertThrows(
    () => buildSpiritGenesis({ spirit_handle: 'koad', master_fingerprint: 'fp' }),
    'throws when master_pubkey_armored missing'
  );
  assertThrows(
    () => buildSpiritGenesis({ spirit_handle: 'koad', master_fingerprint: 'fp', master_pubkey_armored: 'pub' }),
    'throws when created missing'
  );
}

// ---------------------------------------------------------------------------
// Test 2: buildLeafAuthorize
// ---------------------------------------------------------------------------

async function test2_buildLeafAuthorize() {
  console.log('\n2. buildLeafAuthorize — shape + optional device_label');

  const { type, payload } = buildLeafAuthorize({
    leaf_fingerprint: 'LEAF5678'.repeat(5),
    leaf_pubkey_armored: 'leaf-pub-armored',
    device_label: 'wonderland — primary workstation',
    authorized_by_fingerprint: 'ABCD1234'.repeat(5),
    authorized_at: '2026-04-25T22:01:00Z',
  });

  assert(type === 'koad.leaf-authorize', 'type is koad.leaf-authorize');
  assert(payload.leaf_fingerprint === 'LEAF5678'.repeat(5), 'leaf_fingerprint set');
  assert(payload.leaf_pubkey_armored === 'leaf-pub-armored', 'leaf_pubkey_armored set');
  assert(payload.device_label === 'wonderland — primary workstation', 'device_label included');
  assert(payload.authorized_by_fingerprint === 'ABCD1234'.repeat(5), 'authorized_by_fingerprint set');
  assert(payload.authorized_at === '2026-04-25T22:01:00Z', 'authorized_at set');

  // Without device_label
  const { payload: p2 } = buildLeafAuthorize({
    leaf_fingerprint: 'LEAF5678'.repeat(5),
    leaf_pubkey_armored: 'pub',
    authorized_by_fingerprint: 'ABCD1234'.repeat(5),
    authorized_at: '2026-04-25T22:01:00Z',
  });
  assert(!('device_label' in p2), 'device_label omitted when not provided');

  // Required field enforcement
  assertThrows(() => buildLeafAuthorize({}), 'throws when leaf_fingerprint missing');
  assertThrows(
    () => buildLeafAuthorize({ leaf_fingerprint: 'fp' }),
    'throws when leaf_pubkey_armored missing'
  );
  assertThrows(
    () => buildLeafAuthorize({ leaf_fingerprint: 'fp', leaf_pubkey_armored: 'pub' }),
    'throws when authorized_by_fingerprint missing'
  );
  assertThrows(
    () => buildLeafAuthorize({ leaf_fingerprint: 'fp', leaf_pubkey_armored: 'pub', authorized_by_fingerprint: 'fp2' }),
    'throws when authorized_at missing'
  );
}

// ---------------------------------------------------------------------------
// Test 3: buildLeafRevoke
// ---------------------------------------------------------------------------

async function test3_buildLeafRevoke() {
  console.log('\n3. buildLeafRevoke — shape + optional reason');

  const { type, payload } = buildLeafRevoke({
    leaf_fingerprint: 'LEAF5678'.repeat(5),
    revoked_at: '2026-04-25T22:02:00Z',
    reason: 'device lost',
  });

  assert(type === 'koad.leaf-revoke', 'type is koad.leaf-revoke');
  assert(payload.leaf_fingerprint === 'LEAF5678'.repeat(5), 'leaf_fingerprint set');
  assert(payload.revoked_at === '2026-04-25T22:02:00Z', 'revoked_at set');
  assert(payload.reason === 'device lost', 'optional reason included');

  const { payload: p2 } = buildLeafRevoke({
    leaf_fingerprint: 'LEAF5678'.repeat(5),
    revoked_at: '2026-04-25T22:02:00Z',
  });
  assert(!('reason' in p2), 'reason omitted when not provided');

  assertThrows(() => buildLeafRevoke({}), 'throws when leaf_fingerprint missing');
  assertThrows(
    () => buildLeafRevoke({ leaf_fingerprint: 'fp' }),
    'throws when revoked_at missing'
  );
}

// ---------------------------------------------------------------------------
// Test 4: buildPruneAll
// ---------------------------------------------------------------------------

async function test4_buildPruneAll() {
  console.log('\n4. buildPruneAll — required reason (non-empty)');

  const { type, payload } = buildPruneAll({
    pruned_at: '2026-04-25T22:03:00Z',
    reason: 'all devices compromised — emergency recovery',
  });

  assert(type === 'koad.prune-all', 'type is koad.prune-all');
  assert(payload.pruned_at === '2026-04-25T22:03:00Z', 'pruned_at set');
  assert(payload.reason === 'all devices compromised — emergency recovery', 'reason set');

  assertThrows(() => buildPruneAll({}), 'throws when pruned_at missing');
  assertThrows(
    () => buildPruneAll({ pruned_at: '2026-04-25T22:03:00Z' }),
    'throws when reason missing'
  );
  assertThrows(
    () => buildPruneAll({ pruned_at: '2026-04-25T22:03:00Z', reason: '' }),
    'throws when reason is empty string'
  );
  assertThrows(
    () => buildPruneAll({ pruned_at: '2026-04-25T22:03:00Z', reason: '   ' }),
    'throws when reason is whitespace-only'
  );
}

// ---------------------------------------------------------------------------
// Test 5: buildKeySuccession
// ---------------------------------------------------------------------------

async function test5_buildKeySuccession() {
  console.log('\n5. buildKeySuccession — required fields + optional reason');

  const { type, payload } = buildKeySuccession({
    old_master_fingerprint: 'OLDMASTER'.repeat(4) + 'XXXX',
    new_master_fingerprint: 'NEWMASTER'.repeat(4) + 'XXXX',
    new_master_pubkey_armored: 'new-master-armored',
    succeeded_at: '2026-04-25T22:04:00Z',
    reason: 'scheduled rotation',
  });

  assert(type === 'koad.key-succession', 'type is koad.key-succession');
  assert(payload.old_master_fingerprint === 'OLDMASTER'.repeat(4) + 'XXXX', 'old_master_fingerprint set');
  assert(payload.new_master_fingerprint === 'NEWMASTER'.repeat(4) + 'XXXX', 'new_master_fingerprint set');
  assert(payload.new_master_pubkey_armored === 'new-master-armored', 'new_master_pubkey_armored set');
  assert(payload.succeeded_at === '2026-04-25T22:04:00Z', 'succeeded_at set');
  assert(payload.reason === 'scheduled rotation', 'optional reason included');

  const { payload: p2 } = buildKeySuccession({
    old_master_fingerprint: 'OLDMASTER'.repeat(4) + 'XXXX',
    new_master_fingerprint: 'NEWMASTER'.repeat(4) + 'XXXX',
    new_master_pubkey_armored: 'pub',
    succeeded_at: '2026-04-25T22:04:00Z',
  });
  assert(!('reason' in p2), 'reason omitted when not provided');

  assertThrows(() => buildKeySuccession({}), 'throws when old_master_fingerprint missing');
  assertThrows(
    () => buildKeySuccession({ old_master_fingerprint: 'old' }),
    'throws when new_master_fingerprint missing'
  );
}

// ---------------------------------------------------------------------------
// Test 6: wrapEntry
// ---------------------------------------------------------------------------

async function test6_wrapEntry() {
  console.log('\n6. wrapEntry — canonical envelope shape');

  const entry = wrapEntry({
    entity: 'koad',
    timestamp: '2026-04-25T22:00:00Z',
    type: 'koad.spirit-genesis',
    payload: { spirit_handle: 'koad', master_fingerprint: 'FP', master_pubkey_armored: 'PUB', created: '2026-04-25T22:00:00Z' },
    previous: null,
  });

  assert(entry.version === 1, 'version is 1');
  assert(entry.entity === 'koad', 'entity set');
  assert(entry.timestamp === '2026-04-25T22:00:00Z', 'timestamp set');
  assert(entry.type === 'koad.spirit-genesis', 'type set');
  assert(typeof entry.payload === 'object', 'payload is object');
  assert(entry.previous === null, 'previous is null for genesis');
  assert(!('signature' in entry), 'no signature field on unsigned entry');

  // Non-null previous
  const entry2 = wrapEntry({
    entity: 'koad',
    timestamp: '2026-04-25T22:01:00Z',
    type: 'koad.leaf-authorize',
    payload: { leaf_fingerprint: 'FP', leaf_pubkey_armored: 'PUB', authorized_by_fingerprint: 'FP', authorized_at: '2026-04-25T22:01:00Z' },
    previous: 'baguczsaa_example_cid',
  });
  assert(entry2.previous === 'baguczsaa_example_cid', 'previous CID string set');

  assertThrows(() => wrapEntry({}), 'throws when entity missing');
  assertThrows(() => wrapEntry({ entity: 'koad' }), 'throws when timestamp missing');
  assertThrows(
    () => wrapEntry({ entity: 'koad', timestamp: 'ts', type: 'koad.x', payload: null }),
    'throws when payload is null'
  );
}

// ---------------------------------------------------------------------------
// Test 7: canonicalDagJson — stable bytes + key order
// ---------------------------------------------------------------------------

async function test7_canonicalDagJson() {
  console.log('\n7. canonicalDagJson — stable bytes + key sort order');

  const entry = {
    version: 1,
    entity: 'koad',
    timestamp: '2026-04-25T22:00:00Z',
    type: 'koad.spirit-genesis',
    payload: { spirit_handle: 'koad', master_fingerprint: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12', master_pubkey_armored: 'PUB', created: '2026-04-25T22:00:00Z' },
    previous: null,
  };

  const bytes1 = canonicalDagJson(entry);
  const bytes2 = canonicalDagJson(entry);

  assert(bytes1 instanceof Uint8Array, 'returns Uint8Array');
  assert(bytes1.length > 0, 'bytes are non-empty');

  // Same input → same output
  assert(
    bytes1.length === bytes2.length && bytes1.every((b, i) => b === bytes2[i]),
    'same input produces identical bytes (deterministic)'
  );

  // Decode and check key order
  const decoded = JSON.parse(new TextDecoder().decode(bytes1));
  const keys = Object.keys(decoded);
  // Expected sorted order (without signature): entity, payload, previous, timestamp, type, version
  assert(keys[0] === 'entity', 'first key is entity');
  assert(keys[1] === 'payload', 'second key is payload');
  assert(keys[2] === 'previous', 'third key is previous');
  assert(keys[3] === 'timestamp', 'fourth key is timestamp');
  assert(keys[4] === 'type', 'fifth key is type');
  assert(keys[5] === 'version', 'sixth key is version');

  // Reversed input object should produce same bytes
  const reversedEntry = { previous: null, type: entry.type, version: 1, entity: 'koad', timestamp: entry.timestamp, payload: entry.payload };
  const bytes3 = canonicalDagJson(reversedEntry);
  assert(
    bytes3.length === bytes1.length && bytes3.every((b, i) => b === bytes1[i]),
    'key order is canonical regardless of input key order'
  );

  // preImageBytes: same as canonicalDagJson but without signature
  const entryWithSig = { ...entry, signature: 'sig-value' };
  const withSig = canonicalDagJson(entryWithSig);
  const preImg = preImageBytes(entryWithSig);
  assert(withSig.length > preImg.length, 'preImageBytes is shorter than full entry bytes (signature removed)');

  const withSigDecoded = JSON.parse(new TextDecoder().decode(withSig));
  const preImgDecoded = JSON.parse(new TextDecoder().decode(preImg));
  assert('signature' in withSigDecoded, 'full canonical bytes include signature field');
  assert(!('signature' in preImgDecoded), 'pre-image bytes omit signature field');
}

// ---------------------------------------------------------------------------
// Test 8: computeCID — stable, bagu prefix
// ---------------------------------------------------------------------------

async function test8_computeCID() {
  console.log('\n8. computeCID — stable CIDs + bagu prefix');

  const entry = {
    version: 1,
    entity: 'koad',
    timestamp: '2026-04-25T22:00:00Z',
    type: 'koad.spirit-genesis',
    payload: { spirit_handle: 'koad', master_fingerprint: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12', master_pubkey_armored: 'PUB', created: '2026-04-25T22:00:00Z' },
    previous: null,
    signature: 'example-sig-for-cid-test',
  };

  const cid1 = await computeCID(entry);
  const cid2 = await computeCID(entry);

  assert(typeof cid1 === 'string', 'CID is a string');
  assert(cid1.startsWith('bagu'), 'CID has bagu prefix (base32upper dag-json)');
  assert(cid1 === cid2, 'same entry → same CID (deterministic)');
  assert(cid1.length > 40, 'CID is full-length (not truncated)');

  // Different entries produce different CIDs
  const entry2 = { ...entry, entity: 'juno' };
  const cid3 = await computeCID(entry2);
  assert(cid1 !== cid3, 'different entries produce different CIDs');

  // Tampered entry produces different CID
  const tampered = { ...entry, timestamp: '2026-04-25T23:00:00Z' };
  const cidTampered = await computeCID(tampered);
  assert(cid1 !== cidTampered, 'tampered entry produces different CID');
}

// ---------------------------------------------------------------------------
// Test 9: signEntry end-to-end (requires real koad.identity ceremony)
// ---------------------------------------------------------------------------

async function test9_signEntry() {
  console.log('\n9. signEntry end-to-end — create identity, sign spirit-genesis with master');

  // Create a real koad.identity in ceremony posture
  const identity = createKoadIdentity();
  await identity.create({ handle: 'koad', userid: 'koad <koad@koad.sh>' });

  assert(identity.posture === 'ceremony', 'identity in ceremony posture');
  assert(identity.isMasterLoaded, 'master key loaded');

  // Build a spirit-genesis entry
  const { type, payload } = buildSpiritGenesis({
    spirit_handle: identity.handle,
    master_fingerprint: identity.masterFingerprint,
    master_pubkey_armored: identity.masterPublicKey,
    created: '2026-04-25T22:00:00Z',
    description: 'test spirit genesis for Flight D',
  });

  const unsignedEntry = wrapEntry({
    entity: identity.handle,
    timestamp: '2026-04-25T22:00:00Z',
    type,
    payload,
    previous: null,
  });

  // Sign with master (useMaster: true — ceremony entry)
  const { entry, cid } = await signEntry(unsignedEntry, identity, { useMaster: true });

  assert(typeof entry.signature === 'string', 'entry.signature is a string');
  assert(entry.signature.includes('BEGIN PGP SIGNED MESSAGE'), 'signature is PGP armored clearsign');
  assert(typeof cid === 'string', 'CID returned');
  assert(cid.startsWith('bagu'), 'CID has bagu prefix');

  // Verify all other entry fields are preserved
  assert(entry.version === 1, 'version preserved');
  assert(entry.entity === 'koad', 'entity preserved');
  assert(entry.type === 'koad.spirit-genesis', 'type preserved');
  assert(entry.previous === null, 'previous preserved as null');

  // CID should match recomputing from the signed entry
  const recomputedCID = await computeCID(entry);
  assert(cid === recomputedCID, 'returned CID matches recomputed CID from signed entry');

  // Store for test 10
  test9_signEntry._result = { identity, entry, cid };
}
test9_signEntry._result = null;

// ---------------------------------------------------------------------------
// Test 10: verifyEntry round-trip
// ---------------------------------------------------------------------------

async function test10_verifyEntry_roundTrip() {
  console.log('\n10. verifyEntry round-trip — signEntry → verifyEntry returns valid=true');

  const { identity, entry, cid } = test9_signEntry._result;

  // Verify using the master public key (the signer for spirit-genesis)
  const result = await verifyEntry(entry, cid, identity.masterPublicKey);

  assert(result.valid === true, 'verifyEntry returns valid=true');
  assert(!result.error, 'no error on valid entry');
}

// ---------------------------------------------------------------------------
// Test 11: verifyEntry rejects tampered entry (CID mismatch)
// ---------------------------------------------------------------------------

async function test11_verifyEntry_tampered() {
  console.log('\n11. verifyEntry rejects modified entry (CID mismatch)');

  const { identity, entry, cid } = test9_signEntry._result;

  // Tamper the entry by changing the entity field
  const tampered = { ...entry, entity: 'evil' };

  const result = await verifyEntry(tampered, cid, identity.masterPublicKey);

  assert(result.valid === false, 'tampered entry is rejected (valid=false)');
  assert(typeof result.error === 'string', 'error message provided');
  assert(result.error.includes('CID mismatch'), 'error mentions CID mismatch');
}

// ---------------------------------------------------------------------------
// Test 12: verifyEntry rejects wrong signer key
// ---------------------------------------------------------------------------

async function test12_verifyEntry_wrongKey() {
  console.log('\n12. verifyEntry rejects entry verified against wrong key');

  const { entry, cid } = test9_signEntry._result;

  // Generate a different identity — a different PGP key
  const wrongIdentity = createKoadIdentity();
  await wrongIdentity.create({ handle: 'impostor', userid: 'impostor <x@x.com>' });

  // Use the wrong identity's master public key to verify an entry signed by the original identity
  const result = await verifyEntry(entry, cid, wrongIdentity.masterPublicKey);

  assert(result.valid === false, 'entry rejected when wrong key used (valid=false)');
  assert(typeof result.error === 'string', 'error message provided');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n=== Flight D: sigchain entry layer tests ===\n');

  try {
    await test1_buildSpiritGenesis();
    await test2_buildLeafAuthorize();
    await test3_buildLeafRevoke();
    await test4_buildPruneAll();
    await test5_buildKeySuccession();
    await test6_wrapEntry();
    await test7_canonicalDagJson();
    await test8_computeCID();
    await test9_signEntry();
    await test10_verifyEntry_roundTrip();
    await test11_verifyEntry_tampered();
    await test12_verifyEntry_wrongKey();
  } catch (err) {
    console.error('\nUnhandled test error:', err);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run();
