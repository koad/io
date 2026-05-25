/**
 * koad:io-scoring-indexer — Scorer Unit Tests
 *
 * ROOTY-SPEC-009 §10.4: The scoring engine must be testable without a live chain.
 * These tests exercise the pure computation path using fixture data.
 *
 * Test patterns:
 *   1. Known entity → expected score (deterministic)
 *   2. Edge cases: zero signals, single chain, all chains
 *   3. Component-specific: continuity bonus, genesis floor, stake normalization
 *   4. Weight combinations: ring-of-trust default vs game default
 */

'use strict';

// ============================================================================
// Test Fixtures
// ============================================================================

const GENESIS_ENTITY_SIGNALS = {
  entityPubkeyHex: 'a' + '0'.repeat(63),  // 64 hex chars
  firstSeenBlock: 1000,
  lastSeenBlock: 10000,
  broadcastCount: 50,
  broadcastBlocks: Array.from({ length: 10 }, (_, i) => 1000 + i * 1000),
  bondedCount: 5,
  bondedByCount: 3,
  trustPropagation: 12,
  totalStakeValue: 250000,
  governanceActions: 8,
  highSignificanceCount: 3,
  chains: {
    CDN: {
      firstSeenBlock: 1000,
      lastSeenBlock: 10000,
      broadcastCount: 30,
      broadcastBlocks: Array.from({ length: 6 }, (_, i) => 1000 + i * 1000),
      highSignificanceCount: 2,
      bonds: [{ type: 'peer', ageBlocks: 150000 }],
      bondedBy: [{ type: 'friend', ageBlocks: 80000 }],
      trustPropagation: 8,
      stakes: [],
    },
    BTC: {
      firstSeenBlock: 2000,
      lastSeenBlock: 9000,
      broadcastCount: 20,
      broadcastBlocks: Array.from({ length: 4 }, (_, i) => 2000 + i * 500),
      highSignificanceCount: 1,
      bonds: [{ type: 'peer', ageBlocks: 50000 }],
      bondedBy: [{ type: 'peer', ageBlocks: 30000 }],
      trustPropagation: 4,
      stakes: [],
    },
  },
  bonds: [{ type: 'peer', ageBlocks: 150000 }, { type: 'peer', ageBlocks: 50000 }],
  bondedBy: [{ type: 'friend', ageBlocks: 80000 }, { type: 'peer', ageBlocks: 30000 }],
  stakes: [],
};

const NEW_ENTITY_SIGNALS = {
  entityPubkeyHex: 'b' + '0'.repeat(63),
  firstSeenBlock: 9500,
  lastSeenBlock: 10000,
  broadcastCount: 3,
  broadcastBlocks: [9500, 9800, 10000],
  bondedCount: 0,
  bondedByCount: 0,
  trustPropagation: 0,
  totalStakeValue: 0,
  governanceActions: 0,
  highSignificanceCount: 0,
  chains: {
    CDN: {
      firstSeenBlock: 9500,
      lastSeenBlock: 10000,
      broadcastCount: 3,
      broadcastBlocks: [9500, 9800, 10000],
      highSignificanceCount: 0,
      bonds: [],
      bondedBy: [],
      trustPropagation: 0,
      stakes: [],
    },
  },
  bonds: [],
  bondedBy: [],
  stakes: [],
};

const STAKED_ENTITY_SIGNALS = {
  entityPubkeyHex: 'c' + '0'.repeat(63),
  firstSeenBlock: 5000,
  lastSeenBlock: 10000,
  broadcastCount: 15,
  broadcastBlocks: Array.from({ length: 6 }, (_, i) => 5000 + i * 1000),
  bondedCount: 2,
  bondedByCount: 1,
  trustPropagation: 3,
  totalStakeValue: 1000000,
  governanceActions: 5,
  highSignificanceCount: 1,
  chains: {
    CDN: {
      firstSeenBlock: 5000,
      lastSeenBlock: 10000,
      broadcastCount: 15,
      broadcastBlocks: Array.from({ length: 6 }, (_, i) => 5000 + i * 1000),
      highSignificanceCount: 1,
      bonds: [{ type: 'authorized-builder', ageBlocks: 200000 }],
      bondedBy: [{ type: 'peer', ageBlocks: 100000 }],
      trustPropagation: 3,
      stakes: [{ valueNormalized: 1000, durationBlocks: 525600 }],
    },
  },
  bonds: [{ type: 'authorized-builder', ageBlocks: 200000 }],
  bondedBy: [{ type: 'peer', ageBlocks: 100000 }],
  stakes: [{ valueNormalized: 1000, durationBlocks: 525600 }],
};

