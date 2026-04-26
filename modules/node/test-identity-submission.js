// test-identity-submission.js — SPEC-150 submission builder + verifier tests
//
// Tests (per flight plan):
//   1. Round-trip: build submission, verify against same chain → valid
//   2. Tampered signature → invalid
//   3. Wrong fp (key not authorized at chain tip) → invalid
//   4. Wrong protocol field → invalid
//   5. previous_head_cid mismatch → invalid
//   6. Master-signed submission accepted (useMaster: true)
//   7. Leaf-signed submission accepted (default)
//
// Additional tests:
//   8. Null previous_head_cid (first publication) accepted
//   9. Genesis replay rejected (priorKnownHead set but previous_head_cid null)
//  10. already-current CID → valid + alreadyCurrent flag
//  11. Future timestamp → invalid
//  12. Missing entries → chain-invalid
//
// Run: node modules/node/test-identity-submission.js

import {
  buildIdentityGenesis,
  buildLeafAuthorize,
  wrapEntry,
  signEntry,
} from './sigchain.js';

import { createKoadIdentity } from './identity.js';
import { buildHeadSubmission, verifyHeadSubmission } from './identity-submission.js';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeIdentity(handle = 'testentity') {
  const id = createKoadIdentity();
  await id.create({ handle, userid: `${handle} <${handle}@test.koad.sh>` });
  return id;
}

async function makeGenesis(identity) {
  const { type, payload } = buildIdentityGenesis({
    entity_handle: identity.handle,
    master_fingerprint: identity.masterFingerprint,
    master_pubkey_armored: identity.masterPublicKey,
    created: new Date().toISOString(),
  });
  const unsigned = wrapEntry({
    entity: identity.handle,
    timestamp: new Date().toISOString(),
    type,
    payload,
    previous: null,
  });
  return signEntry(unsigned, identity, { useMaster: true });
}

