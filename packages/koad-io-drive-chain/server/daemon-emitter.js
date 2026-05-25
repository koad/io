/**
 * koad:io-drive-chain — Daemon Emission Stream Integration
 *
 * VESTA-SPEC-212: Fires structured events to the kingdom daemon's emission
 * stream for storefront consumption, watcher registration, and cross-entity
 * awareness.
 *
 * Events:
 *   drivechain.sidechain_allocated     — Sidechain ID allocated
 *   drivechain.sidechain_activated     — Sidechain genesis complete, now active
 *   drivechain.sidechain_frozen        — Sidechain frozen (producer silent)
 *   drivechain.sidechain_terminating   — Sidechain termination initiated
 *   drivechain.bmm_committed           — BIP 301 BMM commitment submitted
 *   drivechain.deposit_detected        — Mainchain deposit detected and credited
 *   drivechain.withdrawal_submitted    — Withdrawal bundle submitted to mainchain
 *   drivechain.withdrawal_executed     — Withdrawal bundle executed
 *   drivechain.withdrawal_challenged   — Withdrawal bundle challenged
 *   drivechain.withdrawal_failed       - Withdrawal bundle failed
 *
 * Exported as DriveChainDaemonEmitter global.
 *
 * Authority: VESTA-SPEC-212
 * Cross-ref: KOAD_IO.md (emissions section), ~/.forge/KOAD_IO.md (typed events)
 */

'use strict';

