/**
 * koad:io-drive-chain — Sidechain Manager
 *
 * VESTA-SPEC-212 §1–3: Sidechain lifecycle management, ID allocation interface,
 * and kingdom-state commitment logic. This is the central coordinator for the
 * drivechain package.
 *
 * Responsibilities:
 *   1. Sidechain identity and allocation (SPEC-212 §2)
 *   2. Sidechain genesis, operation, termination, migration (SPEC-212 §9)
 *   3. Kingdom-state commitment orchestration (SPEC-212 §3)
 *   4. Interface to Rust bridge for block production, BMM, deposits, withdrawals
 *   5. Health monitoring and failure mode recovery (SPEC-212 §8)
 *
 * Exported as SidechainManager global.
 *
 * Authority: VESTA-SPEC-212
 * Cross-ref: Rooty assessment §7 (phase 1 components map, §10 package components)
 */

'use strict';

SidechainManager = {
  name: 'SidechainManager',
  version: '0.0.1',

  _active: false,
  _sidechains: {},        // { [sidechainId]: { config, state } } — in-memory cache
  _productionInterval: null,
  _stateCommitInterval: null,

  // ========================================================================
  // SIDECHAIN ID ALLOCATION (SPEC-212 §2)
  // ========================================================================

  /**
   * Allocate a new sidechain ID for a kingdom.
   *
   * Per SPEC-212 §2.1-2.2: checks range availability, validates kingdom eligibility,
   * and registers the sidechain in the Sidechains collection.
   *
   * SPEC-212 OQ-1: "Sidechain slot auction mechanism — should CCT allocate sidechain
   * IDs via treasury auction, or is a fixed flat fee sufficient?"
   * **DEFERRED:** This implementation uses a fixed fee model (SIDECHAIN_ALLOCATION_BOND_SATOSHI).
   * Future spec amendment may introduce auction mechanics.
   *
   * @param {Object} params
   * @param {number} params.sidechainId — Requested sidechain ID (must be in 0x0001–0x7FFF range)
   * @param {string} params.kingdomHandle — Kingdom slug
   * @param {string} params.kingdomGenesisCid — CID of kingdom genesis record
   * @param {string} params.blockProducer — Hex Ed25519 pubkey of initial block producer
   * @param {Object} [params.config] — Additional sidechain configuration overrides
   * @param {string} [params.allocatedBy] — 'cct' | 'koad' (default: 'koad')
   * @returns {Promise<Object>} { success, sidechainId, error? }
   */
  async allocateSidechainId(params = {}) {
    const { sidechainId, kingdomHandle, kingdomGenesisCid, blockProducer, config, allocatedBy } = params;

    // --- Validation ---

    // Sidechain ID range check (SPEC-212 §2.1)
    if (!sidechainId || sidechainId < SIDECHAIN_ID_KINGDOM_MIN || sidechainId > SIDECHAIN_ID_KINGDOM_MAX) {
      // Allow experimental range for testnets
      if (sidechainId < SIDECHAIN_ID_EXPERIMENTAL_MIN || sidechainId > SIDECHAIN_ID_EXPERIMENTAL_MAX) {
        return { success: false, error: `sidechainId ${sidechainId} is outside valid range. Kingdom IDs: 0x0001-0x7FFF, Experimental: 0x8000-0xFFFF` };
      }
    }

    // Required fields
    if (!kingdomHandle) {
      return { success: false, error: 'kingdomHandle is required' };
    }
    if (!kingdomGenesisCid) {
      return { success: false, error: 'kingdomGenesisCid is required' };
    }
    if (!blockProducer) {
      return { success: false, error: 'blockProducer pubkey is required' };
    }

    // Check for duplicate sidechain ID (SPEC-212 §2.2 allocation requires uniqueness)
    const existing = Sidechains.findOne({ sidechain_id: sidechainId });
    if (existing) {
      return { success: false, error: `Sidechain ID ${sidechainId} is already allocated to kingdom '${existing.kingdom_handle}'` };
    }

    // Check for duplicate kingdom (SPEC-212 §2.3: one sidechain per kingdom default)
    const existingKingdom = Sidechains.findOne({ kingdom_handle: kingdomHandle, state: { $nin: [SIDECHAIN_STATE_TERMINATED] } });
    if (existingKingdom) {
      // Multi-sidechain exception check (SPEC-212 §2.3)
      if (!config?.multiSidechainException) {
        return { success: false, error: `Kingdom '${kingdomHandle}' already has an active sidechain (ID: ${existingKingdom.sidechain_id}). Multi-sidechain allocation requires CCT approval per SPEC-212 §2.3.` };
      }
    }

    // --- Allocation ---

    const now = new Date();

    // Build sidechain configuration document (SPEC-212 §2.4)
    const sidechainConfig = {
      sidechainId,
      kingdomHandle,
      kingdomGenesisCid,
      blockProducer,
      consensus: CONSENSUS_POA,
      blockTimeSeconds: config?.blockTimeSeconds || SIDECHAIN_BLOCK_TIME_DEFAULT,
      opReturnLimit: config?.opReturnLimit || SIDECHAIN_OP_RETURN_LIMIT_DEFAULT,
      feeSchedule: config?.feeSchedule || {
        identityOp: 0,
        valueTransfer: 1000,
        withdrawal: 5000,
      },
      withdrawalPeriodBlocks: config?.withdrawalPeriodBlocks || MAINCHAIN_WITHDRAWAL_PERIOD_BLOCKS_DEFAULT,
      minWorkscore: config?.minWorkscore || MIN_WORKSCORE_DEFAULT,
      mainchain: config?.mainchain || 'CDN',
      bip300ActivationHeight: config?.bip300ActivationHeight || 0,
      bip301ActivationHeight: config?.bip301ActivationHeight || 0,
      backupProducers: config?.backupProducers || [],
    };

    // Insert sidechain record (SPEC-212 §9.1: genesis not yet performed)
    const docId = Sidechains.insert({
      sidechain_id: sidechainId,
      kingdom_handle: kingdomHandle,
      kingdom_genesis_cid: kingdomGenesisCid,
      state: SIDECHAIN_STATE_PENDING,
      created_at: now,
      genesis_block: 0,
      last_block: 0,
      last_block_hash: null,
      last_mainchain_bmm_height: 0,
      block_time_seconds: sidechainConfig.blockTimeSeconds,
      consensus: sidechainConfig.consensus,
      block_producer: blockProducer,
      backup_producers: sidechainConfig.backupProducers,
      op_return_limit: sidechainConfig.opReturnLimit,
      fee_schedule: {
        identity_op: sidechainConfig.feeSchedule.identityOp,
        value_transfer: sidechainConfig.feeSchedule.valueTransfer,
        withdrawal: sidechainConfig.feeSchedule.withdrawal,
      },
      withdrawal_period_blocks: sidechainConfig.withdrawalPeriodBlocks,
      min_workscore: sidechainConfig.minWorkscore,
      mainchain: sidechainConfig.mainchain,
      bip300_activation_height: sidechainConfig.bip300ActivationHeight,
      bip301_activation_height: sidechainConfig.bip301ActivationHeight,
      allocated_by: allocatedBy || 'koad',
      allocated_at: now,
      sigchain_tip_count: 0,
      bond_attestation_count: 0,
      score_snapshot_count: 0,
      merkle_root_count: 0,
      health: 'healthy',
      last_health_check: now,
      error_count: 0,
      updated_at: now,
    });

    // Initialize state tracker
    KingdomSidechainState.insert({
      _id: `drivechain-state-${sidechainId}`,
      sidechain_id: sidechainId,
      status: 'idle',
      health: 'healthy',
      last_indexed_mainchain: 0,
      last_produced_sidechain: 0,
      last_bmm_height: 0,
      last_deposit_check: 0,
      deposit_watch_from_block: 0,
      withdrawal_check_upto: 0,
      deposits_processed: 0,
      withdrawals_processed: 0,
      bmm_commitments: 0,
      blocks_produced: 0,
      errors_encountered: 0,
      pending_deposits: 0,
      pending_withdrawals: 0,
      started_at: now,
      updated_at: now,
    });

    // Fire allocation event
    DriveChainDaemonEmitter.onSidechainAllocated(sidechainId, kingdomHandle, blockProducer);

    console.log(`[koad:io-drive-chain] SidechainManager: allocated sidechain ID ${sidechainId} for kingdom '${kingdomHandle}'`);

    return {
      success: true,
      sidechainId,
      sidechainDocId: docId,
      config: sidechainConfig,
    };
  },

  /**
   * Validate that a sidechain ID is available for allocation.
   *
   * @param {number} sidechainId
   * @returns {boolean}
   */
  isSidechainIdAvailable(sidechainId) {
    if (sidechainId === SIDECHAIN_ID_NULL) return false;
    const existing = Sidechains.findOne({ sidechain_id: sidechainId });
    return !existing;
  },

  /**
   * Get the next available kingdom sidechain ID in a range.
   *
   * @param {number} [min] — Minimum ID (default SIDECHAIN_ID_KINGDOM_MIN)
   * @param {number} [max] — Maximum ID (default SIDECHAIN_ID_KINGDOM_MAX)
   * @returns {number|null} Next available ID, or null if full
   */
  getNextAvailableId(min = SIDECHAIN_ID_KINGDOM_MIN, max = SIDECHAIN_ID_KINGDOM_MAX) {
    const used = Sidechains.find(
      { sidechain_id: { $gte: min, $lte: max } },
      { sort: { sidechain_id: 1 }, fields: { sidechain_id: true } }
    ).fetch().map(doc => doc.sidechain_id);

    if (used.length === 0) return min;

    // Find first gap in the sequence
    let candidate = min;
    for (const id of used) {
      if (candidate < id) return candidate;
      candidate = id + 1;
    }

    if (candidate <= max) return candidate;
    return null; // Range exhausted
  },

  // ========================================================================
  // SIDECHAIN LIFECYCLE (SPEC-212 §9)
  // ========================================================================

  /**
   * Activate a sidechain after genesis block is produced.
   * Per SPEC-212 §9.1: genesis block contains kingdom genesis CID and
   * sidechain configuration document CID.
   *
   * @param {number} sidechainId
   * @param {Object} genesisData
   * @param {number} genesisData.genesisBlock — First sidechain block height
   * @param {string} genesisData.genesisBlockHash — Genesis block hash
   * @param {string} genesisData.configDocumentCid — Config document IPFS CID
   * @returns {Promise<Object>}
   */
  async activateSidechain(sidechainId, genesisData = {}) {
    const sidechain = Sidechains.findOne({ sidechain_id: sidechainId });
    if (!sidechain) {
      return { success: false, error: `Sidechain ID ${sidechainId} not found` };
    }
    if (sidechain.state !== SIDECHAIN_STATE_PENDING) {
      return { success: false, error: `Sidechain ${sidechainId} is in state '${sidechain.state}', expected 'pending'` };
    }

    const now = new Date();

    Sidechains.update(
      { sidechain_id: sidechainId },
      {
        $set: {
          state: SIDECHAIN_STATE_ACTIVE,
          genesis_block: genesisData.genesisBlock || 0,
          last_block: genesisData.genesisBlock || 0,
          last_block_hash: genesisData.genesisBlockHash || null,
          config_document_cid: genesisData.configDocumentCid || null,
          health: 'healthy',
          updated_at: now,
        },
      }
    );

    KingdomSidechainState.update(
      { sidechain_id: sidechainId },
      {
        $set: {
          status: 'running',
          health: 'healthy',
          last_produced_sidechain: genesisData.genesisBlock || 0,
          updated_at: now,
        },
      }
    );

    DriveChainDaemonEmitter.onSidechainActivated(sidechainId, genesisData.genesisBlock);

    console.log(`[koad:io-drive-chain] SidechainManager: activated sidechain ID ${sidechainId} at genesis block ${genesisData.genesisBlock}`);

    return { success: true, sidechainId };
  },

  /**
   * Check sidechain health and detect frozen state (SPEC-212 §8.1).
   * If no blocks produced for >2× block_time, marks as frozen.
   *
   * @param {number} sidechainId
   * @returns {Promise<Object>} Health assessment
   */
  async checkHealth(sidechainId) {
    const sidechain = Sidechains.findOne({ sidechain_id: sidechainId });
    if (!sidechain) {
      return { success: false, error: `Sidechain ID ${sidechainId} not found` };
    }

    if (sidechain.state !== SIDECHAIN_STATE_ACTIVE) {
      return { healthy: false, state: sidechain.state, reason: `Sidechain is in state '${sidechain.state}'` };
    }

    // Get last BMM commitment from Rust bridge
    let bridgeConnected = false;
    try {
      bridgeConnected = RustBridge.isConnected();
    } catch (err) {
      // Bridge may not be initialized
    }

    // SPEC-212 §8.1: check if producer has been silent >2× block_time
    const now = new Date();
    const lastBlockTime = sidechain.updated_at || sidechain.created_at;
    const elapsedMs = now.getTime() - lastBlockTime.getTime();
    const blockTimeMs = (sidechain.block_time_seconds || SIDECHAIN_BLOCK_TIME_DEFAULT) * 1000;
    const frozenThresholdMs = blockTimeMs * SIDECHAIN_FROZEN_AFTER_BLOCKS_MISSED;

    let healthy = elapsedMs <= frozenThresholdMs;
    let healthStatus = healthy ? 'healthy' : 'degraded';

    // Update health in collection
    Sidechains.update(
      { sidechain_id: sidechainId },
      {
        $set: {
          health: healthStatus,
          last_health_check: now,
          updated_at: now,
        },
      }
    );

    if (!healthy) {
      // SPEC-212 §8.1: mark as frozen if silent for too long
      if (elapsedMs >= frozenThresholdMs * 3) {
        Sidechains.update(
          { sidechain_id: sidechainId },
          { $set: { state: SIDECHAIN_STATE_FROZEN, updated_at: now } }
        );
        healthStatus = 'down';
        DriveChainDaemonEmitter.onSidechainFrozen(sidechainId, `No blocks for >${Math.round(elapsedMs / 60000)} minutes`);

        console.warn(`[koad:io-drive-chain] SidechainManager: sidechain ${sidechainId} marked as frozen (silent for ${Math.round(elapsedMs / 1000)}s)`);

        // SPEC-212 §8.1 path 1: trigger withdrawal-only mode if configured
        // (stub — actual withdrawal-only mode requires emergency key config)
      }
    }

    return {
      healthy,
      state: sidechain.state,
      health: healthStatus,
      elapsedMs,
      blockTimeMs,
      bridgeConnected,
      lastBlockTime,
    };
  },

  /**
   * Begin block production for an active sidechain.
   * Sets up the interval to produce blocks at the configured cadence.
   *
   * @param {number} sidechainId
   * @returns {Promise<Object>}
   */
  async startProduction(sidechainId) {
    const sidechain = Sidechains.findOne({ sidechain_id: sidechainId });
    if (!sidechain) {
      return { success: false, error: `Sidechain ID ${sidechainId} not found` };
    }
    if (sidechain.state !== SIDECHAIN_STATE_ACTIVE) {
      return { success: false, error: `Cannot start production: sidechain ${sidechainId} is in state '${sidechain.state}'` };
    }

    if (this._productionInterval) {
      clearInterval(this._productionInterval);
    }

    const blockTimeMs = (sidechain.block_time_seconds || SIDECHAIN_BLOCK_TIME_DEFAULT) * 1000;

    this._productionInterval = setInterval(async () => {
      await this._produceNextBlock(sidechainId);
    }, blockTimeMs);

    // Also start BMM commitment interval (every block by default)
    if (this._stateCommitInterval) {
      clearInterval(this._stateCommitInterval);
    }
    this._stateCommitInterval = setInterval(async () => {
      await this._commitKingdomState(sidechainId);
    }, blockTimeMs);

    KingdomSidechainState.update(
      { sidechain_id: sidechainId },
      { $set: { status: 'running' } }
    );

    console.log(`[koad:io-drive-chain] SidechainManager: started block production for sidechain ${sidechainId} (${blockTimeMs}ms interval)`);

    return { success: true, sidechainId, blockTimeMs };
  },

  /**
   * Produce the next sidechain block.
   * @private
   * @param {number} sidechainId
   */
  async _produceNextBlock(sidechainId) {
    const sidechain = Sidechains.findOne({ sidechain_id: sidechainId });
    if (!sidechain) return;

    try {
      let blockHash = null;
      let blockHeight = sidechain.last_block + 1;

      if (RustBridge.isConnected()) {
        // Delegate to Rust bridge (SPEC-212 §4.1 block production flow)
        const result = await RustBridge.produceBlock({
          sidechainId,
          producerPubkey: sidechain.block_producer,
          transactions: [],  // Collect from mempool in real implementation
          previousBlockHash: sidechain.last_block_hash || '0'.repeat(64),
          timestamp: Math.floor(Date.now() / 1000),
        });

        if (result.success) {
          blockHash = result.blockHash;
          blockHeight = result.blockHeight || blockHeight;
        }
      } else {
        // STUB: Generate local block hash (no Rust service)
        const crypto = require('crypto');
        blockHash = crypto.createHash('sha256')
          .update(`stub:${sidechainId}:${blockHeight}:${sidechain.last_block_hash || ''}`)
          .digest('hex');
      }

      if (blockHash) {
        const now = new Date();

        Sidechains.update(
          { sidechain_id: sidechainId },
          {
            $set: {
              last_block: blockHeight,
              last_block_hash: blockHash,
              updated_at: now,
            },
            $inc: { blocks_produced: 1 },
          }
        );

        KingdomSidechainState.update(
          { sidechain_id: sidechainId },
          {
            $set: { last_produced_sidechain: blockHeight, updated_at: now },
            $inc: { blocks_produced: 1 },
          }
        );

        // BMM commit (SPEC-212 §4.1 step 3: submit block hash to CDN mainchain)
        await this._bmmCommit(sidechainId, blockHash, blockHeight);
      }
    } catch (err) {
      console.error(`[koad:io-drive-chain] SidechainManager._produceNextBlock: ${err.message}`);
      KingdomSidechainState.update(
        { sidechain_id: sidechainId },
        { $inc: { errors_encountered: 1 } }
      );
    }
  },

  /**
   * Commit sidechain block hash to CDN mainchain via BIP 301 BMM.
   * @private
   * @param {number} sidechainId
   * @param {string} blockHash
   * @param {number} blockHeight
   */
  async _bmmCommit(sidechainId, blockHash, blockHeight) {
    try {
      const result = await BMMProcessor.commitBlockHash({
        sidechainId,
        sidechainBlockHash: blockHash,
        sidechainBlockHeight: blockHeight,
      });

      if (result.success) {
        KingdomSidechainState.update(
          { sidechain_id: sidechainId },
          {
            $inc: { bmm_commitments: 1 },
            $set: { last_bmm_height: result.mainchainBlock || 0 },
          }
        );

        Sidechains.update(
          { sidechain_id: sidechainId },
          { $set: { last_mainchain_bmm_height: result.mainchainBlock || 0 } }
        );

        DriveChainDaemonEmitter.onBMMCommitted(sidechainId, blockHash, blockHeight, result.bmmTxid);
      }
    } catch (err) {
      console.warn(`[koad:io-drive-chain] SidechainManager._bmmCommit: ${err.message}`);
    }
  },

  /**
   * Commit kingdom state to the sidechain (SPEC-212 §3.4).
   * @private
   * @param {number} sidechainId
   */
  async _commitKingdomState(sidechainId) {
    // SPEC-212 §3.4 commitment flow:
    // 1. Entity sigchain tips → OP_RETURN tag 0x19 (sigchain tip bundle)
    // 2. Trust bond attestations → OP_RETURN tag 0x18
    // 3. Kingdom merkle root → OP_RETURN (merkle root commitment)
    // 4. Score snapshots → OP_RETURN tag 0x14 (if due)
    //
    // STUB: Real implementation will collect pending commitments from the
    // kingdom's sigchain discovery and scoring indexer.

    try {
      const sidechain = Sidechains.findOne({ sidechain_id: sidechainId });
      if (!sidechain) return;

      // STUB: In production, this method would:
      //   1. Query sigchain-discovery for pending entity sigchain tip updates
      //   2. Query the kingdom merkle tree for latest root (VESTA-SPEC-173)
      //   3. Query scoring indexer for latest score snapshot (SPEC-212 §3.2)
      //   4. Encode commitments as sidechain transactions
      //   5. Submit transactions to the sidechain mempool

      console.log(`[koad:io-drive-chain] SidechainManager._commitKingdomState (STUB): sidechainId=${sidechainId}`);

      // Update counters (stub — real counting when commitment logic is implemented)
      Sidechains.update(
        { sidechain_id: sidechainId },
        { $set: { updated_at: new Date() } }
      );
    } catch (err) {
      console.warn(`[koad:io-drive-chain] SidechainManager._commitKingdomState: ${err.message}`);
    }
  },

  /**
   * Initiate graceful sidechain termination (SPEC-212 §9.3).
   *
   * @param {number} sidechainId
   * @param {Object} [options]
   * @param {number} [options.withdrawalWindowBlocks] — Blocks for withdrawal window (default: 30 days in blocks)
   * @returns {Promise<Object>}
   */
  async terminateSidechain(sidechainId, options = {}) {
    const sidechain = Sidechains.findOne({ sidechain_id: sidechainId });
    if (!sidechain) {
      return { success: false, error: `Sidechain ID ${sidechainId} not found` };
    }

    if (sidechain.state === SIDECHAIN_STATE_TERMINATED) {
      return { success: false, error: `Sidechain ${sidechainId} is already terminated` };
    }

    // SPEC-212 §9.3 step 1: announce termination
    const terminationBlock = sidechain.last_block;
    const withdrawalWindowBlocks = options.withdrawalWindowBlocks ||
      CCT_INTERVENTION_GRACE_PERIOD_MAINNET;  // ~30 days

    const now = new Date();

    Sidechains.update(
      { sidechain_id: sidechainId },
      {
        $set: {
          state: SIDECHAIN_STATE_TERMINATING,
          termination_block: terminationBlock,
          withdrawal_window_blocks: withdrawalWindowBlocks,
          updated_at: now,
        },
      }
    );

    // Stop production
    this.stopProduction();

    // SPEC-212 §9.3 step 2: open withdrawal window
    // (stub — real implementation notifies all entities and prioritizes
    //  withdrawal processing. New deposits are rejected.)

    DriveChainDaemonEmitter.onSidechainTerminating(sidechainId, terminationBlock, withdrawalWindowBlocks);

    console.log(`[koad:io-drive-chain] SidechainManager: initiated termination for sidechain ${sidechainId}. Withdrawal window: ${withdrawalWindowBlocks} blocks`);

    return {
      success: true,
      sidechainId,
      terminationBlock,
      withdrawalWindowBlocks,
    };
  },

  /**
   * Stop block production.
   */
  stopProduction() {
    if (this._productionInterval) {
      clearInterval(this._productionInterval);
      this._productionInterval = null;
    }
    if (this._stateCommitInterval) {
      clearInterval(this._stateCommitInterval);
      this._stateCommitInterval = null;
    }
  },

  // ========================================================================
  // INITIALIZATION
  // ========================================================================

  /**
   * Initialize the SidechainManager.
   * Loads active sidechains from the collection and sets up health checks.
   *
   * @param {Object} [options]
   * @param {boolean} [options.autoStart] — If true, start production for active sidechains
   * @returns {Promise<Object>}
   */
  async init(options = {}) {
    if (this._active) {
      console.log('[koad:io-drive-chain] SidechainManager already initialized');
      return { active: true };
    }

    console.log('[koad:io-drive-chain] SidechainManager initializing...');

    // Initialize Rust bridge
    await RustBridge.init();

    // Load active sidechains
    const activeSidechains = Sidechains.find({ state: SIDECHAIN_STATE_ACTIVE }).fetch();
    console.log(`[koad:io-drive-chain] SidechainManager: found ${activeSidechains.length} active sidechains`);

    for (const sc of activeSidechains) {
      this._sidechains[sc.sidechain_id] = {
        config: sc,
        state: sc.state,
      };
    }

    // Start production for active sidechains if requested
    if (options.autoStart !== false) {
      for (const sc of activeSidechains) {
        await this.startProduction(sc.sidechain_id);
      }
    }

    this._active = true;

    console.log('[koad:io-drive-chain] SidechainManager initialized');

    return {
      active: true,
      sidechainCount: activeSidechains.length,
    };
  },

  /**
   * Shut down the SidechainManager.
   */
  shutdown() {
    this.stopProduction();

    if (RustBridge.stopHealthCheck) {
      RustBridge.stopHealthCheck();
    }

    this._active = false;
    this._sidechains = {};
    console.log('[koad:io-drive-chain] SidechainManager shut down');
  },
};
