// sigchain.js — Sigchain entry layer (ESM)
//
// Implements VESTA-SPEC-111 v1.18 §3–5.10.
//
// Pure-functional library for constructing, serializing, CID-computing,
// signing, and verifying SPEC-111 sigchain entries.
//
// Identity entry types (SPEC-111 §5.8, koad.identity.* family):
//   koad.identity.genesis, koad.identity.leaf-authorize, koad.identity.leaf-revoke,
//   koad.identity.prune-all, koad.identity.key-succession
//
// Entity entry types (SPEC-111 §5.10 / VESTA-SPEC-175 §4 / VESTA-SPEC-240 §5, koad.entity.* family):
//   koad.entity.genesis, koad.entity.leaf-authorize, koad.entity.leaf-revoke,
//   koad.entity.key-succession
//
// Entity-key resolution (VESTA-SPEC-240 §7):
//   resolveEntityKey(handle, chain)      → { effective_fingerprint, established_by, history, anomalies }
//   resolveLeafEpoch(handle, leafFpr, chain) → { authorized, stale, revoked, current, ... }
//
// Canonical serialization: dag-json (IPLD codec 0x0129), keys sorted
// lexicographically. CID: CIDv1, sha2-256, base32 → "bagu" prefix.
//
// Signature model: both families use §3.2b (PGP via kbpgp, RFC 4880 armored clearsign).
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
//     buildEntityGenesis({ entity_handle, entity_key_fingerprint, sovereign_key_fingerprint, gestated_at, gestation_host, notes })
//     buildEntityKeySuccession({ entity_handle, old_entity_key_fingerprint, new_entity_key_fingerprint, new_entity_pubkey_armored, succeeded_at, authorized_by, reason })
//     buildEntityLeafAuthorize({ entity_handle, leaf_fingerprint, host, authorized_at, authorized_by })
//     buildEntityLeafRevoke({ entity_handle, leaf_fingerprint, host, revoked_at, revoked_by, reason })
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
// Chain walker
// ---------------------------------------------------------------------------

/**
 * Walk a chain of sigchain entries from genesis to tip, validating each
 * entry's signature and CID link, and producing the current authorized-leaf-set.
 *
 * Entries MUST be provided in chain order (oldest first — genesis at index 0).
 *
 * Implements VESTA-SPEC-111 v1.11 §6 + §5.8.
 *
 * @param {Array<object>} entries — ordered entry objects (from genesis to tip)
 *   Each element is a { entry, cid } pair OR a plain entry object with a `_cid`
 *   property. For convenience the walker also accepts an array of plain signed
 *   entry objects if the caller has already computed CIDs — in that case the
 *   walker recomputes each CID itself.
 *
 *   SIMPLEST FORM: pass `[{ entry, cid }, ...]` pairs produced by signEntry().
 *
 * @returns {Promise<{
 *   valid: boolean,
 *   entity_handle: string|null,
 *   masterFingerprint: string|null,
 *   masterPublicKey: string|null,
 *   sigchainHeadCID: string|null,
 *   leafSet: Array<{ fingerprint, pubkey, device_label, authorized_at }>,
 *   errors: Array<{ index: number, type: string, error: string }>
 * }>}
 */
