// identity-submission.js — Sigchain head submission builder + verifier (ESM)
//
// Implements VESTA-SPEC-150 v1.0:
//   §3  — submission message shape and canonical pre-image serialization
//   §4  — signing rules (leaf or master)
//   §6  — verifier behavior (IPFS fetch step skipped; caller passes entries)
//   §8  — idempotency + replay protection (timestamp window)
//
// Two entry points:
//   buildHeadSubmission(opts)           → Promise<{ submission, canonicalBytes, signedBytes }>
//   verifyHeadSubmission(submission, opts) → Promise<{ valid, error?, reason?, ... }>
//
// Design notes:
//   - Pure functions — no filesystem, no HTTP, no Meteor globals
//   - dag-json serialization mirrors sigchain.js canonicalDagJson() approach
//   - The IPFS chain walk (§6.5) is caller-provided: pass `entries` array
//     until IPFS publishing infrastructure lands (deferred per Part 3 plan)

import { encode as dagJsonEncode } from '@ipld/dag-json';
import { verifyChain } from './sigchain.js';

// ---------------------------------------------------------------------------
// SPEC-150 §3.2 — canonical pre-image key order (lexicographic, signature excluded)
// ---------------------------------------------------------------------------
// Keys: entity_handle, new_head_cid, previous_head_cid, protocol, submitted_at, submitted_by_fingerprint
const SUBMISSION_KEY_ORDER = [
  'entity_handle',
  'new_head_cid',
  'previous_head_cid',
  'protocol',
  'submitted_at',
  'submitted_by_fingerprint',
];

const PROTOCOL_V1 = 'koad.identity.head.v1';

/**
 * Produce the canonical dag-json pre-image bytes for a submission object.
 * Excludes the `signature` field. Keys in lexicographic order per §3.2.
 *
 * @param {object} submission — submission object (with or without signature field)
 * @returns {Uint8Array}
 */
function submissionPreImageBytes(submission) {
  const sorted = {};
  for (const k of SUBMISSION_KEY_ORDER) {
    // previous_head_cid may be null — include explicitly
    if (k in submission || k === 'previous_head_cid') {
      sorted[k] = (k === 'previous_head_cid' && !(k in submission))
        ? null
        : submission[k];
    }
  }
  return dagJsonEncode(sorted);
}

// ---------------------------------------------------------------------------
// Part 1A — Submission builder
// ---------------------------------------------------------------------------

/**
 * Build a signed sigchain head submission per SPEC-150 v1.0 §3.
 *
 * @param {object} opts
 * @param {string} opts.entityHandle       — The entity handle ('koad', 'juno', etc.)
 * @param {string|null} opts.previousHeadCID — Prior tip CID, or null for first publication
 * @param {string} opts.newHeadCID         — New tip CID being announced
 * @param {object} opts.identity           — koad.identity object (must have a loaded leaf or master)
 * @param {boolean} [opts.useMaster=false] — Sign with master instead of leaf (rare; ceremonies)
 * @returns {Promise<{
 *   submission: object,         // Full submission JSON ready for transport
 *   canonicalBytes: Uint8Array, // Canonical dag-json bytes WITHOUT signature — for re-verification
 *   signedBytes: Uint8Array,    // Canonical dag-json bytes WITH signature — for CID if needed
 * }>}
 */
