// test/merkle-tree-tests.js — VESTA-SPEC-169 self-tests
//
// Tinytest suite. Run via Meteor test runner.
// Exercises: tree construction, proof generation, tamper detection,
// skip pointer generation, and signed root round-trip.

Tinytest.add('KingdomMerkleTree — single leaf tree', function (test) {
  const leaves = [
    { type: 'kingdom', id: 'koad', tip: 'baguczsaaaaabbbbbbbbbbbbb0001', seq: 1 },
  ];
  const { root, levels, leafHashes, sortedLeaves } = KingdomMerkleTree.buildTree(leaves);

  test.equal(root.length, 32, 'root is 32 bytes');
  test.equal(leafHashes.length, 1, 'one leaf hash');
  test.equal(levels.length, 1, 'single leaf = single level (root is leaf hash)');
  test.isTrue(root.equals(leafHashes[0]), 'root equals leaf hash for single-leaf tree');
});

Tinytest.add('KingdomMerkleTree — 10-leaf tree build + verify', function (test) {
  const leaves = makeFakeLeaves(10);
  const { root, leafHashes } = KingdomMerkleTree.buildTree(leaves);

  test.equal(root.length, 32, 'root is 32 bytes');
  test.equal(leafHashes.length, 10, 'ten leaf hashes');
  test.isTrue(Buffer.isBuffer(root), 'root is a Buffer');
});

Tinytest.add('KingdomMerkleTree — leaf sort is deterministic', function (test) {
  const leaves = makeFakeLeaves(5);
  const shuffled = [...leaves].reverse();

  const t1 = KingdomMerkleTree.buildTree(leaves);
  const t2 = KingdomMerkleTree.buildTree(shuffled);

  test.isTrue(t1.root.equals(t2.root), 'root is identical regardless of input order');
});

Tinytest.add('KingdomMerkleTree — proof generation and verification', function (test) {
  const leaves = makeFakeLeaves(10);
  const sorted = KingdomMerkleTree.sortLeaves(leaves);
  const { root } = KingdomMerkleTree.buildTree(sorted);

  // Prove leaf at index 5 (0-based in sorted order)
  const proof = KingdomMerkleTree.generateProof(sorted, 5);

  test.isNotNull(proof, 'proof generated');
  test.isNotNull(proof.leaf, 'proof has leaf');
  test.isTrue(Array.isArray(proof.path), 'proof has path');

  const valid = KingdomMerkleTree.verifyProof(proof, root);
  test.isTrue(valid, 'proof verifies against root');
});

Tinytest.add('KingdomMerkleTree — tamper detection: mutated leaf', function (test) {
  const leaves = makeFakeLeaves(10);
  const sorted = KingdomMerkleTree.sortLeaves(leaves);
  const { root } = KingdomMerkleTree.buildTree(sorted);

  const proof = KingdomMerkleTree.generateProof(sorted, 3);

  // Mutate the leaf tip — simulates a tampered leaf
  const tamperedProof = {
    ...proof,
    leaf: { ...proof.leaf, tip: 'baguczsaaaaaTAMPEREDTIPXXXXXXXX' },
  };

  const valid = KingdomMerkleTree.verifyProof(tamperedProof, root);
  test.isFalse(valid, 'tampered leaf fails verification');
});

Tinytest.add('KingdomMerkleTree — tamper detection: mutated path', function (test) {
  const leaves = makeFakeLeaves(10);
  const sorted = KingdomMerkleTree.sortLeaves(leaves);
  const { root } = KingdomMerkleTree.buildTree(sorted);

  const proof = KingdomMerkleTree.generateProof(sorted, 7);

  // Mutate the first sibling hash in the path
  const tamperedPath = proof.path.map((step, i) => {
    if (i === 0) {
      const fakeHash = Buffer.alloc(32, 0xaa);
      return { ...step, hash: fakeHash };
    }
    return step;
  });

  const tamperedProof = { ...proof, path: tamperedPath };
  const valid = KingdomMerkleTree.verifyProof(tamperedProof, root);
  test.isFalse(valid, 'tampered proof path fails verification');
});

