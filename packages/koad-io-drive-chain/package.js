/**
 * koad:io-drive-chain
 *
 * VESTA-SPEC-212: Kingdom Sidechain Protocol — BIP 300/301 Anchored Kingdoms
 * via CDN Drivechain. The koad:io kingdom-layer interface to drivechain mechanics.
 *
 * This package provides:
 *   - Sidechain lifecycle management (genesis, operation, termination, migration)
 *   - Sidechain ID allocation per SPEC-212 §2
 *   - Kingdom-state commitment interface (sigchain tips, trust bonds, score snapshots)
 *   - BIP 301 BMM commitment processing (stub — wires to Rust sidechain driver)
 *   - Deposit watching (stub — watches CDN mainchain via Rust service)
 *   - Withdrawal bundle pool + workscore tracking (stub)
 *   - DDP publications for sidechain state, deposits, withdrawals
 *   - Daemon emission stream integration (lifecycle events, state changes)
 *
 * The Rust drivechain bridge (`rust-bridge.js`) provides the communication adapter
 * to the future `nchashch/drivechain` sidechain driver service. Until the Rust
 * service exists, all bridge calls are stubs with documented expected interfaces.
 *
 * Spec ref: VESTA-SPEC-212 (v0.1, 2026-05-25)
 * Cross-ref: ROOTY-SPEC-003 (taint protocol), ROOTY-SPEC-008 (CDN anchoring),
 *            ROOTY-SPEC-009 (scoring indexer), VESTA-SPEC-007 (trust bonds),
 *            VESTA-SPEC-111 (sigchain format), VESTA-SPEC-115 (kingdom model)
 *
 * Dependency chain:
 *   ecoincore:electrum         → CDN mainchain queries (block headers, tx lookup)
 *   ecoincore:chainpack        → Chain parameter resolution (block time, ticker)
 *   ecoincore:utxo             → CID parsing, TLV encoding/decoding for OP_RETURN
 *   ecoincore:sigchain-discovery → Entity discovery hooks, sigchain tip resolution
 *   koad:io-scoring-indexer    → Score snapshot integration for sidechain anchoring
 *
 * Authority: VESTA-SPEC-212
 */

Package.describe({
  name: 'koad:io-drive-chain',
  version: '0.0.1',
  summary: 'VESTA-SPEC-212: Kingdom sidechain protocol — BIP 300/301 drivechain interface for koad:io kingdoms',
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
  api.use('ecoincore:chainpack');
  api.use('ecoincore:utxo');
  api.use('ecoincore:sigchain-discovery');
  api.use('koad:io-scoring-indexer');

  // Shared collections and constants (both client and server)
  api.addFiles([
    'both/constants.js',
    'both/collections.js',
  ]);

  // Server-only: sidechain manager, BMM processor, deposit watcher,
  // withdrawal manager, Rust bridge adapter, daemon emitter, publications
  api.addFiles([
    'server/rust-bridge.js',        // Communication adapter to Rust sidechain driver (stub)
    'server/sidechain-manager.js',  // Lifecycle, ID allocation, kingdom-state commitment
    'server/bmm-processor.js',      // BIP 301 BMM commit handling (stub — wires to Rust)
    'server/deposit-watcher.js',    // CDN mainchain deposit monitoring (stub — wires to Rust)
    'server/withdrawal-manager.js', // Withdrawal bundle pool + workscore tracking (stub)
    'server/daemon-emitter.js',     // Emission stream integration (lifecycle, deposits, withdrawals)
    'server/publications.js',       // DDP publications for sidechain state
  ], 'server');

  // Exports — namespaced to avoid Meteor 3 globalThis collision
  api.export('KoadIoDriveChain');
  api.export('Sidechains');
  api.export('SidechainDeposits');
  api.export('SidechainWithdrawals');
  api.export('KingdomSidechainState');
  api.export('SidechainManager');
  api.export('BMMProcessor');
  api.export('DepositWatcher');
  api.export('WithdrawalManager');
  api.export('RustBridge');
  api.export('DriveChainDaemonEmitter');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('tinytest');
  api.use('koad:io-core');
  api.use('ecoincore');
  api.use('koad:io-drive-chain');
  api.addFiles([
    'tests/sidechain-manager.test.js',
  ]);
});