async function makeLeafAuthorize({ masterIdentity, leafIdentity, prevCID }) {
  // leafIdentity.fingerprint is the device leaf fp; leafIdentity.publicKey is the device leaf pubkey.
  // These are the correct values to put in the chain (not masterFingerprint/masterPublicKey).
  const { type, payload } = buildLeafAuthorize({
    leaf_fingerprint: leafIdentity.fingerprint,
    leaf_pubkey_armored: leafIdentity.publicKey,
    authorized_by_fingerprint: masterIdentity.masterFingerprint,
    authorized_at: new Date().toISOString(),
    device_label: 'test-device',
  });
  const unsigned = wrapEntry({
    entity: masterIdentity.handle,
    timestamp: new Date().toISOString(),
    type,
    payload,
    previous: prevCID,
  });
  return signEntry(unsigned, masterIdentity, { useMaster: true });
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\n=== test-identity-submission.js ===\n');

  // -------------------------------------------------------------------------
  // Test 1: Round-trip — build submission, verify against same chain → valid
  // -------------------------------------------------------------------------
  console.log('Test 1: Round-trip — master-signed submission against genesis-only chain');
  {
    const identity = await makeIdentity('roundtrip');
    const genesisResult = await makeGenesis(identity);
    const entries = [genesisResult];
    const genesisChainCID = genesisResult.cid;

    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: null,
      newHeadCID: genesisChainCID,
      identity,
      useMaster: true,
    });

    const result = await verifyHeadSubmission(submission, {
      priorKnownHead: null,
      entries,
    });

    assert(result.valid === true, 'round-trip: valid=true');
    assert(result.masterFingerprint === identity.masterFingerprint, 'round-trip: masterFingerprint matches');
  }

  // -------------------------------------------------------------------------
  // Test 2: Tampered signature → invalid
  // -------------------------------------------------------------------------
  console.log('\nTest 2: Tampered signature → invalid');
  {
    const identity = await makeIdentity('tamper');
    const genesisResult = await makeGenesis(identity);
    const entries = [genesisResult];
    const genesisChainCID = genesisResult.cid;

    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: null,
      newHeadCID: genesisChainCID,
      identity,
      useMaster: true,
    });

    // Tamper: replace last few chars of signature with garbage
    const tampered = {
      ...submission,
      signature: submission.signature.slice(0, -10) + 'TAMPERED!!',
    };

    const result = await verifyHeadSubmission(tampered, {
      priorKnownHead: null,
      entries,
    });

    assert(result.valid === false, 'tampered: valid=false');
    assert(result.reason === 'invalid-signature', `tampered: reason=invalid-signature (got: ${result.reason})`);
  }

  // -------------------------------------------------------------------------
  // Test 3: Wrong fp (key not authorized at chain tip) → invalid
  // -------------------------------------------------------------------------
  console.log('\nTest 3: Wrong fingerprint — unauthorized signer');
  {
    const identity = await makeIdentity('wrongfp');
    const outsiderIdentity = await makeIdentity('outsider');
    const genesisResult = await makeGenesis(identity);
    const entries = [genesisResult];
    const genesisChainCID = genesisResult.cid;

    // Build submission signed by the outsider identity (wrong key, wrong fp)
    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: null,
      newHeadCID: genesisChainCID,
      identity: outsiderIdentity,
      useMaster: true,
    });

    const result = await verifyHeadSubmission(submission, {
      priorKnownHead: null,
      entries,
    });

    assert(result.valid === false, 'wrong-fp: valid=false');
    assert(
      result.reason === 'fp-not-authorized' || result.reason === 'invalid-signature',
      `wrong-fp: reason is fp-not-authorized or invalid-signature (got: ${result.reason})`
    );
  }

  // -------------------------------------------------------------------------
  // Test 4: Wrong protocol field → invalid
  // -------------------------------------------------------------------------
  console.log('\nTest 4: Wrong protocol field');
  {
    const identity = await makeIdentity('badprotocol');
    const genesisResult = await makeGenesis(identity);
    const entries = [genesisResult];
    const genesisChainCID = genesisResult.cid;

    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: null,
      newHeadCID: genesisChainCID,
      identity,
      useMaster: true,
    });

    const badProto = { ...submission, protocol: 'koad.identity.head.v99' };

    const result = await verifyHeadSubmission(badProto, {
      priorKnownHead: null,
      entries,
    });

    assert(result.valid === false, 'wrong-protocol: valid=false');
    assert(result.reason === 'wrong-protocol', `wrong-protocol: reason=wrong-protocol (got: ${result.reason})`);
  }

  // -------------------------------------------------------------------------
  // Test 5: previous_head_cid mismatch → invalid
  // Build a two-entry chain so we can use a non-null previous_head_cid.
  // Verifier priorKnownHead is set to a DIFFERENT CID (a fake "other" head),
  // so submission.previous_head_cid (genesis CID) doesn't match → previous-mismatch.
  // -------------------------------------------------------------------------
  console.log('\nTest 5: previous_head_cid mismatch');
  {
    const masterIdentity = await makeIdentity('prevmismatch');
    const leafIdentity = await makeIdentity('prevmismatch-leaf');
    const genesisResult = await makeGenesis(masterIdentity);
    const leafResult = await makeLeafAuthorize({
      masterIdentity,
      leafIdentity,
      prevCID: genesisResult.cid,
    });
    const entries = [genesisResult, leafResult];
    const tipCID = leafResult.cid;

    // Submission claims previous = genesis CID, but priorKnownHead is a fake CID
    const { submission } = await buildHeadSubmission({
      entityHandle: masterIdentity.handle,
      previousHeadCID: genesisResult.cid,
      newHeadCID: tipCID,
      identity: masterIdentity,
      useMaster: true,
    });

    // priorKnownHead is a different CID → previous_head_cid doesn't match
    const result = await verifyHeadSubmission(submission, {
      priorKnownHead: 'baguzsomeotherentirelyunknowncid00000000000000',
      entries,
    });

    assert(result.valid === false, 'prev-mismatch: valid=false');
    assert(result.reason === 'previous-mismatch', `prev-mismatch: reason=previous-mismatch (got: ${result.reason})`);
  }

  // -------------------------------------------------------------------------
  // Test 6: Master-signed submission accepted (useMaster: true)
  // -------------------------------------------------------------------------
  console.log('\nTest 6: Master-signed submission accepted');
  {
    const identity = await makeIdentity('mastersubmit');
    const genesisResult = await makeGenesis(identity);
    const entries = [genesisResult];
    const genesisChainCID = genesisResult.cid;

    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: null,
      newHeadCID: genesisChainCID,
      identity,
      useMaster: true,
    });

    assert(submission.submitted_by_fingerprint === identity.masterFingerprint, 'master-signed: fp is masterFingerprint');
    assert(submission.protocol === 'koad.identity.head.v1', 'master-signed: protocol correct');

    const result = await verifyHeadSubmission(submission, {
      priorKnownHead: null,
      entries,
    });

    assert(result.valid === true, 'master-signed: valid=true');
  }

  // -------------------------------------------------------------------------
  // Test 7: Leaf-signed submission accepted (default useMaster=false)
  // -------------------------------------------------------------------------
  console.log('\nTest 7: Leaf-signed submission accepted');
  {
    const masterIdentity = await makeIdentity('leafsubmit');
    const leafIdentity = await makeIdentity('leafsubmit-leaf');

    const genesisResult = await makeGenesis(masterIdentity);
    const leafAuthorizeResult = await makeLeafAuthorize({
      masterIdentity,
      leafIdentity,
      prevCID: genesisResult.cid,
    });

    const entries = [genesisResult, leafAuthorizeResult];
    const tipCID = leafAuthorizeResult.cid;

    // Configure leafIdentity so it acts as a leaf: its masterFingerprint is the "leaf fp"
    // The test framework uses a separate identity object as the leaf key.
    // We sign using leafIdentity but claim the entity is masterIdentity.handle.
    // To test leaf-signed submission: use leafIdentity for signing, previous=genesis CID.

    // Build leaf submission: signer is leafIdentity (useMaster=false → uses fingerprint)
    // leafIdentity.fingerprint must equal leafIdentity.masterFingerprint in this test setup
    // (since createKoadIdentity in ceremony posture uses masterFingerprint as the leaf fp for first signing)
    const { submission } = await buildHeadSubmission({
      entityHandle: masterIdentity.handle,
      previousHeadCID: genesisResult.cid,
      newHeadCID: tipCID,
      identity: leafIdentity,
      useMaster: false,
    });

    assert(submission.submitted_by_fingerprint === leafIdentity.fingerprint, 'leaf-signed: fp is leafIdentity.fingerprint (device leaf)');

    const result = await verifyHeadSubmission(submission, {
      priorKnownHead: genesisResult.cid,
      entries,
    });

    assert(result.valid === true, 'leaf-signed: valid=true');
    assert(Array.isArray(result.leafSet), 'leaf-signed: leafSet returned');
  }

  // -------------------------------------------------------------------------
  // Test 8: Null previous_head_cid (first publication) accepted
  // -------------------------------------------------------------------------
  console.log('\nTest 8: First publication (previous_head_cid=null) accepted');
  {
    const identity = await makeIdentity('firstpub');
    const genesisResult = await makeGenesis(identity);
    const entries = [genesisResult];

    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: null,
      newHeadCID: genesisResult.cid,
      identity,
      useMaster: true,
    });

    assert(submission.previous_head_cid === null, 'first-pub: previous_head_cid is null');

    const result = await verifyHeadSubmission(submission, {
      priorKnownHead: null,
      entries,
    });

    assert(result.valid === true, 'first-pub: valid=true');
  }

  // -------------------------------------------------------------------------
  // Test 9: Genesis replay rejected (priorKnownHead set but previous_head_cid null)
  // -------------------------------------------------------------------------
  console.log('\nTest 9: Genesis replay rejected');
  {
    const identity = await makeIdentity('genreplay');
    const genesisResult = await makeGenesis(identity);
    const entries = [genesisResult];

    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: null,
      newHeadCID: genesisResult.cid,
      identity,
      useMaster: true,
    });

    // Simulate: Vesta already has this entity at genesisResult.cid
    const result = await verifyHeadSubmission(submission, {
      priorKnownHead: genesisResult.cid,
      entries,
    });

    assert(result.valid === false, 'genesis-replay: valid=false');
    assert(result.reason === 'genesis-replay', `genesis-replay: reason=genesis-replay (got: ${result.reason})`);
  }

  // -------------------------------------------------------------------------
  // Test 10: Already-current CID → valid + alreadyCurrent flag
  // -------------------------------------------------------------------------
  console.log('\nTest 10: Already-current CID — idempotent no-op');
  {
    const identity = await makeIdentity('alreadycurrent');
    const genesisResult = await makeGenesis(identity);
    const entries = [genesisResult];
    const tipCID = genesisResult.cid;

    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: tipCID,  // points to "previous" which happens to match
      newHeadCID: tipCID,       // same as priorKnownHead
      identity,
      useMaster: true,
    });

    const result = await verifyHeadSubmission(submission, {
      priorKnownHead: tipCID,
      entries,
    });

    assert(result.valid === true, 'already-current: valid=true');
    assert(result.alreadyCurrent === true, 'already-current: alreadyCurrent=true');
  }

  // -------------------------------------------------------------------------
  // Test 11: Future timestamp → invalid
  // -------------------------------------------------------------------------
  console.log('\nTest 11: Future timestamp → invalid');
  {
    const identity = await makeIdentity('futurestamp');
    const genesisResult = await makeGenesis(identity);
    const entries = [genesisResult];

    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: null,
      newHeadCID: genesisResult.cid,
      identity,
      useMaster: true,
    });

    // Forge a future timestamp
    const futureSubmission = {
      ...submission,
      submitted_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // +10 minutes
    };

    const result = await verifyHeadSubmission(futureSubmission, {
      priorKnownHead: null,
      entries,
    });

    assert(result.valid === false, 'future-timestamp: valid=false');
    assert(result.reason === 'future-timestamp', `future-timestamp: reason=future-timestamp (got: ${result.reason})`);
  }

  // -------------------------------------------------------------------------
  // Test 12: Missing entries → chain-invalid
  // -------------------------------------------------------------------------
  console.log('\nTest 12: Missing entries → chain-invalid');
  {
    const identity = await makeIdentity('noentries');
    const genesisResult = await makeGenesis(identity);

    const { submission } = await buildHeadSubmission({
      entityHandle: identity.handle,
      previousHeadCID: null,
      newHeadCID: genesisResult.cid,
      identity,
      useMaster: true,
    });

    const result = await verifyHeadSubmission(submission, {
      priorKnownHead: null,
      entries: [],   // empty — simulates "IPFS not yet available"
    });

    assert(result.valid === false, 'no-entries: valid=false');
    assert(result.reason === 'chain-invalid', `no-entries: reason=chain-invalid (got: ${result.reason})`);
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
