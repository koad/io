/**
 * koad:io-drive-chain — CacheBox DDP Publications
 *
 * VESTA-SPEC-212: DDP publications for sidechain state, deposit, and withdrawal
 * collections, exposed via CacheBox for kingdom app consumption.
 *
 * Publications:
 *   1. driveChainSidechains       — Sidechain registry and state
 *   2. driveChainDeposits         — Deposit events per sidechain
 *   3. driveChainWithdrawals      — Withdrawal requests and bundles
 *   4. driveChainState            — Daemon state for admin/dashboard
 *   5. driveChainSidechainDetail  — Single sidechain with recent activity
 *
 * All publications publish cleaned/serialized data (no Buffer fields).
 */

'use strict';

// ============================================================================
// Indexes
// ============================================================================

Sidechains._ensureIndex({ sidechain_id: 1 });
Sidechains._ensureIndex({ kingdom_handle: 1 });
Sidechains._ensureIndex({ state: 1 });

SidechainDeposits._ensureIndex({ sidechain_id: 1, mainchain_block: -1 });
SidechainDeposits._ensureIndex({ mainchain_txid: 1 });
SidechainDeposits._ensureIndex({ status: 1 });

SidechainWithdrawals._ensureIndex({ sidechain_id: 1, type: 1, created_at: -1 });
SidechainWithdrawals._ensureIndex({ type: 1, status: 1 });

// ============================================================================
// driveChainSidechains — Sidechain Registry
// ============================================================================
// Returns all sidechains, optionally filtered by state, kingdom, or ID.
//
// Parameters (filter object):
//   { sidechainId: number }                    — Single sidechain by ID
//   { kingdomHandle: string }                  — Sidechains for a kingdom
//   { state: string }                          — Sidechains by lifecycle state
//   { health: string }                         — Sidechains by health status
//   { limit: number, skip: number }            — Pagination

Meteor.publish('driveChainSidechains', function(filter = {}) {
  const query = {};

  if (filter.sidechainId !== undefined) {
    query.sidechain_id = filter.sidechainId;
  }
  if (filter.kingdomHandle) {
    query.kingdom_handle = filter.kingdomHandle;
  }
  if (filter.state) {
    query.state = filter.state;
  }
  if (filter.health) {
    query.health = filter.health;
  }

  const options = {
    sort: { sidechain_id: 1 },
    limit: filter.limit || 50,
    skip: filter.skip || 0,
  };

  return Sidechains.find(query, options);
});

// ============================================================================
// driveChainDeposits — Deposit Event Log
// ============================================================================
// Returns deposit events for a sidechain, optionally filtered.
//
// Parameters:
//   filter (Object):
//     sidechainId (number) — Required
//     { status: string } — pending | credited | failed
//     { fromBlock: number } — Start block height
//     { toBlock: number } — End block height
//     { limit: number } — Max documents (default 100)
//     { skip: number } — Pagination

Meteor.publish('driveChainDeposits', function(filter = {}) {
  if (filter.sidechainId === undefined) {
    this.error(new Meteor.Error('missing-filter', 'sidechainId is required'));
    return this.ready();
  }

  const query = { sidechain_id: filter.sidechainId };

  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.fromBlock) {
    query.mainchain_block = { $gte: filter.fromBlock };
  }
  if (filter.toBlock) {
    query.mainchain_block = query.mainchain_block || {};
    query.mainchain_block.$lte = filter.toBlock;
  }

  return SidechainDeposits.find(query, {
    sort: { mainchain_block: -1 },
    limit: filter.limit || 100,
    skip: filter.skip || 0,
  });
});

// ============================================================================
// driveChainWithdrawals — Withdrawal Requests and Bundles
// ============================================================================
// Returns withdrawal records for a sidechain.
//
// Parameters:
//   filter (Object):
//     sidechainId (number) — Required
//     { type: string } — 'request' | 'bundle' (default: both)
//     { status: string } — Filter by status
//     { entityPubkeyHex: string } — Filter by entity (for requests)
//     { limit: number } — Max documents (default 100)
//     { skip: number } — Pagination

Meteor.publish('driveChainWithdrawals', function(filter = {}) {
  if (filter.sidechainId === undefined) {
    this.error(new Meteor.Error('missing-filter', 'sidechainId is required'));
    return this.ready();
  }

  const query = { sidechain_id: filter.sidechainId };

  if (filter.type) {
    query.type = filter.type;
  }
  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.entityPubkeyHex) {
    query.entity_pubkey_hex = filter.entityPubkeyHex;
  }

  return SidechainWithdrawals.find(query, {
    sort: { created_at: -1 },
    limit: filter.limit || 100,
    skip: filter.skip || 0,
  });
});

// ============================================================================
// driveChainState — Daemon State
// ============================================================================
// Returns drivechain daemon state for admin dashboards, optionally by sidechain.

Meteor.publish('driveChainState', function(sidechainId) {
  const query = {};
  if (sidechainId !== undefined) {
    query.sidechain_id = sidechainId;
  }

  return KingdomSidechainState.find(query);
});

// ============================================================================
// driveChainSidechainDetail — Single Sidechain + Recent Activity
// ============================================================================
// Convenience publication: returns a single sidechain document plus its
// most recent deposits and withdrawals.
//
// Parameters:
//   sidechainId (number) — Required

Meteor.publish('driveChainSidechainDetail', function(sidechainId) {
  if (sidechainId === undefined) {
    this.error(new Meteor.Error('missing-filter', 'sidechainId is required'));
    return this.ready();
  }

  const sidechain = Sidechains.findOne({ sidechain_id: sidechainId });
  if (!sidechain) {
    this.ready();
    return;
  }

  // We use a multi-cursor publication pattern: return one cursor per collection
  return [
    Sidechains.find({ sidechain_id: sidechainId }),
    SidechainDeposits.find(
      { sidechain_id: sidechainId },
      { sort: { mainchain_block: -1 }, limit: 20 }
    ),
    SidechainWithdrawals.find(
      { sidechain_id: sidechainId },
      { sort: { created_at: -1 }, limit: 20 }
    ),
    KingdomSidechainState.find({ sidechain_id: sidechainId }),
  ];
});
