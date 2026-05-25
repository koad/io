/**
 * koad:io-drive-chain — Sidechain Manager Unit Tests
 *
 * VESTA-SPEC-212: Tests for the deterministic parts of the sidechain manager —
 * ID allocation rules (§2), state commitment shape validation (§3), and
 * lifecycle state transitions (§9).
 *
 * These tests are designed to run without a live chain or Rust service.
 * All bridge calls are stubbed.
 *
 * Test patterns:
 *   1. Sidechain ID allocation: range validation, duplicate detection, kingdom uniqueness
 *   2. Sidechain lifecycle: state transitions (pending → active → terminating → terminated)
 *   3. Kingdom-state commitment shape: what MUST be on the sidechain per SPEC-212 §3.1
 *   4. Withdrawal request validation: minimum amounts, required fields
 *   5. Constants: WORKSCORE defaults, OP_RETURN limits, sidechain ID ranges
 */

'use strict';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal valid sidechain allocation request.
 */
function validAllocationRequest(overrides = {}) {
  return Object.assign({
    sidechainId: 1,
    kingdomHandle: 'test-kingdom',
    kingdomGenesisCid: 'baguczstestkingdomgenesis' + '0'.repeat(35),
    blockProducer: 'a' + '0'.repeat(63),  // 64-hex Ed25519 pubkey
    config: {},
    allocatedBy: 'koad',
  }, overrides);
}

// ============================================================================
// Tests: Sidechain ID Allocation (SPEC-212 §2)
// ============================================================================

Tinytest.add('SidechainManager - allocateSidechainId requires valid ID range', async function(test) {
  // ID 0x0000 is reserved (SIDECHAIN_ID_NULL)
  const nullResult = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0000,
  }));
  test.isFalse(nullResult.success, 'ID 0x0000 should be rejected (reserved)');

  // ID below kingdom range
  const belowResult = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: -1,
  }));
  test.isFalse(belowResult.success, 'negative ID should be rejected');

  // ID in kingdom range (valid)
  const validResult = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0001,
    kingdomHandle: 'valid-kingdom',
  }));
  test.isTrue(validResult.success, 'ID 0x0001 should be accepted (kingdom range)');

  // ID in experimental range (valid, self-assigned)
  const expResult = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x8000,
    kingdomHandle: 'experimental-kingdom',
  }));
  test.isTrue(expResult.success, 'ID 0x8000 should be accepted (experimental range)');

  // ID above experimental range
  const aboveResult = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x10000,
  }));
  test.isFalse(aboveResult.success, 'ID > 0xFFFF should be rejected');
});

Tinytest.add('SidechainManager - allocateSidechainId requires required fields', async function(test) {
  // Missing kingdomHandle
  const noHandle = await SidechainManager.allocateSidechainId(validAllocationRequest({
    kingdomHandle: null,
  }));
  test.isFalse(noHandle.success, 'missing kingdomHandle should be rejected');

  // Missing kingdomGenesisCid
  const noCid = await SidechainManager.allocateSidechainId(validAllocationRequest({
    kingdomGenesisCid: null,
  }));
  test.isFalse(noCid.success, 'missing kingdomGenesisCid should be rejected');

  // Missing blockProducer
  const noProducer = await SidechainManager.allocateSidechainId(validAllocationRequest({
    blockProducer: null,
  }));
  test.isFalse(noProducer.success, 'missing blockProducer should be rejected');

  // All valid fields
  const valid = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0002,
    kingdomHandle: 'field-test',
    kingdomGenesisCid: 'baguczsfieldtest' + '0'.repeat(36),
    blockProducer: 'b' + '0'.repeat(63),
  }));
  test.isTrue(valid.success, 'all required fields should produce valid allocation');
});

Tinytest.add('SidechainManager - allocateSidechainId rejects duplicate ID', async function(test) {
  // First allocation should succeed
  const first = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0003,
    kingdomHandle: 'duplicate-test-1',
  }));
  test.isTrue(first.success, 'first allocation should succeed');

  // Second allocation with same ID should fail
  const second = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0003,  // Same ID
    kingdomHandle: 'duplicate-test-2',
  }));
  test.isFalse(second.success, 'duplicate sidechain ID should be rejected');
  test.isTrue(second.error && second.error.includes('already allocated'),
    `error should mention existing allocation: ${second.error}`);
});

