/**
 * koad:io-drive-chain — Withdrawal Bundle Manager (Stub)
 *
 * VESTA-SPEC-212 §6.2: Manages the withdrawal bundle lifecycle — collecting
 * withdrawal requests from sidechain members, aggregating them into BIP 300
 * withdrawal bundles, submitting bundles to the CDN mainchain, and tracking
 * the fail period until execution.
 *
 * This module wires to the Rust drivechain service via rust-bridge.js for
 * the actual mainchain submission and fail period monitoring. Until the Rust
 * service exists, all operations are stubs.
 *
 * Withdrawal flow (SPEC-212 §6.2):
 *   1. Member requests withdrawal (sidechain tx → withdrawal output)
 *   2. Manager aggregates into BIP 300 withdrawal bundle
 *   3. Bundle submitted to CDN mainchain — fail period begins
 *   4. Fail period expires (or challenged) → bundle executed (or rejected)
 *   5. Sidechain burns the withdrawn CDN
 *
 * Workscore tracking (SPEC-212 OQ-3, BIP 301):
 *   Tracks the workscore of each submitted bundle. The MIN_WORKSCORE_DEFAULT
 *   (131) is the BIP 301 default, flagged for CDN calibration in SPEC-212 OQ-3.
 *
 * Authority: VESTA-SPEC-212 §6.2
 * Cross-ref: Rooty assessment §5 (withdrawal period calculations per chain)
 */

'use strict';

const crypto = require('crypto');