Tinytest.add('KingdomMerkleTree — proof for each leaf in 10-leaf tree', function (test) {
  const leaves = makeFakeLeaves(10);
  const sorted = KingdomMerkleTree.sortLeaves(leaves);
  const { root } = KingdomMerkleTree.buildTree(sorted);

  for (let i = 0; i < sorted.length; i++) {
    const proof = KingdomMerkleTree.generateProof(sorted, i);
    const valid = KingdomMerkleTree.verifyProof(proof, root);
    test.isTrue(valid, `leaf ${i} proof should verify`);
  }
});

Tinytest.add('KingdomMerkleTree — skip pointer construction', function (test) {
  // seqno 17: k = 1,2,4,8,16 → targets seqno 16,15,13,9,1 — all present
  const rootHistory = {
    1: 'aaa01', 9: 'aaa09', 13: 'aaa13', 15: 'aaa15', 16: 'aaa16',
  };

  const skip = KingdomMerkleTree.buildSkipMap(17, rootHistory);

  test.equal(skip['1'],  'aaa16', 'skip[1] points to seqno 16');
  test.equal(skip['2'],  'aaa15', 'skip[2] points to seqno 15');
  test.equal(skip['4'],  'aaa13', 'skip[4] points to seqno 13');
  test.equal(skip['8'],  'aaa09', 'skip[8] points to seqno 9');
  test.equal(skip['16'], 'aaa01', 'skip[16] points to seqno 1');
  test.equal(Object.keys(skip).length, 5, '5 keys present for seqno 17');

  // Sparse history — missing entries are silently omitted
  const sparse = { 1: 'aaa01', 16: 'aaa16' };
  const sparseSkip = KingdomMerkleTree.buildSkipMap(17, sparse);
  test.equal(sparseSkip['1'],  'aaa16', 'sparse: skip[1] present');
  test.equal(sparseSkip['16'], 'aaa01', 'sparse: skip[16] present');
  test.equal(sparseSkip['2'],  undefined, 'sparse: skip[2] absent');
  test.equal(Object.keys(sparseSkip).length, 2, 'sparse: 2 entries only');
});

Tinytest.add('KingdomMerkleTree — skip pointer seqno 1 returns empty', function (test) {
  const skip = KingdomMerkleTree.buildSkipMap(1, {});
  test.equal(Object.keys(skip).length, 0, 'seqno 1 has no skip pointers');
});

Tinytest.addAsync('KingdomMerkleTree — sign root and verify signature', async function (test, done) {
  try {
    // Generate a test Ed25519 keypair
    const ed = require('@noble/ed25519');
    const privKey = ed.utils.randomPrivateKey();
    const pubKey = await ed.getPublicKeyAsync(privKey);

    const leaves = makeFakeLeaves(5);
    const { root } = KingdomMerkleTree.buildTree(leaves);
    const rootHex = root.toString('hex');

    const signedRoot = await KingdomMerkleTree.signRoot({
      kingdom: 'koad',
      seqno: 1,
      root: rootHex,
      leaf_count: leaves.length,
      prev_root: null,
      skip: {},
    }, privKey);

    test.equal(signedRoot.schema, 'koad:io/kingdom-tree-root/v1', 'schema present');
    test.equal(signedRoot.kingdom, 'koad', 'kingdom present');
    test.equal(signedRoot.seqno, 1, 'seqno present');
    test.equal(signedRoot.root, rootHex, 'root hex in signed root');
    test.isNotNull(signedRoot.signature, 'signature present');

    const valid = await KingdomMerkleTree.verifySignedRoot(signedRoot, pubKey);
    test.isTrue(valid, 'signature verifies with correct pubkey');

    done();
  } catch (err) {
    test.fail('Unexpected error: ' + err.message);
    done();
  }
});

Tinytest.addAsync('KingdomMerkleTree — wrong key fails signature verification', async function (test, done) {
  try {
    const ed = require('@noble/ed25519');
    const privKey = ed.utils.randomPrivateKey();
    const wrongPubKey = await ed.getPublicKeyAsync(ed.utils.randomPrivateKey());

    const leaves = makeFakeLeaves(3);
    const { root } = KingdomMerkleTree.buildTree(leaves);

    const signedRoot = await KingdomMerkleTree.signRoot({
      kingdom: 'koad',
      seqno: 2,
      root: root.toString('hex'),
      leaf_count: leaves.length,
      prev_root: 'abcdef1234',
      skip: { '1': 'abcdef1234' },
    }, privKey);

    const valid = await KingdomMerkleTree.verifySignedRoot(signedRoot, wrongPubKey);
    test.isFalse(valid, 'wrong public key fails verification');

    done();
  } catch (err) {
    test.fail('Unexpected error: ' + err.message);
    done();
  }
});