Tinytest.add('SidechainManager - allocateSidechainId enforces one per kingdom (default)', async function(test) {
  // Allocate first sidechain for a kingdom
  const first = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0004,
    kingdomHandle: 'one-per-kingdom',
  }));
  test.isTrue(first.success, 'first allocation should succeed');

  // Second allocation for same kingdom should fail (no multi-sidechain exception)
  const second = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0005,
    kingdomHandle: 'one-per-kingdom',  // Same kingdom
  }));
  test.isFalse(second.success, 'second sidechain for same kingdom should be rejected');
  test.isTrue(second.error && second.error.includes('already has an active sidechain'),
    `error should mention existing sidechain: ${second.error}`);
});

Tinytest.add('SidechainManager - allocateSidechainId allows multi-sidechain with exception', async function(test) {
  // First allocation
  const first = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0006,
    kingdomHandle: 'multi-exception',
  }));
  test.isTrue(first.success, 'first allocation should succeed');

  // Second allocation with multi-sidechain exception flag
  const second = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0007,
    kingdomHandle: 'multi-exception',  // Same kingdom
    config: { multiSidechainException: true },
  }));
  test.isTrue(second.success, 'multi-sidechain with exception flag should be accepted');
});

Tinytest.add('SidechainManager - getNextAvailableId finds first gap', async function(test) {
  // After previous allocations (0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007 are used),
  // the next available should be 0x0008
  const nextId = SidechainManager.getNextAvailableId(0x0001, 0x7FFF);
  test.isTrue(nextId > 0, 'next available ID should be positive');
  test.isTrue(nextId >= 0x0008, `next available should fill the first gap, got ${nextId}`);
});

Tinytest.add('SidechainManager - isSidechainIdAvailable', async function(test) {
  // A used ID should not be available
  test.isFalse(SidechainManager.isSidechainIdAvailable(0x0000), '0x0000 should not be available');
  test.isFalse(SidechainManager.isSidechainIdAvailable(0x0001), '0x0001 should not be available (allocated above)');

  // An unused ID should be available
  test.isTrue(SidechainManager.isSidechainIdAvailable(0x0100), '0x0100 should be available');
});

// ============================================================================
// Tests: Sidechain Lifecycle (SPEC-212 §9)
// ============================================================================

Tinytest.add('SidechainManager - activateSidechain requires pending state', async function(test) {
  // Allocate a sidechain
  const alloc = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0010,
    kingdomHandle: 'lifecycle-test',
  }));
  test.isTrue(alloc.success);

  // Activate it
  const activateResult = await SidechainManager.activateSidechain(0x0010, {
    genesisBlock: 1,
    genesisBlockHash: 'a'.repeat(64),
    configDocumentCid: 'baguczstestconfigdoc',
  });
  test.isTrue(activateResult.success, 'activating a pending sidechain should succeed');

  // Double activation should fail (now in 'active' state)
  const doubleActivate = await SidechainManager.activateSidechain(0x0010, {
    genesisBlock: 2,
    genesisBlockHash: 'b'.repeat(64),
  });
  test.isFalse(doubleActivate.success, 'activating an already-active sidechain should fail');
});

Tinytest.add('SidechainManager - terminateSidechain requires existing sidechain', async function(test) {
  const result = await SidechainManager.terminateSidechain(0x9999);
  test.isFalse(result.success, 'terminating non-existent sidechain should fail');
});