DriveChainDaemonEmitter = {
  name: 'DriveChainDaemonEmitter',
  version: '0.0.1',

  _enabled: true,
  _emissionCount: 0,

  /**
   * Enable or disable emission firing.
   *
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
  },

  /**
   * Fire daemon emission if available.
   *
   * @param {string} type — Event type (noun.verb format)
   * @param {Object} payload — Event payload
   */
  _emit(type, payload) {
    if (!this._enabled) return;

    try {
      const daemonUrl = process.env.KOAD_IO_DAEMON || 'http://10.10.10.10:28282';

      if (typeof HTTP !== 'undefined') {
        HTTP.post(`${daemonUrl}/emit`, {
          data: {
            entity: 'rooty',
            type,
            body: typeof payload === 'object' ? JSON.stringify(payload) : String(payload),
            meta: {
              sessionId: process.env.HARNESS_SESSION_ID || 'drive-chain',
              timestamp: new Date().toISOString(),
              payload,
            },
          },
        }, (err) => {
          if (err) {
            console.warn(`[koad:io-drive-chain] DriveChainDaemonEmitter: failed to emit ${type}: ${err.message}`);
          }
        });
      } else {
        console.log(`[daemon-emitter] ${type}:`, JSON.stringify(payload));
      }

      this._emissionCount++;

      // Update state counter
      KingdomSidechainState?.update(
        { _id: { $regex: '^drivechain-state-' } },
        { $inc: { emitted_count: 1 } },
        { multi: true }
      ).catch(() => {});

    } catch (err) {
      console.warn(`[koad:io-drive-chain] DriveChainDaemonEmitter: emit error: ${err.message}`);
    }
  },

  // ========================================================================
  // SIDECHAIN LIFECYCLE EVENTS
  // ========================================================================

  /**
   * Fired when a sidechain ID is allocated (SPEC-212 §2).
   *
   * @param {number} sidechainId — Allocated sidechain ID
   * @param {string} kingdomHandle — Kingdom that owns the sidechain
   * @param {string} blockProducer — Initial block producer pubkey
   */
  onSidechainAllocated(sidechainId, kingdomHandle, blockProducer) {
    this._emit('drivechain.sidechain_allocated', {
      sidechainId,
      kingdomHandle,
      blockProducer,
    });
  },

  /**
   * Fired when a sidechain is activated after genesis (SPEC-212 §9.1).
   *
   * @param {number} sidechainId
   * @param {number} genesisBlock
   */
  onSidechainActivated(sidechainId, genesisBlock) {
    this._emit('drivechain.sidechain_activated', {
      sidechainId,
      genesisBlock,
    });
  },

  /**
   * Fired when a sidechain is marked as frozen (SPEC-212 §8.1).
   *
   * @param {number} sidechainId
   * @param {string} reason
   */
  onSidechainFrozen(sidechainId, reason) {
    this._emit('drivechain.sidechain_frozen', {
      sidechainId,
      reason,
    });
  },

  /**
   * Fired when sidechain termination is initiated (SPEC-212 §9.3).
   *
   * @param {number} sidechainId
   * @param {number} terminationBlock
   * @param {number} withdrawalWindowBlocks
   */
  onSidechainTerminating(sidechainId, terminationBlock, withdrawalWindowBlocks) {
    this._emit('drivechain.sidechain_terminating', {
      sidechainId,
      terminationBlock,
      withdrawalWindowBlocks,
    });
  },

  // ========================================================================
  // BMM EVENTS
  // ========================================================================

  /**
   * Fired when a BIP 301 BMM commitment is submitted (SPEC-212 §4.1).
   *
   * @param {number} sidechainId
   * @param {string} sidechainBlockHash
   * @param {number} sidechainBlockHeight
   * @param {string} bmmTxid — CDN txid of the BMM commitment
   */
  onBMMCommitted(sidechainId, sidechainBlockHash, sidechainBlockHeight, bmmTxid) {
    this._emit('drivechain.bmm_committed', {
      sidechainId,
      sidechainBlockHash,
      sidechainBlockHeight,
      bmmTxid,
    });
  },

  // ========================================================================
  // DEPOSIT EVENTS (SPEC-212 §6.1)
  // ========================================================================

  /**
   * Fired when a mainchain deposit is detected and credited.
   *
   * @param {number} sidechainId
   * @param {string} mainchainTxid
   * @param {number} amountSatoshi
   * @param {string} sidechainAddress
   */
  onDepositDetected(sidechainId, mainchainTxid, amountSatoshi, sidechainAddress) {
    this._emit('drivechain.deposit_detected', {
      sidechainId,
      mainchainTxid,
      amountSatoshi,
      sidechainAddress,
    });
  },

  // ========================================================================
  // WITHDRAWAL EVENTS (SPEC-212 §6.2)
  // ========================================================================

  /**
   * Fired when a withdrawal bundle is submitted to CDN mainchain.
   *
   * @param {number} sidechainId
   * @param {string} bundleId
   * @param {string} mainchainTxid
   * @param {number} totalAmountSatoshi
   */
  onWithdrawalSubmitted(sidechainId, bundleId, mainchainTxid, totalAmountSatoshi) {
    this._emit('drivechain.withdrawal_submitted', {
      sidechainId,
      bundleId,
      mainchainTxid,
      totalAmountSatoshi,
    });
  },

  /**
   * Fired when a withdrawal bundle is executed on mainchain.
   *
   * @param {number} sidechainId
   * @param {string} bundleId
   * @param {number} totalAmountSatoshi
   */
  onWithdrawalExecuted(sidechainId, bundleId, totalAmountSatoshi) {
    this._emit('drivechain.withdrawal_executed', {
      sidechainId,
      bundleId,
      totalAmountSatoshi,
    });
  },

  /**
   * Fired when a withdrawal bundle is challenged on mainchain.
   *
   * @param {number} sidechainId
   * @param {string} bundleId
   */
  onWithdrawalChallenged(sidechainId, bundleId) {
    this._emit('drivechain.withdrawal_challenged', {
      sidechainId,
      bundleId,
    });
  },

  /**
   * Fired when a withdrawal bundle fails on mainchain.
   *
   * @param {number} sidechainId
   * @param {string} bundleId
   */
  onWithdrawalFailed(sidechainId, bundleId) {
    this._emit('drivechain.withdrawal_failed', {
      sidechainId,
      bundleId,
    });
  },

  /**
   * Get emission count since start.
   *
   * @returns {number}
   */
  getCount() {
    return this._emissionCount;
  },
};
