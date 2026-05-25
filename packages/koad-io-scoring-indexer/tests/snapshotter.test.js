/**
 * koad:io-scoring-indexer — Snapshotter Unit Tests
 *
 * ROOTY-SPEC-009 §6.1: Merkle root computation tests. The snapshotter relies
 * on ScoringEngine.computeMerkleRoot() for the core hash logic; these tests
 * validate the Merkle tree construction edge cases.
 *
 * Also tests payload construction for tag 0x14 broadcast.
 */

'use strict';

Tinytest.add('Snapshotter - Merkle root single entity', function(test) {
  const root = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.5000 },
  ]);
  test.isTrue(typeof root === 'string', 'root should be a hex string');
  test.equal(root.length, 64, 'root should be 64 hex chars (32 bytes)');

  // Deterministic
  const root2 = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.5000 },
  ]);
  test.equal(root, root2, 'same input should produce same root');
});

Tinytest.add('Snapshotter - Merkle root multiple entities', function(test) {
  const root = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.5000 },
    { entityPubkeyHex: 'b' + '0'.repeat(63), totalScore: 0.7500 },
    { entityPubkeyHex: 'c' + '0'.repeat(63), totalScore: 0.2500 },
  ]);
  test.isTrue(typeof root === 'string', 'root should be a hex string');
  test.equal(root.length, 64, 'root should be 64 hex chars');
});

Tinytest.add('Snapshotter - Merkle root odd number of entries', function(test) {
  // 3 entries = odd, last one propagates up
  const root = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.1 },
    { entityPubkeyHex: 'b' + '0'.repeat(63), totalScore: 0.2 },
    { entityPubkeyHex: 'c' + '0'.repeat(63), totalScore: 0.3 },
  ]);
  const root2 = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.1 },
    { entityPubkeyHex: 'b' + '0'.repeat(63), totalScore: 0.2 },
    { entityPubkeyHex: 'c' + '0'.repeat(63), totalScore: 0.3 },
  ]);
  test.equal(root, root2, 'odd entry count should be deterministic');

  // 5 entries = test deeper tree
  const root5 = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.1 },
    { entityPubkeyHex: 'b' + '0'.repeat(63), totalScore: 0.2 },
    { entityPubkeyHex: 'c' + '0'.repeat(63), totalScore: 0.3 },
    { entityPubkeyHex: 'd' + '0'.repeat(63), totalScore: 0.4 },
    { entityPubkeyHex: 'e' + '0'.repeat(63), totalScore: 0.5 },
  ]);
  test.isTrue(typeof root5 === 'string', '5-entry root should be hex string');
  test.equal(root5.length, 64, '5-entry root should be 64 hex chars');
});

Tinytest.add('Snapshotter - Merkle root empty entries', function(test) {
  const root = ScoringEngine.computeMerkleRoot([]);
  test.isTrue(typeof root === 'string', 'empty root should be hex string');
  test.equal(root.length, 64, 'empty root should be 64 hex chars');

  // SHA256 of empty buffer
  const expectedEmptyHash = require('crypto')
    .createHash('sha256')
    .update(Buffer.alloc(0))
    .digest('hex');
  test.equal(root, expectedEmptyHash, 'empty merkle root should be SHA256(empty)');
});

Tinytest.add('Snapshotter - Merkle root lexicographic ordering', function(test) {
  // Entries in different orders should produce the same root
  const entries = [
    { entityPubkeyHex: 'c' + '0'.repeat(63), totalScore: 0.3 },
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.1 },
    { entityPubkeyHex: 'b' + '0'.repeat(63), totalScore: 0.2 },
  ];
  const root1 = ScoringEngine.computeMerkleRoot(entries);

  const entries2 = [
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.1 },
    { entityPubkeyHex: 'c' + '0'.repeat(63), totalScore: 0.3 },
    { entityPubkeyHex: 'b' + '0'.repeat(63), totalScore: 0.2 },
  ];
  const root2 = ScoringEngine.computeMerkleRoot(entries2);

  test.equal(root1, root2, 'different input orders should produce same root');
});

Tinytest.add('Snapshotter - payload size computation', function(test) {
  // Tag 0x14 payload: [merkle_root: 32 bytes][game_id: 2 bytes][block_height: 4 bytes]
  // Total: 38 bytes
  const merkleRootBuf = Buffer.alloc(32);  // 32 bytes
  const gameIdBuf = Buffer.alloc(2);       // 2 bytes
  const heightBuf = Buffer.alloc(4);       // 4 bytes
  const payload = Buffer.concat([merkleRootBuf, gameIdBuf, heightBuf]);

  test.equal(payload.length, 38, `payload should be 38 bytes, got ${payload.length}`);
  test.equal(SNAPSHOT_MERKLE_ROOT_BYTES, 32, 'merkle root field should be 32 bytes');
  test.equal(SNAPSHOT_GAME_ID_BYTES, 2, 'game id field should be 2 bytes');
  test.equal(SNAPSHOT_BLOCK_HEIGHT_BYTES, 4, 'block height field should be 4 bytes');
  test.equal(SNAPSHOT_TOTAL_BYTES, 38, 'total payload should be 38 bytes');
});

Tinytest.add('Snapshotter - game_id encoding', function(test) {
  // Ring-of-trust mode: game_id = 0x0000
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(0x0000, 0);
  test.equal(buf.toString('hex'), '0000', 'ring-of-trust mode should be 0x0000');

  buf.writeUInt16LE(0x0001, 0);
  test.equal(buf.toString('hex'), '0100', 'game_id 1 should encode as 0100 LE');
});

Tinytest.add('Snapshotter - block_height encoding', function(test) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(100000, 0);
  test.equal(buf.length, 4, 'block_height should be 4 bytes');

  // Read back
  test.equal(buf.readUInt32LE(0), 100000, 'block_height should round-trip');
});