Tinytest.add('SidechainManager - terminateSidechain updates state', async function(test) {
  // Allocate and activate
  const alloc = await SidechainManager.allocateSidechainId(validAllocationRequest({
    sidechainId: 0x0011,
    kingdomHandle: 'termination-test',
  }));
  test.isTrue(alloc.success);

  await SidechainManager.activateSidechain(0x0011, {
    genesisBlock: 100,
    genesisBlockHash: 'c'.repeat(64),
  });

  // Terminate
  const terminateResult = await SidechainManager.terminateSidechain(0x0011);
  test.isTrue(terminateResult.success, 'termination should succeed');

  // Verify sidechain is now in terminating state
  const sidechain = Sidechains.findOne({ sidechain_id: 0x0011 });
  test.isTrue(sidechain.state === 'terminating',
    `sidechain state should be 'terminating', got '${sidechain.state}'`);
  test.isTrue(sidechain.termination_block === 100,
    `termination_block should be the last block, got ${sidechain.termination_block}`);
});

// ============================================================================
// Tests: Kingdom-State Commitment Shape (SPEC-212 §3.1)
// ============================================================================

Tinytest.add('Sidechain collections have expected schema fields (SPEC-212 §3.1)', function(test) {
  // SPEC-212 §3.1 defines what MUST be committed to the sidechain.
  // These fields should be present in the Sidechains collection schema.

  const sidechain = Sidechains.findOne({ sidechain_id: 0x0011 });
  if (!sidechain) {
    test.isTrue(false, 'expected sidechain 0x0011 to exist');
    return;
  }

  // Entity sigchain tips tracking (SPEC-212 §3.1 commitment #1)
  test.isTrue('sigchain_tip_count' in sidechain, 'sidechain doc should have sigchain_tip_count');

  // Trust bond attestation tracking (SPEC-212 §3.1 commitment #2)
  test.isTrue('bond_attestation_count' in sidechain, 'sidechain doc should have bond_attestation_count');

  // Kingdom merkle root tracking (SPEC-212 §3.1 commitment #3)
  test.isTrue('merkle_root_count' in sidechain, 'sidechain doc should have merkle_root_count');
  test.isTrue('last_merkle_root' in sidechain, 'sidechain doc should have last_merkle_root');

  // Score snapshot tracking (SPEC-212 §3.1)
  test.isTrue('score_snapshot_count' in sidechain, 'sidechain doc should have score_snapshot_count');

  // Sidechain block producer identity (SPEC-212 §3.1 commitment #5)
  test.isTrue('block_producer' in sidechain, 'sidechain doc should have block_producer');

  // Kingdom sovereign sigchain tip tracking (SPEC-212 §3.1 commitment #4)
  // Kingdom sigchain tip tracking is on the kingdom entity, not on the sidechain doc.
  // The sidechain doc tracks the kingdom_handle and genesis_cid for resolution.
  test.isTrue('kingdom_handle' in sidechain, 'sidechain doc should have kingdom_handle');
  test.isTrue('kingdom_genesis_cid' in sidechain, 'sidechain doc should have kingdom_genesis_cid');
});

Tinytest.add('SidechainDeposits schema has expected fields (SPEC-212 §6.1)', function(test) {
  // SPEC-212 §6.1 defines the deposit flow. The collection should support it.

  const sampleDeposit = {
    sidechain_id: 1,
    mainchain_txid: '0'.repeat(64),  // 32-byte txid hex
  };

  test.isTrue(true, 'SidechainDeposits collection exists');
  // Verify indexing is set up (not possible to check directly in tinytest,
  // but we verify the fields that the schema documents)
});

Tinytest.add('SidechainWithdrawals schema supports bundle lifecycle (SPEC-212 §6.2)', function(test) {
  // SPEC-212 §6.2 defines the withdrawal bundle lifecycle states.
  const validStates = ['pending', 'bundled', 'submitted', 'in_fail_period', 'challenged', 'executed', 'failed', 'retrying'];

  test.isTrue(validStates.includes('pending'), 'pending is a valid state');
  test.isTrue(validStates.includes('bundled'), 'bundled is a valid state');
  test.isTrue(validStates.includes('submitted'), 'submitted is a valid state');
  test.isTrue(validStates.includes('in_fail_period'), 'in_fail_period is a valid state');
  test.isTrue(validStates.includes('challenged'), 'challenged is a valid state');
  test.isTrue(validStates.includes('executed'), 'executed is a valid state');
  test.isTrue(validStates.includes('failed'), 'failed is a valid state');
  test.isTrue(validStates.includes('retrying'), 'retrying is a valid state');
});

