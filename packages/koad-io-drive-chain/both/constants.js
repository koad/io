/**
 * koad:io-drive-chain — Constants and Default Parameters
 *
 * VESTA-SPEC-212: Default BMM workscores, withdrawal periods, sidechain ID ranges,
 * OP_RETURN budgets, and configurable parameters per the kingdom sidechain protocol.
 *
 * These are defaults that can be overridden at sidechain genesis or by the
 * sidechain configuration document (SPEC-212 §2.4).
 *
 * Spec ref: VESTA-SPEC-212 §5 (OP_RETURN budget), §2 (sidechain identity),
 *           §6.2 (withdrawal periods), Rooty assessment §5 (block times).
 */

'use strict';

// ============================================================================
// SIDECHAIN ID RANGES (SPEC-212 §2.1)
// ============================================================================

// Reserved — uninitialized / null sidechain ID
SIDECHAIN_ID_NULL = 0x0000;

// Kingdom sidechains (allocated by CCT or allocation authority)
SIDECHAIN_ID_KINGDOM_MIN = 0x0001;
SIDECHAIN_ID_KINGDOM_MAX = 0x7FFF;

// Experimental / testnet sidechains (self-assigned, no collision protection)
SIDECHAIN_ID_EXPERIMENTAL_MIN = 0x8000;
SIDECHAIN_ID_EXPERIMENTAL_MAX = 0xFFFF;

// ============================================================================
// OP_RETURN BUDGET (SPEC-212 §5.1)
// ============================================================================

// Default OP_RETURN limit on sidechain (inherits CDN mainchain limit)
// SPEC-212 §5.1: sovereign MAY extend up to 1000 bytes
SIDECHAIN_OP_RETURN_LIMIT_DEFAULT = 80;

// Extended OP_RETURN limit for sidechains that need bond attestation payloads
// Tag 0x18 bond attestation is 99 bytes — requires limit >= 100
SIDECHAIN_OP_RETURN_LIMIT_EXTENDED = 100;

// Maximum practical limit (CDN's Bitcoin 0.16+ datacarriersize)
SIDECHAIN_OP_RETURN_LIMIT_MAX = 1000;

// ============================================================================
// TLV TAG REGISTRY — Sidechain-Extended (SPEC-212 §5.2)
// ============================================================================

// New sidechain-specific TLV tags extending ROOTY-SPEC-003
TAG_BOND_ATTESTATION      = 0x18;  // SPEC-212 §5.3 — Bond attestation payload
TAG_SIGCHAIN_TIP_BUNDLE   = 0x19;  // SPEC-212 §5.4 — Multiple entity tips in one tx

// kSC prefix (0x6B5343) for sidechain-specific protocol messages (SPEC-212 §5.5)
KSC_PREFIX = 'kSC';
KSC_PREFIX_HEX = '6b5343';

// ============================================================================
// BLOCK TIMES (Rooty assessment §5, SPEC-212 §1.1)
// ============================================================================

// CDN mainnet block time in seconds
CDN_MAINNET_BLOCK_TIME = 300;

// CDN testnet (SpudNet) block time in seconds
CDN_TESTNET_BLOCK_TIME = 30;

// Recommended sidechain block time for UX (SPEC-212 §1.1)
SIDECHAIN_BLOCK_TIME_DEFAULT = 60;

// ============================================================================
// WITHDRAWAL PERIODS (SPEC-212 §6.2, Rooty assessment §5)
// ============================================================================

// Default withdrawal fail period in mainchain blocks (BIP 300 default)
// On CDN mainnet (300s): 144 blocks ≈ 12 hours
// On CDN testnet (30s): 144 blocks ≈ 1.2 hours
MAINCHAIN_WITHDRAWAL_PERIOD_BLOCKS_DEFAULT = 144;

// Testnet withdrawal period (20 blocks ≈ 10 minutes on CDN testnet)
TESTNET_WITHDRAWAL_PERIOD_BLOCKS = 20;

// Short withdrawal period for SpudNet V2 fast testing cycles
SPUDNET_WITHDRAWAL_PERIOD_BLOCKS = 10;  // 10 blocks × 30s = 5 minutes

// ============================================================================
// WORKSCORE (SPEC-212 OQ-3, BIP 301 default flagged for CDN calibration)
// ============================================================================

// Default MIN_WORKSCORE from BIP 301 reference (Bitcoin SHA-256)
// SPEC-212 OQ-3: Open question — CDN scrypt hashrate via AuxPoW is different
// from BTC SHA-256. This value needs calibration for CDN.
MIN_WORKSCORE_DEFAULT = 131;

// Minimum workscore for testnet (lower threshold for faster testing)
MIN_WORKSCORE_TESTNET = 10;

// ============================================================================
// SIDECHAIN CONFIGURATION DOCUMENT KEYS (SPEC-212 §2.4)
// ============================================================================

