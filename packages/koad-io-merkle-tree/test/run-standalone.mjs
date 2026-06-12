// run-standalone.mjs — Node.js standalone self-test for koad:io-merkle-tree
//
// Runs outside Meteor. Uses the same logic as merkle-tree.js directly
// (re-imported here since we can't use the Meteor package system from Node).
//
// Usage: node test/run-standalone.mjs

import { createHash } from 'crypto';
import * as ed from '@noble/ed25519';

// ── Inline the package logic (same as server/merkle-tree.js) ─────────────────
// We re-implement the minimal pieces here rather than fighting ESM/CJS boundary
// in the test runner. This also serves as a spec-conformance cross-check.

function dagJsonCanonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(dagJsonCanonical).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + dagJsonCanonical(obj[k])).join(',') + '}';
}

function dagJsonCanonicalBytes(obj) {
  return Buffer.from(dagJsonCanonical(obj), 'utf8');
}

function sha256(data) {
  return createHash('sha256').update(data).digest();
}

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function hashLeaf(leaf) {
  const encoded = dagJsonCanonicalBytes(leaf);
  return sha256(Buffer.concat([LEAF_PREFIX, encoded]));
}

function hashNode(left, right) {
  return sha256(Buffer.concat([NODE_PREFIX, left, right]));
}

function sortLeaves(leaves) {
  return [...leaves].sort((a, b) => {
    const aStr = dagJsonCanonical(a);
    const bStr = dagJsonCanonical(b);
    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
  });
}

function buildTree(leaves) {
  if (!leaves || leaves.length === 0) throw new Error('Empty leaf set');
  const sorted = sortLeaves(leaves);
  const leafHashes = sorted.map(hashLeaf);
  const levels = [leafHashes];
  let current = leafHashes;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = (i + 1 < current.length) ? current[i + 1] : current[i];
      next.push(hashNode(left, right));
    }
    levels.push(next);
    current = next;
  }
  return { root: current[0], levels, leafHashes, sortedLeaves: sorted };
}

function generateProof(leaves, leafIndex) {
  const sorted = sortLeaves(leaves);
  const { levels } = buildTree(sorted);
  const path = [];
  let idx = leafIndex;
  for (let level = 0; level < levels.length - 1; level++) {
    const lvl = levels[level];
    let sibIdx, sibPos;
    if (idx % 2 === 0) {
      sibIdx = (idx + 1 < lvl.length) ? idx + 1 : idx;
      sibPos = 'right';
    } else {
      sibIdx = idx - 1;
      sibPos = 'left';
    }
    path.push({ hash: lvl[sibIdx], position: sibPos });
    idx = Math.floor(idx / 2);
  }
  return { leaf: sorted[leafIndex], leafIndex, path };
}

function verifyProof(proof, root) {
  if (!proof || !proof.leaf || !proof.path) return false;
  const rootBuf = typeof root === 'string' ? Buffer.from(root, 'hex') : root;
  let current = hashLeaf(proof.leaf);
  for (const step of proof.path) {
    const sibling = step.hash;
    current = (step.position === 'right')
      ? hashNode(current, sibling)
      : hashNode(sibling, current);
  }
  return current.equals(rootBuf);
}

function buildSkipMap(seqno, rootHistory) {
  if (seqno <= 1) return {};
  const lookup = (n) => (typeof rootHistory.get === 'function' ? rootHistory.get(n) : rootHistory[n]);
  const skip = {};
  for (let k = 1; k <= seqno - 1; k *= 2) {
    const v = lookup(seqno - k);
    if (v != null) skip[String(k)] = v;
  }
  return skip;
}

async function signRoot(params, privateKeyBytes) {
  const { kingdom, seqno, root, leaf_count, prev_root = null, skip = {} } = params;
  const timestamp = params.timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rootHex = Buffer.isBuffer(root) ? root.toString('hex') : root;
  const preImage = { kingdom, leaf_count, prev_root, root: rootHex, schema: 'koad:io/kingdom-tree-root/v1', seqno, skip, timestamp };
  const preImageBytes = dagJsonCanonicalBytes(preImage);
  const sigBytes = await ed.signAsync(preImageBytes, privateKeyBytes);
  const signature = Buffer.from(sigBytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return { schema: 'koad:io/kingdom-tree-root/v1', kingdom, seqno, root: rootHex, leaf_count, timestamp, prev_root, skip, signature };
}

async function verifySignedRoot(signedRoot, pubKeyBytes) {
  if (!signedRoot || signedRoot.schema !== 'koad:io/kingdom-tree-root/v1') return false;
  const preImage = {
    kingdom: signedRoot.kingdom, leaf_count: signedRoot.leaf_count,
    prev_root: signedRoot.prev_root, root: signedRoot.root,
    schema: signedRoot.schema, seqno: signedRoot.seqno,
    skip: signedRoot.skip, timestamp: signedRoot.timestamp,
  };
  const preImageBytes = dagJsonCanonicalBytes(preImage);
  const b64 = signedRoot.signature.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (signedRoot.signature.length % 4)) % 4);
  const sigBytes = Buffer.from(b64, 'base64');
  try { return await ed.verifyAsync(sigBytes, preImageBytes, pubKeyBytes); }
  catch (_) { return false; }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

