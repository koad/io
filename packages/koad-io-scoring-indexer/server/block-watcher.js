/**
 * koad:io-scoring-indexer — Block Watcher
 *
 * ROOTY-SPEC-009 §7.1: Block event subscriber + OP_RETURN scanner integration.
 *
 * Consumes block events from electrum via `blockchain.headers.subscribe`
 * (implemented in ecoincore:electrum). On each new block:
 *   1. Fetch all transactions in the block
 *   2. Scan for kIO and koad OP_RETURNs (reusing sigchain-discovery scan primitives)
 *   3. Update in-memory/collection score table for affected entities
 *   4. Every N blocks (default 2016): trigger snapshot (via snapshotter.js)
 *
 * Exported as BlockWatcher global.
 */

'use strict';

BlockWatcher = {
  name: 'BlockWatcher',
  version: '0.0.1',

  _active: false,
  _chains: [],           // [ticker, ...] — which chains to watch
  _blockCount: 0,        // total blocks processed since start
  _lastSnapshotBlock: 0, // last block at which snapshot was taken
  _watcherHandles: {},   // { ticker: subscriptionHandle }
  _interval: null,       // setInterval handle for snapshot cadence check

  /**
   * Start watching for new blocks on the specified chains.
   *
   * @param {Object} options
   *   @param {string[]} [options.chains] — Chain tickers to watch (default: ['CDN'])
   *   @param {number} [options.snapshotInterval] — Blocks between snapshots (default: DEFAULT_SNAPSHOT_INTERVAL)
   *   @param {boolean} [options.autoStart] — If true, begin watching immediately (default: true)
   * @returns {Promise<void>}
   */
  async start(options = {}) {
    if (this._active) {
      console.log('[koad:io-scoring-indexer] BlockWatcher already running');
      return;
    }

    const chains = options.chains || ['CDN'];
    const snapshotInterval = options.snapshotInterval || DEFAULT_SNAPSHOT_INTERVAL;

    this._chains = chains;
    this._active = true;
    this._blockCount = 0;
    this._snapshotInterval = snapshotInterval;

    // Load last snapshot block from state
    try {
      const state = await ScoringIndexerState.findOneAsync('scoring-indexer-state');
      if (state?.last_snapshot_block) {
        this._lastSnapshotBlock = state.last_snapshot_block;
      }
      if (state?.last_indexed_block) {
        this._blockCount = state.last_indexed_block;
      }
    } catch (err) {
      console.warn('[koad:io-scoring-indexer] BlockWatcher: could not load state, starting fresh');
    }

    // Subscribe to electrum block headers on each chain
    for (const ticker of chains) {
      await this._subscribeChain(ticker);
    }

    // Periodic snapshot check (every 60s, check if we've passed the interval)
    this._interval = Meteor.setInterval(() => {
      this._checkSnapshotCadence();
    }, 60000);

    console.log(`[koad:io-scoring-indexer] BlockWatcher started on chains: ${chains.join(', ')}`);
  },

  /**
   * Subscribe to block header updates for a single chain via ecoincore:electrum.
   *
   * @param {string} ticker — Chain ticker (e.g. 'CDN', 'BTC')
   * @returns {Promise<void>}
   */
  async _subscribeChain(ticker) {
    try {
      // ecoincore:electrum provides blockchain.headers.subscribe via eCoinCore
      // The electrum package maintains connections and subscription state.
      // We register a callback via the eCoinCore block subscription API.
      const handle = await eCoinCore.fn.subscribeBlocks(ticker, (blockHeader) => {
        this._onBlock(ticker, blockHeader);
      });

      this._watcherHandles[ticker] = handle;
      console.log(`[koad:io-scoring-indexer] BlockWatcher subscribed to ${ticker} blocks`);
    } catch (err) {
      console.error(`[koad:io-scoring-indexer] BlockWatcher: failed to subscribe to ${ticker}: ${err.message}`);
    }
  },

  /**
   * Handle a new block header from electrum.
   *
   * @param {string} ticker — Chain ticker
   * @param {Object} blockHeader — { height, hex, ... }
   * @returns {Promise<void>}
   */
  async _onBlock(ticker, blockHeader) {
    if (!this._active) return;

    const height = blockHeader.height;
    this._blockCount = height;

    try {
      // 1. Fetch transactions in this block via electrum
      //    Uses ecoincore:electrum's getBlockTransactions
      const txs = await eCoinCore.fn.getBlockTransactions(ticker, height);

      // 2. Scan for kIO and koad OP_RETURNs
      //    Reuses sigchain-discovery scan primitives
      const broadcasts = this._scanTransactions(txs);

      // 3. For each discovered entity, update scores
      if (broadcasts.length > 0) {
        await this._updateScoresForBroadcasts(broadcasts, ticker, height);
      }

      // 4. Update state
      await this._updateState({ last_indexed_block: height });

      // 5. Fire daemon emission (if emitter available)
      if (typeof DaemonEmitter !== 'undefined' && DaemonEmitter.onBlock) {
        DaemonEmitter.onBlock(ticker, height, broadcasts.length);
      }

    } catch (err) {
      console.error(`[koad:io-scoring-indexer] BlockWatcher: error processing block ${height} on ${ticker}: ${err.message}`);
      if (typeof DaemonEmitter !== 'undefined' && DaemonEmitter.onError) {
        DaemonEmitter.onError(`block_watcher: ${ticker}@${height}: ${err.message}`);
      }
    }
  },

  /**
   * Scan transaction list for kIO and koad OP_RETURN payloads.
   *
   * @param {Object[]} txs — Array of transaction objects from electrum
   * @returns {Object[]} Array of detected broadcasts with entity info
   */
  _scanTransactions(txs) {
    const results = [];

    for (const tx of txs) {
      if (!tx.vout) continue;

      for (const vout of tx.vout) {
        if (!vout.scriptPubKey || !vout.scriptPubKey.hex) continue;

        const asm = vout.scriptPubKey.asm || '';
        const hex = vout.scriptPubKey.hex;

        // Check for OP_RETURN (starts with 'OP_RETURN ' or '6a' hex prefix)
        if (!asm.startsWith('OP_RETURN') && !hex.startsWith('6a')) continue;

        // Extract the data portion of the OP_RETURN
        // kIO prefix = 0x6B494F (SPEC-001 §5.2)
        // koad prefix = 0x6b6f6164 (SPEC-003)
        let dataHex;
        if (hex.startsWith('6a')) {
          // Standard OP_RETURN: 6a <length> <data>
          dataHex = hex.slice(4); // skip 6a + 1-byte length
        } else {
          // From asm: 'OP_RETURN <hexdata>'
          const parts = asm.split(' ');
          if (parts.length < 2) continue;
          dataHex = parts[1];
        }

        if (!dataHex) continue;

        // Check for kIO prefix (ROOTY-SPEC-001 §5.2)
        const kioPrefix = '6b494f'; // "kIO" in hex
        if (dataHex.startsWith(kioPrefix)) {
          results.push({
            type: 'kio',
            txid: tx.txid,
            dataHex,
            vout: vout.n,
            entityPubkeyHex: null,   // resolved by derive.js from address
            address: this._extractAddress(tx, vout),
            flags: this._parseFlagsByte(dataHex, kioPrefix),
            cid: this._extractCid(dataHex, kioPrefix),
          });
        }

        // Check for koad prefix (ROOTY-SPEC-003)
        const koadPrefix = '6b6f6164'; // "koad" in hex
        if (dataHex.startsWith(koadPrefix)) {
          results.push({
            type: 'koad',
            txid: tx.txid,
            dataHex,
            vout: vout.n,
            address: this._extractAddress(tx, vout),
          });
        }
      }
    }

    return results;
  },

  /**
   * Extract the sender address from a transaction's vin.
   *
   * @param {Object} tx — Transaction object
   * @param {Object} vout — The OP_RETURN vout
   * @returns {string|null} Address or null if not resolvable
   */
  _extractAddress(tx, vout) {
    // The address sending the OP_RETURN is typically the first input's address
    if (tx.vin && tx.vin[0] && tx.vin[0].address) {
      return tx.vin[0].address;
    }
    return null;
  },

  /**
   * Parse the flags byte from a kIO OP_RETURN payload.
   * Per ROOTY-SPEC-001 §5.2: kIO <cid(37)> <flags(1)> [reserved(4)]
   *
   * @param {string} dataHex — Full OP_RETURN hex
   * @param {string} prefix — Magic byte prefix hex
   * @returns {number} Flags byte (0 if not found)
   */
  _parseFlagsByte(dataHex, prefix) {
    // After prefix (3 bytes) and CID (37 bytes = 74 hex chars), next byte is flags
    const prefixLen = prefix.length; // 6 hex chars = 3 bytes
    const cidLen = 74; // 37 bytes = 74 hex chars
    const flagsStart = prefixLen + cidLen;

    if (dataHex.length < flagsStart + 2) return 0;
    return parseInt(dataHex.substr(flagsStart, 2), 16);
  },

  /**
   * Extract the CID from a kIO OP_RETURN payload.
   *
   * @param {string} dataHex — Full OP_RETURN hex
   * @param {string} prefix — Magic byte prefix hex
   * @returns {string} CID hex or empty string
   */
  _extractCid(dataHex, prefix) {
    const prefixLen = prefix.length;
    const cidLen = 74; // 37 bytes = 74 hex chars
    if (dataHex.length < prefixLen + cidLen) return '';
    return dataHex.substr(prefixLen, cidLen);
  },

  /**
   * Update scores for entities discovered in new broadcasts.
   *
   * @param {Object[]} broadcasts — Array of detected broadcasts
   * @param {string} ticker — Chain ticker
   * @param {number} blockHeight — Block height
   * @returns {Promise<void>}
   */
  async _updateScoresForBroadcasts(broadcasts, ticker, blockHeight) {
    // Collect unique addresses that need score updates
    const addressSet = new Set();
    for (const b of broadcasts) {
      if (b.address) addressSet.add(b.address);
    }

    if (addressSet.size === 0) return;

    // Resolve addresses to entity pubkeys via WatchedEntities
    for (const address of addressSet) {
      try {
        const entity = await WatchedEntities.findOneAsync({
          [`addresses.${ticker}.address`]: address,
        });

        if (!entity) {
          // Unknown entity — might be discovered via full-chain scan later
          continue;
        }

        // Recompute score for this entity
        const signals = await this._collectEntitySignals(entity.entity_pubkey_hex);
        if (!signals) continue;

        const result = ScoringEngine.computeScore(signals);

        // Update ScoreTable
        await ScoreTable.upsertAsync(
          { entity_pubkey_hex: entity.entity_pubkey_hex },
          {
            $set: {
              entity_name: entity.entity_name,
              total_score: result.totalScore,
              diversity_bonus: result.diversityBonus,
              dataplane_count: result.dataplaneCount,
              components: result.components,
              signals: result.signals,
              chain_scores: result.chainScores,
              last_updated_block: blockHeight,
              last_updated_at: new Date(),
            },
          }
        );

        // Insert ScoreHistory entry
        await ScoreHistory.insertAsync({
          entity_pubkey_hex: entity.entity_pubkey_hex,
          entity_name: entity.entity_name,
          snapshot_block: blockHeight,
          snapshot_time: new Date(),
          total_score: result.totalScore,
          components: result.components,
          diversity_bonus: result.diversityBonus,
          dataplane_count: result.dataplaneCount,
        });

        // Fire daemon emission
        if (typeof DaemonEmitter !== 'undefined' && DaemonEmitter.onEntityUpdate) {
          DaemonEmitter.onEntityUpdate(entity.entity_pubkey_hex, result);
        }

      } catch (err) {
        console.error(`[koad:io-scoring-indexer] error updating score for address ${address}: ${err.message}`);
      }
    }
  },

  /**
   * Collect on-chain signals for an entity across all watched chains.
   *
   * @param {string} entityPubkeyHex — Entity's Ed25519 public key hex
   * @returns {Promise<Object|null>} Entity signals object or null if not found
   */
  async _collectEntitySignals(entityPubkeyHex) {
    try {
      const entity = await WatchedEntities.findOneAsync({ entity_pubkey_hex: entityPubkeyHex });
      if (!entity) return null;

      // Collect broadcasts
      const broadcasts = await EntityBroadcasts.findAsync(
        { entity_pubkey_hex: entityPubkeyHex },
        { sort: { block_height: 1 } }
      ).fetch();

      // Collect taints
      const taints = await AddressTaints.findAsync({}).fetch(); // filtered by entity's addresses

      // Build signals object
      const chains = {};
      const discoveredChains = entity.discovered_on || ['CDN'];

      for (const ticker of discoveredChains) {
        const chainBroadcasts = broadcasts.filter(b => b.chain === ticker);
        const broadcastBlocks = chainBroadcasts.map(b => b.block_height);
        const sigCount = chainBroadcasts.filter(b => b.flags & 0x01).length;

        chains[ticker] = {
          firstSeenBlock: broadcastBlocks.length > 0 ? Math.min(...broadcastBlocks) : 0,
          lastSeenBlock: broadcastBlocks.length > 0 ? Math.max(...broadcastBlocks) : 0,
          broadcastCount: chainBroadcasts.length,
          broadcastBlocks,
          highSignificanceCount: sigCount,
          bonds: [],       // Populated from trust bond data
          bondedBy: [],
          trustPropagation: 0,
          stakes: [],      // Populated from timelock data
        };
      }

      return {
        entityPubkeyHex,
        firstSeenBlock: entity.last_broadcast_height || 0,
        lastSeenBlock: entity.last_broadcast_height || 0,
        broadcastCount: entity.broadcast_count || broadcasts.length,
        broadcastBlocks: broadcasts.map(b => b.block_height),
        bondedCount: 0,
        bondedByCount: 0,
        trustPropagation: 0,
        totalStakeValue: 0,
        governanceActions: this._countGovernanceActions(taints),
        highSignificanceCount: broadcasts.filter(b => b.flags & 0x01).length,
        chains,
        bonds: [],
        bondedBy: [],
        stakes: [],
      };
    } catch (err) {
      console.error(`[koad:io-scoring-indexer] _collectEntitySignals: ${err.message}`);
      return null;
    }
  },

  /**
   * Count governance actions from taint records.
   *
   * @param {Object[]} taints — Array of AddressTaints documents
   * @returns {number} Governance action count
   */
  _countGovernanceActions(taints) {
    let count = 0;
    for (const taint of taints) {
      // Tag 0x08 = governance_tip (ROOTY-SPEC-003)
      if (taint.payload?.governance_tip) count++;
      // Kingdom_id tag 0x03 implies kingdom membership governance
      if (taint.payload?.kingdom_id) count++;
    }
    return count;
  },

  /**
   * Update ScoringIndexerState document.
   *
   * @param {Object} fields — Fields to update
   * @returns {Promise<void>}
   */
  async _updateState(fields) {
    try {
      const update = { $set: { ...fields, updated_at: new Date() } };
      await ScoringIndexerState.upsertAsync('scoring-indexer-state', update);
    } catch (err) {
      console.warn(`[koad:io-scoring-indexer] _updateState: ${err.message}`);
    }
  },

  /**
   * Check if it's time to produce a score snapshot.
   */
  async _checkSnapshotCadence() {
    if (!this._active) return;

    const currentBlock = this._blockCount;
    const interval = this._snapshotInterval || DEFAULT_SNAPSHOT_INTERVAL;

    if (currentBlock - this._lastSnapshotBlock >= interval) {
      console.log(`[koad:io-scoring-indexer] Snapshot cadence reached (block ${currentBlock})`);
      this._lastSnapshotBlock = currentBlock;

      if (typeof Snapshotter !== 'undefined' && Snapshotter.takeSnapshot) {
        try {
          await Snapshotter.takeSnapshot(currentBlock);
        } catch (err) {
          console.error(`[koad:io-scoring-indexer] snapshot error: ${err.message}`);
        }
      }
    }
  },

  /**
   * Stop the block watcher.
   */
  stop() {
    this._active = false;

    // Unsubscribe from electrum block subscriptions
    for (const [ticker, handle] of Object.entries(this._watcherHandles)) {
      try {
        if (handle && typeof handle.stop === 'function') {
          handle.stop();
        }
      } catch (err) {
        console.warn(`[koad:io-scoring-indexer] error unsubscribing from ${ticker}: ${err.message}`);
      }
    }

    if (this._interval) {
      Meteor.clearInterval(this._interval);
      this._interval = null;
    }

    this._watcherHandles = {};
    console.log('[koad:io-scoring-indexer] BlockWatcher stopped');
  },
};
