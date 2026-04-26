// sigchain.js — Sigchain entry layer (ESM)
//
// Implements VESTA-SPEC-111 v1.11 §3–5.8.
//
// Pure-functional library for constructing, serializing, CID-computing,
// signing, and verifying SPEC-111 sigchain entries.
//
// Five identity entry types (SPEC-111 §5.8):
//   koad.identity.genesis, koad.identity.leaf-authorize, koad.identity.leaf-revoke,
//   koad.identity.prune-all, koad.identity.key-succession
//
// Canonical serialization: dag-json (IPLD codec 0x0129), keys sorted
// lexicographically. CID: CIDv1, sha2-256, base32upper → "bagu" prefix.
//
// Signature model: Option B (PGP detached/clearsign) per flight plan §open-question.
// Signing uses koad.identity.sign() → produces RFC 4880 clearsign armored string.
// The `signature` field carries the full armored PGP signature block.
//
// This module is purposely dependency-light. It imports from deps.js for
// dag-json + multiformats, and from pgp.js for verify. It does NOT touch
// IPFS, DNS, or filesystem.
//
// API surface:
//
//   Constructors (pure data — no signing):
//     buildIdentityGenesis({ entity_handle, master_fingerprint, master_pubkey_armored, created, description })
//     buildLeafAuthorize({ leaf_fingerprint, leaf_pubkey_armored, device_label, authorized_by_fingerprint, authorized_at })
//     buildLeafRevoke({ leaf_fingerprint, revoked_at, reason })
//     buildPruneAll({ pruned_at, reason })
//     buildKeySuccession({ old_master_fingerprint, new_master_fingerprint, new_master_pubkey_armored, succeeded_at, reason })
//
//   Envelope:
//     wrapEntry({ entity, timestamp, type, payload, previous })  → unsigned entry object
//
//   Canonical serialization:
//     canonicalDagJson(entry)   → Uint8Array
//     preImageBytes(entry)      → Uint8Array (signature field removed)
//
//   CID:
//     computeCID(entry)         → base32upper CIDv1 string ('bagu...')
//
//   Sign + finalize:
//     signEntry(unsignedEntry, identity)  → Promise<{ entry, cid }>
//
//   Verify:
//     verifyEntry(entry, expectedCID, signerPublicKey)  → Promise<{ valid, error? }>

import { encode as dagJsonEncode } from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { base32 } from 'multiformats/bases/base32';
import { verify as pgpVerify } from './pgp.js';

// dag-json codec number per SPEC-111 §3.1
const DAG_JSON_CODEC = 0x0129;

// ---------------------------------------------------------------------------
// Entry constructors — pure payload objects, no envelope wrapping
// ---------------------------------------------------------------------------

/**
 * Build payload for koad.identity.genesis entry.
 * SPEC-111 §5.8 — first entry in an entity identity sigchain. Signed by master.
 *
 * @param {object} opts
 * @param {string} opts.entity_handle           REQUIRED
 * @param {string} opts.master_fingerprint      REQUIRED (40-hex)
 * @param {string} opts.master_pubkey_armored   REQUIRED (PGP-armored)
 * @param {string} opts.created                 REQUIRED (ISO 8601 UTC)
 * @param {string} [opts.description]           OPTIONAL
 * @returns {{ type: string, payload: object }}
 */
export function buildIdentityGenesis({
  entity_handle,
  master_fingerprint,
  master_pubkey_armored,
  created,
  description,
} = {}) {
  if (!entity_handle) throw new Error('[sigchain] buildIdentityGenesis: entity_handle is required');
  if (!master_fingerprint) throw new Error('[sigchain] buildIdentityGenesis: master_fingerprint is required');
  if (!master_pubkey_armored) throw new Error('[sigchain] buildIdentityGenesis: master_pubkey_armored is required');
  if (!created) throw new Error('[sigchain] buildIdentityGenesis: created is required');

  const payload = {
    entity_handle,
    master_fingerprint,
    master_pubkey_armored,
    created,
  };
  if (description !== undefined && description !== null) {
    payload.description = description;
  }

  return { type: 'koad.identity.genesis', payload };
}

/**
 * Build payload for koad.identity.leaf-authorize entry.
 * SPEC-111 §5.8 — authorizes a device leaf PGP key.
 * Signed by master (first leaf) or an authorized leaf (subsequent additions).
 *
 * @param {object} opts
 * @param {string} opts.leaf_fingerprint              REQUIRED (40-hex)
 * @param {string} opts.leaf_pubkey_armored           REQUIRED (PGP-armored)
 * @param {string} [opts.device_label]                OPTIONAL
 * @param {string} opts.authorized_by_fingerprint     REQUIRED (40-hex)
 * @param {string} opts.authorized_at                 REQUIRED (ISO 8601 UTC)
 * @returns {{ type: string, payload: object }}
 */
