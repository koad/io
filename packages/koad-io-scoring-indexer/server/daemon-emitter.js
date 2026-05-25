/**
 * koad:io-scoring-indexer — Daemon Emission Stream Integration
 *
 * ROOTY-SPEC-009 §7.2: Fires structured events to the kingdom daemon's emission
 * stream for storefront consumption and watcher registration.
 *
 * This module is an adapter between the scoring indexer's internal events and
 * the daemon's emission API. It can be a stub when the daemon doesn't load
 * the package; all callers check for existence before firing.
 *
 * Events (SPEC-009 §7.2):
 *   score.snapshot_committed  — Tag 0x14 broadcast confirmed
 *   score.entity_updated      — Entity score changes
 *   score.genesis_complete    — Genesis scan finished
 *
 * Exported as DaemonEmitter global.
 */

'use strict';

DaemonEmitter = {
  name: 'DaemonEmitter',
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
      // Try daemon HTTP emission endpoint
      // The daemon runs at KOAD_IO_DAEMON or default http://10.10.10.10:28282
      const daemonUrl = process.env.KOAD_IO_DAEMON || 'http://10.10.10.10:28282';

      // Use Meteor's HTTP package if available, otherwise log and skip
      if (typeof HTTP !== 'undefined') {
        HTTP.post(`${daemonUrl}/emit`, {
          data: {
            entity: 'rooty',
            type,
            body: typeof payload === 'object' ? JSON.stringify(payload) : String(payload),
            meta: {
              sessionId: process.env.HARNESS_SESSION_ID || 'scoring-indexer',
              timestamp: new Date().toISOString(),
              payload,
            },
          },
        }, (err) => {
          if (err) {
            // Non-fatal — daemon may be down
            console.warn(`[koad:io-scoring-indexer] DaemonEmitter: failed to emit ${type}: ${err.message}`);
          }
        });
      } else {
        // Log as structured console output (collectable by emission watchers)
        console.log(`[daemon-emitter] ${type}:`, JSON.stringify(payload));
      }

      this._emissionCount++;

      // Update state counter
      ScoringIndexerState?.upsertAsync('scoring-indexer-state', {
        $inc: { emitted_count: 1 },
      }).catch(() => {});

    } catch (err) {
      // Silent — emission is best-effort
      console.warn(`[koad:io-scoring-indexer] DaemonEmitter: emit error: ${err.message}`);
    }
  },

  /**
   * Fired when a new block is processed.
   *
   * @param {string} ticker — Chain ticker
   * @param {number} height — Block height
   * @param {number} broadcastCount — Broadcasts found in block
   */
  onBlock(ticker, height, broadcastCount) {
    this._emit('scoring.block_processed', {
      chain: ticker,
      blockHeight: height,
      broadcastCount,
    });
  },

  /**
   * Fired when an entity's score is updated.
   *
   * @param {string} entityPubkeyHex — Entity pubkey
   * @param {Object} scoreResult — Score result from ScoringEngine
   */
  onEntityUpdate(entityPubkeyHex, scoreResult) {
    this._emit('score.entity_updated', {
      entityPubkeyHex,
      totalScore: scoreResult.totalScore,
      components: scoreResult.components,
      diversityBonus: scoreResult.diversityBonus,
      dataplaneCount: scoreResult.dataplaneCount,
    });
  },

  /**
   * Fired when a score snapshot is committed.
   *
   * @param {number} blockHeight — Snapshot block height
   * @param {string} merkleRoot — Hex Merkle root
   * @param {number} entityCount — Number of entities in snapshot
   * @param {string|null} txid — Broadcast txid (if anchored)
   */
  onSnapshot(blockHeight, merkleRoot, entityCount, txid) {
    this._emit('score.snapshot_committed', {
      blockHeight,
      merkleRoot,
      entityCount,
      txid,
    });
  },

  /**
   * Fired when genesis scan completes.
   *
   * @param {number} entityCount — Entities scored
   * @param {number} scanBlock — Block at genesis
   * @param {string|null} merkleRoot — Genesis Merkle root
   */
  onGenesisComplete(entityCount, scanBlock, merkleRoot) {
    this._emit('score.genesis_complete', {
      entityCount,
      scanBlock,
      merkleRoot,
    });
  },

  /**
   * Fired on error conditions.
   *
   * @param {string} message — Error description
   */
  onError(message) {
    this._emit('scoring.error', { message });
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