Tinytest.add('KingdomMerkleTree — leaf validation rejects unknown type', function (test) {
  test.throws(function () {
    KingdomMerkleTree.validateLeaf({
      type: 'alien', id: 'x', tip: 'baguXXX', seq: 1,
    });
  }, /Unknown leaf type/);
});

Tinytest.add('KingdomMerkleTree — leaf validation rejects missing fields', function (test) {
  test.throws(function () {
    KingdomMerkleTree.validateLeaf({ type: 'entity' }); // missing id, tip, seq
  });
});

Tinytest.add('KingdomMerkleTree — empty leaf set throws', function (test) {
  test.throws(function () {
    KingdomMerkleTree.buildTree([]);
  }, /empty leaf set/);
});

Tinytest.add('KingdomMerkleTree — domain separator — leaf vs node hashes differ', function (test) {
  const leaf = { type: 'entity', id: 'juno', tip: 'baguczsaaa0001', seq: 1 };
  const leafHash = KingdomMerkleTree.hashLeaf(leaf);

  // Construct what a node hash of (leafHash, leafHash) would be
  const nodeHash = KingdomMerkleTree.hashNode(leafHash, leafHash);

  test.isFalse(leafHash.equals(nodeHash), 'leaf hash != node hash (domain separators work)');
});

Tinytest.add('KingdomMerkleTree — dagJsonCanonical sorts keys', function (test) {
  const obj = { z: 1, a: 2, m: 3 };
  const result = KingdomMerkleTree.dagJsonCanonical(obj);
  test.equal(result, '{"a":2,"m":3,"z":1}', 'keys sorted lexicographically');
});

Tinytest.add('KingdomMerkleTree — odd-count tree: 3 leaves', function (test) {
  // 3 leaves: level[0]=3, level[1]=2 (hash(0,1)+hash(2,2)), level[2]=1 root
  const leaves = makeFakeLeaves(3);
  const { root, levels } = KingdomMerkleTree.buildTree(leaves);

  test.equal(root.length, 32, '3-leaf tree root is 32 bytes');
  test.equal(levels.length, 3, '3 leaves → 3 levels (leaf/mid/root)');
  test.equal(levels[1].length, 2, 'mid level has 2 nodes with odd-count padding');
  test.equal(levels[2].length, 1, 'top level is the single root');
});

Tinytest.add('KingdomMerkleTree — mixed leaf types coexist', function (test) {
  const leaves = [
    { type: 'kingdom',  id: 'koad',                                    tip: 'baguczsaKINGDOM', seq: 5 },
    { type: 'entity',   id: 'juno',                                    tip: 'baguczsaJUNO',    seq: 10 },
    { type: 'user',     id: 'abcdef1234567890abcdef1234567890abcdef12', tip: 'baguczsaUSER',    seq: 3 },
    { type: 'witness',  id: 'kingdom:yclo',                            tip: 'baguczsaWIT',     seq: 1 },
  ];
  const { root, leafHashes } = KingdomMerkleTree.buildTree(leaves);

  test.equal(root.length, 32, 'root is 32 bytes');
  test.equal(leafHashes.length, 4, 'all 4 leaves hashed');
});

// ── Helper ────────────────────────────────────────────────────────────────────

function makeFakeLeaves(count) {
  const leaves = [
    // Always include the required kingdom leaf
    { type: 'kingdom', id: 'koad', tip: 'baguczsaKINGDOM0000000000001', seq: count },
  ];

  for (let i = 1; i < count; i++) {
    // Mix of entity and user leaves
    const isUser = i % 3 === 0;
    if (isUser) {
      const fakeHex = String(i).padStart(64, '0');
      leaves.push({
        type: 'user',
        id: fakeHex,
        tip: `baguczsaFAKEUSERTIP${String(i).padStart(4, '0')}`,
        seq: i * 2,
      });
    } else {
      leaves.push({
        type: 'entity',
        id: `entity-${i}`,
        tip: `baguczsaFAKETIP${String(i).padStart(6, '0')}`,
        seq: i,
      });
    }
  }

  return leaves;
}
