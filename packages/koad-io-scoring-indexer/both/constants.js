/**
 * koad:io-scoring-indexer — Constants and Default Parameters
 *
 * ROOTY-SPEC-009 §3.7: Scoring function weights, thresholds, and configurable
 * parameters for the ring-of-trust scoring model. These are defaults that can
 * be overridden at indexer startup or by a game_rule_commit (tag 0x12).
 */

'use strict';

// ============================================================================
// DEFAULT WEIGHTS — Ring-of-Trust Mode (SPEC-009 §3.7)
// ============================================================================
// These weights bias toward trust network as the primary signal (community trust
// emphasis). For Grand Game mode, different weights apply (see GAME_DEFAULT_WEIGHTS).

SCORING_WEIGHTS = {
  longevity: 0.20,  // S_longevity — entity age and continuous presence
  activity:  0.15,  // S_activity  — activity density and consistency
  trust:     0.35,  // S_trust     — trust network size and depth (ring-of-trust core)
  stake:     0.15,  // S_stake     — timelocked commitment
  governance:0.15,  // S_governance — governance participation
};

// Grand Game default weights (SPEC-009 §3.7, game theoretical balance)
GAME_DEFAULT_WEIGHTS = {
  longevity: 0.25,
  activity:  0.20,
  trust:     0.20,
  stake:     0.20,
  governance:0.15,
};

// ============================================================================
// SCORE COMPONENT THRESHOLDS (SPEC-009 §3.2–3.6)
// ============================================================================

// S_activity: broadcast rate at which score reaches 0.5 (SPEC-009 §3.3)
// Default: 12 broadcasts/year (monthly cadence)
ACTIVITY_RATE_HALF_MAX = 12;

// Blocks per year for rate normalization — CDN at 300s blocks
BLOCKS_PER_YEAR = 105120;  // 365.25 × 288 blocks/day

// Default for CDN block time (300s). Used for chain-normalized longevity.
CDN_BLOCK_TARGET_SECONDS = 300;

// S_longevity: continuity gap threshold (SPEC-009 §3.2)
// Entities with broadcast gaps exceeding this are not continuous.
// Default: 105,120 blocks ≈ 1 year on CDN
CONTINUITY_GAP_THRESHOLD = 105120;

// S_longevity: continuity bonus multiplier (SPEC-009 §3.2)
CONTINUITY_BONUS_MULTIPLIER = 1.2;

// S_longevity: genesis entity floor (SPEC-009 §3.2)
// Pre-game entities get a baseline score floor
GENESIS_ENTITY_SCORE_FLOOR = 0.3;

// S_trust: bond type weights (SPEC-009 §3.4)
BOND_TYPE_WEIGHTS = {
  'authorized-agent': 2.0,
  'authorized-builder': 1.5,
  'family': 2.0,
  'peer': 1.0,
  'employee': 1.0,
  'member': 0.8,
  'friend': 1.2,
  'vendor': 0.5,
  'customer': 0.3,
};

// Default bond type weight for unknown/missing bond types
DEFAULT_BOND_TYPE_WEIGHT = 0.5;

// S_trust: bond age thresholds for age weighting (SPEC-009 §3.4)
// Bonds older than this many blocks get 1.5× weight
BOND_AGE_THRESHOLD_1_YEAR = 105120;  // ~1 year on CDN
BOND_AGE_THRESHOLD_2_YEAR = 210240;  // ~2 years
BOND_AGE_WEIGHT_1_YEAR = 1.5;
BOND_AGE_WEIGHT_2_YEAR = 2.0;

// S_trust: trust propagation depth (SPEC-009 §3.4, §11 Q5)
// Default: 2 degrees. Configurable, hard cap at 4.
TRUST_PROPAGATION_DEPTH = 2;
TRUST_PROPAGATION_MAX_DEPTH = 4;

// S_trust: decay factor for N-degree trust propagation (SPEC-009 §3.4)
TRUST_DECAY_FACTOR = 0.5;

// S_stake: reference commitment level (SPEC-009 §3.5)
// Equivalent to 1000 CDN locked for 1 year (525,600 CDN-block-days on CDN)
STAKE_REFERENCE = 525600;  // CDN-block-days

// S_governance: reference activity level (SPEC-009 §3.6)
// Expected baseline of governance actions
GOVERNANCE_REFERENCE = 10;

// Governance score sub-weights (SPEC-009 §3.6)
GOVERNANCE_PROPOSAL_WEIGHT = 0.5;
GOVERNANCE_ALLIANCE_WEIGHT = 1.0;
GOVERNANCE_TIP_WEIGHT = 0.3;

// ============================================================================
// DATAPLANE / MULTI-CHAIN PARAMETERS (SPEC-009 §5)
// ============================================================================

// Per-chain significance weights for cross-chain scoring (SPEC-009 §5.1)
CHAIN_WEIGHTS = {
  BTC: 1.0,  // Hardest anchor, deepest trust signal
  CDN: 1.0,  // Community namespace — native chain for community activity
  LTC: 0.8,  // Secondary community chain
  AUR: 0.8,  // Secondary community chain
  EFL: 0.8,  // Secondary community chain
};

// Default chain weight for unknown chains
DEFAULT_CHAIN_WEIGHT = 0.6;

// Dataplane diversity bonus formula (SPEC-009 §5.3)
// diversity_bonus = 1.0 + (dataplane_count - 1) × DIVERSITY_BONUS_PER_CHAIN
DIVERSITY_BONUS_PER_CHAIN = 0.1;
DIVERSITY_BONUS_CAP = 1.4;

// ============================================================================
// SCORING STATE / SNAPSHOT PARAMETERS
// ============================================================================

// Default snapshot cadence in blocks (SPEC-009 §6.1)
// 2016 blocks ≈ 1 week on CDN at 300s blocks
DEFAULT_SNAPSHOT_INTERVAL = 2016;

// Tag 0x14 score_snapshot payload constants (SPEC-009 §6.1)
SNAPSHOT_MERKLE_ROOT_BYTES = 32;
SNAPSHOT_GAME_ID_BYTES = 2;
SNAPSHOT_BLOCK_HEIGHT_BYTES = 4;
SNAPSHOT_TOTAL_BYTES = 38;  // 32 + 2 + 4

// Ring-of-trust mode game_id (SPEC-009 §6.1)
GAME_ID_RING_OF_TRUST = 0x0000;

// ============================================================================
// STALENESS / LIVENESS THRESHOLDS
// ============================================================================

// Blocks since last broadcast before an entity is considered stale
STALE_BLOCKS_THRESHOLD = 105120;  // ~1 year

// Blocks since last broadcast before an entity is considered retired
RETIRED_BLOCKS_THRESHOLD = 525600;  // ~5 years

// ============================================================================
// EXPORT SUMMARY — all constants are globalThis for Meteor package access
// ============================================================================

'use strict';
// Constants are declared as globals above (no `const` or `let`) so they are
// accessible across files within the Meteor package without explicit import.
