/**
 * koad:io-scoring-indexer — Snapshotter
 *
 * ROOTY-SPEC-009 §6: Merkle root computation + tag 0x14 score_snapshot broadcast.
 *
 * Periodically Merkle-roots the full ScoreTable and (when a funded wallet is
 * available) broadcasts the root via OP_RETURN with tag 0x14. The snapshot
 * provides incremental provability — observers can verify that the latest
 * snapshot matches their locally computed score table without replaying all
 * history.
 *
 * Payload format (SPEC-009 §6.1, tag 0x14):
 *   [merkle_root: 32 bytes][game_id: 2 bytes][block_height: 4 bytes]
 *   = 38 bytes total
 *
 * Exported as Snapshotter global.
 */

'use strict';

Snapshotter = {
  name: 'Snapshotter',
  version: '0.0.1',

  _broadcastEnabled: false,  // Set to true when wallet is funded

  /**
   * Enable or disable on-chain broadcast of snapshots.
   *
   * @param {boolean} enabled
   */
  setBroadcastEnabled(enabled) {
    this._broadcastEnabled = enabled;
  },

  /**
   * Take a score snapshot at the given block height.
   *
   * Steps:
   *   1. Read all entries from ScoreTable
   *   2. Compute Merkle root via ScoringEngine.computeMerkleRoot()
   *   3. Insert ScoreHistory records for all entities
   *   4. If broadcast enabled: construct and broadcast tag 0x14 OP_RETURN
   *   5. Update ScoringIndexerState
   *
   * @param {number} blockHeight — Block height at which snapshot is taken
   * @param {Object} [options]
   *   @param {number} [options.gameId] — Game ID (0x0000 for ring-of-trust mode)
   *   @param {boolean} [options.broadcast] — Override broadcast enabled flag
   * @returns {Promise<Object>} { merkleRoot, entityCount, snapshotTxid }
   */
  async takeSnapshot(blockHeight, options = {}) {
    const gameId = options.gameId || GAME_ID_RING_OF_TRUST;
    const shouldBroadcast = options.broadcast !== undefined ? options.broadcast : this._broadcastEnabled;

    console.log(`[koad:io-scoring-indexer] Snapshotter: taking snapshot at block ${blockHeight}`);

    // 1. Read all entries from ScoreTable
    let entries;
    try {
      entries = await ScoreTable.find({}).fetch();
    } catch (err) {
      console.error(`[koad:io-scoring-indexer] Snapshotter: failed to read ScoreTable: ${err.message}`);
      entries = [];
    }

    const entityCount = entries.length;
    const snapshotTime = new Date();

    // 2. Compute Merkle root
    const merkleEntries = entries.map(e => ({
      entityPubkeyHex: e.entity_pubkey_hex,
      totalScore: e.total_score,
    }));
    const merkleRoot = ScoringEngine.computeMerkleRoot(merkleEntries);

    console.log(`[koad:io-scoring-indexer] Snapshotter: Merkle root for ${entityCount} entities: ${merkleRoot}`);

    // 3. Insert/update ScoreHistory entries for all entities
    let insertedCount = 0;
    for (const entry of entries) {
      try {
        await ScoreHistory.insertAsync({
          entity_pubkey_hex: entry.entity_pubkey_hex,
          entity_name: entry.entity_name,
          snapshot_block: blockHeight,
          snapshot_time: snapshotTime,
          total_score: entry.total_score,
          components: entry.components,
          diversity_bonus: entry.diversity_bonus,
          dataplane_count: entry.dataplane_count,
          merkle_root: merkleRoot,
        });
        insertedCount++;
      } catch (err) {
        console.warn(`[koad:io-scoring-indexer] Snapshotter: failed to insert history for ${entry.entity_pubkey_hex}: ${err.message}`);
      }
    }

    // 4. Broadcast tag 0x14 OP_RETURN (if enabled)
    let snapshotTxid = null;
    if (shouldBroadcast) {
      try {
        snapshotTxid = await this._broadcastSnapshot(merkleRoot, gameId, blockHeight);
        console.log(`[koad:io-scoring-indexer] Snapshotter: broadcast txid ${snapshotTxid}`);
      } catch (err) {
        console.error(`[koad:io-scoring-indexer] Snapshotter: broadcast failed: ${err.message}`);
      }
    }

    // 5. Update ScoringIndexerState
    try {
      await ScoringIndexerState.upsertAsync('scoring-indexer-state', {
        $set: {
          last_snapshot_block: blockHeight,
          last_snapshot_merkle_root: merkleRoot,
          last_snapshot_txid: snapshotTxid,
          entity_count: entityCount,
          updated_at: snapshotTime,
        },
        $inc: {
          snapshot_count: 1,
        },
      });
    } catch (err) {
      console.warn(`[koad:io-scoring-indexer] Snapshotter: failed to update state: ${err.message}`);
    }

    // 6. Fire daemon emission
    if (typeof DaemonEmitter !== 'undefined' && DaemonEmitter.onSnapshot) {
      DaemonEmitter.onSnapshot(blockHeight, merkleRoot, entityCount, snapshotTxid);
    }

    return {
      merkleRoot,
      entityCount,
      insertedCount,
      snapshotTxid,
      blockHeight,
      gameId,
    };
  },

  /**
   * Construct and broadcast the tag 0x14 OP_RETURN transaction.
   *
   * Payload: [merkle_root: 32 bytes][game_id: 2 bytes LE][block_height: 4 bytes LE]
   * = 38 bytes total (SPEC-009 §6.1)
   *
   * NOTE: This requires a funded wallet on the broadcast chain. Currently
   * expected to use ecoincore:utxo's sigchain-broadcast primitives or the
   * wallet-expansion work from the five-chain dataplane brief.
   *
   * @param {string} merkleRootHex — 64-char hex Merkle root
   * @param {number} gameId — 2-byte game ID
   * @param {number} blockHeight — Block height
   * @returns {Promise<string|null>} txid if broadcast succeeded, null otherwise
   */
  async _broadcastSnapshot(merkleRootHex, gameId, blockHeight) {
    // Construct payload
    const merkleRootBuf = Buffer.from(merkleRootHex, 'hex');
    const gameIdBuf = Buffer.alloc(2);
    gameIdBuf.writeUInt16LE(gameId, 0);
    const heightBuf = Buffer.alloc(4);
    heightBuf.writeUInt32LE(blockHeight, 0);

    const payload = Buffer.concat([merkleRootBuf, gameIdBuf, heightBuf]);
    const payloadHex = payload.toString('hex');

    console.log(`[koad:io-scoring-indexer] Snapshotter: constructed tag 0x14 payload (${payloadHex})`);

    // TODO: Broadcast via funded wallet.
    // This requires the wallet-expansion work from the five-chain dataplane brief
    // (~/.rooty/briefs/2026-05-24-five-chain-dataplane-model-and-ecoincore-wallet-expansion.md).
    // When the wallet infrastructure is available, use:
    //   eCoinCore.fn.broadcastOpReturn('CDN', payloadHex, 0x14)
    // or the sigchain-broadcast path:
    //   eCoinCore.sigchain.broadcast.broadcastToChain(ticker, payload)
    //
    // Until then, this is a stub that logs the payload and returns null.

    console.log('[koad:io-scoring-indexer] Snapshotter: _broadcastSnapshot is a stub — no funded wallet yet');
    return null;
  },

  /**
   * Compute a genesis snapshot from historical data.
   *
   * @param {number} scanBlock — Block at which genesis scan completed
   * @param {Object[]} genesisEntries — Array of entity entries (as would appear in ScoreTable)
   * @param {Object} [options]
   * @returns {Promise<Object>} Snapshot result
   */
  async takeGenesisSnapshot(scanBlock, genesisEntries, options = {}) {
    console.log(`[koad:io-scoring-indexer] Snapshotter: taking genesis snapshot at block ${scanBlock}`);

    // Populate ScoreTable from genesis entries
    let insertedCount = 0;
    for (const entry of genesisEntries) {
      try {
        await ScoreTable.upsertAsync(
          { entity_pubkey_hex: entry.entity_pubkey_hex },
          {
            $set: {
              entity_name: entry.entity_name || '',
              total_score: entry.total_score,
              diversity_bonus: entry.diversity_bonus || 1.0,
              dataplane_count: entry.dataplane_count || 1,
              components: entry.components,
              signals: entry.signals || {},
              chain_scores: entry.chain_scores || {},
              last_updated_block: scanBlock,
              last_updated_at: new Date(),
            },
          }
        );
        insertedCount++;
      } catch (err) {
        console.warn(`[koad:io-scoring-indexer] Snapshotter: genesis insert failed for ${entry.entity_pubkey_hex}: ${err.message}`);
      }
    }

    console.log(`[koad:io-scoring-indexer] Snapshotter: genesis inserted ${insertedCount} entities`);

    // Take the first snapshot
    return this.takeSnapshot(scanBlock, options);
  },
};
