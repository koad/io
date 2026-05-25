/**
 * koad:io-scoring-indexer — Core Scoring Engine (Scorer)
 *
 * ROOTY-SPEC-009 §3: Pure computation of all five score components from
 * on-chain entity signals. Accepts a data model (parsed entity signals) and
 * returns deterministic scores. No chain dependencies — fully testable offline.
 *
 * The pipeline:
 *   Entity signals (JSON) → scorer.js → computed component scores → weighted total
 *
 * Exported as ScoringEngine global with methods for each component and the
 * composite total computation.
 *
 * All component scores are normalized to [0, 1].
 */

'use strict';

const crypto = require('crypto');

// ============================================================================
// ScoringEngine — Namespaced global
// ============================================================================

ScoringEngine = {
  name: 'ScoringEngine',
  version: '0.0.1',

  /**
   * Compute the full score for a single entity from its on-chain signals.
   *
   * @param {Object} signals — Entity signals extracted from on-chain data.
   *   See EntitySignals typedef below for the schema.
   * @param {Object} [weights] — Custom weights override (defaults from constants.js).
   *   Must have keys: longevity, activity, trust, stake, governance.
   * @param {Object} [options] — Additional options:
   *   @param {number} [options.gameStartBlock] — Block height of game start (for longevity max).
   *   @param {number} [options.currentBlock] — Current block height (default: signals.lastSeenBlock).
   *   @param {number} [options.blocksPerYear] — Blocks per year for rate normalization.
   *   @param {number} [options.genesisEntityFloor] — Floor for genesis entities (default: 0.3).
   * @returns {Object} { totalScore, diversityBonus, dataplaneCount, components, signals }
   */
  computeScore(signals, weights, options = {}) {
    // Guard: signals must be an object with at minimum entity identity
    if (!signals || typeof signals !== 'object') {
      throw new Error('ScoringEngine.computeScore: signals must be an object');
    }
    if (!signals.entityPubkeyHex && !signals.entity_pubkey_hex) {
      throw new Error('ScoringEngine.computeScore: signals must include entityPubkeyHex');
    }

    const w = weights || SCORING_WEIGHTS;
    const currentBlock = options.currentBlock || signals.lastSeenBlock || 0;
    const gameStartBlock = options.gameStartBlock || 0;
    const blocksPerYear = options.blocksPerYear || BLOCKS_PER_YEAR;
    const genesisEntityFloor = options.genesisEntityFloor !== undefined
      ? options.genesisEntityFloor : GENESIS_ENTITY_SCORE_FLOOR;

    // Normalize signal references (accept camelCase or snake_case)
    const sig = this._normalizeSignals(signals);

    // Compute per-chain component maps, then merge to entity-level
    const chainScores = {};
    const chainKeys = Object.keys(sig.chains || {});

    for (const ticker of chainKeys) {
      const chain = sig.chains[ticker];
      const chainWeight = CHAIN_WEIGHTS[ticker] || DEFAULT_CHAIN_WEIGHT;

      chainScores[ticker] = {
        weight: chainWeight,
        longevity: this.computeLongevity(
          chain.firstSeenBlock,
          currentBlock,
          gameStartBlock,
          chain.broadcastBlocks,
          blocksPerYear
        ),
        activity: this.computeActivity(
          chain.broadcastCount,
          chain.firstSeenBlock,
          currentBlock,
          chain.highSignificanceCount,
          blocksPerYear
        ),
        trust: this.computeTrust(
          chain.bonds || sig.bonds,
          chain.bondedBy || sig.bondedBy,
          chain.trustPropagation || sig.trustPropagation,
          { entityAgeBlocks: currentBlock - (chain.firstSeenBlock || 0) }
        ),
        stake: this.computeStake(
          chain.stakes || sig.stakes
        ),
      };
    }

    // Entity-level component scores (merging across chains per SPEC-009 §5.1)
    const entityComponents = this._computeEntityComponents(
      chainScores,
      chainKeys,
      sig,
      currentBlock,
      gameStartBlock,
      blocksPerYear
    );

    // Dataplane diversity bonus (SPEC-009 §5.3)
    const dataplaneCount = chainKeys.length > 0 ? chainKeys.length : 1;
    const diversityBonus = Math.min(
      1.0 + (dataplaneCount - 1) * DIVERSITY_BONUS_PER_CHAIN,
      DIVERSITY_BONUS_CAP
    );

    // Weighted sum
    const weightedSum =
      w.longevity * entityComponents.longevity +
      w.activity * entityComponents.activity +
      w.trust * entityComponents.trust +
      w.stake * entityComponents.stake +
      w.governance * entityComponents.governance;

    const totalScore = weightedSum * diversityBonus;

    return {
      totalScore: Math.round(totalScore * 10000) / 10000,  // 4 decimal places
      diversityBonus: Math.round(diversityBonus * 100) / 100,
      dataplaneCount,
      components: entityComponents,
      chainScores,
      signals: {
        firstSeenBlock: sig.firstSeenBlock,
        lastSeenBlock: sig.lastSeenBlock,
        broadcastCount: sig.broadcastCount,
        bondedCount: sig.bondedCount,
        bondedByCount: sig.bondedByCount,
        trustPropagation: sig.trustPropagation,
        totalStakeValue: sig.totalStakeValue,
        governanceActions: sig.governanceActions,
      },
    };
  },

  // ========================================================================
  // S_longevity — Longevity Score (SPEC-009 §3.2)
  // ========================================================================

  /**
   * Compute S_longevity: entity age and continuous presence.
   *
   * @param {number} firstBlock — Earliest block with entity activity (any chain).
   * @param {number} presentBlock — Current block height.
   * @param {number} gameStartBlock — Game start block (for longevity max denominator).
   * @param {number[]} [broadcastBlocks] — Array of block heights of broadcasts (for continuity check).
   * @param {number} [blocksPerYear] — Blocks per year (for continuity gap threshold).
   * @returns {number} S_longevity normalized to [0, 1].
   */
  computeLongevity(firstBlock, presentBlock, gameStartBlock, broadcastBlocks, blocksPerYear) {
    if (!firstBlock || !presentBlock || presentBlock <= firstBlock) {
      return 0;
    }

    const bpy = blocksPerYear || BLOCKS_PER_YEAR;
    const totalTime = presentBlock - firstBlock;
    const maxTime = gameStartBlock > 0 ? presentBlock - gameStartBlock : totalTime;

    let score = Math.min(totalTime / Math.max(maxTime, 1), 1.0);

    // Continuity bonus (SPEC-009 §3.2): no gap > CONTINUITY_GAP_THRESHOLD
    if (Array.isArray(broadcastBlocks) && broadcastBlocks.length >= 2) {
      const sorted = [...broadcastBlocks].sort((a, b) => a - b);
      let maxGap = 0;
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1];
        if (gap > maxGap) maxGap = gap;
      }
      if (maxGap <= CONTINUITY_GAP_THRESHOLD) {
        score = Math.min(score * CONTINUITY_BONUS_MULTIPLIER, 1.0);
      }
    }

    // Genesis entity floor (SPEC-009 §3.2)
    if (gameStartBlock > 0 && firstBlock < gameStartBlock) {
      score = Math.max(score, GENESIS_ENTITY_SCORE_FLOOR);
    }

    return Math.round(score * 10000) / 10000;
  },

  // ========================================================================
  // S_activity — Activity Score (SPEC-009 §3.3)
  // ========================================================================

  /**
   * Compute S_activity: activity density with s-curve diminishing returns.
   *
   * @param {number} broadcastCount — Total kIO broadcasts across all chains.
   * @param {number} firstBlock — Earliest block with entity activity.
   * @param {number} presentBlock — Current block height.
   * @param {number} [highSignificanceCount] — Broadcasts with HIGH_SIGNIFICANCE flag (count double).
   * @param {number} [blocksPerYear] — Blocks per year for rate normalization.
   * @returns {number} S_activity normalized to [0, 1].
   */
  computeActivity(broadcastCount, firstBlock, presentBlock, highSignificanceCount, blocksPerYear) {
    if (!broadcastCount || !firstBlock || !presentBlock || presentBlock <= firstBlock) {
      return 0;
    }

    const bpy = blocksPerYear || BLOCKS_PER_YEAR;
    const sigCount = highSignificanceCount || 0;

    // Flag bonus: HIGH_SIGNIFICANCE broadcasts count double (SPEC-009 §3.3)
    const adjustedCount = broadcastCount + sigCount;

    // Normalize to broadcasts per year
    const lifespan = presentBlock - firstBlock;
    const normalizedRate = (adjustedCount / lifespan) * bpy;

    // S-curve with diminishing returns (SPEC-009 §3.3)
    const halfMax = ACTIVITY_RATE_HALF_MAX;
    const score = normalizedRate / (normalizedRate + halfMax);

    return Math.round(score * 10000) / 10000;
  },

  // ========================================================================
  // S_trust — Trust Network Score (SPEC-009 §3.4)
  // ========================================================================

  /**
   * Compute S_trust: trust network size and depth with propagation.
   *
   * @param {Object[]} [outgoingBonds] — Array of bond objects with { type, ageBlocks }.
   * @param {Object[]} [incomingBonds] — Array of bonds received by entity.
   * @param {number} [propagationScore] — Pre-computed 2-degree propagation count.
   * @param {Object} [options]
   *   @param {number} [options.entityAgeBlocks] — Age of entity in blocks.
   * @returns {number} S_trust normalized to [0, 1].
   */
  computeTrust(outgoingBonds, incomingBonds, propagationScore, options = {}) {
    const entityAgeBlocks = options.entityAgeBlocks || 0;

    // Compute weighted outgoing bond score
    const outBonds = Array.isArray(outgoingBonds) ? outgoingBonds : [];
    const inBonds = Array.isArray(incomingBonds) ? incomingBonds : [];

    let weightedOutgoing = 0;
    let weightedIncoming = 0;

    for (const bond of outBonds) {
      const typeWeight = BOND_TYPE_WEIGHTS[bond.type] || DEFAULT_BOND_TYPE_WEIGHT;
      const ageWeight = this._bondAgeWeight(bond.ageBlocks || 0);
      weightedOutgoing += typeWeight * ageWeight;
    }

    for (const bond of inBonds) {
      const typeWeight = BOND_TYPE_WEIGHTS[bond.type] || DEFAULT_BOND_TYPE_WEIGHT;
      const ageWeight = this._bondAgeWeight(bond.ageBlocks || 0);
      weightedIncoming += typeWeight * ageWeight;
    }

    // Raw bond score (outgoing + incoming weighted)
    const rawBondScore = weightedOutgoing + weightedIncoming;

    // Trust propagation (SPEC-009 §3.4)
    const propScore = propagationScore || 0;

    // Combined trust score: direct bonds + propagated bonds
    // Normalize to [0, 1] using reference network sizes
    // Reference: a well-connected entity might have ~20 direct bonds
    const directMax = 40;  // max meaningful direct bonds
    const propMax = 200;   // max meaningful 2-degree propagation

    const directScore = Math.min(rawBondScore / directMax, 1.0);
    const propScoreNorm = Math.min(propScore / propMax, 1.0);

    // Weight: direct bonds matter most, propagation adds nuance
    const score = directScore * 0.7 + propScoreNorm * 0.3;

    return Math.round(Math.min(score, 1.0) * 10000) / 10000;
  },

  /**
   * Compute bond age weight multiplier (SPEC-009 §3.4).
   * Bonds older than 1 year: 1.5×, older than 2 years: 2.0×.
   *
   * @param {number} ageBlocks — Age of the bond in blocks.
   * @returns {number} Age weight multiplier.
   */
  _bondAgeWeight(ageBlocks) {
    if (ageBlocks >= BOND_AGE_THRESHOLD_2_YEAR) {
      return BOND_AGE_WEIGHT_2_YEAR;
    }
    if (ageBlocks >= BOND_AGE_THRESHOLD_1_YEAR) {
      return BOND_AGE_WEIGHT_1_YEAR;
    }
    return 1.0;
  },

  // ========================================================================
  // S_stake — Stake Commitment Score (SPEC-009 §3.5)
  // ========================================================================

  /**
   * Compute S_stake: timelocked commitment.
   *
   * @param {Object[]} [stakes] — Array of stake objects with { value, durationBlocks }.
   * @returns {number} S_stake normalized to [0, 1].
   */
  computeStake(stakes) {
    const stakeList = Array.isArray(stakes) ? stakes : [];

    if (stakeList.length === 0) {
      return 0;
    }

    // total_locked_weight = Σ (stake_value_normalized × lock_duration_blocks)
    let totalWeight = 0;
    for (const s of stakeList) {
      const value = s.valueNormalized || s.value || 0;
      const duration = s.durationBlocks || 0;
      totalWeight += value * duration;
    }

    const score = Math.min(totalWeight / STAKE_REFERENCE, 1.0);
    return Math.round(score * 10000) / 10000;
  },

  // ========================================================================
  // S_governance — Governance Participation Score (SPEC-009 §3.6)
  // ========================================================================

  /**
   * Compute S_governance: governance participation.
   *
   * @param {number} [proposalVotes] — Number of distinct proposals voted on.
   * @param {number} [allianceVotes] — Cross-kingdom governance actions.
   * @param {number} [governanceTips] — Count of governance_tip (tag 0x08) taints.
   * @returns {number} S_governance normalized to [0, 1].
   */
  computeGovernance(proposalVotes, allianceVotes, governanceTips) {
    const pv = proposalVotes || 0;
    const av = allianceVotes || 0;
    const gt = governanceTips || 0;

    const raw =
      pv * GOVERNANCE_PROPOSAL_WEIGHT +
      av * GOVERNANCE_ALLIANCE_WEIGHT +
      gt * GOVERNANCE_TIP_WEIGHT;

    const score = Math.min(raw / GOVERNANCE_REFERENCE, 1.0);
    return Math.round(score * 10000) / 10000;
  },

  // ========================================================================
  // MERKLE ROOT COMPUTATION (SPEC-009 §6.1)
  // ========================================================================

  /**
   * Compute the SHA256 Merkle root of the score table.
   *
   * Per SPEC-009 §6.1, each leaf is:
   *   SHA256(entity_pubkey_hex || score_uint64_be)
   * where score_uint64_be is the total_score encoded as 8-byte big-endian.
   *
   * Leaves are sorted lexicographically by entity_pubkey_hex.
   *
   * @param {Object[]} entries — Array of { entityPubkeyHex, totalScore }.
   * @returns {string} Hex-encoded SHA256 Merkle root (32 bytes = 64 hex chars).
   */
  computeMerkleRoot(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    }

    // Build leaves: SHA256(entity_pubkey_hex || score_uint64_be)
    const leaves = entries.map(entry => {
      const scoreBuf = Buffer.alloc(8);
      // Convert score to uint64 big-endian (multiply by 10000 to preserve precision)
      const scoreInt = Math.round(entry.totalScore * 10000);
      scoreBuf.writeUInt32BE(scoreInt, 4);  // Lower 32 bits
      scoreBuf.writeUInt32BE(0, 0);         // Upper 32 bits (scores < 10000 so upper is 0)

      const pubkeyBuf = Buffer.from(entry.entityPubkeyHex, 'hex');
      const leaf = crypto.createHash('sha256')
        .update(Buffer.concat([pubkeyBuf, scoreBuf]))
        .digest();

      return { leaf, pubkeyHex: entry.entityPubkeyHex };
    });

    // Sort leaves lexicographically by entity_pubkey_hex (SPEC-009 §6.1)
    leaves.sort((a, b) => a.pubkeyHex.localeCompare(b.pubkeyHex));

    // Build Merkle tree
    let layer = leaves.map(l => l.leaf);

    while (layer.length > 1) {
      const nextLayer = [];
      for (let i = 0; i < layer.length; i += 2) {
        if (i + 1 < layer.length) {
          // Hash the pair
          const combined = crypto.createHash('sha256')
            .update(Buffer.concat([layer[i], layer[i + 1]]))
            .digest();
          nextLayer.push(combined);
        } else {
          // Odd number of nodes — propagate the last one up
          nextLayer.push(layer[i]);
        }
      }
      layer = nextLayer;
    }

    return layer[0].toString('hex');
  },

  // ========================================================================
  // HELPER — Normalize Signal Field Names
  // ========================================================================

  /**
   * Normalize signal field names to a consistent schema.
   * Accepts both camelCase and snake_case input.
   */
  _normalizeSignals(signals) {
    const s = {};

    // Map both naming conventions to canonical snake_case output
    s.entityPubkeyHex = signals.entityPubkeyHex || signals.entity_pubkey_hex || '';
    s.firstSeenBlock = signals.firstSeenBlock || signals.first_seen_block || 0;
    s.lastSeenBlock = signals.lastSeenBlock || signals.last_seen_block || 0;
    s.broadcastCount = signals.broadcastCount || signals.broadcast_count || 0;
    s.bondedCount = signals.bondedCount || signals.bonded_count || 0;
    s.bondedByCount = signals.bondedByCount || signals.bonded_by_count || 0;
    s.trustPropagation = signals.trustPropagation || signals.trust_propagation || 0;
    s.totalStakeValue = signals.totalStakeValue || signals.total_stake_value || 0;
    s.governanceActions = signals.governanceActions || signals.governance_actions || 0;
    s.highSignificanceCount = signals.highSignificanceCount || signals.high_significance_count || 0;

    // Broadcast blocks for continuity check
    s.broadcastBlocks = signals.broadcastBlocks || signals.broadcast_blocks || [];

    // Bonds
    s.bonds = signals.bonds || [];
    s.bondedBy = signals.bondedBy || [];

    // Chain-specific signals
    s.chains = signals.chains || {};
    // If no per-chain data, create a synthetic single-chain entry from top-level signals
    if (Object.keys(s.chains).length === 0) {
      s.chains = {
        CDN: {
          firstSeenBlock: s.firstSeenBlock,
          lastSeenBlock: s.lastSeenBlock,
          broadcastCount: s.broadcastCount,
          broadcastBlocks: s.broadcastBlocks,
          highSignificanceCount: s.highSignificanceCount,
          bonds: s.bonds,
          bondedBy: s.bondedBy,
          trustPropagation: s.trustPropagation,
          stakes: s.stakes || [],
        },
      };
    }

    // Stakes
    s.stakes = signals.stakes || [];

    return s;
  },

  // ========================================================================
  // HELPER — Compute Entity-Level Components Across Chains (SPEC-009 §5.1)
  // ========================================================================

  /**
   * Merge per-chain component scores into entity-level scores.
   * SPEC-009 §5.1:
   *   S_longevity  = max across chains (entity age = oldest chain presence)
   *   S_activity   = Σ weighted(S_activity[C])  // cross-chain activity summed
   *   S_trust      = Σ weighted(S_trust[C])     // trust network aggregated
   *   S_stake      = Σ weighted(S_stake[C])     // total stake summed
   *   S_governance = entity-level input (not chain-specific)
   */
  _computeEntityComponents(chainScores, chainKeys, signals, currentBlock, gameStartBlock, blocksPerYear) {
    const bpy = blocksPerYear || BLOCKS_PER_YEAR;

    // Default entity-level values (for when there are no per-chain scores)
    let longevity = 0;
    let activity = 0;
    let trust = 0;
    let stake = 0;

    if (chainKeys.length > 0) {
      // S_longevity: max across all chains (SPEC-009 §5.1)
      longevity = Math.max(...chainKeys.map(t => chainScores[t].longevity));

      // S_activity: sum weighted across chains
      let weightedActivity = 0;
      let totalWeight = 0;
      for (const t of chainKeys) {
        const cw = CHAIN_WEIGHTS[t] || DEFAULT_CHAIN_WEIGHT;
        weightedActivity += chainScores[t].activity * cw;
        totalWeight += cw;
      }
      activity = totalWeight > 0 ? weightedActivity / totalWeight : 0;

      // S_trust: sum weighted across chains
      let weightedTrust = 0;
      totalWeight = 0;
      for (const t of chainKeys) {
        const cw = CHAIN_WEIGHTS[t] || DEFAULT_CHAIN_WEIGHT;
        weightedTrust += chainScores[t].trust * cw;
        totalWeight += cw;
      }
      trust = totalWeight > 0 ? weightedTrust / totalWeight : 0;

      // S_stake: sum weighted across chains
      let weightedStake = 0;
      totalWeight = 0;
      for (const t of chainKeys) {
        const cw = CHAIN_WEIGHTS[t] || DEFAULT_CHAIN_WEIGHT;
        weightedStake += chainScores[t].stake * cw;
        totalWeight += cw;
      }
      stake = totalWeight > 0 ? weightedStake / totalWeight : 0;
    } else {
      // Fallback: compute from top-level signals
      longevity = this.computeLongevity(
        signals.firstSeenBlock, currentBlock, gameStartBlock,
        signals.broadcastBlocks, bpy
      );
      activity = this.computeActivity(
        signals.broadcastCount, signals.firstSeenBlock, currentBlock,
        signals.highSignificanceCount, bpy
      );
      trust = this.computeTrust(
        signals.bonds, signals.bondedBy, signals.trustPropagation
      );
      stake = this.computeStake(signals.stakes);
    }

    // S_governance: entity-level, not chain-specific (SPEC-009 §5.1)
    const governance = this.computeGovernance(
      signals.governanceActions,
      signals.allianceVotes || 0,
      signals.governanceTips || 0
    );

    return {
      longevity: Math.round(longevity * 10000) / 10000,
      activity: Math.round(activity * 10000) / 10000,
      trust: Math.round(trust * 10000) / 10000,
      stake: Math.round(stake * 10000) / 10000,
      governance: Math.round(governance * 10000) / 10000,
    };
  },
};
