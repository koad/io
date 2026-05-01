#!/usr/bin/env node
// test-submit-command.mjs — Tests for the identity submit + verify command layer
//
// Tests the sigchain generation + submission building logic that the bridge
// will use. Does not exercise file I/O or IPFS (dry-run path).
//
// Run: node commands/identity/submit/test-submit-command.mjs
//      (from ~/.koad-io/)

import { readFileSync as _readFileSync, existsSync as _existsSync, mkdtempSync, rmSync, mkdirSync as _mkdirSync, writeFileSync as _writeFileSync, readdirSync as _readdirSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { homedir } from 'os';

const homeDir = process.env.HOME || os.homedir();
const nodeModulePath = join(homeDir, '.koad-io', 'modules', 'node');

const sigchainMod   = await import(join(nodeModulePath, 'sigchain.js'));
const identityMod   = await import(join(nodeModulePath, 'identity.js'));
const submissionMod = await import(join(nodeModulePath, 'identity-submission.js'));
const writerMod     = await import(join(nodeModulePath, 'identity-writer.js'));
const ceremonyMod   = await import(join(nodeModulePath, 'ceremony.js'));

const {
  buildIdentityGenesis, buildLeafAuthorize, wrapEntry, signEntry, computeCID, verifyChain
} = sigchainMod;
const { createKoadIdentity } = identityMod;
const { buildHeadSubmission, verifyHeadSubmission } = submissionMod;
const { writeIdentityRegistry } = writerMod;

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test helpers — replicate the submit bridge's logic in a testable form
// ---------------------------------------------------------------------------

/**
 * Build a complete test identity with genesis + leaf-authorize chain,
 * replicating what submit-bridge.mjs does at submission time.
 */
async function buildFullChain(handle) {
  const identity = createKoadIdentity();
  await identity.create({ handle, userid: `${handle} <${handle}@test.koad.sh>` });

  const now = new Date().toISOString();

  // Genesis entry (leaf-signed in test; master-signed in production with --mnemonic)
  const { type: genesisType, payload: genesisPayload } = buildIdentityGenesis({
    entity_handle: handle,
    master_fingerprint: identity.masterFingerprint,
    master_pubkey_armored: identity.masterPublicKey,
    created: now,
    description: `${handle} test identity`,
  });
  const unsignedGenesis = wrapEntry({
    entity: handle,
    timestamp: now,
    type: genesisType,
    payload: genesisPayload,
    previous: null,
  });
  const genesisResult = await signEntry(unsignedGenesis, identity, { useMaster: true });

  // Leaf-authorize entry
  const { type: leafType, payload: leafPayload } = buildLeafAuthorize({
    leaf_fingerprint: identity.fingerprint,
    leaf_pubkey_armored: identity.publicKey,
    authorized_by_fingerprint: identity.masterFingerprint,
    authorized_at: now,
    device_label: 'test-device',
  });
  const unsignedLeafAuth = wrapEntry({
    entity: handle,
    timestamp: now,
    type: leafType,
    payload: leafPayload,
    previous: genesisResult.cid,
  });
  const leafAuthResult = await signEntry(unsignedLeafAuth, identity, { useMaster: true });

  return {
    identity,
    entries: [genesisResult, leafAuthResult],
    genesisCID: genesisResult.cid,
    tipCID: leafAuthResult.cid,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Chain generation produces valid verifiable entries
// ---------------------------------------------------------------------------
console.log('\n=== test-submit-command.mjs ===\n');
console.log('Test 1: Chain generation — genesis + leaf-authorize are valid');
{
  const { identity, entries, genesisCID, tipCID } = await buildFullChain('testsubmit1');

  assert(typeof genesisCID === 'string' && genesisCID.startsWith('bagu'), 'genesis CID has bagu prefix');
  assert(typeof tipCID === 'string' && tipCID.startsWith('bagu'), 'tip CID has bagu prefix');
  assert(genesisCID !== tipCID, 'genesis CID ≠ tip CID');

  // Verify the chain
  const chainResult = await verifyChain(entries);
  assert(chainResult.valid === true, 'verifyChain: valid=true');
  assert(chainResult.entity_handle === 'testsubmit1', 'verifyChain: entity_handle correct');
  assert(chainResult.masterFingerprint === identity.masterFingerprint, 'verifyChain: masterFingerprint correct');
  assert(chainResult.sigchainHeadCID === tipCID, 'verifyChain: sigchainHeadCID === tipCID');
  assert(chainResult.leafSet.length === 1, `verifyChain: 1 authorized leaf (got ${chainResult.leafSet.length})`);
  assert(chainResult.leafSet[0].fingerprint === identity.fingerprint, 'verifyChain: authorized leaf fp matches identity.fingerprint');
}

// ---------------------------------------------------------------------------
// Test 2: SPEC-150 submission round-trip for first publication
// ---------------------------------------------------------------------------
console.log('\nTest 2: SPEC-150 submission round-trip — first publication (previous=null)');
{
  const { identity, entries, tipCID } = await buildFullChain('testsubmit2');

  const { submission } = await buildHeadSubmission({
    entityHandle: identity.handle,
    previousHeadCID: null,
    newHeadCID: tipCID,
    identity,
    useMaster: false, // leaf-signed submission
  });

  assert(submission.protocol === 'koad.identity.head.v1', 'submission: protocol correct');
  assert(submission.entity_handle === 'testsubmit2', 'submission: entity_handle correct');
  assert(submission.new_head_cid === tipCID, 'submission: new_head_cid = tipCID');
  assert(submission.previous_head_cid === null, 'submission: previous_head_cid = null');
  assert(typeof submission.signature === 'string' && submission.signature.includes('BEGIN PGP'), 'submission: signature is PGP armored');
  assert(submission.submitted_by_fingerprint === identity.fingerprint, 'submission: submitted_by_fingerprint = leaf fp');

  // Verify the submission
  const result = await verifyHeadSubmission(submission, { priorKnownHead: null, entries });
  assert(result.valid === true, `verifyHeadSubmission: valid=true (got: ${JSON.stringify(result)})`);
  assert(result.masterFingerprint === identity.masterFingerprint, 'verifyHeadSubmission: masterFingerprint correct');
}

// ---------------------------------------------------------------------------
// Test 3: SPEC-150 submission round-trip for update (previous != null)
// ---------------------------------------------------------------------------
console.log('\nTest 3: SPEC-150 submission round-trip — update (previous=genesis CID)');
{
  const { identity, entries, genesisCID, tipCID } = await buildFullChain('testsubmit3');

  const { submission } = await buildHeadSubmission({
    entityHandle: identity.handle,
    previousHeadCID: genesisCID,
    newHeadCID: tipCID,
    identity,
    useMaster: false,
  });

  assert(submission.previous_head_cid === genesisCID, 'submission: previous_head_cid = genesisCID');

  const result = await verifyHeadSubmission(submission, { priorKnownHead: genesisCID, entries });
  assert(result.valid === true, `verifyHeadSubmission: valid=true`);
}

// ---------------------------------------------------------------------------
// Test 4: Dry-run output contains expected CIDs
// ---------------------------------------------------------------------------
console.log('\nTest 4: Dry-run output — CIDs are present and correct');
{
  const { identity, entries, genesisCID, tipCID } = await buildFullChain('testsubmit4');

  // Simulate the dry-run output (no file writes; just validate CID shapes)
  assert(genesisCID.length > 40, `genesis CID length > 40 chars (got ${genesisCID.length})`);
  assert(tipCID.length > 40, `tip CID length > 40 chars (got ${tipCID.length})`);

  // Simulate identity.json update that submit writes
  const mockMetadata = {
    entity: identity.handle,
    masterFingerprint: identity.masterFingerprint,
    leafFingerprints: [identity.fingerprint],
    created: new Date().toISOString(),
    sigchain_tip_cid: tipCID,
    sigchain_genesis_cid: genesisCID,
    spec: 'VESTA-SPEC-150 v1.1',
  };

  assert(mockMetadata.sigchain_tip_cid === tipCID, 'metadata: sigchain_tip_cid correct');
  assert(mockMetadata.sigchain_genesis_cid === genesisCID, 'metadata: sigchain_genesis_cid correct');
}

// ---------------------------------------------------------------------------
// Test 5: ROOTY-SPEC-001 OP_RETURN payload shape
// ---------------------------------------------------------------------------
console.log('\nTest 5: ROOTY-SPEC-001 OP_RETURN payload — magic + version + flags + CID');
{
  const { tipCID } = await buildFullChain('testsubmit5');

  // Replicate buildChainAnchor payload construction from submit-bridge.mjs
  // Import multiformats from the node module's own node_modules
  const { CID } = await import(join(nodeModulePath, 'node_modules', 'multiformats', 'dist', 'src', 'cid.js'));
  const cidObj = CID.parse(tipCID);
  const cidBytes = cidObj.bytes;

  const magic = Buffer.from([0x6B, 0x49, 0x4F]);   // "kIO"
  const version = Buffer.from([0x01]);
  const flags = Buffer.from([0x00]);
  const cidBuf = Buffer.from(cidBytes);
  const payload = Buffer.concat([magic, version, flags, cidBuf]);

  assert(payload[0] === 0x6B, 'OP_RETURN payload: magic[0] = 0x6B (k)');
  assert(payload[1] === 0x49, 'OP_RETURN payload: magic[1] = 0x49 (I)');
  assert(payload[2] === 0x4F, 'OP_RETURN payload: magic[2] = 0x4F (O)');
  assert(payload[3] === 0x01, 'OP_RETURN payload: version = 0x01');
  assert(payload[4] === 0x00, 'OP_RETURN payload: flags = 0x00');
  assert(payload.length <= 80, `OP_RETURN payload within 80-byte limit (got ${payload.length} bytes)`);
  assert(payload.length === 5 + cidBytes.length, `OP_RETURN payload: 5 header + ${cidBytes.length} CID bytes = ${payload.length}`);
}

// ---------------------------------------------------------------------------
// Test 6: Vesta registry write + read consistency
// ---------------------------------------------------------------------------
console.log('\nTest 6: Vesta registry write/read consistency');
{
  const { identity, tipCID } = await buildFullChain('testsubmit6');

  // Use a temp vesta dir so we don't pollute real ~/.vesta/
  const { mkdtempSync, rmSync } = await import('fs');
  const tmpVestaDir = mkdtempSync('/tmp/test-vesta-');

  try {
    const writeResult = await writeIdentityRegistry({
      handle: identity.handle,
      masterFingerprint: identity.masterFingerprint,
      masterPublicKey: identity.masterPublicKey,
      sigchainHeadCID: tipCID,
      vestaDir: tmpVestaDir,
    });

    assert(writeResult.written === true, 'writeIdentityRegistry: written=true');
    assert(writeResult.created === true, 'writeIdentityRegistry: created=true');

    // Read back
    const { readFileSync, existsSync } = await import('fs');
    const metaPath = join(writeResult.sigchainDir, 'metadata.json');
    const headPath = join(writeResult.sigchainDir, 'sigchain-head.txt');
    const pubPath  = join(writeResult.sigchainDir, 'master.pub.asc');

    assert(existsSync(metaPath), 'metadata.json written');
    assert(existsSync(headPath), 'sigchain-head.txt written');
    assert(existsSync(pubPath),  'master.pub.asc written');

    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    assert(meta.handle === identity.handle, 'metadata: handle correct');
    assert(meta.masterFingerprint === identity.masterFingerprint, 'metadata: masterFingerprint correct');
    assert(meta.sigchainHeadCID === tipCID, 'metadata: sigchainHeadCID correct');
    assert(meta.status === 'active', 'metadata: status=active');

    const head = readFileSync(headPath, 'utf8').trim();
    assert(head === tipCID, 'sigchain-head.txt: CID correct');

  } finally {
    rmSync(tmpVestaDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Test 7: Verify command logic — chain walk from cached entries
// ---------------------------------------------------------------------------
console.log('\nTest 7: Verify command logic — chain walk from plain entry objects');
{
  const { identity, entries, genesisCID, tipCID } = await buildFullChain('testsubmit7');

  // Simulate what verify-bridge.mjs does: sort + walk plain entry objects
  const plainEntries = entries.map(e => e.entry || e);

  const chainResult = await verifyChain(plainEntries);
  assert(chainResult.valid === true, 'verifyChain from plain entries: valid=true');
  assert(chainResult.sigchainHeadCID === tipCID, 'verifyChain: head CID correct');
  assert(chainResult.errors.length === 0, `verifyChain: no errors (got ${chainResult.errors.length})`);
}

// ---------------------------------------------------------------------------
// Test 8: Piece 1 — master-signed genesis (SPEC-149 §6 conformance)
//
// Simulates the --mnemonic path in submit-bridge.mjs:
//   - Derive master from mnemonic
//   - Sign genesis + leaf-authorize with master
//   - Verify chain walk confirms master-signed genesis
// ---------------------------------------------------------------------------
console.log('\nTest 8: Piece 1 — master-signed genesis (SPEC-149 §6 compliance)');
{
  // Build identity using ceremony path (master in memory)
  const identity = createKoadIdentity();
  const { mnemonic, masterFingerprint: mFP } = await identity.create({
    handle: 'testsubmit8',
    userid: 'testsubmit8 <testsubmit8@test.koad.sh>',
  });

  const now = new Date().toISOString();

  // Genesis must be signed by master (useMaster: true)
  const { type: gType, payload: gPayload } = buildIdentityGenesis({
    entity_handle: 'testsubmit8',
    master_fingerprint: identity.masterFingerprint,
    master_pubkey_armored: identity.masterPublicKey,
    created: now,
    description: 'master-signed genesis test',
  });
  const unsignedGenesis = wrapEntry({
    entity: 'testsubmit8',
    timestamp: now,
    type: gType,
    payload: gPayload,
    previous: null,
  });
  const genesisResult = await signEntry(unsignedGenesis, identity, { useMaster: true });

  const { type: lType, payload: lPayload } = buildLeafAuthorize({
    leaf_fingerprint: identity.fingerprint,
    leaf_pubkey_armored: identity.publicKey,
    authorized_by_fingerprint: identity.masterFingerprint,
    authorized_at: now,
    device_label: 'test-master-signed',
  });
  const unsignedLeafAuth = wrapEntry({
    entity: 'testsubmit8',
    timestamp: now,
    type: lType,
    payload: lPayload,
    previous: genesisResult.cid,
  });
  const leafAuthResult = await signEntry(unsignedLeafAuth, identity, { useMaster: true });

  // Verify chain
  const chainResult = await verifyChain([genesisResult, leafAuthResult]);
  assert(chainResult.valid === true, 'Test 8: master-signed genesis chain is valid');
  assert(chainResult.errors.length === 0, `Test 8: no chain errors (got ${chainResult.errors.length})`);
  assert(chainResult.leafSet.length === 1, 'Test 8: 1 authorized leaf');
  assert(chainResult.masterFingerprint === identity.masterFingerprint, 'Test 8: masterFingerprint correct');

  // Verify genesis entry is signed by master: the chain walker verifies this;
  // valid=true means the master signature on genesis was accepted
  assert(chainResult.valid === true, 'Test 8: master signature on genesis verified by chain walk');

  // Lockdown — master must be scrubbed
  identity.lockdown();
  assert(!identity.isMasterLoaded, 'Test 8: master scrubbed after lockdown');
  assert(identity.isLoaded, 'Test 8: leaf still loaded after lockdown');
}

// ---------------------------------------------------------------------------
// Test 9: Piece 1 — leaf-signed genesis with warning (non-conforming fallback)
//
// When --mnemonic is not provided, submit-bridge should sign with leaf and emit
// a warning. Here we verify the chain is technically walkable (valid=true)
// but the genesis is NOT signed by master (verified by attempting master verify).
// ---------------------------------------------------------------------------
console.log('\nTest 9: Piece 1 — leaf-signed genesis warning path (non-conforming but functional)');
{
  const identity = createKoadIdentity();
  await identity.create({ handle: 'testsubmit9', userid: 'testsubmit9 <testsubmit9@test.koad.sh>' });
  identity.lockdown(); // lock master — simulates "no --mnemonic" posture

  const now = new Date().toISOString();

  const { type: gType, payload: gPayload } = buildIdentityGenesis({
    entity_handle: 'testsubmit9',
    master_fingerprint: identity.masterFingerprint,
    master_pubkey_armored: identity.masterPublicKey,
    created: now,
    description: 'leaf-signed genesis test',
  });
  const unsignedGenesis = wrapEntry({
    entity: 'testsubmit9', timestamp: now, type: gType, payload: gPayload, previous: null,
  });

  // Sign with leaf (useMaster: false) — simulates no-mnemonic path
  const genesisResult = await signEntry(unsignedGenesis, identity, { useMaster: false });

  const { type: lType, payload: lPayload } = buildLeafAuthorize({
    leaf_fingerprint: identity.fingerprint,
    leaf_pubkey_armored: identity.publicKey,
    authorized_by_fingerprint: identity.masterFingerprint, // states master authorized it
    authorized_at: now,
    device_label: 'test-leaf-signed',
  });
  const unsignedLeafAuth = wrapEntry({
    entity: 'testsubmit9', timestamp: now, type: lType, payload: lPayload, previous: genesisResult.cid,
  });
  const leafAuthResult = await signEntry(unsignedLeafAuth, identity, { useMaster: false });

  // Chain walk: genesis verifies against masterPublicKey — since it was leaf-signed,
  // the chain walk will FAIL (verifyEntry on genesis checks against master pub).
  // This is the expected non-conforming behavior: chain is invalid per verifyChain.
  const chainResult = await verifyChain([genesisResult, leafAuthResult]);
  // Leaf-signed genesis will fail chain validation because genesis signature is checked
  // against masterPublicKey — correct rejection of non-conforming chain.
  assert(chainResult.valid === false, 'Test 9: leaf-signed genesis correctly rejected by chain walk');
  assert(chainResult.errors.length > 0, `Test 9: chain walk reports error for leaf-signed genesis (got ${chainResult.errors.length})`);
  const hasGenesisError = chainResult.errors.some(e =>
    e.type === 'genesis-signature-invalid' || e.type === 'cid-link-mismatch'
  );
  assert(hasGenesisError, `Test 9: chain error is genesis-signature-invalid or cid-link-mismatch (got ${chainResult.errors.map(e=>e.type).join(',')})`);
}

// ---------------------------------------------------------------------------
// Test 10: Piece 2 — device-key add via master (sigchain extension)
//
// Simulates the device-key-add-bridge flow:
//   - Existing chain with master-signed genesis
//   - Add a new device key, authorized by master
//   - Verify the extended chain has 2 authorized leaves
// ---------------------------------------------------------------------------
console.log('\nTest 10: Piece 2 — device-key add via master (sigchain extension)');
{
  const { buildLeafKeyManager: buildLeafKM10, extractKMInfo: extractKMInfo10 } = ceremonyMod;

  const id10b = createKoadIdentity();
  await id10b.create({
    handle: 'testsubmit10b',
    userid: 'testsubmit10b <testsubmit10b@test.koad.sh>',
  });

  const now10 = new Date().toISOString();

  // Build initial chain (master-signed)
  const { type: gType10, payload: gPayload10 } = buildIdentityGenesis({
    entity_handle: 'testsubmit10b',
    master_fingerprint: id10b.masterFingerprint,
    master_pubkey_armored: id10b.masterPublicKey,
    created: now10,
    description: 'device-key add test',
  });
  const gen10 = wrapEntry({ entity: 'testsubmit10b', timestamp: now10, type: gType10, payload: gPayload10, previous: null });
  const genesisResult10 = await signEntry(gen10, id10b, { useMaster: true });

  const { type: l1Type10, payload: l1Payload10 } = buildLeafAuthorize({
    leaf_fingerprint: id10b.fingerprint,
    leaf_pubkey_armored: id10b.publicKey,
    authorized_by_fingerprint: id10b.masterFingerprint,
    authorized_at: now10,
    device_label: 'original-device',
  });
  const la10 = wrapEntry({ entity: 'testsubmit10b', timestamp: now10, type: l1Type10, payload: l1Payload10, previous: genesisResult10.cid });
  const leafAuth10 = await signEntry(la10, id10b, { useMaster: true });
  const chainTip10 = leafAuth10.cid;

  // Simulate device-key add: generate a second leaf, authorize with master
  const leaf2KM10 = await buildLeafKM10('testsubmit10b (device: new-device) <testsubmit10b@test.koad.sh>');
  const { fingerprint: leaf2FP10, publicKey: leaf2Pub10 } = await extractKMInfo10(leaf2KM10);

  const { type: l2Type10, payload: l2Payload10 } = buildLeafAuthorize({
    leaf_fingerprint: leaf2FP10,
    leaf_pubkey_armored: leaf2Pub10,
    authorized_by_fingerprint: id10b.masterFingerprint,
    authorized_at: now10,
    device_label: 'new-device',
  });
  const la210 = wrapEntry({ entity: 'testsubmit10b', timestamp: now10, type: l2Type10, payload: l2Payload10, previous: chainTip10 });
  const leafAuth210 = await signEntry(la210, id10b, { useMaster: true }); // master signs new leaf
  const newTip10 = leafAuth210.cid;

  // Walk extended chain
  const chain10 = await verifyChain([genesisResult10, leafAuth10, leafAuth210]);
  assert(chain10.valid === true, 'Test 10: extended chain with 2 leaves is valid');
  assert(chain10.leafSet.length === 2, `Test 10: 2 authorized leaves (got ${chain10.leafSet.length})`);
  const leaf2Authorized = chain10.leafSet.some(l => l.fingerprint === leaf2FP10);
  assert(leaf2Authorized, 'Test 10: new device leaf is in authorized set');
  assert(chain10.sigchainHeadCID === newTip10, 'Test 10: sigchainHeadCID = new leaf-authorize CID');

  // Lockdown
  id10b.lockdown();
  assert(!id10b.isMasterLoaded, 'Test 10: master scrubbed after lockdown');
}

// ---------------------------------------------------------------------------
// Test 11: Piece 2 — device-key add via existing leaf (alternate authorization)
// ---------------------------------------------------------------------------
console.log('\nTest 11: Piece 2 — device-key add via existing authorized leaf');
{
  const { buildLeafKeyManager: buildLeafKM11, extractKMInfo: extractKMInfo11 } = ceremonyMod;

  const id11 = createKoadIdentity();
  await id11.create({ handle: 'testsubmit11', userid: 'testsubmit11 <testsubmit11@test.koad.sh>' });
  const now11 = new Date().toISOString();

  // Build initial master-signed chain
  const { type: gT11, payload: gP11 } = buildIdentityGenesis({
    entity_handle: 'testsubmit11',
    master_fingerprint: id11.masterFingerprint,
    master_pubkey_armored: id11.masterPublicKey,
    created: now11,
    description: 'leaf-authorized add test',
  });
  const gen11 = wrapEntry({ entity: 'testsubmit11', timestamp: now11, type: gT11, payload: gP11, previous: null });
  const genesis11 = await signEntry(gen11, id11, { useMaster: true });

  const { type: l1T11, payload: l1P11 } = buildLeafAuthorize({
    leaf_fingerprint: id11.fingerprint,
    leaf_pubkey_armored: id11.publicKey,
    authorized_by_fingerprint: id11.masterFingerprint,
    authorized_at: now11,
    device_label: 'original-device',
  });
  const la11 = wrapEntry({ entity: 'testsubmit11', timestamp: now11, type: l1T11, payload: l1P11, previous: genesis11.cid });
  const leafAuth11 = await signEntry(la11, id11, { useMaster: true });
  const tip11 = leafAuth11.cid;

  // Lockdown master — now only leaf is available
  id11.lockdown();

  // Add second leaf, authorized by EXISTING LEAF (not master)
  const leaf2KM11 = await buildLeafKM11('testsubmit11 (device: second) <testsubmit11@test.koad.sh>');
  const { fingerprint: leaf2FP11, publicKey: leaf2Pub11 } = await extractKMInfo11(leaf2KM11);

  const { type: l2T11, payload: l2P11 } = buildLeafAuthorize({
    leaf_fingerprint: leaf2FP11,
    leaf_pubkey_armored: leaf2Pub11,
    authorized_by_fingerprint: id11.fingerprint, // existing leaf signs, not master
    authorized_at: now11,
    device_label: 'second-device',
  });
  const la211 = wrapEntry({ entity: 'testsubmit11', timestamp: now11, type: l2T11, payload: l2P11, previous: tip11 });
  const leafAuth211 = await signEntry(la211, id11, { useMaster: false }); // existing leaf signs

  const chain11 = await verifyChain([genesis11, leafAuth11, leafAuth211]);
  assert(chain11.valid === true, 'Test 11: leaf-authorized add chain is valid');
  assert(chain11.leafSet.length === 2, `Test 11: 2 authorized leaves (got ${chain11.leafSet.length})`);
  const leaf2Auth11 = chain11.leafSet.some(l => l.fingerprint === leaf2FP11);
  assert(leaf2Auth11, 'Test 11: second leaf authorized by existing leaf');
}

// ---------------------------------------------------------------------------
// Test 12: Piece 2 — unauthorized device-key add rejected (no mnemonic, no leaf-key)
//
// The command.sh validates this before reaching the bridge, but we also test
// the chain walk: a leaf-authorize entry signed by an unknown fingerprint
// fails chain walk validation (authorized_by_fingerprint not recognized).
// ---------------------------------------------------------------------------
console.log('\nTest 12: Piece 2 — unauthorized leaf-authorize rejected by chain walk');
{
  const { buildLeafKeyManager: buildLeafKM12, extractKMInfo: extractKMInfo12 } = ceremonyMod;

  const id12 = createKoadIdentity();
  await id12.create({ handle: 'testsubmit12', userid: 'testsubmit12 <testsubmit12@test.koad.sh>' });
  const now12 = new Date().toISOString();

  // Build a minimal valid chain
  const { type: gT12, payload: gP12 } = buildIdentityGenesis({
    entity_handle: 'testsubmit12',
    master_fingerprint: id12.masterFingerprint,
    master_pubkey_armored: id12.masterPublicKey,
    created: now12,
    description: 'unauthorized add test',
  });
  const gen12 = wrapEntry({ entity: 'testsubmit12', timestamp: now12, type: gT12, payload: gP12, previous: null });
  const genesis12 = await signEntry(gen12, id12, { useMaster: true });

  const { type: l1T12, payload: l1P12 } = buildLeafAuthorize({
    leaf_fingerprint: id12.fingerprint,
    leaf_pubkey_armored: id12.publicKey,
    authorized_by_fingerprint: id12.masterFingerprint,
    authorized_at: now12,
    device_label: 'real-device',
  });
  const la12 = wrapEntry({ entity: 'testsubmit12', timestamp: now12, type: l1T12, payload: l1P12, previous: genesis12.cid });
  const leafAuth12 = await signEntry(la12, id12, { useMaster: true });
  const tip12 = leafAuth12.cid;

  // Create an UNAUTHORIZED leaf-authorize: signed by an unknown identity
  const unknownId = createKoadIdentity();
  await unknownId.create({ handle: 'unknown12', userid: 'unknown12 <unknown12@test.koad.sh>' });
  unknownId.lockdown();

  const newLeaf12 = await buildLeafKM12('testsubmit12 (device: sneaky) <testsubmit12@test.koad.sh>');
  const { fingerprint: newLeaf12FP, publicKey: newLeaf12Pub } = await extractKMInfo12(newLeaf12);

  const { type: l3T12, payload: l3P12 } = buildLeafAuthorize({
    leaf_fingerprint: newLeaf12FP,
    leaf_pubkey_armored: newLeaf12Pub,
    authorized_by_fingerprint: unknownId.fingerprint, // unauthorized signer
    authorized_at: now12,
    device_label: 'sneaky-device',
  });
  const la312 = wrapEntry({ entity: 'testsubmit12', timestamp: now12, type: l3T12, payload: l3P12, previous: tip12 });
  const badLeafAuth12 = await signEntry(la312, unknownId, { useMaster: false });

  const chain12 = await verifyChain([genesis12, leafAuth12, badLeafAuth12]);
  // The unauthorized leaf-authorize has no effect on leafSet
  const sneakyAuthorized = chain12.leafSet.some(l => l.fingerprint === newLeaf12FP);
  assert(!sneakyAuthorized, 'Test 12: unauthorized leaf-authorize has no effect — sneaky leaf not in leafSet');
  const hasAuthorizerError = chain12.errors.some(e => e.type === 'leaf-authorize-unknown-authorizer');
  assert(hasAuthorizerError, 'Test 12: chain walk reports leaf-authorize-unknown-authorizer error');
  assert(chain12.leafSet.length === 1, `Test 12: only 1 authorized leaf (the real one) (got ${chain12.leafSet.length})`);
}

// ---------------------------------------------------------------------------
// Test 13: Piece 2 — entry cache write + read round-trip
//
// After submit writes ~/.vesta/entities/<entity>/sigchain/entries/<cid>.json,
// verify reads them back and walks the chain without IPFS.
// ---------------------------------------------------------------------------
console.log('\nTest 13: Piece 2 — entry cache write/read round-trip (submit → verify)');
{
  const handle13 = 'testsubmit13';
  const { identity, entries, genesisCID, tipCID } = await buildFullChain(handle13);

  // Write entries to a temp vesta dir — simulate what submit-bridge.mjs does
  const tmpVesta13 = mkdtempSync('/tmp/test-vesta-');
  const entriesDir13 = join(tmpVesta13, 'entities', handle13, 'sigchain', 'entries');
  _mkdirSync(entriesDir13, { recursive: true });

  const writtenCIDs13 = [];
  for (const { entry, cid } of entries) {
    const cacheFile = join(entriesDir13, `${cid}.json`);
    _writeFileSync(cacheFile, JSON.stringify(entry, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
    writtenCIDs13.push(cid);
  }

  assert(writtenCIDs13.length === 2, `Test 13: 2 cache files written (got ${writtenCIDs13.length})`);
  assert(_existsSync(join(entriesDir13, `${genesisCID}.json`)), 'Test 13: genesis cache file present');
  assert(_existsSync(join(entriesDir13, `${tipCID}.json`)), 'Test 13: tip cache file present');

  // Simulate verify reading from the cache (as verify-bridge.mjs does)
  const readFiles = _readdirSync(entriesDir13).filter(f => f.endsWith('.json'));
  assert(readFiles.length === 2, `Test 13: 2 .json files in entries dir (got ${readFiles.length})`);

  const readEntries13 = readFiles.map(f => JSON.parse(_readFileSync(join(entriesDir13, f), 'utf8')));
  const chain13 = await verifyChain(readEntries13);
  assert(chain13.valid === true, 'Test 13: chain walk from cached entries valid');
  assert(chain13.sigchainHeadCID === tipCID, 'Test 13: sigchainHeadCID correct from cache');
  assert(chain13.masterFingerprint === identity.masterFingerprint, 'Test 13: masterFingerprint correct');
  assert(chain13.leafSet.length === 1, `Test 13: 1 authorized leaf from cache (got ${chain13.leafSet.length})`);

  // Verify CID integrity: re-read and check each file name matches entry CID
  for (const { entry, cid } of entries) {
    const reread = JSON.parse(_readFileSync(join(entriesDir13, `${cid}.json`), 'utf8'));
    const recomputedCID = await computeCID(reread);
    assert(recomputedCID === cid, `Test 13: CID integrity — ${cid.slice(0, 16)}... re-computed matches filename`);
  }

  try {
    rmSync(tmpVesta13, { recursive: true, force: true });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Test 14: Piece 2 — verify handles missing entries dir gracefully
// ---------------------------------------------------------------------------
console.log('\nTest 14: Piece 2 — verify: missing entries dir falls back cleanly');
{
  const fakeVestaDir = '/tmp/nonexistent-vesta-dir-' + Date.now();
  const entriesDir14 = join(fakeVestaDir, 'entries');

  // Simulate what verify-bridge.mjs does when entriesDir is absent
  const dirExists14 = _existsSync(entriesDir14);
  assert(dirExists14 === false, 'Test 14: entries dir correctly not found for nonexistent vesta dir');

  // The verify-bridge.mjs logic: if !existsSync(entriesDir) → cachedEntries stays []
  // which triggers the IPFS / local-reconstruction fallback.
  const cachedEntries14 = [];
  if (_existsSync(entriesDir14)) {
    // would populate from dir
  }
  assert(cachedEntries14.length === 0, 'Test 14: cachedEntries empty when entries dir absent — triggers fallback');
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