const EMPTY_SIGNALS = {
  entityPubkeyHex: 'd' + '0'.repeat(63),
  firstSeenBlock: 0,
  lastSeenBlock: 0,
  broadcastCount: 0,
  broadcastBlocks: [],
  bondedCount: 0,
  bondedByCount: 0,
  trustPropagation: 0,
  totalStakeValue: 0,
  governanceActions: 0,
  highSignificanceCount: 0,
  chains: {},
  bonds: [],
  bondedBy: [],
  stakes: [],
};

// ============================================================================
// Tests
// ============================================================================

Tinytest.add('ScoringEngine - computeScore returns valid structure', function(test) {
  const result = ScoringEngine.computeScore(GENESIS_ENTITY_SIGNALS);

  test.isTrue(typeof result === 'object', 'result should be an object');
  test.isTrue(typeof result.totalScore === 'number', 'totalScore should be a number');
  test.isTrue(result.totalScore >= 0 && result.totalScore <= 1.4, 'totalScore should be in [0, 1.4]');
  test.isTrue(typeof result.diversityBonus === 'number', 'diversityBonus should be a number');
  test.isTrue(result.diversityBonus >= 1.0 && result.diversityBonus <= 1.4, 'diversityBonus should be in [1.0, 1.4]');
  test.isTrue(typeof result.dataplaneCount === 'number', 'dataplaneCount should be a number');

  // Check component structure
  test.isTrue(typeof result.components === 'object', 'components should be an object');
  test.isTrue('longevity' in result.components, 'components should have longevity');
  test.isTrue('activity' in result.components, 'components should have activity');
  test.isTrue('trust' in result.components, 'components should have trust');
  test.isTrue('stake' in result.components, 'components should have stake');
  test.isTrue('governance' in result.components, 'components should have governance');

  // Check signals
  test.isTrue(typeof result.signals === 'object', 'signals should be an object');
});

Tinytest.add('ScoringEngine - new entity scores near zero', function(test) {
  const result = ScoringEngine.computeScore(NEW_ENTITY_SIGNALS);

  // New entity should have low scores across the board
  test.isTrue(result.totalScore < 0.3, `new entity score should be low, got ${result.totalScore}`);
  test.isTrue(result.components.activity < 0.5, 'new entity activity should be low');
  test.isTrue(result.components.trust === 0, 'new entity trust should be 0 (no bonds)');
  test.isTrue(result.components.stake === 0, 'new entity stake should be 0 (no stakes)');
  test.isTrue(result.components.governance === 0, 'new entity governance should be 0');
});

Tinytest.add('ScoringEngine - empty signals produce zero scores', function(test) {
  const result = ScoringEngine.computeScore(EMPTY_SIGNALS);

  test.equal(result.totalScore, 0, 'empty signals should produce 0 total score');
  test.equal(result.components.longevity, 0, 'longevity should be 0');
  test.equal(result.components.activity, 0, 'activity should be 0');
  test.equal(result.components.trust, 0, 'trust should be 0');
  test.equal(result.components.stake, 0, 'stake should be 0');
  test.equal(result.components.governance, 0, 'governance should be 0');
  test.equal(result.diversityBonus, 1.0, 'diversity bonus should be 1.0 for empty signals');
});

Tinytest.add('ScoringEngine - staked entity scores higher trust and stake', function(test) {
  const result = ScoringEngine.computeScore(STAKED_ENTITY_SIGNALS);

  // Staked entity has authorized-builder bond (weight 1.5) and a stake
  test.isTrue(result.components.stake > 0, 'staked entity should have non-zero stake score');
  test.isTrue(result.components.trust > 0, 'bonded entity should have non-zero trust score');

  // Compare with new entity (no bonds, no stake)
  const newResult = ScoringEngine.computeScore(NEW_ENTITY_SIGNALS);
  test.isTrue(result.totalScore > newResult.totalScore,
    `staked entity score (${result.totalScore}) should exceed new entity score (${newResult.totalScore})`);
});

Tinytest.add('ScoringEngine - computeLongevity basic', function(test) {
  // Entity active from block 1000 to 10000
  const score = ScoringEngine.computeLongevity(1000, 10000, 0, null, 105120);
  test.isTrue(score > 0, 'longevity should be > 0');
  test.isTrue(score <= 1.0, 'longevity should be <= 1.0');
  // The entity has been active for 9000 blocks, and the max is also 9000 (no game start)
  // So longevity should be 1.0
  test.equal(score, 1.0, `longevity should be 1.0 for max age, got ${score}`);
});

