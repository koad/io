/**
 * koad:io-drive-chain — CDN Mainchain Deposit Watcher (Stub)
 *
 * VESTA-SPEC-212 §6.1: Watches the CDN mainchain for BIP 300 deposit transactions
 * targeting registered kingdom sidechains. When a deposit is detected, credits the
 * depositor with equivalent sidechain CDN.
 *
 * This module wires to the Rust drivechain service via rust-bridge.js for the
 * actual CDN mainchain monitoring. Until the Rust service exists, all operations
 * are stubs.
 *
 * Deposit flow (SPEC-212 §6.1):
 *   1. Member constructs BIP 300 deposit transaction on CDN mainchain
 *   2. DepositWatcher monitors CDN for outputs to BIP 300 hashrate escrow address
 *   3. On detection, verifies: target sidechain ID match, >= 6 confirmations, non-zero amount
 *   4. Sidechain issues equivalent CDN UTXO to depositor's derived sidechain address
 *   5. Deposit event logged in SidechainDeposits collection
 *
 * Authority: VESTA-SPEC-212 §6.1
 * Cross-ref: ROOTY-SPEC-008 §3 (CDN electrum integration for mainchain monitoring)
 */

'use strict';

DepositWatcher = {
  name: 'DepositWatcher',
  version: '0.0.1',

  _active: false,
  _watchInterval: null,
  _watchedSidechains: [],  // [sidechainId, ...]

  /**
   * Initialize the deposit watcher.
   *
   * @param {Object} [options]
   * @param {number} [options.pollIntervalMs] — CDN poll interval in ms (default: 30000 — matches CDN block time)
   * @param {number} [options.requiredConfirmations] — Confirmations before crediting (default: 6, SPEC-212 §6.1)
   * @returns {Promise<boolean>}
   */
  async init(options = {}) {
    this._pollIntervalMs = options.pollIntervalMs || (CDN_MAINNET_BLOCK_TIME * 1000);  // Every CDN block
    this._requiredConfirmations = options.requiredConfirmations || DEPOSIT_CONFIRMATIONS_REQUIRED;

    // Load active sidechains to watch
    this._watchedSidechains = Sidechains.find({
      state: { $in: [SIDECHAIN_STATE_ACTIVE, SIDECHAIN_STATE_PENDING] },
    }).fetch().map(sc => sc.sidechain_id);

    console.log(`[koad:io-drive-chain] DepositWatcher: watching ${this._watchedSidechains.length} sidechains for deposits`);

    this._active = true;

    // Start polling loop
    this._watchInterval = setInterval(() => {
      this._pollForDeposits();
    }, this._pollIntervalMs);

    // Immediate first poll
    await this._pollForDeposits();

    console.log('[koad:io-drive-chain] DepositWatcher initialized');
    return true;
  },

  /**
   * Poll the Rust bridge for new deposits on all watched sidechains.
   * @private
   */
  async _pollForDeposits() {
    if (!this._active) return;

    for (const sidechainId of this._watchedSidechains) {
      try {
        if (RustBridge.isConnected()) {
          // Query Rust service for deposits
          const result = await RustBridge.watchDeposits({
            sidechainId,
            fromBlock: this._getWatchFromBlock(sidechainId),
          });

          if (result.deposits && result.deposits.length > 0) {
            for (const deposit of result.deposits) {
              await this._processDetectedDeposit(sidechainId, deposit);
            }
          }
        } else {
          // STUB: Check for mock deposits via electrum (not implemented yet)
          // In production, this would use ecoincore:electrum to monitor
          // the CDN mainchain for BIP 300 deposit outputs.
        }
      } catch (err) {
        console.warn(`[koad:io-drive-chain] DepositWatcher: poll error for sidechain ${sidechainId}: ${err.message}`);
      }
    }
  },

  /**
   * Get the block height to watch from for a sidechain.
   * @private
   * @param {number} sidechainId
   * @returns {number}
   */
  _getWatchFromBlock(sidechainId) {
    const state = KingdomSidechainState.findOne({ sidechain_id: sidechainId });
    return state?.deposit_watch_from_block || state?.last_indexed_mainchain || 0;
  },

  /**
   * Process a detected deposit event.
   *
   * Per SPEC-212 §6.1 step 2:
   *   - Verify target sidechain ID matches
   *   - Verify >= DEPOSIT_CONFIRMATIONS_REQUIRED confirmations
   *   - Verify amount is non-zero
   *
   * @private
   * @param {number} sidechainId — Target sidechain ID
   * @param {Object} deposit — Deposit event from Rust service
   */
  async _processDetectedDeposit(sidechainId, deposit) {
    // SPEC-212 §6.1 step 2: verification
    if (deposit.amount_satoshi < MINIMUM_DEPOSIT_SATOSHI) {
      console.log(`[koad:io-drive-chain] DepositWatcher: skipping deposit below minimum (${deposit.amount_satoshi} < ${MINIMUM_DEPOSIT_SATOSHI})`);
      return;
    }

    if (deposit.confirmations < this._requiredConfirmations) {
      console.log(`[koad:io-drive-chain] DepositWatcher: deposit ${deposit.mainchain_txid.substring(0, 16)}... has only ${deposit.confirmations} confirmations (need ${this._requiredConfirmations})`);
      // Hold for confirmation — will be picked up on next poll
      return;
    }

    // Check if already processed (idempotency)
    const existing = SidechainDeposits.findOne({ mainchain_txid: deposit.mainchain_txid });
    if (existing) {
      return;  // Already processed
    }

    // SPEC-212 §6.1 step 3: issue sidechain CDN
    // Derive sidechain address from depositor's mainchain address (SPEC-212 §6.3)
    const sidechainAddress = this._deriveSidechainAddress(deposit.depositor_address, sidechainId);

    // STUB: Create sidechain credit transaction
    // In production, this would call RustBridge to create a sidechain UTXO
    // crediting the depositor's derived sidechain address.

    const now = new Date();

    SidechainDeposits.insert({
      sidechain_id: sidechainId,
      mainchain_txid: deposit.mainchain_txid,
      mainchain_block: deposit.mainchain_block,
      mainchain_confirmations: deposit.confirmations,
      deposit_address: deposit.deposit_address,
      deposit_amount_satoshi: deposit.amount_satoshi,
      sidechain_address: sidechainAddress,
      sidechain_txid: null,  // STUB: No sidechain credit tx yet
      sidechain_block: null,
      entity_pubkey_hex: null,  // Would be resolved from sigchain-discovery
      status: deposit.confirmations >= this._requiredConfirmations ? 'credited' : 'pending',
      created_at: now,
      credited_at: now,
      processed_by: 'deposit-watcher',
    });

    // Update state counters
    KingdomSidechainState.update(
      { sidechain_id: sidechainId },
      {
        $inc: { deposits_processed: 1 },
        $set: {
          last_deposit_check: deposit.mainchain_block,
          updated_at: now,
        },
      }
    );

    DriveChainDaemonEmitter.onDepositDetected(
      sidechainId,
      deposit.mainchain_txid,
      deposit.amount_satoshi,
      sidechainAddress
    );

    console.log(`[koad:io-drive-chain] DepositWatcher: processed deposit of ${deposit.amount_satoshi} satoshi to sidechain ${sidechainId}`);
  },

  /**
   * Derive a sidechain address from a mainchain address.
   *
   * SPEC-212 §6.3: Sidechain addresses are deterministically derived from
   * entity Ed25519 signing keys via HKDF-SHA256 + BIP39 + BIP44.
   *
   * STUB: Returns a placeholder address. Real implementation requires
   * entity key resolution from the mainchain address.
   *
   * @private
   * @param {string} mainchainAddress — CDN mainchain address
   * @param {number} sidechainId — Target sidechain ID
   * @returns {string} Sidechain address (stub)
   */
  _deriveSidechainAddress(mainchainAddress, sidechainId) {
    // STUB: Real derivation would:
    //   1. Look up entity Ed25519 pubkey from mainchain address via sigchain-discovery
    //   2. Run HKDF-SHA256 with salt = kingdom_slug + ":" + sidechainId,
    //      info = SIDECHAIN_ADDRESS_DERIVATION_INFO
    //   3. Convert to BIP39 mnemonic → BIP44 m/44'/34'/sidechain_id'/0/0
    //
    // For now, return a deterministic placeholder based on the mainchain address.
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256')
      .update(`sidechain:${sidechainId}:${mainchainAddress}`)
      .digest('hex');

    return `sc${sidechainId.toString(16).padStart(4, '0')}${hash.substring(0, 36)}`;  // Bech32-style placeholder
  },

  /**
   * Add a sidechain to the watch list.
   *
   * @param {number} sidechainId
   */
  watchSidechain(sidechainId) {
    if (!this._watchedSidechains.includes(sidechainId)) {
      this._watchedSidechains.push(sidechainId);
      console.log(`[koad:io-drive-chain] DepositWatcher: now watching sidechain ${sidechainId}`);
    }
  },

  /**
   * Remove a sidechain from the watch list.
   *
   * @param {number} sidechainId
   */
  unwatchSidechain(sidechainId) {
    this._watchedSidechains = this._watchedSidechains.filter(id => id !== sidechainId);
    console.log(`[koad:io-drive-chain] DepositWatcher: stopped watching sidechain ${sidechainId}`);
  },

  /**
   * Shut down the deposit watcher.
   */
  shutdown() {
    if (this._watchInterval) {
      clearInterval(this._watchInterval);
      this._watchInterval = null;
    }
    this._active = false;
    this._watchedSidechains = [];
    console.log('[koad:io-drive-chain] DepositWatcher shut down');
  },
};