export async function buildHeadSubmission({
  entityHandle,
  previousHeadCID = null,
  newHeadCID,
  identity,
  useMaster = false,
} = {}) {
  if (!entityHandle || typeof entityHandle !== 'string') {
    throw new Error('[identity-submission] buildHeadSubmission: entityHandle is required');
  }
  if (!newHeadCID || typeof newHeadCID !== 'string') {
    throw new Error('[identity-submission] buildHeadSubmission: newHeadCID is required');
  }
  if (!identity || typeof identity.sign !== 'function') {
    throw new Error('[identity-submission] buildHeadSubmission: identity must have .sign()');
  }
  if (previousHeadCID !== null && typeof previousHeadCID !== 'string') {
    throw new Error('[identity-submission] buildHeadSubmission: previousHeadCID must be a string or null');
  }

  // Step 1: Determine signer fingerprint
  const submittedByFingerprint = useMaster
    ? identity.masterFingerprint
    : identity.fingerprint;

  if (!submittedByFingerprint) {
    const which = useMaster ? 'masterFingerprint' : 'fingerprint';
    throw new Error(`[identity-submission] buildHeadSubmission: identity.${which} is not set — identity may not be fully loaded`);
  }

  // Step 2: Build submission object without signature
  const unsignedSubmission = {
    protocol: PROTOCOL_V1,
    entity_handle: entityHandle,
    previous_head_cid: previousHeadCID,
    new_head_cid: newHeadCID,
    submitted_at: new Date().toISOString(),
    submitted_by_fingerprint: submittedByFingerprint,
  };

  // Step 3: Canonical pre-image bytes (dag-json, keys in lex order, no signature)
  const canonicalBytes = submissionPreImageBytes(unsignedSubmission);

  // Step 4: Sign pre-image string via identity.sign()
  //         identity.sign() takes a string and returns RFC 4880 armored clearsign block
  const preImageStr = new TextDecoder().decode(canonicalBytes);
  const signature = await identity.sign(preImageStr, { useMaster });

  // Step 5: Build final submission with signature
  const submission = { ...unsignedSubmission, signature };

  // Step 6: Compute final canonical bytes (with signature) — callers may want this for transport
  // Note: 'signature' sorts last in the full object if needed; we use a simple re-encode here
  const signedSorted = {};
  for (const k of SUBMISSION_KEY_ORDER) {
    signedSorted[k] = submission[k];
  }
  signedSorted['signature'] = submission.signature;
  const signedBytes = dagJsonEncode(signedSorted);

  return { submission, canonicalBytes, signedBytes };
}

// ---------------------------------------------------------------------------
// Part 1B — Verifier
// ---------------------------------------------------------------------------

/**
 * Verify a sigchain head submission per SPEC-150 §6 verifier behavior.
 *
 * IPFS fetch (§6.5 step 5) is skipped — caller passes entries directly.
 * This is a temporary affordance until IPFS publishing infrastructure lands.
 *
 * @param {object} submission               — The submission JSON received
 * @param {object} opts
 * @param {string|null} opts.priorKnownHead — Vesta's currently-known head CID for this entity (or null)
 * @param {Array} opts.entries              — Chain entries from genesis to new_head_cid (caller provides)
 * @returns {Promise<{
 *   valid: boolean,
 *   error?: string,
 *   reason?: string,
 *     // 'wrong-protocol' | 'invalid-signature' | 'fp-not-authorized'
 *     // | 'previous-mismatch' | 'chain-invalid' | 'stale-head' | 'genesis-replay'
 *     // | 'future-timestamp' | 'expired-timestamp'
 *   masterFingerprint?: string,
 *   leafSet?: array,
 * }>}
 */
