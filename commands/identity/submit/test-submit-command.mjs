#!/usr/bin/env node
// test-submit-command.mjs — Tests for the identity submit + verify command layer
//
// Tests the sigchain generation + submission building logic that the bridge
// will use. Does not exercise file I/O or IPFS (dry-run path).
//
// Run: node commands/identity/submit/test-submit-command.mjs
//      (from ~/.koad-io/)

import { join } from 'path';
import os from 'os';

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
// Results
// ---------------------------------------------------------------------------
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
