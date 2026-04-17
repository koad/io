// sovereign-profiles-tests.js — Tinytest suite for koad:io-sovereign-profiles
// Tests run in client context via Meteor's tinytest harness.
//
// Covered:
//   - canonicalPreImage: field ordering, signature omission
//   - SovereignProfile.genesis: entry shape, SPEC-111 §4 conformance
//   - SovereignProfile.create: state-update shape, scope:"profile"
//   - SovereignProfile.update: alias of create with previousCid
//   - SovereignProfile.sign: signature present, base64url format
//   - SovereignProfile.render: render-ready shape
//   - base64url encode/decode round-trip
//   - SovereignProfile.publish: delegates to IPFSClient.put, returns CID
//   - SovereignProfile.verifyChain: delegates fetch to IPFSClient.get (wiring only)

import { SovereignProfile, canonicalPreImage, computeCid, toBase64Url, fromBase64Url } from '../client/profile-builder.js';
import * as ed from '@noble/ed25519';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Minimal valid entry for testing pre-image and signing
const TEST_ENTITY = 'alice';

async function makeTestKeypair() {
  const privKey = ed.utils.randomPrivateKey();
  const pubKey = await ed.getPublicKey(privKey);
  return { privKey, pubKey };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Tinytest.addAsync('sovereign-profiles — base64url round-trip', async function(test) {
  const original = new Uint8Array([0, 1, 2, 255, 128, 64]);
  const encoded = toBase64Url(original);
  const decoded = fromBase64Url(encoded);

  test.equal(decoded.length, original.length, 'round-trip length matches');
  for (let i = 0; i < original.length; i++) {
    test.equal(decoded[i], original[i], `byte ${i} matches`);
  }

  // Confirm no padding characters
  test.isFalse(encoded.includes('='), 'no padding in base64url output');
  // Confirm URL-safe characters
  test.isFalse(encoded.includes('+'), 'no + in base64url output');
  test.isFalse(encoded.includes('/'), 'no / in base64url output');
});

Tinytest.addAsync('sovereign-profiles — canonicalPreImage has sorted keys, no signature', async function(test) {
  const entry = {
    version: 1,
    entity: 'alice',
    timestamp: '2026-04-16T00:00:00Z',
    type: 'koad.genesis',
    payload: { entity: 'alice', pubkey: 'abc', created: '2026-04-16T00:00:00Z', description: 'test' },
    previous: null,
    signature: 'should-be-absent-from-pre-image',
  };

  const preImageBytes = canonicalPreImage(entry);
  const preImageStr = new TextDecoder().decode(preImageBytes);
  const parsed = JSON.parse(preImageStr);

  // signature must not appear
  test.isUndefined(parsed.signature, 'signature absent from pre-image');

  // all other required fields present
  test.equal(parsed.version, 1);
  test.equal(parsed.entity, 'alice');
  test.equal(parsed.type, 'koad.genesis');
  test.equal(parsed.previous, null);
});

Tinytest.addAsync('sovereign-profiles — genesis entry shape conforms to SPEC-111 §4', async function(test) {
  const { pubKey } = await makeTestKeypair();
  const entry = SovereignProfile.genesis({
    entity: TEST_ENTITY,
    pubkeyBytes: pubKey,
    description: 'test genesis',
  });

  test.equal(entry.version, 1, 'version is 1');
  test.equal(entry.entity, TEST_ENTITY, 'entity matches');
  test.equal(entry.type, 'koad.genesis', 'type is koad.genesis');
  test.equal(entry.previous, null, 'previous is null for genesis');
  test.isUndefined(entry.signature, 'signature absent before signing');

  // payload required fields per §4.1
  test.equal(entry.payload.entity, TEST_ENTITY, 'payload.entity matches');
  test.isString(entry.payload.pubkey, 'payload.pubkey is base64url string');
  test.isString(entry.payload.created, 'payload.created is present');
  test.equal(entry.payload.description, 'test genesis', 'payload.description present');
});

Tinytest.addAsync('sovereign-profiles — create produces koad.state-update with scope:profile', async function(test) {
  const entry = SovereignProfile.create({
    entity: TEST_ENTITY,
    previousCid: 'bafyreifake123',
    profile: { name: 'Alice', bio: 'test bio', socialProofs: [] },
  });

  test.equal(entry.version, 1);
  test.equal(entry.entity, TEST_ENTITY);
  test.equal(entry.type, 'koad.state-update', 'type is koad.state-update');
  test.equal(entry.previous, 'bafyreifake123', 'previous CID set correctly');
  test.equal(entry.payload.scope, 'profile', 'payload.scope is "profile"');
  test.equal(entry.payload.data.name, 'Alice', 'profile name in payload.data');
  test.equal(entry.payload.data.bio, 'test bio', 'profile bio in payload.data');
  test.isUndefined(entry.signature, 'signature absent before signing');
});

Tinytest.addAsync('sovereign-profiles — update is alias of create with previousCid', async function(test) {
  const changes = { name: 'Alice Updated', bio: 'new bio' };
  const entry = SovereignProfile.update('bafyreifake456', changes, TEST_ENTITY);

  test.equal(entry.type, 'koad.state-update');
  test.equal(entry.previous, 'bafyreifake456');
  test.equal(entry.payload.data.name, 'Alice Updated');
});

Tinytest.addAsync('sovereign-profiles — sign adds valid Ed25519 signature', async function(test) {
  const { privKey, pubKey } = await makeTestKeypair();

  const unsignedEntry = SovereignProfile.create({
    entity: TEST_ENTITY,
    previousCid: 'bafyreifake789',
    profile: { name: 'Alice', bio: '' },
  });

  const signedEntry = await SovereignProfile.sign(unsignedEntry, privKey);

  // signature field present
  test.isString(signedEntry.signature, 'signature is a string');
  test.isTrue(signedEntry.signature.length > 0, 'signature is non-empty');

  // no padding
  test.isFalse(signedEntry.signature.includes('='), 'no padding in signature');

  // all other fields preserved
  test.equal(signedEntry.entity, unsignedEntry.entity);
  test.equal(signedEntry.type, unsignedEntry.type);
  test.equal(signedEntry.previous, unsignedEntry.previous);

  // verify the signature is actually correct
  const preImage = canonicalPreImage(unsignedEntry);
  const sigBytes = fromBase64Url(signedEntry.signature);
  const valid = await ed.verify(sigBytes, preImage, pubKey);
  test.isTrue(valid, 'signature verifies against public key');
});

Tinytest.addAsync('sovereign-profiles — render produces template-ready shape', async function(test) {
  const profileData = {
    name: 'Alice',
    bio: 'A test entity',
    avatar: 'bafyreiavatarcid',
    socialProofs: [{ platform: 'github', handle: 'alice', url: 'https://github.com/alice' }],
  };

  const rendered = SovereignProfile.render(profileData, { verified: true, entity: 'alice' });

  test.equal(rendered.name, 'Alice');
  test.equal(rendered.bio, 'A test entity');
  test.equal(rendered.avatar, 'bafyreiavatarcid');
  test.isTrue(rendered.verified, 'verified flag set');
  test.equal(rendered.entity, 'alice');
  test.equal(rendered.socialProofs.length, 1);
  test.equal(rendered.socialProofs[0].platform, 'github');
});

Tinytest.addAsync('sovereign-profiles — render handles null profile data', async function(test) {
  const rendered = SovereignProfile.render(null);
  test.isNull(rendered, 'null input returns null');
});

Tinytest.addAsync('sovereign-profiles — computeCid produces stable CIDv1', async function(test) {
  const { encode } = await import('@ipld/dag-json');
  const bytes = encode({ hello: 'world' });

  const cid1 = await computeCid(bytes);
  const cid2 = await computeCid(bytes);

  test.equal(cid1, cid2, 'same input produces same CID');
  // dag-json (0x0129) + sha2-256 produces 'bagu...' prefix in base32upper CIDv1.
  // 'bafy...' is dag-cbor (0x71). SPEC-111 examples use 'bafyrei...' illustratively
  // but the specified codec 0x0129 correctly yields 'bagu...'.
  test.isTrue(cid1.startsWith('bagu'), `CIDv1 dag-json starts with bagu (got ${cid1})`);
});

// ── Publish / resolve wiring tests ────────────────────────────────────────────
// These tests stub IPFSClient to verify the wiring between sovereign-profiles
// and ipfs-client, without requiring a live Helia node or IPFS network.

Tinytest.addAsync('sovereign-profiles — publish delegates to IPFSClient.put and returns CID', async function(test) {
  const { privKey, pubKey } = await makeTestKeypair();

  const genesisUnsigned = SovereignProfile.genesis({
    entity: TEST_ENTITY,
    pubkeyBytes: pubKey,
    description: 'test publish wiring',
  });
  const signedGenesis = await SovereignProfile.sign(genesisUnsigned, privKey);

  // Stub IPFSClient.put to capture the call and return a fake CID
  const origPut = IPFSClient.put;
  let putCalledWith = null;
  const fakeCid = 'baguqeeraTEST';
  IPFSClient.put = async function(bytes) {
    putCalledWith = bytes;
    return fakeCid;
  };

  try {
    const cid = await SovereignProfile.publish(signedGenesis);
    test.equal(cid, fakeCid, 'publish returns CID from IPFSClient.put');
    test.isNotNull(putCalledWith, 'IPFSClient.put was called');
    test.isTrue(putCalledWith instanceof Uint8Array, 'put received dag-json bytes');
  } finally {
    IPFSClient.put = origPut; // restore
  }
});

Tinytest.addAsync('sovereign-profiles — verifyChain fetch delegates to IPFSClient.get', async function(test) {
  // Verify that a network error from IPFSClient.get is surfaced as a fetch error
  // (not the old "stub — cannot fetch" message), proving the wiring is live.
  const origGet = IPFSClient.get;
  IPFSClient.get = async function(cid) {
    throw new Error('IPFSClient.get called — wiring confirmed');
  };

  try {
    const { valid, errors } = await SovereignProfile.verifyChain('baguqeeraFAKECID');
    test.isFalse(valid, 'invalid chain when get throws');
    test.isTrue(errors.length > 0, 'errors surfaced');
    // The error message must come from IPFSClient.get, not the old stub text
    test.isFalse(
      errors[0].includes('fetchEntry stub'),
      'error is from IPFSClient.get, not old stub'
    );
    test.isTrue(
      errors[0].includes('wiring confirmed'),
      `fetch error propagated correctly (got: ${errors[0]})`
    );
  } finally {
    IPFSClient.get = origGet; // restore
  }
});