Tinytest.add('ScoringEngine - computeLongevity with game start', function(test) {
  // Entity active from block 1000, game starts at block 5000, current = 10000
  const score = ScoringEngine.computeLongevity(1000, 10000, 5000, null, 105120);
  // Entity age = 9000 blocks, max possible = 5000 blocks (10000 - 5000)
  // Score = 9000/5000 = 1.0 (capped)
  test.equal(score, 1.0, 'pre-game entity should have capped longevity');
});

Tinytest.add('ScoringEngine - computeLongevity continuity bonus', function(test) {
  // No gaps > threshold
  const blocks = [1000, 2000, 3000, 4000];  // gaps of 1000 blocks each
  const score = ScoringEngine.computeLongevity(1000, 10000, 0, blocks, 105120);
  // Should get continuity bonus (no gap > 105120)
  // Base score = 9000/9000 = 1.0, bonus pushes to 1.2 but capped at 1.0
  test.equal(score, 1.0, 'continuity bonus should cap at 1.0');

  // Big gap, no bonus
  const blocksWithGap = [1000, 200000];  // gap > 105120
  const score2 = ScoringEngine.computeLongevity(1000, 200000, 0, blocksWithGap, 105120);
  // Base score = 199000/199000 = 1.0, but gap is too large for bonus
  test.equal(score2, 1.0, `score with gap should still be 1.0 (max age), got ${score2}`);
});

Tinytest.add('ScoringEngine - computeActivity s-curve', function(test) {
  // High broadcast rate: 50 broadcasts over 9000 blocks
  // Rate = (50/9000) * 105120 = 584 broadcasts/year
  // Score = 584 / (584 + 12) = 0.9799
  const score = ScoringEngine.computeActivity(50, 1000, 10000, 0, 105120);
  test.isTrue(score > 0.5, 'active entity should have high activity score');
  test.isTrue(score <= 1.0, 'activity score should be <= 1.0');

  // Low broadcast rate: 3 broadcasts over 500 blocks
  // Rate = (3/500) * 105120 = 630.72
  // Score = 630.72 / (630.72 + 12) = 0.9813
  const score2 = ScoringEngine.computeActivity(3, 9500, 10000, 0, 105120);
  test.isTrue(score2 > 0, 'low activity entity should have non-zero score');
});

Tinytest.add('ScoringEngine - computeActivity with flag bonus', function(test) {
  // Same broadcast count, one with high significance flags
  const scoreNoFlags = ScoringEngine.computeActivity(10, 1000, 10000, 0, 105120);
  const scoreWithFlags = ScoringEngine.computeActivity(10, 1000, 10000, 5, 105120);
  test.isTrue(scoreWithFlags > scoreNoFlags,
    'high significance flags should increase activity score');
});

Tinytest.add('ScoringEngine - computeStake', function(test) {
  // No stakes
  test.equal(ScoringEngine.computeStake([]), 0, 'no stakes should score 0');
  test.equal(ScoringEngine.computeStake(), 0, 'undefined stakes should score 0');
  test.equal(ScoringEngine.computeStake(null), 0, 'null stakes should score 0');

  // One stake: 1000 value * 525600 duration = 525600000, ref = 525600
  // Score = min(525600000 / 525600, 1.0) = min(1000, 1.0) = 1.0
  const score = ScoringEngine.computeStake([
    { valueNormalized: 1000, durationBlocks: 525600 },
  ]);
  test.isTrue(score > 0, 'stake should produce non-zero score');
  test.equal(score, 1.0, `stake at reference level should score 1.0, got ${score}`);
});

Tinytest.add('ScoringEngine - computeGovernance', function(test) {
  // No governance
  test.equal(ScoringEngine.computeGovernance(), 0, 'no governance should score 0');
  test.equal(ScoringEngine.computeGovernance(0, 0, 0), 0);

  // Moderate governance: 5 proposals + 2 alliance + 3 tips
  // raw = 5*0.5 + 2*1.0 + 3*0.3 = 2.5 + 2.0 + 0.9 = 5.4
  // score = min(5.4/10, 1.0) = 0.54
  const score = ScoringEngine.computeGovernance(5, 2, 3);
  test.equal(score, 0.54, `governance score should be 0.54, got ${score}`);

  // Max governance: 20 proposals (saturated at reference 10)
  const scoreMax = ScoringEngine.computeGovernance(20, 10, 10);
  test.equal(scoreMax, 1.0, 'saturated governance should score 1.0');
});