export function buildLeafAuthorize({
  leaf_fingerprint,
  leaf_pubkey_armored,
  device_label,
  authorized_by_fingerprint,
  authorized_at,
} = {}) {
  if (!leaf_fingerprint) throw new Error('[sigchain] buildLeafAuthorize: leaf_fingerprint is required');
  if (!leaf_pubkey_armored) throw new Error('[sigchain] buildLeafAuthorize: leaf_pubkey_armored is required');
  if (!authorized_by_fingerprint) throw new Error('[sigchain] buildLeafAuthorize: authorized_by_fingerprint is required');
  if (!authorized_at) throw new Error('[sigchain] buildLeafAuthorize: authorized_at is required');

  const payload = {
    leaf_fingerprint,
    leaf_pubkey_armored,
    authorized_by_fingerprint,
    authorized_at,
  };
  if (device_label !== undefined && device_label !== null) {
    payload.device_label = device_label;
  }

  return { type: 'koad.identity.leaf-authorize', payload };
}

/**
 * Build payload for koad.identity.leaf-revoke entry.
 * SPEC-111 §5.8 — revokes a device leaf.
 * Signed by any currently authorized leaf (not the one being revoked), or master.
 *
 * @param {object} opts
 * @param {string} opts.leaf_fingerprint    REQUIRED (40-hex)
 * @param {string} opts.revoked_at          REQUIRED (ISO 8601 UTC)
 * @param {string} [opts.reason]            OPTIONAL
 * @returns {{ type: string, payload: object }}
 */
export function buildLeafRevoke({
  leaf_fingerprint,
  revoked_at,
  reason,
} = {}) {
  if (!leaf_fingerprint) throw new Error('[sigchain] buildLeafRevoke: leaf_fingerprint is required');
  if (!revoked_at) throw new Error('[sigchain] buildLeafRevoke: revoked_at is required');

  const payload = { leaf_fingerprint, revoked_at };
  if (reason !== undefined && reason !== null) {
    payload.reason = reason;
  }

  return { type: 'koad.identity.leaf-revoke', payload };
}

/**
 * Build payload for koad.identity.prune-all entry.
 * SPEC-111 §5.8 — recovery: revokes ALL current leaves simultaneously.
 * Signed by master ONLY.
 *
 * @param {object} opts
 * @param {string} opts.pruned_at   REQUIRED (ISO 8601 UTC)
 * @param {string} opts.reason      REQUIRED (non-empty — this is a serious event)
 * @returns {{ type: string, payload: object }}
 */
export function buildPruneAll({
  pruned_at,
  reason,
} = {}) {
  if (!pruned_at) throw new Error('[sigchain] buildPruneAll: pruned_at is required');
  if (!reason || reason.trim() === '') throw new Error('[sigchain] buildPruneAll: reason is required and must not be empty');

  return { type: 'koad.identity.prune-all', payload: { pruned_at, reason } };
}

/**
 * Build payload for koad.identity.key-succession entry.
 * SPEC-111 §5.8 — master key rotation. Signed by OLD master.
 *
 * @param {object} opts
 * @param {string} opts.old_master_fingerprint      REQUIRED (40-hex)
 * @param {string} opts.new_master_fingerprint      REQUIRED (40-hex)
 * @param {string} opts.new_master_pubkey_armored   REQUIRED (PGP-armored)
 * @param {string} opts.succeeded_at                REQUIRED (ISO 8601 UTC)
 * @param {string} [opts.reason]                    OPTIONAL
 * @returns {{ type: string, payload: object }}
 */
export function buildKeySuccession({
  old_master_fingerprint,
  new_master_fingerprint,
  new_master_pubkey_armored,
  succeeded_at,
  reason,
} = {}) {
  if (!old_master_fingerprint) throw new Error('[sigchain] buildKeySuccession: old_master_fingerprint is required');
  if (!new_master_fingerprint) throw new Error('[sigchain] buildKeySuccession: new_master_fingerprint is required');
  if (!new_master_pubkey_armored) throw new Error('[sigchain] buildKeySuccession: new_master_pubkey_armored is required');
  if (!succeeded_at) throw new Error('[sigchain] buildKeySuccession: succeeded_at is required');

  const payload = {
    old_master_fingerprint,
    new_master_fingerprint,
    new_master_pubkey_armored,
    succeeded_at,
  };
  if (reason !== undefined && reason !== null) {
    payload.reason = reason;
  }

  return { type: 'koad.identity.key-succession', payload };
}