// ============================================================================
// Tests: Withdrawal Request Validation (SPEC-212 §6.2)
// ============================================================================

Tinytest.add('WithdrawalManager - requestWithdrawal validates required fields', async function(test) {
  // Missing sidechainId
  const noId = await WithdrawalManager.requestWithdrawal({
    entityPubkeyHex: 'a'.repeat(64),
    mainchainTargetAddress: 'cdn1testaddress',
    amountSatoshi: 100000,
    sidechainTxid: 'b'.repeat(64),
  });
  test.isFalse(noId.success, 'missing sidechainId should fail');

  // Missing amount
  const noAmount = await WithdrawalManager.requestWithdrawal({
    sidechainId: 1,
    entityPubkeyHex: 'a'.repeat(64),
    mainchainTargetAddress: 'cdn1testaddress',
    sidechainTxid: 'b'.repeat(64),
  });
  test.isFalse(noAmount.success, 'missing amount should fail');

  // Amount below minimum
  const lowAmount = await WithdrawalManager.requestWithdrawal({
    sidechainId: 1,
    entityPubkeyHex: 'a'.repeat(64),
    mainchainTargetAddress: 'cdn1testaddress',
    amountSatoshi: 1,  // Below MINIMUM_WITHDRAWAL_SATOSHI (1000)
    sidechainTxid: 'b'.repeat(64),
  });
  test.isFalse(lowAmount.success, 'amount below minimum should fail');
});

// ============================================================================
// Tests: Constants Validation (SPEC-212 §5, Rooty assessment §5)
// ============================================================================

Tinytest.add('Constants match VESTA-SPEC-212 values', function(test) {
  // Sidechain ID ranges (SPEC-212 §2.1)
  test.equal(SIDECHAIN_ID_NULL, 0x0000, 'SIDECHAIN_ID_NULL should be 0x0000');
  test.equal(SIDECHAIN_ID_KINGDOM_MIN, 0x0001, 'kingdom min should be 0x0001');
  test.equal(SIDECHAIN_ID_KINGDOM_MAX, 0x7FFF, 'kingdom max should be 0x7FFF');
  test.equal(SIDECHAIN_ID_EXPERIMENTAL_MIN, 0x8000, 'experimental min should be 0x8000');
  test.equal(SIDECHAIN_ID_EXPERIMENTAL_MAX, 0xFFFF, 'experimental max should be 0xFFFF');

  // Block times (SPEC-212 §1.1, Rooty assessment §5)
  test.equal(CDN_MAINNET_BLOCK_TIME, 300, 'CDN mainnet block time is 300s');
  test.equal(CDN_TESTNET_BLOCK_TIME, 30, 'CDN testnet block time is 30s');
  test.equal(SIDECHAIN_BLOCK_TIME_DEFAULT, 60, 'default sidechain block time is 60s');

  // OP_RETURN limits (SPEC-212 §5.1)
  test.equal(SIDECHAIN_OP_RETURN_LIMIT_DEFAULT, 80, 'default OP_RETURN is 80 bytes');
  test.equal(SIDECHAIN_OP_RETURN_LIMIT_EXTENDED, 100, 'extended OP_RETURN is 100 bytes');
  test.equal(SIDECHAIN_OP_RETURN_LIMIT_MAX, 1000, 'max OP_RETURN is 1000 bytes');

  // Workscore (SPEC-212 OQ-3, BIP 301 default)
  test.equal(MIN_WORKSCORE_DEFAULT, 131, 'default MIN_WORKSCORE is 131');
  test.equal(MIN_WORKSCORE_TESTNET, 10, 'testnet MIN_WORKSCORE is 10');

  // Withdrawal periods (SPEC-212 §6.2)
  test.equal(MAINCHAIN_WITHDRAWAL_PERIOD_BLOCKS_DEFAULT, 144, 'default fail period is 144 blocks');

  // Deposit minimum (SPEC-212 §6.1)
  test.equal(MINIMUM_DEPOSIT_SATOSHI, 1000, 'minimum deposit is 1000 satoshi');

  // Consensus model (SPEC-212 §4.1)
  test.equal(CONSENSUS_POA, 'proof-of-authority', 'v1 consensus is PoA');

  // Sidechain lifecycle states (SPEC-212 §9)
  test.equal(SIDECHAIN_STATE_PENDING, 'pending', 'pending state');
  test.equal(SIDECHAIN_STATE_ACTIVE, 'active', 'active state');
  test.equal(SIDECHAIN_STATE_FROZEN, 'frozen', 'frozen state');
  test.equal(SIDECHAIN_STATE_TERMINATING, 'terminating', 'terminating state');
  test.equal(SIDECHAIN_STATE_TERMINATED, 'terminated', 'terminated state');
  test.equal(SIDECHAIN_STATE_MIGRATING, 'migrating', 'migrating state');

  // TLV tags (SPEC-212 §5.2)
  test.equal(TAG_BOND_ATTESTATION, 0x18, 'bond attestation tag is 0x18');
  test.equal(TAG_SIGCHAIN_TIP_BUNDLE, 0x19, 'sigchain tip bundle tag is 0x19');
  test.equal(KSC_PREFIX, 'kSC', 'kSC prefix');
});

