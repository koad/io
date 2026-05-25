/**
 * koad:io-scoring-indexer — CacheBox DDP Publications
 *
 * ROOTY-SPEC-009 §7.3: DDP publications for ScoreTable and ScoreHistory
 * collections, exposed via CacheBox for kingdom app consumption.
 *
 * Publications:
 *   1. scoringScoreTable  — Current scores, optionally filtered by entity
 *   2. scoringScoreHistory — Historical snapshots per entity
 *   3. scoringLeaderboard  — Top-N entities by total score
 *   4. scoringIndexerState — Daemon state for admin/dashboard
 *
 * All publications publish cleaned/serialized data (no Buffer fields).
 */

'use strict';

// ============================================================================
// scoringScoreTable — Full score table
// ============================================================================
// Returns current scores for all entities. Can be filtered by entity pubkey.
//
// Parameters:
//   filter (Object, optional):
//     { entityPubkeyHex: string } — Single entity
//     { minScore: number } — Minimum total score threshold
//     { limit: number } — Max documents to return (default 100)
//     { skip: number } — Offset for pagination

ScoreTable._ensureIndex({ entity_pubkey_hex: 1 });
ScoreTable._ensureIndex({ total_score: -1 });

Meteor.publish('scoringScoreTable', function(filter = {}) {
  const query = {};

  if (filter.entityPubkeyHex) {
    query.entity_pubkey_hex = filter.entityPubkeyHex;
  }
  if (filter.minScore) {
    query.total_score = { $gte: filter.minScore };
  }

  const options = {
    sort: { total_score: -1 },
    limit: filter.limit || 100,
    skip: filter.skip || 0,
  };

  // Add rank field via transform
  return ScoreTable.find(query, options);
});

// ============================================================================
// scoringScoreHistory — Per-entity score history
// ============================================================================
// Returns chronological history for one or more entities.
//
// Parameters:
//   filter (Object):
//     { entityPubkeyHex: string } — Required: which entity's history
//     { fromBlock: number } — Optional: start block
//     { toBlock: number } — Optional: end block
//     { limit: number } — Max documents (default 1000)

ScoreHistory._ensureIndex({ entity_pubkey_hex: 1, snapshot_block: -1 });

Meteor.publish('scoringScoreHistory', function(filter = {}) {
  if (!filter.entityPubkeyHex) {
    this.error(new Meteor.Error('missing-filter', 'entityPubkeyHex is required'));
    return this.ready();
  }

  const query = { entity_pubkey_hex: filter.entityPubkeyHex };

  if (filter.fromBlock) {
    query.snapshot_block = { $gte: filter.fromBlock };
  }
  if (filter.toBlock) {
    query.snapshot_block = query.snapshot_block || {};
    query.snapshot_block.$lte = filter.toBlock;
  }

  return ScoreHistory.find(query, {
    sort: { snapshot_block: -1 },
    limit: filter.limit || 1000,
  });
});

// ============================================================================
// scoringLeaderboard — Top-N leaderboard
// ============================================================================
// Convenience publication for the top N entities by score.
//
// Parameters:
//   limit (number) — How many to return (default 20, max 100)
//   skip (number) — Offset for pagination

Meteor.publish('scoringLeaderboard', function(limit = 20, skip = 0) {
  const maxLimit = 100;
  const safeLimit = Math.min(limit, maxLimit);

  return ScoreTable.find({}, {
    sort: { total_score: -1 },
    limit: safeLimit,
    skip: skip || 0,
  });
});

// ============================================================================
// scoringIndexerState — Daemon indexer state
// ============================================================================
// Single-document state for admin dashboards.

Meteor.publish('scoringIndexerState', function() {
  return ScoringIndexerState.find('scoring-indexer-state');
});
