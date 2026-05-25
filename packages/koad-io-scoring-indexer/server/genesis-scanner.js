/**
 * koad:io-scoring-indexer — Genesis Scanner
 *
 * ROOTY-SPEC-009 §6.2–6.3: Historical scan for entity bootstrap.
 *
 * When the indexer starts for the first time, the genesis scanner iterates
 * through all known entities (from WatchedEntities) and computes baseline
 * scores from all historical data up to the scan block.
 *
 * Discovery order (SPEC-009 §6.3):
 *   1. WatchedEntities subscription — entities the deployer explicitly added
 *   2. Full-chain magic-byte scan — discovers unknown entities (weekly, heavy)
 *
 * Exported as GenesisScanner global.
 */

'use strict';

GenesisScanner = {
  name: 'GenesisScanner',
  version: '0.0.1',

  _complete: false,
  _scanBlock: 0,
  _entityCount: 0,

  /**
   * Run the genesis scan.
   *
   * @param {number} scanBlock — Current block height to use as scan reference
   * @param {Object} [options]
   *   @param {string[]} [options.chains] — Chains to scan (default: ['CDN'])
   *   @param {boolean} [options.discoveryMode] — If true, also scan for unknown entities (default: false)
   *   @param {Object} [options.weights] — Custom scoring weights
   * @returns {Promise<Object>} { entityCount, genesisEntries, snapshotResult }
   */
  async runGenesisScan(scanBlock, options = {}) {
    const chains = options.chains || ['CDN'];
    const discoveryMode = options.discoveryMode || false;
    const weights = options.weights || null;

    console.log(`[koad:io-scoring-indexer] GenesisScanner: starting at block ${scanBlock} on chains ${chains.join(', ')}`);

    // Step 1: Collect entity list from WatchedEntities
    const entities = await this._collectEntities(chains, discoveryMode);
    console.log(`[koad:io-scoring-indexer] GenesisScanner: found ${entities.length} entities`);

    // Step 2: For each entity, collect signals and compute score
    const genesisEntries = [];
    for (const entity of entities) {
      try {
        const signals = await this._collectHistoricalSignals(entity, chains);
        if (!signals) continue;

        const result = ScoringEngine.computeScore(signals, weights, {
          currentBlock: scanBlock,
          gameStartBlock: options.gameStartBlock || 0,
        });

        genesisEntries.push({
          entity_pubkey_hex: entity.entity_pubkey_hex,
          entity_name: entity.entity_name || 'unknown',
          total_score: result.totalScore,
          diversity_bonus: result.diversityBonus,
          dataplane_count: result.dataplaneCount,
          components: result.components,
          signals: result.signals,
          chain_scores: result.chainScores,
        });
      } catch (err) {
        console.warn(`[koad:io-scoring-indexer] GenesisScanner: error scoring ${entity.entity_name || entity.entity_pubkey_hex}: ${err.message}`);
      }
    }

    this._entityCount = genesisEntries.length;

    // Step 3: Populate ScoreTable with genesis snapshot
    let snapshotResult = null;
    try {
      snapshotResult = await Snapshotter.takeGenesisSnapshot(scanBlock, genesisEntries, options);
    } catch (err) {
      console.error(`[koad:io-scoring-indexer] GenesisScanner: genesis snapshot failed: ${err.message}`);
    }

    // Step 4: Mark state
    this._complete = true;
    this._scanBlock = scanBlock;

    try {
      await ScoringIndexerState.upsertAsync('scoring-indexer-state', {
        $set: {
          genesis_complete: true,
          genesis_block: scanBlock,
          genesis_entity_count: this._entityCount,
          status: 'watching',
          updated_at: new Date(),
        },
        $inc: {
          scan_count: 1,
        },
      });
    } catch (err) {
      console.warn(`[koad:io-scoring-indexer] GenesisScanner: failed to update state: ${err.message}`);
    }

    // Fire daemon emission
    if (typeof DaemonEmitter !== 'undefined' && DaemonEmitter.onGenesisComplete) {
      DaemonEmitter.onGenesisComplete(this._entityCount, scanBlock, snapshotResult?.merkleRoot || null);
    }

    console.log(`[koad:io-scoring-indexer] GenesisScanner: complete — ${this._entityCount} entities scored at block ${scanBlock}`);
    return { entityCount: this._entityCount, genesisEntries, snapshotResult };
  },

  /**
   * Collect the list of entities to scan.
   *
   * Primary mode: WatchedEntities subscription (SPEC-009 §6.3).
   *
   * @param {string[]} chains — Chain tickers to include
   * @param {boolean} discoveryMode — If true, also scan for unknown entities
   * @returns {Promise<Object[]>} Array of entity records
   */
  async _collectEntities(chains, discoveryMode) {
    const entities = [];

    // Mode 1: WatchedEntities
    try {
      const watched = await WatchedEntities.find({}).fetch();
      entities.push(...watched);
    } catch (err) {
      console.warn(`[koad:io-scoring-indexer] GenesisScanner: failed to read WatchedEntities: ${err.message}`);
    }

    // Mode 2: Discovery scan — full-chain OP_RETURN scan for unknown entities
    if (discoveryMode) {
      try {
        // Reuse sigchain-discovery scan primitives for full-chain discovery
        // This is resource-intensive and should be rate-limited
        // TODO: full-chain magic-byte scan — see SPEC-009 §6.3
        console.log('[koad:io-scoring-indexer] GenesisScanner: discovery mode not yet implemented — waiting on full-chain scan extension');
      } catch (err) {
        console.warn(`[koad:io-scoring-indexer] GenesisScanner: discovery scan error: ${err.message}`);
      }
    }

    // Deduplicate by entity_pubkey_hex
    const seen = new Set();
    return entities.filter(e => {
      const key = e.entity_pubkey_hex || e.entityPubkeyHex;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  /**
   * Collect historical on-chain signals for a single entity across all chains.
   *
   * @param {Object} entity — WatchedEntities document
   * @param {string[]} chains — Chain tickers
   * @returns {Promise<Object|null>} Entity signals object
   */
  async _collectHistoricalSignals(entity, chains) {
    const pubkeyHex = entity.entity_pubkey_hex;
    if (!pubkeyHex) return null;

    try {
      // Collect all historical broadcasts for this entity
      const broadcasts = await EntityBroadcasts.findAsync(
        { entity_pubkey_hex: pubkeyHex },
        { sort: { block_height: 1 } }
      ).fetch();

      const broadcastBlocks = broadcasts.map(b => b.block_height);
      const firstSeen = broadcastBlocks.length > 0 ? Math.min(...broadcastBlocks) : 0;
      const lastSeen = broadcastBlocks.length > 0 ? Math.max(...broadcastBlocks) : 0;

      // Build per-chain data
      const chainsData = {};
      for (const ticker of chains) {
        const chainBroadcasts = broadcasts.filter(b => b.chain === ticker);
        const chainBlocks = chainBroadcasts.map(b => b.block_height);

        chainsData[ticker] = {
          firstSeenBlock: chainBlocks.length > 0 ? Math.min(...chainBlocks) : 0,
          lastSeenBlock: chainBlocks.length > 0 ? Math.max(...chainBlocks) : 0,
          broadcastCount: chainBroadcasts.length,
          broadcastBlocks: chainBlocks,
          highSignificanceCount: chainBroadcasts.filter(b => b.flags & 0x01).length,
          bonds: [],
          bondedBy: [],
          trustPropagation: 0,
          stakes: [],
        };
      }

      return {
        entityPubkeyHex: pubkeyHex,
        firstSeenBlock: firstSeen,
        lastSeenBlock: lastSeen,
        broadcastCount: broadcasts.length,
        broadcastBlocks,
        bondedCount: 0,
        bondedByCount: 0,
        trustPropagation: 0,
        totalStakeValue: 0,
        governanceActions: 0,
        highSignificanceCount: broadcasts.filter(b => b.flags & 0x01).length,
        chains: chainsData,
        bonds: [],
        bondedBy: [],
        stakes: [],
      };
    } catch (err) {
      console.error(`[koad:io-scoring-indexer] GenesisScanner: _collectHistoricalSignals failed for ${pubkeyHex}: ${err.message}`);
      return null;
    }
  },

  /**
   * Check whether genesis scan has been completed.
   *
   * @returns {boolean}
   */
  isComplete() {
    return this._complete;
  },

  /**
   * Get genesis scan summary.
   *
   * @returns {Object}
   */
  getSummary() {
    return {
      complete: this._complete,
      scanBlock: this._scanBlock,
      entityCount: this._entityCount,
    };
  },
};
