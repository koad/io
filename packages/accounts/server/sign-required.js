// sign-required.js — SPEC-185 §8.8 observe-mode capability tier
//
// Helpers for guarding DDP methods and publications by capability tier.
//
// Two tiers:
//   Observe-mode: session.fingerprint is set (delegated OR self)
//   Sign-mode:    fingerprint is set AND caller presents a fresh proof
//
// Sign-required proof shape (per Vesta §8.8):
//   proof: {
//     ts:          ISO 8601 UTC — within 60-second window
//     signature:   PGP clearsign of "koad-io:method-proof:v1:<methodName>:<ts>"
//     fingerprint: 40-hex — must match this.connection's session fingerprint
//   }
//
// The methodName is included in the signed payload to prevent cross-method reuse.
// The ts window is 60 seconds (matches SPEC-185 §6.1 nonce TTL for consistency).
//
// Public API (exported as globals on server):
//   requireObserveMode(sessionId)         — throws if not observe-mode-OK
//   requireSignMode(sessionId, methodName, proof)  — async; throws if proof invalid

const kbpgp = Npm.require('kbpgp');

const SIGN_PROOF_WINDOW_MS = 60 * 1000; // 60-second window per VESTA-SPEC-185 §8.8 OQ-3
const SIGN_PROOF_PREFIX = 'koad-io:method-proof:v1:';
const FINGERPRINT_RE = /^[0-9A-F]{40}$/;

// ---------------------------------------------------------------------------
// Internal: import armored key and verify clearsign
// These are duplicated from pgp-auth.js to keep this file self-contained.
// If this becomes a maintenance concern, extract to a shared pgp-utils.js.
// ---------------------------------------------------------------------------

function importPublicKey(armored) {
  return new Promise(function (resolve, reject) {
    kbpgp.KeyManager.import_from_armored_pgp({ armored }, function (err, km) {
      if (err) return reject(new Error('key-import: ' + err.message));
      resolve(km);
    });
  });
}

function verifyClearsign(clearsignArmored, km) {
  const ring = new kbpgp.keyring.KeyRing();
  ring.add_key_manager(km);
  return new Promise(function (resolve) {
    kbpgp.unbox({ armored: clearsignArmored, keyfetch: ring }, function (err, literals) {
      if (err) return resolve({ verified: false, body: '', fingerprint: '', error: err.message });
      try {
        const lit = literals[0];
        let body = lit.toString();
        if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
        body = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const ds = lit.get_data_signer();
        const signerKm = ds ? ds.get_key_manager() : null;
        const fpBuf = signerKm ? signerKm.get_pgp_fingerprint() : null;
        const fingerprint = fpBuf ? fpBuf.toString('hex').toUpperCase() : '';
        resolve({ verified: true, body, fingerprint });
      } catch (extractErr) {
        resolve({ verified: false, body: '', fingerprint: '', error: 'extract: ' + extractErr.message });
      }
    });
  });
}

/**
 * Resolve a public key for a fingerprint.
 * Checks WellKnownKeys collection (if available) and keys.openpgp.org.
 *
 * @param {string} fp — normalized 40-hex fingerprint
 * @returns {string|null} armored public key or null
 */