export async function verifyHeadSubmission(submission, { priorKnownHead = null, entries = [] } = {}) {
  if (!submission || typeof submission !== 'object') {
    return { valid: false, error: 'submission must be an object', reason: 'invalid-input' };
  }

  // -------------------------------------------------------------------
  // §6.1 — Protocol version check
  // -------------------------------------------------------------------
  if (submission.protocol !== PROTOCOL_V1) {
    return {
      valid: false,
      error: `unknown protocol: ${submission.protocol} — expected ${PROTOCOL_V1}`,
      reason: 'wrong-protocol',
    };
  }

  // -------------------------------------------------------------------
  // §8.3 — Timestamp window (belt-and-suspenders replay protection)
  // -------------------------------------------------------------------
  if (submission.submitted_at) {
    const submittedAt = new Date(submission.submitted_at).getTime();
    const now = Date.now();
    // Reject if more than 24h in the past
    if (now - submittedAt > 24 * 60 * 60 * 1000) {
      return {
        valid: false,
        error: `submission timestamp ${submission.submitted_at} is more than 24 hours in the past`,
        reason: 'expired-timestamp',
      };
    }
    // Reject if more than 5 minutes in the future (clock skew tolerance)
    if (submittedAt - now > 5 * 60 * 1000) {
      return {
        valid: false,
        error: `submission timestamp ${submission.submitted_at} is more than 5 minutes in the future`,
        reason: 'future-timestamp',
      };
    }
  }

  // -------------------------------------------------------------------
  // §6.3 — Staleness check / genesis replay protection (§9)
  // -------------------------------------------------------------------
  if (priorKnownHead !== null) {
    // Entity already known to this verifier
    if (submission.previous_head_cid === null) {
      // Genesis replay — priorKnownHead exists but submission claims first publication
      return {
        valid: false,
        error: `entity ${submission.entity_handle} already has a known head — cannot re-submit with previous_head_cid=null`,
        reason: 'genesis-replay',
      };
    }
    // Idempotency: same CID already current — accept as no-op
    if (submission.new_head_cid === priorKnownHead) {
      return {
        valid: true,
        alreadyCurrent: true,
        masterFingerprint: null,
        leafSet: [],
      };
    }
    // previous_head_cid must match priorKnownHead (or be a fork — simplified: reject mismatch)
    // Full conflict resolution (§7) requires IPFS walk depth comparison — deferred.
    // For now: require exact match to prevent regressions.
    if (submission.previous_head_cid !== priorKnownHead) {
      return {
        valid: false,
        error: `previous_head_cid ${submission.previous_head_cid} does not match known head ${priorKnownHead}`,
        reason: 'previous-mismatch',
        currentHead: priorKnownHead,
      };
    }
  }

  // -------------------------------------------------------------------
  // §6.5 — Chain walk (caller provides entries)
  // -------------------------------------------------------------------
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      valid: false,
      error: 'entries array is required for chain walk — IPFS fetch not yet implemented',
      reason: 'chain-invalid',
    };
  }

  const chainResult = await verifyChain(entries);
  if (!chainResult.valid) {
    return {
      valid: false,
      error: 'chain walk failed: ' + (chainResult.errors[0]?.error || 'unknown error'),
      reason: 'chain-invalid',
    };
  }

  // Confirm chain tip matches new_head_cid
  if (chainResult.sigchainHeadCID !== submission.new_head_cid) {
    return {
      valid: false,
      error: `chain tip CID ${chainResult.sigchainHeadCID} does not match submission new_head_cid ${submission.new_head_cid}`,
      reason: 'chain-invalid',
    };
  }

  // -------------------------------------------------------------------
  // §6.6 — Authorization confirmation
  // -------------------------------------------------------------------
  const submitterFp = submission.submitted_by_fingerprint;
  const isMaster = submitterFp === chainResult.masterFingerprint;
  const isLeaf = chainResult.leafSet.some(l => l.fingerprint === submitterFp);

  if (!isMaster && !isLeaf) {
    return {
      valid: false,
      error: `submitted_by_fingerprint ${submitterFp} is not authorized — not master and not in current leaf set`,
      reason: 'fp-not-authorized',
    };
  }

  // -------------------------------------------------------------------
  // §6.4 — Signature verification
  // -------------------------------------------------------------------
  // Determine the signer's public key
  let signerPublicKey = null;
  if (isMaster) {
    signerPublicKey = chainResult.masterPublicKey;
  } else {
    const leaf = chainResult.leafSet.find(l => l.fingerprint === submitterFp);
    signerPublicKey = leaf ? leaf.pubkey : null;
  }

  if (!signerPublicKey) {
    return {
      valid: false,
      error: `cannot find public key for fingerprint ${submitterFp}`,
      reason: 'fp-not-authorized',
    };
  }

  // Reconstruct pre-image and verify signature
  const preImageBytes = submissionPreImageBytes(submission);
  const preImageStr = new TextDecoder().decode(preImageBytes);

  // Use pgp.verify — same module as sigchain.js
  let pgpVerify;
  try {
    const pgpMod = await import('./pgp.js');
    pgpVerify = pgpMod.verify;
  } catch (err) {
    return {
      valid: false,
      error: 'failed to load pgp module: ' + err.message,
      reason: 'invalid-signature',
    };
  }

  let verifyResult;
  try {
    verifyResult = await pgpVerify(submission.signature, signerPublicKey);
  } catch (err) {
    return {
      valid: false,
      error: 'pgp.verify threw: ' + err.message,
      reason: 'invalid-signature',
    };
  }

  if (!verifyResult.verified) {
    return {
      valid: false,
      error: 'PGP signature invalid — ' + (verifyResult.error || 'unknown error'),
      reason: 'invalid-signature',
    };
  }

  // Confirm signed body matches pre-image
  const signedBody = verifyResult.body.trim();
  const expectedBody = preImageStr.trim();
  if (signedBody !== expectedBody) {
    return {
      valid: false,
      error: 'signed body does not match submission pre-image — tampered submission',
      reason: 'invalid-signature',
    };
  }

  // -------------------------------------------------------------------
  // §6.7 — Accept
  // -------------------------------------------------------------------
  return {
    valid: true,
    masterFingerprint: chainResult.masterFingerprint,
    masterPublicKey: chainResult.masterPublicKey,
    leafSet: chainResult.leafSet,
  };
}