// ---------------------------------------------------------------------------
// Generic envelope wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a payload (from a constructor) in the canonical SPEC-111 entry envelope.
 * Returns an unsigned entry object (no `signature` field).
 *
 * The caller merges { type, payload } from a buildX() result with entity +
 * timestamp + previous to produce the full unsigned entry.
 *
 * @param {object} opts
 * @param {string} opts.entity      Entity handle
 * @param {string} opts.timestamp   ISO 8601 UTC
 * @param {string} opts.type        Entry type string (e.g. 'koad.identity.genesis')
 * @param {object} opts.payload     Type-specific payload object
 * @param {string|null} opts.previous  CID of predecessor, null for genesis
 * @returns {object} Unsigned entry (version, entity, timestamp, type, payload, previous)
 */
export function wrapEntry({ entity, timestamp, type, payload, previous = null } = {}) {
  if (!entity) throw new Error('[sigchain] wrapEntry: entity is required');
  if (!timestamp) throw new Error('[sigchain] wrapEntry: timestamp is required');
  if (!type) throw new Error('[sigchain] wrapEntry: type is required');
  if (!payload || typeof payload !== 'object') throw new Error('[sigchain] wrapEntry: payload must be an object');
  if (previous !== null && typeof previous !== 'string') throw new Error('[sigchain] wrapEntry: previous must be a string CID or null');

  return {
    version: 1,
    entity,
    timestamp,
    type,
    payload,
    previous,
  };
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * Produce the canonical dag-json bytes for an entry.
 *
 * SPEC-111 §3.1: fields sorted lexicographically, no extraneous whitespace.
 * dag-json encoder from @ipld/dag-json is deterministic; we sort the top-level
 * keys before encoding to enforce the spec ordering.
 *
 * The full sorted key order for a complete entry (signature present):
 *   entity, payload, previous, signature, timestamp, type, version
 *
 * @param {object} entry  Any entry object (signed or unsigned)
 * @returns {Uint8Array}  Canonical dag-json bytes
 */
export function canonicalDagJson(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('[sigchain] canonicalDagJson: entry must be an object');

  // Build a sorted-key copy. All fields that may appear in a SPEC-111 entry,
  // in lexicographic order: entity, payload, previous, signature, timestamp, type, version.
  // Omit fields that are not present (e.g. signature on an unsigned entry).
  const sorted = _sortedEntry(entry);
  return dagJsonEncode(sorted);
}

/**
 * Produce canonical dag-json bytes with the `signature` field removed.
 * This is the pre-image for signing (SPEC-111 §3.2).
 *
 * @param {object} entry  Signed or unsigned entry
 * @returns {Uint8Array}  Pre-image bytes
 */
export function preImageBytes(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('[sigchain] preImageBytes: entry must be an object');

  // Strip signature field, then encode as canonical dag-json.
  const { signature: _sig, ...rest } = entry; // eslint-disable-line no-unused-vars
  const sorted = _sortedEntry(rest);
  return dagJsonEncode(sorted);
}

/**
 * Build a new object with keys in lexicographic order.
 * Handles the full SPEC-111 entry key set. Unknown extra keys are sorted
 * after known keys to remain deterministic.
 *
 * @param {object} entry
 * @returns {object} key-sorted shallow copy
 * @private
 */
function _sortedEntry(entry) {
  // SPEC-111 §3.2 pre-image order: entity, payload, previous, timestamp, type, version
  // Full entry order (with signature): entity, payload, previous, signature, timestamp, type, version
  const KNOWN_ORDER = ['entity', 'payload', 'previous', 'signature', 'timestamp', 'type', 'version'];

  const knownKeys = KNOWN_ORDER.filter(k => k in entry);
  const unknownKeys = Object.keys(entry).filter(k => !KNOWN_ORDER.includes(k)).sort();

  const result = {};
  for (const k of [...knownKeys, ...unknownKeys]) {
    result[k] = entry[k];
  }
  return result;
}

// ---------------------------------------------------------------------------
// CID computation
// ---------------------------------------------------------------------------

/**
 * Compute the CIDv1 (dag-json codec, sha2-256 multihash) for an entry.
 *
 * SPEC-111 §3.1: CIDv1 + dag-json codec (0x0129) + sha2-256.
 * Output is base32upper string with "bagu" prefix.
 *
 * The CID is computed from the FULL canonical bytes — including the `signature`
 * field when present. Call this after signing.
 *
 * @param {object} entry  Entry object (should include `signature` for the final stored CID)
 * @returns {string}  base32upper CIDv1 string (e.g. "baguczsaa...")
 */
export async function computeCID(entry) {
  const bytes = canonicalDagJson(entry);
  const digest = await sha256.digest(bytes);
  const cid = CID.create(1, DAG_JSON_CODEC, digest);
  // base32 (lowercase multibase prefix 'b') produces the 'bagu' prefix per SPEC-111 §3.1.
  // NOTE: spec text says "base32upper" but all examples show lowercase 'baguczs...' — the
  // examples are authoritative; lowercase base32 is the correct encoding. Flag for Vesta.
  return cid.toString(base32);
}

// ---------------------------------------------------------------------------
// Sign + finalize
// ---------------------------------------------------------------------------

/**
 * Sign an unsigned entry with a koad.identity object and produce the final entry.
 *
 * Signing model: Option B (PGP clearsign). The pre-image bytes are decoded to
 * a UTF-8 string and passed to identity.sign(). The resulting RFC 4880 armored
 * clearsign block is stored verbatim in the `signature` field.
 *
 * Callers should pass { useMaster: true } for identity entries that require the
 * master key (koad.identity.genesis, koad.identity.prune-all, koad.identity.key-succession,
 * and the first koad.identity.leaf-authorize).
 *
 * @param {object} unsignedEntry    Unsigned entry from wrapEntry()
 * @param {object} identity         koad.identity object (from createKoadIdentity())
 * @param {object} [opts]
 * @param {boolean} [opts.useMaster=false]  Sign with master key (ceremony/recovery posture)
 * @returns {Promise<{ entry: object, cid: string }>}
 */
export async function signEntry(unsignedEntry, identity, { useMaster = false } = {}) {
  if (!unsignedEntry || typeof unsignedEntry !== 'object') {
    throw new Error('[sigchain] signEntry: unsignedEntry must be an object');
  }
  if (!identity || typeof identity.sign !== 'function') {
    throw new Error('[sigchain] signEntry: identity must be a koad.identity object with .sign()');
  }

  // 1. Compute pre-image (canonical dag-json without signature field)
  const preImage = preImageBytes(unsignedEntry);

  // 2. Convert bytes to string for PGP signing
  //    dag-json bytes are ASCII-safe (all non-ASCII is escaped as \uXXXX)
  const preImageStr = new TextDecoder().decode(preImage);

  // 3. Sign: produces RFC 4880 armored clearsign block
  const armored = await identity.sign(preImageStr, { useMaster });

  // 4. Build the final entry with signature field
  const signedEntry = { ...unsignedEntry, signature: armored };

  // 5. Compute CID from the final entry bytes (including signature)
  const cid = await computeCID(signedEntry);

  return { entry: signedEntry, cid };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify a received sigchain entry.
 *
 * Steps (SPEC-111 §3.4 adapted for Option B PGP signatures):
 *   1. Recompute CID from entry bytes; assert match with expectedCID.
 *   2. Extract pre-image (remove signature field).
 *   3. Verify the PGP clearsign signature against signerPublicKey.
 *   4. Confirm the clearsign body matches the pre-image.
 *
 * @param {object} entry          Complete signed entry
 * @param {string} expectedCID    CID to verify against (base32upper string)
 * @param {string} signerPublicKey  Armored PGP public key of the expected signer
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
export async function verifyEntry(entry, expectedCID, signerPublicKey) {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, error: '[sigchain] verifyEntry: entry must be an object' };
  }
  if (!expectedCID || typeof expectedCID !== 'string') {
    return { valid: false, error: '[sigchain] verifyEntry: expectedCID must be a string' };
  }
  if (!signerPublicKey || typeof signerPublicKey !== 'string') {
    return { valid: false, error: '[sigchain] verifyEntry: signerPublicKey must be an armored public key string' };
  }
  if (!entry.signature) {
    return { valid: false, error: '[sigchain] verifyEntry: entry has no signature field' };
  }

  // Step 1: Recompute CID from entry bytes and assert match
  let actualCID;
  try {
    actualCID = await computeCID(entry);
  } catch (err) {
    return { valid: false, error: '[sigchain] verifyEntry: CID computation failed: ' + err.message };
  }

  if (actualCID !== expectedCID) {
    return {
      valid: false,
      error: `[sigchain] verifyEntry: CID mismatch — expected ${expectedCID}, got ${actualCID}`,
    };
  }

  // Step 2: Extract pre-image (remove signature field)
  const preImage = preImageBytes(entry);
  const preImageStr = new TextDecoder().decode(preImage);

  // Step 3: Verify PGP clearsign signature
  let verifyResult;
  try {
    verifyResult = await pgpVerify(entry.signature, signerPublicKey);
  } catch (err) {
    return { valid: false, error: '[sigchain] verifyEntry: pgp.verify threw: ' + err.message };
  }

  if (!verifyResult.verified) {
    return {
      valid: false,
      error: '[sigchain] verifyEntry: PGP signature invalid — ' + (verifyResult.error || 'unknown error'),
    };
  }

  // Step 4: Confirm the signed body matches the pre-image bytes
  // kbpgp clearsign normalizes line endings to \n; preImageStr is ASCII only.
  const signedBody = verifyResult.body.trim();
  const expectedBody = preImageStr.trim();
  if (signedBody !== expectedBody) {
    return {
      valid: false,
      error: '[sigchain] verifyEntry: signed body does not match pre-image — tampered entry',
    };
  }

  return { valid: true };
}