Tinytest.add('ScoringEngine - computeTrust', function(test) {
  // No bonds
  test.equal(ScoringEngine.computeTrust([], []), 0, 'no bonds should score 0');

  // One peer bond (weight 1.0), age 150000 blocks (>1 year, 1.5×)
  // weighted = 1.0 * 1.5 = 1.5
  const score = ScoringEngine.computeTrust(
    [{ type: 'peer', ageBlocks: 150000 }],
    []
  );
  test.isTrue(score > 0, 'bonds should produce non-zero trust score');

  // Authorized-agent bond (weight 2.0), age 300000 blocks (>2 years, 2.0×)
  // weighted = 2.0 * 2.0 = 4.0
  const highScore = ScoringEngine.computeTrust(
    [{ type: 'authorized-agent', ageBlocks: 300000 }],
    []
  );
  test.isTrue(highScore > score, 'higher trust bonds should produce higher score');
});

Tinytest.add('ScoringEngine - computeMerkleRoot', function(test) {
  // Empty entries
  const emptyRoot = ScoringEngine.computeMerkleRoot([]);
  test.isTrue(typeof emptyRoot === 'string', 'empty merkle root should be hex string');
  test.equal(emptyRoot.length, 64, 'empty merkle root should be 64 hex chars');

  // Single entry
  const singleRoot = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.5000 },
  ]);
  test.isTrue(typeof singleRoot === 'string', 'single merkle root should be hex string');
  test.equal(singleRoot.length, 64, 'single merkle root should be 64 hex chars');

  // Two entries — deterministic
  const root1 = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.5000 },
    { entityPubkeyHex: 'b' + '0'.repeat(63), totalScore: 0.7500 },
  ]);
  const root2 = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.5000 },
    { entityPubkeyHex: 'b' + '0'.repeat(63), totalScore: 0.7500 },
  ]);
  test.equal(root1, root2, 'deterministic inputs should produce deterministic roots');

  // Different ordering (handled by lexicographic sort internally)
  const root3 = ScoringEngine.computeMerkleRoot([
    { entityPubkeyHex: 'b' + '0'.repeat(63), totalScore: 0.7500 },
    { entityPubkeyHex: 'a' + '0'.repeat(63), totalScore: 0.5000 },
  ]);
  test.equal(root1, root3, 'reordering should produce same merkle root');
});

Tinytest.add('ScoringEngine - weights influence total score', function(test) {
  // Compute with ring-of-trust default weights
  const resultRing = ScoringEngine.computeScore(GENESIS_ENTITY_SIGNALS, SCORING_WEIGHTS);

  // Compute with game default weights (trust lower, longevity higher)
  const resultGame = ScoringEngine.computeScore(GENESIS_ENTITY_SIGNALS, GAME_DEFAULT_WEIGHTS);

  test.isTrue(typeof resultRing.totalScore === 'number', 'ring-of-trust score should be a number');
  test.isTrue(typeof resultGame.totalScore === 'number', 'game score should be a number');

  // These should produce different totals (weights differ)
  // Ring-of-trust weights trust at 0.35, Game weights trust at 0.20
  // The test entity has moderate trust, so ring score may be higher or lower
  test.notEqual(
    Math.round(resultRing.totalScore * 100),
    Math.round(resultGame.totalScore * 100),
    'different weights should produce different total scores'
  );
});

Tinytest.add('ScoringEngine - dataplane diversity bonus', function(test) {
  // Single chain entity
  const singleChain = JSON.parse(JSON.stringify(GENESIS_ENTITY_SIGNALS));
  singleChain.chains = { CDN: GENESIS_ENTITY_SIGNALS.chains.CDN };
  const resultSingle = ScoringEngine.computeScore(singleChain);

  // Multi-chain entity (same entity, two chains)
  const resultMulti = ScoringEngine.computeScore(GENESIS_ENTITY_SIGNALS);

  // Multi-chain entity should have higher diversity bonus
  test.isTrue(resultMulti.diversityBonus >= resultSingle.diversityBonus,
    'multi-chain entity should have >= diversity bonus');
  test.equal(resultSingle.diversityBonus, 1.0, 'single-chain diversity bonus should be 1.0');
  test.equal(resultMulti.diversityBonus, 1.1, 'two-chain diversity bonus should be 1.1');
});

Tinytest.add('ScoringEngine - computeScore requires valid signals', function(test) {
  test.throws(() => {
    ScoringEngine.computeScore(null);
  }, 'null signals should throw');

  test.throws(() => {
    ScoringEngine.computeScore({});
  }, 'signals without entityPubkeyHex should throw');

  test.throws(() => {
    ScoringEngine.computeScore('invalid');
  }, 'string signals should throw');
});
