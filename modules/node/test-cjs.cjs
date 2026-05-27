// test-cjs.cjs — CommonJS integration test for @koad-io/node
//
// Validates that every .cjs entry point loads, exports the expected symbols,
// and that real operations (identity ceremony, sigchain, auth, pgp, etc.)
// work through the CJS→ESM bridge.

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    failed++;
  }
}

async function run() {
  // =========================================================================
  // 1. require() every CJS entry — verify exports resolve
  // =========================================================================

  console.log('\n1. require() all CJS entry points');

  const indexMod = require('./index.cjs');
  assert(typeof indexMod.koad === 'object', 'index.cjs exports koad object');
  assert(typeof indexMod.createIdentityShape === 'function', 'index.cjs exports createIdentityShape');
  assert(indexMod.depsReady instanceof Promise, 'index.cjs exports depsReady promise');

  const depsMod = require('./deps.cjs');
  assert(depsMod.ready instanceof Promise, 'deps.cjs exports ready promise');

  const identityMod = require('./identity.cjs');
  assert(typeof identityMod.createKoadIdentity === 'function', 'identity.cjs exports createKoadIdentity');
  assert(typeof identityMod.createIdentityShape === 'function', 'identity.cjs exports createIdentityShape');
  assert(typeof identityMod.createIdentity === 'function', 'identity.cjs exports createIdentity');

  const sigchainMod = require('./sigchain.cjs');
  assert(typeof sigchainMod.buildIdentityGenesis === 'function', 'sigchain.cjs exports buildIdentityGenesis');
  assert(typeof sigchainMod.buildLeafAuthorize === 'function', 'sigchain.cjs exports buildLeafAuthorize');
  assert(typeof sigchainMod.buildLeafRevoke === 'function', 'sigchain.cjs exports buildLeafRevoke');
  assert(typeof sigchainMod.buildPruneAll === 'function', 'sigchain.cjs exports buildPruneAll');
  assert(typeof sigchainMod.buildKeySuccession === 'function', 'sigchain.cjs exports buildKeySuccession');
  assert(typeof sigchainMod.wrapEntry === 'function', 'sigchain.cjs exports wrapEntry');
  assert(typeof sigchainMod.canonicalDagJson === 'function', 'sigchain.cjs exports canonicalDagJson');
  assert(typeof sigchainMod.preImageBytes === 'function', 'sigchain.cjs exports preImageBytes');
  assert(typeof sigchainMod.computeCID === 'function', 'sigchain.cjs exports computeCID');
  assert(typeof sigchainMod.signEntry === 'function', 'sigchain.cjs exports signEntry');
  assert(typeof sigchainMod.verifyEntry === 'function', 'sigchain.cjs exports verifyEntry');
  assert(typeof sigchainMod.verifyChain === 'function', 'sigchain.cjs exports verifyChain');

  const pgpMod = require('./pgp.cjs');
  assert(pgpMod.ready instanceof Promise, 'pgp.cjs exports ready promise');

  const authMod = require('./auth.cjs');
  assert(typeof authMod.challenge === 'function', 'auth.cjs exports challenge');
  assert(typeof authMod.respond === 'function', 'auth.cjs exports respond');
  assert(typeof authMod.verify === 'function', 'auth.cjs exports verify');
  assert(typeof authMod.pendingNonceCount === 'function', 'auth.cjs exports pendingNonceCount');
  assert(typeof authMod.sweepExpiredNonces === 'function', 'auth.cjs exports sweepExpiredNonces');

  const submissionMod = require('./identity-submission.cjs');
  assert(typeof submissionMod.buildHeadSubmission === 'function', 'identity-submission.cjs exports buildHeadSubmission');
  assert(typeof submissionMod.verifyHeadSubmission === 'function', 'identity-submission.cjs exports verifyHeadSubmission');

  const writerMod = require('./identity-writer.cjs');
  assert(typeof writerMod.writeIdentityRegistry === 'function', 'identity-writer.cjs exports writeIdentityRegistry');
  assert(typeof writerMod.updateSigchainHead === 'function', 'identity-writer.cjs exports updateSigchainHead');

  const receiverMod = require('./identity-receiver.cjs');
  assert(typeof receiverMod.receiveHeadSubmission === 'function', 'identity-receiver.cjs exports receiveHeadSubmission');
  assert(typeof receiverMod.queryIdentityHeads === 'function', 'identity-receiver.cjs exports queryIdentityHeads');

  const resolverMod = require('./identity-resolver.cjs');
  assert(typeof resolverMod.resolveIdentity === 'function', 'identity-resolver.cjs exports resolveIdentity');

  // =========================================================================
  // 2. koad object shape (index.cjs)
  // =========================================================================

  console.log('\n2. koad object shape via index.cjs');

  const { koad } = indexMod;
  assert(koad.maintenance === true, 'koad.maintenance starts true');
  assert(Array.isArray(koad.seeders), 'koad.seeders is array');
  assert(Array.isArray(koad.emitters), 'koad.emitters is array');
  assert(Array.isArray(koad.trackers), 'koad.trackers is array');
  assert(typeof koad.format.timestamp === 'function', 'koad.format.timestamp is function');
  assert(typeof koad.deps === 'object', 'koad.deps is object');
  assert(typeof koad.identity === 'object', 'koad.identity is object');
  assert(koad.identity.type === 'pgp', 'koad.identity.type is pgp');

  const ts = koad.format.timestamp(new Date('2026-01-15T10:30:45Z'), '-');
  assert(typeof ts === 'string' && ts.length > 0, 'format.timestamp produces string');

  // =========================================================================
  // 3. depsReady — lazy ESM deps load into koad.deps
  // =========================================================================

  console.log('\n3. depsReady — ESM deps lazy-load into koad.deps');

  await indexMod.depsReady;
  assert(typeof koad.deps.dagJsonEncode === 'function', 'koad.deps.dagJsonEncode loaded');
  assert(typeof koad.deps.dagJsonDecode === 'function', 'koad.deps.dagJsonDecode loaded');
  assert(typeof koad.deps.CID === 'function', 'koad.deps.CID loaded');
  assert(typeof koad.deps.sha256 === 'object', 'koad.deps.sha256 loaded');
  assert(typeof koad.deps.base64 === 'object', 'koad.deps.base64 loaded');
  assert(typeof koad.deps.ed === 'object', 'koad.deps.ed loaded');
  assert(typeof koad.deps.pgp === 'object', 'koad.deps.pgp loaded');

  // =========================================================================
  // 4. deps.cjs .ready promise
  // =========================================================================

  console.log('\n4. deps.cjs .ready resolves with exports');

  const depsResolved = await depsMod.ready;
  assert(typeof depsResolved.dagJsonEncode === 'function', 'deps.ready: dagJsonEncode');
  assert(typeof depsResolved.sha256 === 'object', 'deps.ready: sha256');
  assert(typeof depsResolved.ed === 'object', 'deps.ready: ed');

  // =========================================================================
  // 5. pgp.cjs .ready — clearsign + verify round-trip
  // =========================================================================

  console.log('\n5. pgp.cjs — clearsign + verify round-trip');

  const pgp = await pgpMod.ready;
  assert(typeof pgp.clearsign === 'function', 'pgp.ready: clearsign');
  assert(typeof pgp.verify === 'function', 'pgp.ready: verify');

  // Build a key via ceremony (buildLeafKeyManager) to test pgp.cjs sign/verify
  const ceremony = await import('./ceremony.js');
  const testKM = await ceremony.buildLeafKeyManager('test-cjs-pgp@koad.io');
  assert(testKM !== null, 'buildLeafKeyManager returns km');

  const armor = await pgp.clearsign('hello from CJS', testKM);
  assert(typeof armor === 'string', 'clearsign returns armor string');
  assert(armor.includes('BEGIN PGP SIGNED MESSAGE'), 'armor is PGP clearsigned');

  const { publicKey: testPub } = await ceremony.extractKMInfo(testKM);
  assert(typeof testPub === 'string', 'exported public key');

  const vr = await pgp.verify(armor, testPub);
  assert(vr.verified === true, 'verify returns verified=true');
  assert(vr.body === 'hello from CJS', 'verify returns correct body');

  // =========================================================================
  // 6. identity.cjs — full ceremony through CJS
  // =========================================================================

  console.log('\n6. identity.cjs — create → sign → verify → lockdown');

  const identity = identityMod.createKoadIdentity();
  assert(identity.isLoaded === false, 'not loaded before create');

  const createResult = await identity.create({ handle: 'test-cjs', userid: 'test-cjs@koad.io' });
  assert(typeof createResult.mnemonic === 'string', 'create returns mnemonic');
  assert(typeof createResult.masterFingerprint === 'string', 'create returns masterFingerprint');
  assert(typeof createResult.leafFingerprint === 'string', 'create returns leafFingerprint');
  assert(identity.isLoaded === true, 'isLoaded after create');
  assert(identity.isMasterLoaded === true, 'isMasterLoaded during ceremony');
  assert(identity.posture === 'ceremony', 'posture is ceremony');
  assert(identity.handle === 'test-cjs', 'handle set');

  const signed = await identity.sign('cjs-payload', { useMaster: true });
  assert(typeof signed === 'string', 'sign with master returns string');
  assert(signed.includes('BEGIN PGP SIGNED MESSAGE'), 'signed is PGP armor');

  const vResult = await identity.verify(signed, identity.masterPublicKey);
  assert(vResult.verified === true, 'verify round-trip succeeds');
  assert(vResult.body === 'cjs-payload', 'verify returns correct body');

  const leafSigned = await identity.sign('leaf-payload');
  assert(typeof leafSigned === 'string', 'sign with leaf returns string');

  const leafVerify = await identity.verify(leafSigned, identity.publicKey);
  assert(leafVerify.verified === true, 'leaf verify succeeds');

  const savedMnemonic = createResult.mnemonic;
  const savedMasterFP = identity.masterFingerprint;

  identity.lockdown();
  assert(identity.posture === 'routine', 'posture is routine after lockdown');
  assert(identity.isMasterLoaded === false, 'master not loaded after lockdown');
  assert(identity.masterFingerprint === savedMasterFP, 'masterFingerprint persists after lockdown');
  assert(identity.isLoaded === true, 'still loaded (leaf) after lockdown');

  // =========================================================================
  // 7. identity.cjs — importMnemonic reconstitution
  // =========================================================================

  console.log('\n7. identity.cjs — importMnemonic reconstitution');

  const identity2 = identityMod.createKoadIdentity();
  const importResult = await identity2.importMnemonic({ mnemonic: savedMnemonic, userid: 'test-cjs@koad.io' });
  assert(importResult.masterFingerprint === savedMasterFP, 'reconstituted masterFingerprint matches');
  assert(identity2.posture === 'recovery', 'posture is recovery after importMnemonic');
  assert(identity2.isMasterLoaded === true, 'master loaded after importMnemonic');

  // =========================================================================
  // 8. identity.cjs — createIdentity + createIdentityShape
  // =========================================================================

  console.log('\n8. identity.cjs — legacy helpers');

  const shape = identityMod.createIdentityShape();
  assert(shape.type === 'pgp', 'createIdentityShape type=pgp');
  assert(shape.fingerprint === null, 'createIdentityShape fingerprint=null');

  const ident = identityMod.createIdentity({ type: 'pgp', userid: 'test@cjs' });
  assert(ident.type === 'pgp', 'createIdentity type=pgp');
  assert(ident.userid === 'test@cjs', 'createIdentity userid preserved');

  let threw = false;
  try { identityMod.createIdentity({}); } catch (_) { threw = true; }
  assert(threw, 'createIdentity rejects missing type');

  // =========================================================================
  // 9. sigchain.cjs — buildIdentityGenesis + computeCID + signEntry + verifyEntry
  // =========================================================================

  console.log('\n9. sigchain.cjs — genesis → sign → verify round-trip');

  const { type: genesisType, payload: genesisPayload } = await sigchainMod.buildIdentityGenesis({
    entity_handle: 'test-cjs-entity',
    master_fingerprint: identity2.masterFingerprint,
    master_pubkey_armored: identity2.masterPublicKey,
    created: '2026-05-26T00:00:00Z',
  });
  assert(genesisType === 'koad.identity.genesis', 'genesis type correct');
  assert(genesisPayload.entity_handle === 'test-cjs-entity', 'entity_handle preserved');

  const unsignedGenesis = await sigchainMod.wrapEntry({
    entity: 'test-cjs-entity',
    timestamp: '2026-05-26T00:00:00Z',
    type: genesisType,
    payload: genesisPayload,
    previous: null,
  });
  assert(unsignedGenesis.version === 1, 'wrapEntry version is 1');
  assert(unsignedGenesis.entity === 'test-cjs-entity', 'wrapEntry entity preserved');

  const cid = await sigchainMod.computeCID(unsignedGenesis);
  assert(typeof cid === 'string', 'computeCID returns string');
  assert(cid.startsWith('bagu'), 'CID has bagu prefix');

  const cid2 = await sigchainMod.computeCID(unsignedGenesis);
  assert(cid === cid2, 'computeCID is deterministic');

  const canonical = await sigchainMod.canonicalDagJson(unsignedGenesis);
  assert(canonical instanceof Uint8Array, 'canonicalDagJson returns Uint8Array');

  const preImage = await sigchainMod.preImageBytes(unsignedGenesis);
  assert(preImage instanceof Uint8Array, 'preImageBytes returns Uint8Array');

  // Sign with identity2 (still has master loaded from reconstitution)
  const { entry: signedEntry, cid: signedCID } = await sigchainMod.signEntry(unsignedGenesis, identity2, { useMaster: true });
  assert(typeof signedEntry.signature === 'string', 'signEntry returns signed entry');
  assert(signedEntry.signature.includes('BEGIN PGP SIGNED MESSAGE'), 'signature is PGP armor');
  assert(typeof signedCID === 'string', 'signEntry returns CID');

  const verifyResult = await sigchainMod.verifyEntry(signedEntry, signedCID, identity2.masterPublicKey);
  assert(verifyResult.valid === true, 'verifyEntry returns valid=true');
  assert(!verifyResult.error, 'verifyEntry returns no error');

  // =========================================================================
  // 10. sigchain.cjs — leaf authorize + verifyChain
  // =========================================================================

  console.log('\n10. sigchain.cjs — leaf authorize + verifyChain');

  const { type: leafType, payload: leafPayload } = await sigchainMod.buildLeafAuthorize({
    leaf_fingerprint: identity2.fingerprint,
    leaf_pubkey_armored: identity2.publicKey,
    device_label: 'cjs-test-device',
    authorized_by_fingerprint: identity2.masterFingerprint,
    authorized_at: '2026-05-26T00:01:00Z',
  });
  assert(leafType === 'koad.identity.leaf-authorize', 'leaf authorize type correct');

  const unsignedLeaf = await sigchainMod.wrapEntry({
    entity: 'test-cjs-entity',
    timestamp: '2026-05-26T00:01:00Z',
    type: leafType,
    payload: leafPayload,
    previous: signedCID,
  });

  const { entry: signedLeaf, cid: leafCID } = await sigchainMod.signEntry(unsignedLeaf, identity2, { useMaster: true });
  assert(typeof leafCID === 'string', 'leaf authorize signed');

  const chainResult = await sigchainMod.verifyChain([signedEntry, signedLeaf]);
  assert(chainResult.valid === true, 'verifyChain valid=true for 2-entry chain');
  assert(chainResult.masterFingerprint === identity2.masterFingerprint, 'chain masterFingerprint matches');
  assert(Array.isArray(chainResult.leafSet), 'chain leafSet is array');
  assert(chainResult.leafSet.length === 1, 'leafSet has one entry');

  // =========================================================================
  // 11. auth.cjs — challenge → respond → verify round-trip
  // =========================================================================

  console.log('\n11. auth.cjs — challenge → respond → verify');

  const challengeObj = await authMod.challenge();
  assert(typeof challengeObj.nonce === 'string', 'challenge returns nonce');
  assert(challengeObj.nonce.length > 0, 'nonce is non-empty');

  // Need raw ed25519 keys for auth — get from deps
  const ed = koad.deps.ed;
  const privKey = ed.utils.randomPrivateKey();
  const pubKeyRaw = await ed.getPublicKeyAsync(privKey);
  const pubKeyB64 = Buffer.from(pubKeyRaw).toString('base64url');

  // respond() takes raw Uint8Array seed, verify() takes base64url strings
  const response = await authMod.respond(challengeObj.nonce, privKey);
  assert(response.nonce === challengeObj.nonce, 'response echoes nonce');
  assert(typeof response.signature === 'string', 'response has signature');

  const authVerify = await authMod.verify(challengeObj.nonce, response.signature, pubKeyB64);
  assert(authVerify.valid === true, 'auth verify valid=true');

  // Replay should fail
  const replay = await authMod.verify(challengeObj.nonce, response.signature, pubKeyB64);
  assert(replay.valid === false, 'replay rejected');

  const count = await authMod.pendingNonceCount();
  assert(typeof count === 'number', 'pendingNonceCount returns number');

  // =========================================================================
  // 12. identity-writer.cjs + identity-resolver.cjs round-trip
  // =========================================================================

  console.log('\n12. identity-writer.cjs + identity-resolver.cjs round-trip');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-cjs-test-'));
  const entitiesDir = path.join(tmpDir, 'entities');
  fs.mkdirSync(entitiesDir, { recursive: true });

  const writeResult = await writerMod.writeIdentityRegistry({
    handle: 'cjs-test-handle',
    masterFingerprint: identity.masterFingerprint,
    masterPublicKey: identity.masterPublicKey,
    sigchainHeadCID: signedCID,
    entitiesDir,
  });
  assert(writeResult.written === true, 'writeIdentityRegistry written=true');

  const resolveResult = await resolverMod.resolveIdentity('cjs-test-handle', {
    entitiesDir,
    mode: 'lite',
  });
  assert(resolveResult.resolved === true, 'resolveIdentity resolved=true');
  assert(resolveResult.handle === 'cjs-test-handle', 'handle round-trips');
  assert(resolveResult.masterFingerprint === identity.masterFingerprint, 'masterFingerprint round-trips');
  assert(resolveResult.sigchainHeadCID === signedCID, 'sigchainHeadCID round-trips');

  // updateSigchainHead
  const updateResult = await writerMod.updateSigchainHead({
    handle: 'cjs-test-handle',
    sigchainHeadCID: leafCID,
    entitiesDir,
  });
  assert(updateResult.updated === true, 'updateSigchainHead updated=true');

  const resolveAfterUpdate = await resolverMod.resolveIdentity('cjs-test-handle', {
    entitiesDir,
    mode: 'lite',
  });
  assert(resolveAfterUpdate.sigchainHeadCID === leafCID, 'sigchainHeadCID updated after updateSigchainHead');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // =========================================================================
  // 13. identity-submission.cjs — build + verify
  // =========================================================================

  console.log('\n13. identity-submission.cjs — buildHeadSubmission + verifyHeadSubmission');

  const buildResult = await submissionMod.buildHeadSubmission({
    entityHandle: 'cjs-sub-test',
    identity: identity2,
    newHeadCID: signedCID,
    previousHeadCID: null,
    useMaster: true,
  });
  assert(typeof buildResult === 'object', 'buildHeadSubmission returns object');
  assert(typeof buildResult.submission === 'object', 'result has .submission');
  assert(buildResult.submission.entity_handle === 'cjs-sub-test', 'submission entity_handle correct');
  assert(typeof buildResult.submission.signature === 'string', 'submission has signature');
  assert(buildResult.canonicalBytes instanceof Uint8Array, 'canonicalBytes is Uint8Array');
  assert(buildResult.signedBytes instanceof Uint8Array, 'signedBytes is Uint8Array');

  const submission = buildResult.submission;

  const subVerify = await submissionMod.verifyHeadSubmission(submission, {
    entries: [signedEntry],
  });
  assert(subVerify.valid === true, 'verifyHeadSubmission valid=true');

  // =========================================================================
  // 14. identity-receiver.cjs — receive + bulk query
  // =========================================================================

  console.log('\n14. identity-receiver.cjs — receiveHeadSubmission + queryIdentityHeads');

  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-cjs-recv-'));
  const entitiesDir2 = path.join(tmpDir2, 'entities');
  fs.mkdirSync(entitiesDir2, { recursive: true });

  // receiveHeadSubmission — verify CJS bridge calls through to ESM
  // (full validation is tested in test-identity-receiver.js; here we test the CJS→ESM bridge)
  const recvResult = await receiverMod.receiveHeadSubmission(submission, {
    vestaEntitiesDir: entitiesDir2,
    skipGitCommit: true,
  });
  assert(typeof recvResult === 'object', 'receiveHeadSubmission returns object');
  assert(typeof recvResult.httpStatus === 'number', 'receiveHeadSubmission returns httpStatus');

  // queryIdentityHeads — empty dir returns valid response
  const queryResult = await receiverMod.queryIdentityHeads({}, {
    vestaEntitiesDir: entitiesDir2,
  });
  assert(typeof queryResult === 'object', 'queryIdentityHeads returns object');
  assert(queryResult.httpStatus === 200, 'query httpStatus=200');
  assert(typeof queryResult.body.count === 'number', 'query body has count');

  fs.rmSync(tmpDir2, { recursive: true, force: true });

  // =========================================================================
  // Summary
  // =========================================================================

  console.log(`\n=== CJS Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