export async function verifyChain(entries) {
  // Canonical empty result
  const _empty = (extra = {}) => ({
    valid: false,
    entity_handle: null,
    masterFingerprint: null,
    masterPublicKey: null,
    sigchainHeadCID: null,
    leafSet: [],
    errors: [],
    ...extra,
  });

  // Guard: empty array
  if (!Array.isArray(entries) || entries.length === 0) {
    return _empty({ errors: [{ index: -1, type: 'empty-chain', error: 'empty chain' }] });
  }

  // Normalize input: accept either { entry, cid } pairs or plain entry objects.
  // For plain entries we compute the CID ourselves.
  const normalized = [];
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    if (item && typeof item === 'object' && 'entry' in item && 'cid' in item) {
      // Already a { entry, cid } pair from signEntry()
      normalized.push({ entry: item.entry, cid: item.cid });
    } else if (item && typeof item === 'object' && item.signature) {
      // Plain signed entry — compute CID now
      const cid = await computeCID(item);
      normalized.push({ entry: item, cid });
    } else {
      return _empty({
        errors: [{
          index: i,
          type: 'invalid-entry-shape',
          error: `entry at index ${i} is not a valid signed entry or {entry,cid} pair`,
        }],
      });
    }
  }

  // State
  let entity_handle = null;
  let masterFingerprint = null;
  let masterPublicKey = null;
  let leafSet = [];              // Array<{ fingerprint, pubkey, device_label, authorized_at }>
  let pruned = false;            // true after prune-all; next authorize should be by master
  const errors = [];
  let criticalError = false;     // CID link break or genesis failure → halt

  let prevCID = null;            // CID of the previous entry (for link validation)

  for (let i = 0; i < normalized.length; i++) {
    const { entry, cid } = normalized[i];
    const type = entry.type;

    // -----------------------------------------------------------------------
    // Step A: Genesis
    // -----------------------------------------------------------------------
    if (i === 0) {
      if (type !== 'koad.identity.genesis' && type !== 'koad.genesis') {
        errors.push({
          index: 0,
          type: 'invalid-genesis-type',
          error: `genesis entry must be koad.identity.genesis or koad.genesis, got: ${type}`,
        });
        criticalError = true;
        break;
      }

      // previous must be null for genesis
      if (entry.previous !== null) {
        errors.push({
          index: 0,
          type: 'genesis-previous-not-null',
          error: 'genesis entry must have previous=null',
        });
        criticalError = true;
        break;
      }

      if (type === 'koad.identity.genesis') {
        // koad.identity.genesis — SPEC-111 §5.8
        const p = entry.payload || {};
        entity_handle = p.entity_handle || null;
        masterFingerprint = p.master_fingerprint || null;
        masterPublicKey = p.master_pubkey_armored || null;

        if (!entity_handle || !masterFingerprint || !masterPublicKey) {
          errors.push({
            index: 0,
            type: 'genesis-missing-fields',
            error: 'koad.identity.genesis payload missing required fields: entity_handle, master_fingerprint, master_pubkey_armored',
          });
          criticalError = true;
          break;
        }

        // Verify signature against master pubkey
        const verResult = await verifyEntry(entry, cid, masterPublicKey);
        if (!verResult.valid) {
          errors.push({ index: 0, type: 'genesis-signature-invalid', error: verResult.error });
          criticalError = true;
          break;
        }
      } else {
        // koad.genesis — legacy entity chain (§4) — no master model
        const p = entry.payload || {};
        entity_handle = p.entity || null;
        const pubkey = p.pubkey || null;

        if (!entity_handle || !pubkey) {
          errors.push({
            index: 0,
            type: 'legacy-genesis-missing-fields',
            error: 'koad.genesis payload missing required fields: entity, pubkey',
          });
          criticalError = true;
          break;
        }

        // Verify signature against the entity pubkey
        const verResult = await verifyEntry(entry, cid, pubkey);
        if (!verResult.valid) {
          errors.push({ index: 0, type: 'genesis-signature-invalid', error: verResult.error });
          criticalError = true;
          break;
        }

        // In the legacy model there is no master — use entity pubkey as the
        // stand-in so that downstream callers can still work.
        masterPublicKey = pubkey;
      }

      prevCID = cid;
      continue;
    }

    // -----------------------------------------------------------------------
    // Step B: CID link check — entry.previous MUST equal the prior CID
    // -----------------------------------------------------------------------
    if (entry.previous !== prevCID) {
      errors.push({
        index: i,
        type: 'cid-link-mismatch',
        error: `entry ${i} previous field (${entry.previous}) does not match prior CID (${prevCID})`,
      });
      criticalError = true;
      break;
    }

    // -----------------------------------------------------------------------
    // Step C: Dispatch by type
    // -----------------------------------------------------------------------

    if (type === 'koad.identity.leaf-authorize') {
      const p = entry.payload || {};
      const authorizer = p.authorized_by_fingerprint;
      const leafFp = p.leaf_fingerprint;
      const leafPub = p.leaf_pubkey_armored;
      const deviceLabel = p.device_label || null;
      const authorizedAt = p.authorized_at || null;

      // Determine which key to verify against
      let signerPubKey = null;
      if (authorizer === masterFingerprint) {
        signerPubKey = masterPublicKey;
      } else {
        const authorizer_leaf = leafSet.find(l => l.fingerprint === authorizer);
        if (authorizer_leaf) {
          signerPubKey = authorizer_leaf.pubkey;
        }
      }

      if (!signerPubKey) {
        errors.push({
          index: i,
          type: 'leaf-authorize-unknown-authorizer',
          error: `leaf-authorize at index ${i}: authorized_by_fingerprint (${authorizer}) matches no current authority`,
        });
        // Not critical — chain link is still valid; skip effect
      } else {
        const verResult = await verifyEntry(entry, cid, signerPubKey);
        if (!verResult.valid) {
          errors.push({
            index: i,
            type: 'leaf-authorize-signature-invalid',
            error: verResult.error,
          });
          // Skip effect — bad signature doesn't authorize
        } else {
          // Idempotent: if fingerprint already in leafSet, update (latest wins)
          const existing = leafSet.findIndex(l => l.fingerprint === leafFp);
          const leaf = { fingerprint: leafFp, pubkey: leafPub, device_label: deviceLabel, authorized_at: authorizedAt };
          if (existing >= 0) {
            leafSet[existing] = leaf;
          } else {
            leafSet.push(leaf);
          }
          pruned = false; // A valid master-signed leaf-authorize after prune clears the pruned flag
        }
      }

    } else if (type === 'koad.identity.leaf-revoke') {
      const p = entry.payload || {};
      const revokedFp = p.leaf_fingerprint;

      // Self-revocation check — the signing identity is the one being revoked.
      // Detect: if the entry was signed by the leaf being revoked, reject.
      // We detect this by trying to verify against revokedFp's pubkey first;
      // if that succeeds, it's self-revocation.
      const revokedLeaf = leafSet.find(l => l.fingerprint === revokedFp);

      let isSelfRevoke = false;
      if (revokedLeaf) {
        const selfCheck = await verifyEntry(entry, cid, revokedLeaf.pubkey);
        if (selfCheck.valid) {
          isSelfRevoke = true;
        }
      }

      if (isSelfRevoke) {
        errors.push({
          index: i,
          type: 'self-revocation-rejected',
          error: `leaf-revoke at index ${i}: self-revocation rejected — leaf cannot revoke itself`,
        });
        // No effect
      } else {
        // Must be signed by any currently authorized leaf (other than the one
        // being revoked) OR master pubkey.
        const otherLeaves = leafSet.filter(l => l.fingerprint !== revokedFp);
        const candidates = [
          ...(masterPublicKey ? [masterPublicKey] : []),
          ...otherLeaves.map(l => l.pubkey),
        ];

        let revokeValid = false;
        for (const pub of candidates) {
          const verResult = await verifyEntry(entry, cid, pub);
          if (verResult.valid) {
            revokeValid = true;
            break;
          }
        }

        if (!revokeValid) {
          errors.push({
            index: i,
            type: 'leaf-revoke-signature-invalid',
            error: `leaf-revoke at index ${i}: signature could not be verified against any current authority`,
          });
          // No effect
        } else {
          leafSet = leafSet.filter(l => l.fingerprint !== revokedFp);
        }
      }

    } else if (type === 'koad.identity.prune-all') {
      // Must be signed by master only
      const verResult = masterPublicKey
        ? await verifyEntry(entry, cid, masterPublicKey)
        : { valid: false, error: 'no master public key on record' };

      if (!verResult.valid) {
        errors.push({
          index: i,
          type: 'prune-all-signature-invalid',
          error: verResult.error,
        });
        // No effect
      } else {
        leafSet = [];
        pruned = true;
      }

    } else if (type === 'koad.identity.key-succession') {
      // Must be signed by the OLD master pubkey
      const verResult = masterPublicKey
        ? await verifyEntry(entry, cid, masterPublicKey)
        : { valid: false, error: 'no master public key on record' };

      if (!verResult.valid) {
        errors.push({
          index: i,
          type: 'key-succession-signature-invalid',
          error: verResult.error,
        });
        // No effect — old master key still stands
      } else {
        const p = entry.payload || {};
        masterFingerprint = p.new_master_fingerprint || masterFingerprint;
        masterPublicKey = p.new_master_pubkey_armored || masterPublicKey;
        // leafSet is preserved through succession
      }

    } else if (type === 'koad.bond') {
      // Bond entries: verify the CID link (done above) but no leaf-set effect.
      // Signature verification is out of scope for the identity walker.
      // Continue silently.

    } else {
      // Unknown type — warn but continue
      errors.push({
        index: i,
        type: 'unknown-entry-type',
        error: `unknown entry type: ${type} (entry ${i}) — skipped`,
      });
    }

    prevCID = cid;
  }

  // -----------------------------------------------------------------------
  // Post-walk: warn if chain ended in pruned state without re-authorization
  // -----------------------------------------------------------------------
  if (!criticalError && pruned && leafSet.length === 0) {
    errors.push({
      index: normalized.length - 1,
      type: 'chain-ends-in-pruned-state',
      error: 'chain ends in prune-all state with no subsequent master-signed leaf-authorize — chain is in invalid authorized-leaf state',
    });
  }

  const sigchainHeadCID = criticalError ? null : (prevCID || null);

  return {
    valid: !criticalError,
    entity_handle,
    masterFingerprint,
    masterPublicKey,
    sigchainHeadCID,
    leafSet,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Entity entry constructors (koad.entity.* family)
// VESTA-SPEC-175 §4 / SPEC-111 §5.10
// Signed by sovereign master or sovereign device leaf (§3.2b PGP via kbpgp).
// ---------------------------------------------------------------------------

/**
 * Build payload for koad.entity.genesis entry.
 * VESTA-SPEC-175 §4.1 — sovereign authorizes a new entity into existence.
 * Filed in the sovereign's sigchain.
 *
 * @param {object} opts
 * @param {string} opts.entity_handle             REQUIRED
 * @param {string} opts.entity_key_fingerprint    REQUIRED (40-hex PGP fingerprint of entity.public.asc)
 * @param {string} opts.sovereign_key_fingerprint REQUIRED (40-hex PGP fingerprint of sovereign master)
 * @param {string} opts.gestated_at               REQUIRED (ISO 8601 timestamp)
 * @param {string} opts.gestation_host            REQUIRED (hostname where gestate was run)
 * @param {string} [opts.notes]                   OPTIONAL
 * @returns {{ type: string, payload: object }}
 */
export function buildEntityGenesis({
  entity_handle,
  entity_key_fingerprint,
  sovereign_key_fingerprint,
  gestated_at,
  gestation_host,
  notes,
} = {}) {
  if (!entity_handle) throw new Error('[sigchain] buildEntityGenesis: entity_handle is required');
  if (!entity_key_fingerprint) throw new Error('[sigchain] buildEntityGenesis: entity_key_fingerprint is required');
  if (!sovereign_key_fingerprint) throw new Error('[sigchain] buildEntityGenesis: sovereign_key_fingerprint is required');
  if (!gestated_at) throw new Error('[sigchain] buildEntityGenesis: gestated_at is required');
  if (!gestation_host) throw new Error('[sigchain] buildEntityGenesis: gestation_host is required');

  const payload = {
    entity_handle,
    entity_key_fingerprint,
    gestation_host,
    gestated_at,
    sovereign_key_fingerprint,
  };
  if (notes !== undefined && notes !== null) {
    payload.notes = notes;
  }

  return { type: 'koad.entity.genesis', payload };
}

/**
 * Build payload for koad.entity.key-succession entry.
 * VESTA-SPEC-240 §5.1–5.2 — the sovereign says the handle continues under a
 * new entity key. Filed in the sovereign's sigchain, signed by the sovereign's
 * currently-active device leaf (SPEC-111 §3.2b), exactly like the other three
 * koad.entity.* types.
 *
 * `new_entity_pubkey_armored` carries the whole armored public key on purpose:
 * the chain MUST be self-contained, so a verifier must never have to fetch a
 * file to learn what key a succession installed (§5.2).
 *
 * @param {object} opts
 * @param {string} opts.entity_handle                  REQUIRED
 * @param {string} opts.old_entity_key_fingerprint     REQUIRED (MUST equal the effective key before this entry)
 * @param {string} opts.new_entity_key_fingerprint     REQUIRED (MUST equal fpr(new_entity_pubkey_armored))
 * @param {string} opts.new_entity_pubkey_armored      REQUIRED (PGP-armored public key)
 * @param {string} opts.succeeded_at                   REQUIRED (ISO 8601 UTC)
 * @param {string} opts.authorized_by                  REQUIRED (40-hex fingerprint of the signing sovereign leaf)
 * @param {string} [opts.reason]                       OPTIONAL: rotation|lost-key|compromise|migration|other
 * @returns {{ type: string, payload: object }}
 */
export function buildEntityKeySuccession({
  entity_handle,
  old_entity_key_fingerprint,
  new_entity_key_fingerprint,
  new_entity_pubkey_armored,
  succeeded_at,
  authorized_by,
  reason,
} = {}) {
  if (!entity_handle) throw new Error('[sigchain] buildEntityKeySuccession: entity_handle is required');
  if (!old_entity_key_fingerprint) throw new Error('[sigchain] buildEntityKeySuccession: old_entity_key_fingerprint is required');
  if (!new_entity_key_fingerprint) throw new Error('[sigchain] buildEntityKeySuccession: new_entity_key_fingerprint is required');
  if (!new_entity_pubkey_armored) throw new Error('[sigchain] buildEntityKeySuccession: new_entity_pubkey_armored is required');
  if (!succeeded_at) throw new Error('[sigchain] buildEntityKeySuccession: succeeded_at is required');
  if (!authorized_by) throw new Error('[sigchain] buildEntityKeySuccession: authorized_by is required');

  const payload = {
    authorized_by,
    entity_handle,
    new_entity_key_fingerprint,
    new_entity_pubkey_armored,
    old_entity_key_fingerprint,
    succeeded_at,
  };
  // §5.2: absent is treated as `other` by consumers; the writer omits rather
  // than inventing a discriminator the operator did not give.
  if (reason !== undefined && reason !== null && reason !== '') {
    payload.reason = reason;
  }

  return { type: 'koad.entity.key-succession', payload };
}

/**
 * Build payload for koad.entity.leaf-authorize entry.
 * VESTA-SPEC-175 §4.2 — sovereign authorizes a device leaf for an entity.
 * Filed in the sovereign's sigchain when a new device comes online for an entity.
 *
 * @param {object} opts
 * @param {string} opts.entity_handle    REQUIRED
 * @param {string} opts.leaf_fingerprint REQUIRED (40-hex PGP fingerprint of devices/<host>/leaf.public.asc)
 * @param {string} opts.host             REQUIRED (machine hostname)
 * @param {string} opts.authorized_at    REQUIRED (ISO 8601 timestamp)
 * @param {string} opts.authorized_by    REQUIRED (sovereign key fingerprint — master or authorized device leaf)
 * @returns {{ type: string, payload: object }}
 */
export function buildEntityLeafAuthorize({
  entity_handle,
  leaf_fingerprint,
  host,
  authorized_at,
  authorized_by,
} = {}) {
  if (!entity_handle) throw new Error('[sigchain] buildEntityLeafAuthorize: entity_handle is required');
  if (!leaf_fingerprint) throw new Error('[sigchain] buildEntityLeafAuthorize: leaf_fingerprint is required');
  if (!host) throw new Error('[sigchain] buildEntityLeafAuthorize: host is required');
  if (!authorized_at) throw new Error('[sigchain] buildEntityLeafAuthorize: authorized_at is required');
  if (!authorized_by) throw new Error('[sigchain] buildEntityLeafAuthorize: authorized_by is required');

  return {
    type: 'koad.entity.leaf-authorize',
    payload: {
      authorized_at,
      authorized_by,
      entity_handle,
      host,
      leaf_fingerprint,
    },
  };
}

/**
 * Build payload for koad.entity.leaf-revoke entry.
 * VESTA-SPEC-175 §4.3 — sovereign revokes a device leaf for an entity.
 * Filed in the sovereign's sigchain when a device is lost, retired, or rotated.
 *
 * @param {object} opts
 * @param {string} opts.entity_handle    REQUIRED
 * @param {string} opts.leaf_fingerprint REQUIRED (40-hex PGP fingerprint of revoked leaf)
 * @param {string} opts.host             REQUIRED (machine hostname)
 * @param {string} opts.revoked_at       REQUIRED (ISO 8601 timestamp)
 * @param {string} opts.revoked_by       REQUIRED (sovereign key fingerprint)
 * @param {string} [opts.reason]         OPTIONAL ('lost-device' | 'rotation' | 'compromise' | 'other')
 * @returns {{ type: string, payload: object }}
 */
export function buildEntityLeafRevoke({
  entity_handle,
  leaf_fingerprint,
  host,
  revoked_at,
  revoked_by,
  reason,
} = {}) {
  if (!entity_handle) throw new Error('[sigchain] buildEntityLeafRevoke: entity_handle is required');
  if (!leaf_fingerprint) throw new Error('[sigchain] buildEntityLeafRevoke: leaf_fingerprint is required');
  if (!host) throw new Error('[sigchain] buildEntityLeafRevoke: host is required');
  if (!revoked_at) throw new Error('[sigchain] buildEntityLeafRevoke: revoked_at is required');
  if (!revoked_by) throw new Error('[sigchain] buildEntityLeafRevoke: revoked_by is required');

  const payload = {
    entity_handle,
    host,
    leaf_fingerprint,
    revoked_at,
    revoked_by,
  };
  if (reason !== undefined && reason !== null) {
    payload.reason = reason;
  }

  return { type: 'koad.entity.leaf-revoke', payload };
}

// ---------------------------------------------------------------------------
// Entity-key resolution — VESTA-SPEC-240 §7
// ---------------------------------------------------------------------------

/** Uppercase a fingerprint for comparison. Non-strings become null. */
function _fpr(value) {
  return typeof value === 'string' && value.length > 0 ? value.toUpperCase() : null;
}

/**
 * Resolve the effective entity key for a handle over a sovereign chain.
 *
 * VESTA-SPEC-240 §7. The single replacement for "does any genesis name this
 * key" — that comparison is how a superseded key gets resurrected (K-2).
 *
 * R-1: order is LINKAGE order, supplied by the caller. `chain` MUST already be
 *      in root → head order (resolveEntityKey never sorts, never reads mtime,
 *      never trusts `timestamp`). Use loadChainFromDir() in ceremony.mjs to
 *      produce it by walking `previous` from head.cid.
 * R-2: key-affecting entries are {koad.entity.genesis, koad.entity.key-succession}.
 * R-3: last key-affecting entry in chain order wins.
 * R-4: anomalies are recorded, never fatal. A succession whose
 *      old_entity_key_fingerprint is not the key effective immediately before it
 *      is `dangling-succession`: it changes nothing and is not a key event.
 *
 * @param {string} handle  Entity handle to resolve.
 * @param {Array<{entry: object, cid: string}>} chain  Root → head, linkage ordered.
 * @returns {{
 *   effective_fingerprint: string|null,
 *   established_by: string|null,
 *   history: Array<{type: string, fingerprint: string, cid: string, depth: number}>,
 *   anomalies: string[]
 * }}
 */
export function resolveEntityKey(handle, chain) {
  if (!handle || typeof handle !== 'string') {
    throw new Error('[sigchain] resolveEntityKey: handle is required');
  }
  if (!Array.isArray(chain)) {
    throw new Error('[sigchain] resolveEntityKey: chain must be an array of {entry, cid}');
  }

  const history = [];
  const anomalies = new Set();
  let effective = null;
  let establishedBy = null;
  let genesisCount = 0;
  const genesisFprs = [];

  for (let i = 0; i < chain.length; i++) {
    const item = chain[i];
    const entry = item && item.entry ? item.entry : item;
    const cid = item && item.cid ? item.cid : null;
    if (!entry || typeof entry !== 'object') continue;

    const type = entry.type;
    if (type !== 'koad.entity.genesis' && type !== 'koad.entity.key-succession') continue;

    const payload = entry.payload || {};
    if (payload.entity_handle !== handle) continue;

    if (type === 'koad.entity.genesis') {
      const fpr = _fpr(payload.entity_key_fingerprint);
      genesisCount += 1;
      if (genesisCount > 1) {
        // §12: duplicates are a recorded anomaly about one handle, not a chain
        // failure. Different keys → legacy-duplicate-genesis; same key → the
        // informational variant.
        anomalies.add(genesisFprs.includes(fpr)
          ? 'duplicate-genesis-same-key'
          : 'legacy-duplicate-genesis');
      }
      genesisFprs.push(fpr);
      effective = fpr;
      establishedBy = cid;
      history.push({ type, fingerprint: fpr, cid, depth: i });
      continue;
    }

    // koad.entity.key-succession
    const oldFpr = _fpr(payload.old_entity_key_fingerprint);
    const newFpr = _fpr(payload.new_entity_key_fingerprint);
    if (effective === null || oldFpr !== effective) {
      // R-4: dangling — ignored as a key event, never fatal.
      anomalies.add('dangling-succession');
      continue;
    }
    effective = newFpr;
    establishedBy = cid;
    history.push({ type, fingerprint: newFpr, cid, depth: i });
  }

  return {
    effective_fingerprint: effective,
    established_by: effective === null ? null : establishedBy,
    history,
    anomalies: Array.from(anomalies),
  };
}

/**
 * Resolve whether a device leaf is authorized in the CURRENT entity-key epoch.
 *
 * VESTA-SPEC-240 §9.4 L-1/L-3 (the minimum the §13 matrix and AC-16 need to
 * print the leaf-epoch line — full window enforcement is a separate brief).
 * A leaf authorized before the most recent `koad.entity.key-succession` for the
 * handle is `stale`; a leaf named by a later `koad.entity.leaf-revoke` is
 * `revoked`. `current` is the only value a caller should treat as usable.
 *
 * @param {string} handle
 * @param {string} leafFingerprint
 * @param {Array<{entry: object, cid: string}>} chain  Root → head, linkage ordered.
 * @returns {{authorized: boolean, stale: boolean, revoked: boolean, current: boolean,
 *            authorized_by_cid: string|null, epoch_succession_cid: string|null}}
 */
export function resolveLeafEpoch(handle, leafFingerprint, chain) {
  if (!handle || typeof handle !== 'string') {
    throw new Error('[sigchain] resolveLeafEpoch: handle is required');
  }
  if (!Array.isArray(chain)) {
    throw new Error('[sigchain] resolveLeafEpoch: chain must be an array of {entry, cid}');
  }
  const target = _fpr(leafFingerprint);

  let authorizedDepth = -1;
  let authorizedByCid = null;
  let revokeDepth = -1;
  let lastSuccessionDepth = -1;
  let lastSuccessionCid = null;

  for (let i = 0; i < chain.length; i++) {
    const item = chain[i];
    const entry = item && item.entry ? item.entry : item;
    const cid = item && item.cid ? item.cid : null;
    if (!entry || typeof entry !== 'object') continue;
    const payload = entry.payload || {};
    if (payload.entity_handle !== handle) continue;

    if (entry.type === 'koad.entity.key-succession') {
      lastSuccessionDepth = i;
      lastSuccessionCid = cid;
    } else if (target && entry.type === 'koad.entity.leaf-authorize') {
      if (_fpr(payload.leaf_fingerprint) === target) {
        authorizedDepth = i;
        authorizedByCid = cid;
      }
    } else if (target && entry.type === 'koad.entity.leaf-revoke') {
      if (_fpr(payload.leaf_fingerprint) === target) {
        revokeDepth = i;
      }
    }
  }

  const authorized = authorizedDepth >= 0;
  const stale = authorized && lastSuccessionDepth > authorizedDepth;
  // L-3: revocation is final and independent of epochs.
  const revoked = revokeDepth >= 0 && revokeDepth > authorizedDepth;

  return {
    authorized,
    stale,
    revoked,
    current: authorized && !stale && !revoked,
    authorized_by_cid: authorizedByCid,
    epoch_succession_cid: stale ? lastSuccessionCid : null,
  };
}

// ---------------------------------------------------------------------------
// Verify (single entry)
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