WithdrawalManager = {
  name: 'WithdrawalManager',
  version: '0.0.1',

  _active: false,
  _bundleInterval: null,
  _failPeriodCheckInterval: null,

  /**
   * Initialize the withdrawal manager.
   *
   * @param {Object} [options]
   * @param {number} [options.bundleIntervalSidechain] — Sidechain blocks between bundles (default: 144)
   * @param {number} [options.failPeriodCheckIntervalMs] — Mainchain fail period check interval in ms
   * @returns {Promise<boolean>}
   */
  async init(options = {}) {
    this._bundleIntervalSidechain = options.bundleIntervalSidechain || WITHDRAWAL_BUNDLE_INTERVAL_DEFAULT;
    this._failPeriodCheckIntervalMs = options.failPeriodCheckIntervalMs || 60000;  // Every minute

    this._active = true;

    // Start fail period check loop
    this._failPeriodCheckInterval = setInterval(() => {
      this._checkFailPeriodExpiry();
    }, this._failPeriodCheckIntervalMs);

    console.log('[koad:io-drive-chain] WithdrawalManager initialized');
    return true;
  },

  // ========================================================================
  // WITHDRAWAL REQUESTS (SPEC-212 §6.2 step 1)
  // ========================================================================

  /**
   * Register a withdrawal request from a sidechain member.
   *
   * SPEC-212 §6.2 step 1: Member constructs a withdrawal request on the sidechain.
   * Transaction sends sidechain CDN to a withdrawal output with OP_RETURN
   * specifying the target CDN mainchain address.
   *
   * @param {Object} params
   * @param {number} params.sidechainId — Sidechain ID
   * @param {string} params.entityPubkeyHex — Entity Ed25519 pubkey
   * @param {string} params.sidechainAddress — Sidechain address burning from
   * @param {string} params.mainchainTargetAddress — CDN mainchain destination
   * @param {number} params.amountSatoshi — Amount to withdraw (must be >= MINIMUM_WITHDRAWAL_SATOSHI)
   * @param {string} params.sidechainTxid — Sidechain txid of withdrawal request
   * @param {number} params.sidechainBlock — Sidechain block where request was included
   * @returns {Promise<Object>}
   */
  async requestWithdrawal(params = {}) {
    const { sidechainId, entityPubkeyHex, sidechainAddress, mainchainTargetAddress, amountSatoshi, sidechainTxid, sidechainBlock } = params;

    // Validation
    if (!sidechainId) return { success: false, error: 'sidechainId is required' };
    if (!entityPubkeyHex) return { success: false, error: 'entityPubkeyHex is required' };
    if (!mainchainTargetAddress) return { success: false, error: 'mainchainTargetAddress is required' };
    if (!amountSatoshi || amountSatoshi < MINIMUM_WITHDRAWAL_SATOSHI) {
      return { success: false, error: `amountSatoshi must be >= ${MINIMUM_WITHDRAWAL_SATOSHI}` };
    }
    if (!sidechainTxid) return { success: false, error: 'sidechainTxid is required' };

    // Verify sidechain exists and is active
    const sidechain = Sidechains.findOne({ sidechain_id: sidechainId });
    if (!sidechain) return { success: false, error: `Sidechain ${sidechainId} not found` };
    if (sidechain.state !== SIDECHAIN_STATE_ACTIVE) {
      return { success: false, error: `Sidechain ${sidechainId} is in state '${sidechain.state}', withdrawals only accepted on active sidechains` };
    }

    // Check for existing request (idempotency by sidechain txid)
    const existing = SidechainWithdrawals.findOne({
      type: 'request',
      sidechain_txid: sidechainTxid,
    });
    if (existing) {
      return { success: true, withdrawalId: existing._id, note: 'already registered' };
    }

    // SPEC-212 §6.4: Withdrawal authorization check
    // If withdrawal target address doesn't match derived address, may need
    // additional authorization (dual-signature or sigchain entry).
    // STUB: This check is deferred.

    const now = new Date();

    // Resolve entity handle from sigchain-discovery (STUB)
    const entityHandle = entityPubkeyHex ? entityPubkeyHex.substring(0, 8) + '...' : 'unknown';

    const docId = SidechainWithdrawals.insert({
      type: 'request',
      sidechain_id: sidechainId,
      entity_pubkey_hex: entityPubkeyHex,
      entity_handle: entityHandle,
      sidechain_address: sidechainAddress,
      mainchain_target_address: mainchainTargetAddress,
      amount_satoshi: amountSatoshi,
      sidechain_txid: sidechainTxid,
      sidechain_block: sidechainBlock || 0,
      bundle_id: null,
      status: 'pending',
      created_at: now,
    });

    console.log(`[koad:io-drive-chain] WithdrawalManager: registered withdrawal request for ${amountSatoshi} CDN satoshi (sidechain ${sidechainId})`);

    return {
      success: true,
      withdrawalId: docId,
      sidechainId,
      amountSatoshi,
    };
  },

  // ========================================================================
  // WITHDRAWAL BUNDLE AGGREGATION (SPEC-212 §6.2 step 2)
  // ========================================================================

  /**
   * Aggregate pending withdrawal requests into a withdrawal bundle.
   *
   * SPEC-212 §6.2 step 2: Bundle contains all withdrawal requests from the
   * current period. Bundle is signed by the sidechain operator's withdrawal key.
   *
   * @param {number} sidechainId
   * @returns {Promise<Object>} Created bundle
   */
  async createBundle(sidechainId) {
    // Collect pending withdrawal requests
    const pendingRequests = SidechainWithdrawals.find({
      type: 'request',
      sidechain_id: sidechainId,
      status: 'pending',
    }).fetch();

    if (pendingRequests.length === 0) {
      return { success: true, note: 'no pending withdrawals to bundle' };
    }

    // Validate all requests have sufficient balance (STUB: balance check deferred)

    // Build bundle CID (SPEC-212 §6.2: bundle CID identifies the withdrawal bundle)
    const bundleEntries = pendingRequests.map((req, idx) => ({
      index: idx,
      mainchain_address: req.mainchain_target_address,
      amount_satoshi: req.amount_satoshi,
      sidechain_txid: req.sidechain_txid,
      sidechain_proof: null,  // STUB: merkle proof from sidechain block
    }));

    const bundleJson = JSON.stringify({
      sidechain_id: sidechainId,
      created_at: new Date().toISOString(),
      requests: bundleEntries,
      total_amount_satoshi: bundleEntries.reduce((sum, e) => sum + e.amount_satoshi, 0),
      version: 1,
    });

    // Bundle CID is the SHA256 hash of the bundle JSON
    const bundleCid = crypto.createHash('sha256').update(bundleJson).digest('hex');
    const totalAmount = bundleEntries.reduce((sum, e) => sum + e.amount_satoshi, 0);

    const now = new Date();

    // Insert bundle document
    const bundleId = SidechainWithdrawals.insert({
      type: 'bundle',
      sidechain_id: sidechainId,
      bundle_cid: bundleCid,
      request_count: pendingRequests.length,
      total_amount_satoshi: totalAmount,
      mainchain_txid: null,
      mainchain_block: null,
      workscore: null,
      fail_period_start: null,
      fail_period_end: null,
      fail_period_blocks: null,
      challenged: false,
      status: 'pending',  // pending → submitted → in_fail_period → executed | failed
      submitted_at: null,
      executed_at: null,
      created_by: 'withdrawal-manager',
      created_at: now,
    });

    // Link requests to bundle
    for (const req of pendingRequests) {
      SidechainWithdrawals.update(
        { _id: req._id },
        {
          $set: {
            bundle_id: bundleId,
            status: 'bundled',
            bundled_at: now,
          },
        }
      );
    }

    console.log(`[koad:io-drive-chain] WithdrawalManager: created bundle for sidechain ${sidechainId}: ${pendingRequests.length} requests, ${totalAmount} total CDN satoshi`);

    return {
      success: true,
      bundleId,
      bundleCid,
      requestCount: pendingRequests.length,
      totalAmountSatoshi: totalAmount,
    };
  },

  // ========================================================================
  // WITHDRAWAL BUNDLE SUBMISSION (SPEC-212 §6.2 step 3)
  // ========================================================================

  /**
   * Submit a withdrawal bundle to the CDN mainchain.
   *
   * SPEC-212 §6.2 step 3: Bundle is submitted to CDN mainchain via BIP 300
   * transaction. Fail period begins (default: 144 CDN blocks on mainnet,
   * 20 blocks on testnet).
   *
   * @param {string} bundleId
   * @returns {Promise<Object>}
   */
  async submitBundle(bundleId) {
    const bundle = SidechainWithdrawals.findOne({ _id: bundleId, type: 'bundle' });
    if (!bundle) {
      return { success: false, error: `Bundle ${bundleId} not found` };
    }
    if (bundle.status !== 'pending') {
      return { success: false, error: `Bundle is in status '${bundle.status}', expected 'pending'` };
    }

    // Get sidechain config for withdrawal period
    const sidechain = Sidechains.findOne({ sidechain_id: bundle.sidechain_id });
    const failPeriodBlocks = sidechain?.withdrawal_period_blocks || MAINCHAIN_WITHDRAWAL_PERIOD_BLOCKS_DEFAULT;

    let result;
    if (RustBridge.isConnected()) {
      result = await RustBridge.submitWithdrawalBundle({
        sidechainId: bundle.sidechain_id,
        bundleCid: bundle.bundle_cid,
        withdrawalRequests: this._getBundleRequests(bundleId),
        workscoreTarget: sidechain?.min_workscore || MIN_WORKSCORE_DEFAULT,
      });
    } else {
      // STUB: Simulate successful submission
      console.log(`[koad:io-drive-chain] WithdrawalManager.submitBundle (STUB): simulating bundle submission`);

      await new Promise(resolve => setTimeout(resolve, 50));

      const mockTxid = crypto.createHash('sha256')
        .update(`bundle:${bundleId}:${Date.now()}`)
        .digest('hex');

      result = {
        success: true,
        mainchainTxid: mockTxid,
        mainchainBlock: 0,
        failPeriodStart: 0,
        failPeriodEnd: failPeriodBlocks,
        workscore: sidechain?.min_workscore || MIN_WORKSCORE_DEFAULT,
        _stub: true,
      };
    }

    if (result.success) {
      const now = new Date();
      const failPeriodEnd = now.getTime() + (failPeriodBlocks * CDN_MAINNET_BLOCK_TIME * 1000);

      SidechainWithdrawals.update(
        { _id: bundleId },
        {
          $set: {
            status: 'in_fail_period',
            mainchain_txid: result.mainchainTxid,
            mainchain_block: result.mainchainBlock || 0,
            workscore: result.workscore,
            fail_period_start: result.failPeriodStart || 0,
            fail_period_end: result.failPeriodEnd || 0,
            fail_period_blocks: failPeriodBlocks,
            submitted_at: now,
          },
        }
      );

      KingdomSidechainState.update(
        { sidechain_id: bundle.sidechain_id },
        {
          $inc: { withdrawals_processed: 1 },
          $set: { updated_at: now },
        }
      );

      DriveChainDaemonEmitter.onWithdrawalSubmitted(
        bundle.sidechain_id,
        bundleId,
        result.mainchainTxid,
        bundle.total_amount_satoshi
      );

      console.log(`[koad:io-drive-chain] WithdrawalManager: submitted bundle ${bundleId} to CDN mainchain (txid: ${result.mainchainTxid.substring(0, 16)}...)`);
    } else {
      SidechainWithdrawals.update(
        { _id: bundleId },
        { $set: { status: 'failed' } }
      );

      console.error(`[koad:io-drive-chain] WithdrawalManager: bundle submission failed for ${bundleId}`);
    }

    return {
      success: result.success,
      bundleId,
      mainchainTxid: result.mainchainTxid,
      failPeriodBlocks,
      workscore: result.workscore,
    };
  },

  /**
   * Get withdrawal requests associated with a bundle.
   * @private
   * @param {string} bundleId
   * @returns {Object[]}
   */
  _getBundleRequests(bundleId) {
    return SidechainWithdrawals.find({
      type: 'request',
      bundle_id: bundleId,
    }).fetch().map(req => ({
      index: 0,
      mainchain_address: req.mainchain_target_address,
      amount_satoshi: req.amount_satoshi,
      sidechain_txid: req.sidechain_txid,
      sidechain_proof: null,
    }));
  },

  // ========================================================================
  // FAIL PERIOD MONITORING (SPEC-212 §6.2 step 4)
  // ========================================================================

  /**
   * Check for expired fail periods and execute bundles.
   * @private
   */
  async _checkFailPeriodExpiry() {
    const inFailPeriod = SidechainWithdrawals.find({
      type: 'bundle',
      status: 'in_fail_period',
    }).fetch();

    for (const bundle of inFailPeriod) {
      let status;
      if (RustBridge.isConnected()) {
        const result = await RustBridge.withdrawalStatus(bundle.mainchain_txid);
        status = result.status;
      } else {
        // STUB: Assume all bundles eventually succeed
        status = 'executed';
      }

      if (status === 'executed') {
        await this._executeBundle(bundle);
      } else if (status === 'challenged') {
        await this._handleChallengedBundle(bundle);
      } else if (status === 'failed') {
        await this._handleFailedBundle(bundle);
      }
    }
  },

  /**
   * Execute a withdrawal bundle after successful fail period.
   *
   * SPEC-212 §6.2 step 4:
   * - If no challenge: operator executes the withdrawal (CDN mainchain UTXOs created)
   * - Sidechain burns the withdrawn CDN
   *
   * @private
   * @param {Object} bundle — Bundle document
   */
  async _executeBundle(bundle) {
    console.log(`[koad:io-drive-chain] WithdrawalManager: executing bundle ${bundle._id}`);

    const now = new Date();

    // SPEC-212 §6.2 step 5: Burn the withdrawn CDN on the sidechain
    // Mark all withdrawal requests in this bundle as executed
    SidechainWithdrawals.update(
      { type: 'request', bundle_id: bundle._id },
      {
        $set: {
          status: 'executed',
          executed_at: now,
        },
      },
      { multi: true }
    );

    // Mark bundle as executed
    SidechainWithdrawals.update(
      { _id: bundle._id },
      {
        $set: {
          status: 'executed',
          executed_at: now,
        },
      }
    );

    DriveChainDaemonEmitter.onWithdrawalExecuted(
      bundle.sidechain_id,
      bundle._id,
      bundle.total_amount_satoshi
    );

    console.log(`[koad:io-drive-chain] WithdrawalManager: bundle ${bundle._id} executed, ${bundle.total_amount_satoshi} CDN burned`);
  },

  /**
   * Handle a challenged withdrawal bundle.
   *
   * SPEC-212 §6.2 step 4 (if challenged):
   * - Withdrawal bundle is rejected
   * - Challenged withdrawals are retried individually
   * - Operator posts bond to resolve
   *
   * @private
   * @param {Object} bundle — Bundle document
   */
  async _handleChallengedBundle(bundle) {
    console.warn(`[koad:io-drive-chain] WithdrawalManager: bundle ${bundle._id} was challenged on mainchain`);

    const now = new Date();

    // Mark bundle as challenged
    SidechainWithdrawals.update(
      { _id: bundle._id },
      {
        $set: {
          status: 'challenged',
          challenged: true,
          updated_at: now,
        },
      }
    );

    // Return individual requests to pending for retry
    SidechainWithdrawals.update(
      { type: 'request', bundle_id: bundle._id },
      {
        $set: {
          status: 'retrying',
          bundle_id: null,
          updated_at: now,
        },
      },
      { multi: true }
    );

    DriveChainDaemonEmitter.onWithdrawalChallenged(bundle.sidechain_id, bundle._id);
  },

  /**
   * Handle a failed withdrawal bundle.
   *
   * SPEC-212 §8.3: If the operator consistently fails to execute withdrawals,
   * this is grounds for sovereign intervention or CCT intervention.
   *
   * @private
   * @param {Object} bundle — Bundle document
   */
  async _handleFailedBundle(bundle) {
    console.error(`[koad:io-drive-chain] WithdrawalManager: bundle ${bundle._id} failed`);

    const now = new Date();

    SidechainWithdrawals.update(
      { _id: bundle._id },
      {
        $set: {
          status: 'failed',
          failure_reason: 'Withdrawal bundle not executed on mainchain after fail period',
          updated_at: now,
        },
      }
    );

    // Return individual requests to pending for retry (SPEC-212 §8.3 recovery)
    SidechainWithdrawals.update(
      { type: 'request', bundle_id: bundle._id },
      {
        $set: {
          status: 'pending',
          bundle_id: null,
          updated_at: now,
        },
      }
    );

    DriveChainDaemonEmitter.onWithdrawalFailed(bundle.sidechain_id, bundle._id);

    // SPEC-212 §8.3 recovery path 2: if >3 consecutive failures, escalate
    const recentFailures = SidechainWithdrawals.find({
      type: 'bundle',
      sidechain_id: bundle.sidechain_id,
      status: 'failed',
      submitted_at: { $gte: new Date(Date.now() - 86400000) },  // Last 24 hours
    }).count();

    if (recentFailures >= 3) {
      console.warn(`[koad:io-drive-chain] WithdrawalManager: ${recentFailures} recent bundle failures for sidechain ${bundle.sidechain_id} — escalation recommended (SPEC-212 §8.3)`);
    }
  },

  /**
   * Shut down the withdrawal manager.
   */
  shutdown() {
    if (this._failPeriodCheckInterval) {
      clearInterval(this._failPeriodCheckInterval);
      this._failPeriodCheckInterval = null;
    }
    if (this._bundleInterval) {
      clearInterval(this._bundleInterval);
      this._bundleInterval = null;
    }
    this._active = false;
    console.log('[koad:io-drive-chain] WithdrawalManager shut down');
  },
};