async function resolvePublicKey(fp) {
  if (typeof WellKnownKeys !== 'undefined') {
    const entry = WellKnownKeys.findOne({ fingerprint: fp });
    if (entry && entry.armoredKey) return entry.armoredKey;
  }
  // Keyserver fallback
  try {
    const res = await fetch(`https://keys.openpgp.org/vks/v1/by-fingerprint/${fp}`, {
      headers: { Accept: 'application/pgp-keys' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.includes('BEGIN PGP PUBLIC KEY BLOCK') ? text : null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * requireObserveMode
 *
 * Confirms the given sessionId has a non-null fingerprint in ApplicationSessions.
 * Throws Meteor.Error('unauthorized') if not authenticated.
 *
 * Call with this.connection.id inside a Meteor method.
 *
 * @param {string} sessionId — from this.connection.id
 * @returns {Promise<{ fingerprint: string, fingerprintSource: string }>}
 */
async function requireObserveMode(sessionId) {
  if (!sessionId) throw new Meteor.Error('unauthorized', 'No DDP session');
  const session = await ApplicationSessions.findOneAsync({ _id: sessionId });
  if (!session || !session.fingerprint) {
    throw new Meteor.Error('unauthorized', 'Not authenticated — present a PGP key at /me');
  }
  return {
    fingerprint: session.fingerprint,
    fingerprintSource: session.fingerprintSource || null,
  };
}

/**
 * requireSignMode
 *
 * Confirms observe-mode, then verifies a fresh proof signature from the caller.
 * The proof must be signed with the key matching the session's fingerprint.
 *
 * @param {string} sessionId — from this.connection.id
 * @param {string} methodName — exact name of the calling method (bound to signature)
 * @param {object} proof — { ts, signature, fingerprint }
 * @returns {Promise<{ fingerprint: string }>}
 */
async function requireSignMode(sessionId, methodName, proof) {
  const { fingerprint } = await requireObserveMode(sessionId);

  if (!proof || typeof proof !== 'object') {
    throw new Meteor.Error('sign-mode-required', 'proof is required for this method');
  }

  const { ts, signature, fingerprint: proofFp } = proof;

  if (typeof ts !== 'string' || typeof signature !== 'string' || typeof proofFp !== 'string') {
    throw new Meteor.Error('sign-mode-required', 'proof must have ts, signature, and fingerprint fields');
  }

  // Confirm proof fingerprint matches session fingerprint
  const normalizedProofFp = proofFp.replace(/\s/g, '').toUpperCase();
  if (!FINGERPRINT_RE.test(normalizedProofFp) || normalizedProofFp !== fingerprint) {
    throw new Meteor.Error('sign-mode-required', 'proof.fingerprint does not match session fingerprint');
  }

  // Validate timestamp — within 60-second window
  let tsMs;
  try {
    tsMs = new Date(ts).getTime();
  } catch (_) {
    throw new Meteor.Error('sign-mode-required', 'proof.ts is not a valid ISO 8601 timestamp');
  }
  const now = Date.now();
  if (isNaN(tsMs) || Math.abs(now - tsMs) > SIGN_PROOF_WINDOW_MS) {
    throw new Meteor.Error('sign-mode-required', 'proof.ts is outside the 60-second window');
  }

  // Reconstruct expected message: "koad-io:method-proof:v1:<methodName>:<ts>"
  const expectedMsg = `${SIGN_PROOF_PREFIX}${methodName}:${ts}`;

  // Resolve public key for this fingerprint
  const armoredKey = await resolvePublicKey(fingerprint);
  if (!armoredKey) {
    throw new Meteor.Error('sign-mode-required', 'Cannot resolve public key for fingerprint — include publicKey field or upload to keys.openpgp.org');
  }

  let km;
  try {
    km = await importPublicKey(armoredKey);
  } catch (err) {
    throw new Meteor.Error('sign-mode-required', 'Failed to import public key: ' + err.message);
  }

  const result = await verifyClearsign(signature, km);

  if (!result.verified) {
    throw new Meteor.Error('sign-mode-required', 'Proof signature invalid: ' + (result.error || 'unknown'));
  }

  // Confirm signed body matches the expected message
  if (result.body.trim() !== expectedMsg.trim()) {
    throw new Meteor.Error('sign-mode-required', 'Proof body does not match expected message');
  }

  // Confirm signer fingerprint
  if (result.fingerprint !== fingerprint) {
    throw new Meteor.Error('sign-mode-required', 'Proof signer fingerprint mismatch');
  }

  return { fingerprint };
}

// Export as server globals for use in any Meteor method/publication
globalThis.requireObserveMode = requireObserveMode;
globalThis.requireSignMode = requireSignMode;

log.success('loaded koad:io-accounts/sign-required (VESTA-SPEC-185 §8.8)');