let pass = 0, fail = 0;

function assert(cond, label) {
  if (cond) {
    console.log(`  PASS: ${label}`);
    pass++;
  } else {
    console.error(`  FAIL: ${label}`);
    fail++;
  }
}

function assertThrows(fn, pattern, label) {
  try {
    fn();
    console.error(`  FAIL: ${label} (expected throw, got none)`);
    fail++;
  } catch (err) {
    if (pattern && !pattern.test(err.message)) {
      console.error(`  FAIL: ${label} (wrong error: ${err.message})`);
      fail++;
    } else {
      console.log(`  PASS: ${label}`);
      pass++;
    }
  }
}

function makeFakeLeaves(count) {
  const leaves = [{ type: 'kingdom', id: 'koad', tip: 'baguczsaKINGDOM0000000000001', seq: count }];
  for (let i = 1; i < count; i++) {
    const isUser = i % 3 === 0;
    if (isUser) {
      leaves.push({ type: 'user', id: String(i).padStart(64, '0'), tip: `baguczsaFAKEUSERTIP${String(i).padStart(4, '0')}`, seq: i * 2 });
    } else {
      leaves.push({ type: 'entity', id: `entity-${i}`, tip: `baguczsaFAKETIP${String(i).padStart(6, '0')}`, seq: i });
    }
  }
  return leaves;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\nkoad:io-merkle-tree standalone self-test\n');

// 1. Single leaf tree
console.log('1. Single leaf tree');
{
  const leaves = [{ type: 'kingdom', id: 'koad', tip: 'baguczsaKINGDOM', seq: 1 }];
  const { root, levels, leafHashes } = buildTree(leaves);
  assert(root.length === 32, 'root is 32 bytes');
  assert(levels.length === 1, 'single leaf = single level');
  assert(root.equals(leafHashes[0]), 'root equals leaf hash for single leaf');
}

// 2. 10-leaf tree build
console.log('2. 10-leaf tree build');
{
  const leaves = makeFakeLeaves(10);
  const { root, leafHashes } = buildTree(leaves);
  assert(root.length === 32, 'root is 32 bytes');
  assert(leafHashes.length === 10, '10 leaf hashes');
  assert(Buffer.isBuffer(root), 'root is a Buffer');
}

// 3. Deterministic sort
console.log('3. Deterministic sort (order independence)');
{
  const leaves = makeFakeLeaves(5);
  const shuffled = [...leaves].reverse();
  const t1 = buildTree(leaves);
  const t2 = buildTree(shuffled);
  assert(t1.root.equals(t2.root), 'root identical regardless of input order');
}

// 4. Proof generation and verification
console.log('4. Proof generation + verification');
{
  const leaves = makeFakeLeaves(10);
  const sorted = sortLeaves(leaves);
  const { root } = buildTree(sorted);
  const proof = generateProof(sorted, 5);
  assert(proof.leaf !== null, 'proof has leaf');
  assert(Array.isArray(proof.path), 'proof has path');
  assert(verifyProof(proof, root), 'proof verifies against root');
}

// 5. Tamper: mutated leaf
console.log('5. Tamper detection — mutated leaf');
{
  const leaves = makeFakeLeaves(10);
  const sorted = sortLeaves(leaves);
  const { root } = buildTree(sorted);
  const proof = generateProof(sorted, 3);
  const tampered = { ...proof, leaf: { ...proof.leaf, tip: 'baguczsaTAMPERED000000000' } };
  assert(!verifyProof(tampered, root), 'tampered leaf fails verification');
}

// 6. Tamper: mutated path
console.log('6. Tamper detection — mutated path');
{
  const leaves = makeFakeLeaves(10);
  const sorted = sortLeaves(leaves);
  const { root } = buildTree(sorted);
  const proof = generateProof(sorted, 7);
  const tamperedPath = proof.path.map((step, i) =>
    i === 0 ? { ...step, hash: Buffer.alloc(32, 0xaa) } : step
  );
  assert(!verifyProof({ ...proof, path: tamperedPath }, root), 'tampered path fails verification');
}

// 7. All leaves prove
console.log('7. Proof for all leaves in 10-leaf tree');
{
  const leaves = makeFakeLeaves(10);
  const sorted = sortLeaves(leaves);
  const { root } = buildTree(sorted);
  let allPass = true;
  for (let i = 0; i < sorted.length; i++) {
    const proof = generateProof(sorted, i);
    if (!verifyProof(proof, root)) {
      allPass = false;
      console.error(`  FAIL: leaf ${i} proof failed`);
      fail++;
    }
  }
  if (allPass) {
    console.log('  PASS: all 10 leaves verify');
    pass++;
  }
}

// 8. Skip pointer construction
console.log('8. Skip pointer construction');
{
  // seqno 17: powers of 2 up to seqno-1=16 → k = 1,2,4,8,16
  // All targets (16,15,13,9,1) are present in rootHistory → 5 skip entries
  const rootHistory = { 1: 'aaa01', 9: 'aaa09', 13: 'aaa13', 15: 'aaa15', 16: 'aaa16' };
  const skip = buildSkipMap(17, rootHistory);
  assert(skip['1']  === 'aaa16', 'skip[1] = seqno 16');
  assert(skip['2']  === 'aaa15', 'skip[2] = seqno 15');
  assert(skip['4']  === 'aaa13', 'skip[4] = seqno 13');
  assert(skip['8']  === 'aaa09', 'skip[8] = seqno 9');
  assert(skip['16'] === 'aaa01', 'skip[16] = seqno 1');
  assert(Object.keys(skip).length === 5, '5 skip entries for seqno 17');

  // Test with missing entries — skip[k] absent when target seqno not in history
  const sparseHistory = { 1: 'aaa01', 16: 'aaa16' };
  const sparseSkip = buildSkipMap(17, sparseHistory);
  assert(sparseSkip['1'] === 'aaa16', 'sparse: skip[1] present');
  assert(sparseSkip['16'] === 'aaa01', 'sparse: skip[16] present');
  assert(sparseSkip['2'] === undefined, 'sparse: skip[2] absent (seqno 15 not in history)');
  assert(Object.keys(sparseSkip).length === 2, 'sparse: 2 skip entries only');
}

// 9. Skip pointer seqno 1
console.log('9. Skip pointer seqno 1 is empty');
{
  const skip = buildSkipMap(1, {});
  assert(Object.keys(skip).length === 0, 'seqno 1 has no skip pointers');
}

// 10. Odd-count tree (3 leaves)
console.log('10. Odd-count tree (3 leaves)');
{
  // 3 leaves: level[0]=3 hashes, level[1]=2 hashes (hash(0,1)+hash(2,2)), level[2]=1 root
  // Total: 3 levels
  const leaves = makeFakeLeaves(3);
  const { root, levels } = buildTree(leaves);
  assert(root.length === 32, '3-leaf root is 32 bytes');
  assert(levels.length === 3, '3 leaves → 3 levels (leaf/mid/root)');
  assert(levels[1].length === 2, 'mid level has 2 nodes with odd-count padding');
  assert(levels[2].length === 1, 'top level is the single root');
}

// 11. Domain separator
console.log('11. Domain separator: leaf hash != node hash');
{
  const leaf = { type: 'entity', id: 'juno', tip: 'baguczsaJUNO', seq: 1 };
  const lh = hashLeaf(leaf);
  const nh = hashNode(lh, lh);
  assert(!lh.equals(nh), 'leaf hash != node hash (0x00 vs 0x01 separators)');
}

// 12. dagJsonCanonical key sorting
console.log('12. dagJsonCanonical key sorting');
{
  const result = dagJsonCanonical({ z: 1, a: 2, m: 3 });
  assert(result === '{"a":2,"m":3,"z":1}', 'keys sorted lexicographically');
}

// 13. Sign and verify (async)
console.log('13. Sign root + verify (async)');

async function testSigning() {
  const privKey = ed.utils.randomPrivateKey();
  const pubKey = await ed.getPublicKeyAsync(privKey);

  const leaves = makeFakeLeaves(5);
  const { root } = buildTree(leaves);
  const rootHex = root.toString('hex');

  const signedRoot = await signRoot({
    kingdom: 'koad', seqno: 1, root: rootHex, leaf_count: leaves.length,
    prev_root: null, skip: {},
  }, privKey);

  assert(signedRoot.schema === 'koad:io/kingdom-tree-root/v1', 'schema correct');
  assert(signedRoot.kingdom === 'koad', 'kingdom correct');
  assert(signedRoot.seqno === 1, 'seqno correct');
  assert(typeof signedRoot.signature === 'string', 'signature is string');

  const valid = await verifySignedRoot(signedRoot, pubKey);
  assert(valid, 'signature verifies with correct pubkey');

  const wrongPub = await ed.getPublicKeyAsync(ed.utils.randomPrivateKey());
  const invalid = await verifySignedRoot(signedRoot, wrongPub);
  assert(!invalid, 'wrong pubkey fails verification');

  // 14. Mixed leaf types
  console.log('14. Mixed leaf types');
  const mixed = [
    { type: 'kingdom', id: 'koad', tip: 'baguczsaKINGDOM', seq: 5 },
    { type: 'entity',  id: 'juno', tip: 'baguczsaJUNO',   seq: 10 },
    { type: 'user',    id: '0'.repeat(64), tip: 'baguczsaUSER', seq: 3 },
    { type: 'witness', id: 'kingdom:yclo', tip: 'baguczsaWIT',  seq: 1 },
  ];
  const { root: mixedRoot, leafHashes: mixedHashes } = buildTree(mixed);
  assert(mixedRoot.length === 32, 'mixed leaf types: root is 32 bytes');
  assert(mixedHashes.length === 4, 'mixed leaf types: all 4 leaves hashed');

  // Final tally
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exit(1);
  }
}

testSigning().catch(err => {
  console.error('Test run error:', err);
  process.exit(1);
});