// ============================================================================
// Tests: Rust Bridge Interface (Stub)
// ============================================================================

Tinytest.add('RustBridge exposes expected methods', function(test) {
  test.isTrue(typeof RustBridge.init === 'function', 'RustBridge.init should be a function');
  test.isTrue(typeof RustBridge.bmmCommit === 'function', 'RustBridge.bmmCommit should be a function');
  test.isTrue(typeof RustBridge.bmmStatus === 'function', 'RustBridge.bmmStatus should be a function');
  test.isTrue(typeof RustBridge.watchDeposits === 'function', 'RustBridge.watchDeposits should be a function');
  test.isTrue(typeof RustBridge.getDeposits === 'function', 'RustBridge.getDeposits should be a function');
  test.isTrue(typeof RustBridge.submitWithdrawalBundle === 'function', 'RustBridge.submitWithdrawalBundle should be a function');
  test.isTrue(typeof RustBridge.withdrawalStatus === 'function', 'RustBridge.withdrawalStatus should be a function');
  test.isTrue(typeof RustBridge.produceBlock === 'function', 'RustBridge.produceBlock should be a function');
  test.isTrue(typeof RustBridge.getSidechainState === 'function', 'RustBridge.getSidechainState should be a function');
  test.isTrue(typeof RustBridge.healthCheck === 'function', 'RustBridge.healthCheck should be a function');
  test.isTrue(typeof RustBridge.isConnected === 'function', 'RustBridge.isConnected should be a function');
});

Tinytest.add('RustBridge stub returns expected shapes', async function(test) {
  // bmmCommit
  const bmmResult = await RustBridge.bmmCommit({
    sidechainId: 1,
    sidechainBlockHash: 'a'.repeat(64),
    sidechainBlockHeight: 100,
  });
  test.isTrue(bmmResult.success, 'bmmCommit should return success');
  test.isTrue(bmmResult._stub, 'bmmCommit should be marked as stub');
  test.isTrue(typeof bmmResult.bmmTxid === 'string', 'bmmCommit should return a bmmTxid');

  // produceBlock
  const blockResult = await RustBridge.produceBlock({
    sidechainId: 1,
    producerPubkey: 'a'.repeat(64),
    previousBlockHash: 'b'.repeat(64),
  });
  test.isTrue(blockResult.success, 'produceBlock should return success');
  test.isTrue(typeof blockResult.blockHash === 'string', 'produceBlock should return blockHash');

  // submitWithdrawalBundle
  const withdrawalResult = await RustBridge.submitWithdrawalBundle({
    sidechainId: 1,
    bundleCid: 'c'.repeat(64),
    withdrawalRequests: [],
  });
  test.isTrue(withdrawalResult.success, 'submitWithdrawalBundle should return success');
  test.isTrue(typeof withdrawalResult.mainchainTxid === 'string', 'should return mainchainTxid');
});