SIDECHAIN_CONFIG_KEYS = {
  sidechain_id:           'sidechain_id',
  kingdom_handle:         'kingdom_handle',
  kingdom_genesis_cid:    'kingdom_genesis_cid',
  block_time_seconds:     'block_time_seconds',
  consensus:              'consensus',
  block_producer:         'block_producer',
  backup_producers:       'backup_producers',
  op_return_limit:        'op_return_limit',
  fee_schedule:           'fee_schedule',
  withdrawal_period_blocks: 'withdrawal_period_blocks',
  min_workscore:          'min_workscore',
  mainchain:              'mainchain',
  bip300_activation_height: 'bip300_activation_height',
  bip301_activation_height: 'bip301_activation_height',
};

// ============================================================================
// SIDECHAIN CONSENSUS MODELS (SPEC-212 §4)
// ============================================================================

CONSENSUS_POA    = 'proof-of-authority';     // v1 — required (SPEC-212 §4.1)
CONSENSUS_OPEN   = 'open-mining';            // v2 — future (SPEC-212 §4.3)

// ============================================================================
// DEPOSIT / WITHDRAWAL PARAMETERS (SPEC-212 §6)
// ============================================================================

// Minimum deposit in CDN satoshis (dust threshold)
MINIMUM_DEPOSIT_SATOSHI = 1000;

// Minimum withdrawal amount in CDN satoshis
MINIMUM_WITHDRAWAL_SATOSHI = 1000;

// Required mainchain confirmations before crediting a deposit (SPEC-212 §6.1)
DEPOSIT_CONFIRMATIONS_REQUIRED = 6;

// Withdrawal bundle cadence in sidechain blocks (SPEC-212 §6.2)
// Recommended: every 144 sidechain blocks at 60s block time ≈ 2.4 hours
WITHDRAWAL_BUNDLE_INTERVAL_DEFAULT = 144;

// ============================================================================
// KINGDOM-STATE COMMITMENT CADENCE (SPEC-212 §3)
// ============================================================================

// How often the kingdom merkle root is committed to the sidechain
// Recommended: every sidechain block (real-time commitment)
SIDECHAIN_MERKLE_ROOT_COMMIT_INTERVAL = 1;

// How often score snapshots are committed to the sidechain (SPEC-212 §3.2)
SIDECHAIN_SCORE_SNAPSHOT_INTERVAL = 2016;  // ~1 week on CDN mainnet

// ============================================================================
// SIDECHAIN LIFECYCLE STATES (SPEC-212 §9)
// ============================================================================

SIDECHAIN_STATE_PENDING    = 'pending';     // ID allocated, not yet genesis
SIDECHAIN_STATE_ACTIVE     = 'active';      // Normal operation (SPEC-212 §9.2)
SIDECHAIN_STATE_FROZEN     = 'frozen';      // Producer silent (SPEC-212 §8.1)
SIDECHAIN_STATE_TERMINATING = 'terminating'; // Withdrawal window open (SPEC-212 §9.3)
SIDECHAIN_STATE_TERMINATED = 'terminated';  // Gracefully closed (SPEC-212 §9.3)
SIDECHAIN_STATE_MIGRATING  = 'migrating';   // Migration in progress (SPEC-212 §9.4)

// ============================================================================
// SIDECHAIN ID ALLOCATION BOND (SPEC-212 §2.2)
// ============================================================================

// Recommended minimum bond for sidechain ID allocation (in CDN)
SIDECHAIN_ALLOCATION_BOND_SATOSHI = 10000000000;  // 10,000 CDN

// ============================================================================
// ADDRESS DERIVATION (SPEC-212 §6.3)
// ============================================================================

// HKDF info string for sidechain address derivation
SIDECHAIN_ADDRESS_DERIVATION_INFO = 'koad-io/sidechain/address/v1';

// BIP44 coin_type for CDN (SLIP44)
BIP44_COIN_TYPE_CDN = 34;

// ============================================================================
// FAILURE MODE PARAMETERS (SPEC-212 §8)
// ============================================================================

// Blocks before sidechain is considered frozen (2× block time)
// At 60s block time: ~2 minutes of silence triggers frozen state
SIDECHAIN_FROZEN_AFTER_BLOCKS_MISSED = 2;

// Grace period before CCT intervention (30 days in blocks on CDN mainnet)
// 30 days × 288 blocks/day = 8640 blocks
CCT_INTERVENTION_GRACE_PERIOD_MAINNET = 8640;

// Grace period before CCT intervention on testnet
// 30 days × 2880 blocks/day (30s blocks) = 86400 blocks
CCT_INTERVENTION_GRACE_PERIOD_TESTNET = 86400;

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

'use strict';
// Constants are declared as globals above (no `const` or `let`) so they are
// accessible across files within the Meteor package without explicit import.
