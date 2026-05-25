/**
 * koad:io-scoring-indexer
 *
 * ROOTY-SPEC-009: Ring-of-Trust Scoring Indexer — JS/electrum thin-client
 * implementation. Scores sovereign entities from on-chain data (sigchain tips,
 * bond attestations, taint payloads, timelocks) across multiple UTXO chains.
 *
 * This is a **koad:io package** (kingdom layer). It scores entities — a kingdom
 * concept. Chain-generalized primitives (electrum queries, address derivation,
 * CID parsing) live in ecoincore packages.
 *
 * Scoring model (SPEC-009 §3): five components, each normalized to [0,1]:
 *   S_longevity  — entity age and continuous presence
 *   S_activity   — activity density and consistency (s-curve with diminishing returns)
 *   S_trust      — trust network size and depth (2-degree propagation, bond-type weights)
 *   S_stake      — timelocked commitment (amount × duration)
 *   S_governance — governance participation
 *
 * Total = weighted sum × dataplane diversity bonus (1.0 + (chains-1) × 0.1, cap 1.4)
 *
 * Dependency chain:
 *   ecoincore:electrum         → assertElectrumConnection, observeAddress, getAddressHistory
 *   ecoincore:sigchain-discovery → WatchedEntities, EntityBroadcasts, AddressTaints, deriveAddress
 *   ecoincore:chainpack        → Chainpacks collection, chain parameter resolution
 *   ecoincore:utxo             → CID parsing, TLV encoding/decoding
 *
 * Authority: ROOTY-SPEC-009 v0.1 (ring-of-trust scoring indexer)
 * Cross-ref: ROOTY-SPEC-001 (sigchain tip broadcast), VESTA-SPEC-007 (trust bond protocol),
 *            ROOTY-SPEC-003 (taint protocol), ROOTY-SPEC-004 (timelock staking)
 */

Package.describe({
  name: 'koad:io-scoring-indexer',
  version: '0.0.1',
  summary: 'ROOTY-SPEC-009: ring-of-trust scoring indexer — deterministic on-chain scores for sovereign entities',
  git: '',
  documentation: null
});

Package.onUse(function(api) {
  api.versionsFrom('3.0');
  api.use('ecmascript');
  api.use('mongo');
  api.use('koad:io-core');
  api.use('ecoincore');
  api.use('ecoincore:electrum');
  api.use('ecoincore:sigchain-discovery');
  api.use('ecoincore:chainpack');
  api.use('ecoincore:utxo');

  // Shared collections and constants (both client and server)
  api.addFiles([
    'both/constants.js',
    'both/collections.js',
  ]);

  // Server-only: scoring engine, block watcher, snapshotter, genesis scanner,
  // daemon emitter, and DDP publications
  api.addFiles([
    'server/scorer.js',
    'server/block-watcher.js',
    'server/snapshotter.js',
    'server/genesis-scanner.js',
    'server/daemon-emitter.js',
    'server/publications.js',
  ], 'server');

  // Exports — namespaced to avoid Meteor 3 globalThis collision
  api.export('ScoreTable');
  api.export('ScoreHistory');
  api.export('ScoringIndexerState');
  api.export('ScoringEngine');
  api.export('BlockWatcher');
  api.export('Snapshotter');
  api.export('GenesisScanner');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('tinytest');
  api.use('koad:io-core');
  api.use('ecoincore');
  api.use('koad:io-scoring-indexer');
  api.addFiles([
    'tests/scorer.test.js',
    'tests/snapshotter.test.js',
  ]);
});
