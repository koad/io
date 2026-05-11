// pgp-auth.js — PGP challenge-response authentication methods (VESTA-SPEC-185)
//
// Implements the visitor identification ceremony:
//   auth.challenge  — issue a nonce for a given fingerprint
//   auth.verify     — verify a clearsigned nonce, tag the DDP session
//
// These are Meteor methods (not REST endpoints) because the whole point is to
// tag the DDP connection's ApplicationSession with a fingerprint field.
// this.connection.id gives us the session to tag.
//
// Session model (VESTA-SPEC-185 §8):
//   - No JWT. No Meteor Accounts. No login tokens.
//   - Authentication check in methods/publications: this.connection?.fingerprint
//   - Logout: set session.fingerprint = null on the server.
//
// Public key resolution order (§6.4):
//   1. publicKey field included in verify request body
//   2. WellKnownKeys collection (if populated by daemon indexer)
//   3. keys.openpgp.org keyserver fetch by fingerprint
//   4. Error — ask visitor to include publicKey field

const kbpgp = Npm.require('kbpgp');
const crypto = Npm.require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches SPEC-185 §6.1 + SPEC-140 §3.3
const CHALLENGE_PREFIX = 'koad-io:pgp-auth:v1:'; // distinct from Ed25519 prefix in SPEC-140
const FINGERPRINT_RE = /^[0-9A-F]{40}$/; // 40-char uppercase hex

// ---------------------------------------------------------------------------
// In-memory nonce store
// Key: "<fingerprint>:<nonce>" (prevents cross-fingerprint reuse)
// Value: expiry timestamp (Unix ms)
// ---------------------------------------------------------------------------

const _nonces = new Map();

// Sweep expired nonces periodically (60s interval, same pattern as auth.js)
Meteor.setInterval(function () {
  const now = Date.now();
  for (const [key, expires] of _nonces.entries()) {
    if (now > expires) _nonces.delete(key);
  }
}, 60 * 1000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a PGP fingerprint to 40-char uppercase hex.
 * Strips spaces (keyserver 4-char groups) and uppercases.
 * Returns null if the result is not valid.
 */
function normalizeFingerprint(raw) {
  if (typeof raw !== 'string') return null;
  const norm = raw.replace(/\s/g, '').toUpperCase();
  return FINGERPRINT_RE.test(norm) ? norm : null;
}

/**
 * Import an armored PGP public key into a kbpgp KeyManager.
 * Returns a Promise<KeyManager>.
 */
function importPublicKey(armored) {
  return new Promise(function (resolve, reject) {
    kbpgp.KeyManager.import_from_armored_pgp({ armored }, function (err, km) {
      if (err) return reject(new Error('[pgp-auth] Failed to import public key: ' + err.message));
      resolve(km);
    });
  });
}

/**
 * Extract the 40-char uppercase hex fingerprint from a kbpgp KeyManager.
 */
function kmFingerprint(km) {
  const buf = km.get_pgp_fingerprint();
  return buf ? buf.toString('hex').toUpperCase() : null;
}

/**
 * Verify a clearsigned message against a KeyManager.
 * Returns { verified, body, fingerprint, error? }
 */
function verifyClearsign(clearsignArmored, km) {
  const ring = new kbpgp.keyring.KeyRing();
  ring.add_key_manager(km);

  return new Promise(function (resolve) {
    kbpgp.unbox({ armored: clearsignArmored, keyfetch: ring }, function (err, literals) {
      if (err) {
        return resolve({ verified: false, body: '', fingerprint: '', error: err.message });
      }

      try {
        const lit = literals[0];
        // Normalize line endings to LF (SPEC-148 §3.3)
        let body = lit.toString();
        if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
        body = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const ds = lit.get_data_signer();
        const signerKm = ds ? ds.get_key_manager() : null;
        const fpBuf = signerKm ? signerKm.get_pgp_fingerprint() : null;
        const fingerprint = fpBuf ? fpBuf.toString('hex').toUpperCase() : '';

        resolve({ verified: true, body, fingerprint });
      } catch (extractErr) {
        resolve({ verified: false, body: '', fingerprint: '', error: 'Failed to extract result: ' + extractErr.message });
      }
    });
  });
}

/**
 * Resolve a public key for a given fingerprint via keyserver (keys.openpgp.org).
 * Returns armored public key string, or null if not found.
 */
async function fetchFromKeyserver(fingerprint) {
  try {
    const url = `https://keys.openpgp.org/vks/v1/by-fingerprint/${fingerprint}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/pgp-keys' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----') ? text : null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Meteor Methods
// ---------------------------------------------------------------------------

Meteor.methods({
  /**
   * auth.challenge — Issue a nonce challenge for a given fingerprint.
   *
   * Input: { fingerprint }  (40-char hex, upper or lower, spaces stripped)
   * Returns: { nonce, expires }
   * Throws: Meteor.Error on invalid input
   */
  'auth.challenge': async function ({ fingerprint } = {}) {
    const fp = normalizeFingerprint(fingerprint);
    if (!fp) {
      throw new Meteor.Error('invalid-fingerprint', 'fingerprint must be 40 hex characters');
    }

    const nonce = crypto.randomBytes(32).toString('hex'); // 64-char lowercase hex
    const expires = Date.now() + NONCE_TTL_MS;
    const storeKey = `${fp}:${nonce}`;
    _nonces.set(storeKey, expires);

    log.debug(`[auth.challenge] issued nonce for ${fp.slice(0, 8)}...`);
    return { nonce, expires };
  },

  /**
   * auth.verify — Verify a clearsigned nonce and tag the DDP session.
   *
   * Input: { fingerprint, nonce, clearsign, publicKey? }
   * Returns: { fingerprint }
   * Throws: Meteor.Error on verification failure
   *
   * Side effect: ApplicationSessions.update sets fingerprint + identifiedAt
   * on the session for this.connection.id.
   */
  'auth.verify': async function ({ fingerprint, nonce, clearsign, publicKey } = {}) {
    const fp = normalizeFingerprint(fingerprint);
    if (!fp) {
      throw new Meteor.Error('invalid-fingerprint', 'fingerprint must be 40 hex characters');
    }
    if (typeof nonce !== 'string' || nonce.length !== 64) {
      throw new Meteor.Error('invalid-nonce', 'nonce must be a 64-char hex string');
    }
    if (typeof clearsign !== 'string' || !clearsign.includes('BEGIN PGP SIGNED MESSAGE')) {
      throw new Meteor.Error('invalid-clearsign', 'clearsign must be a PGP clearsigned message');
    }

    // Look up nonce in store
    const storeKey = `${fp}:${nonce}`;
    const expires = _nonces.get(storeKey);

    if (expires === undefined) {
      throw new Meteor.Error('nonce-not-found', 'nonce not found or already used');
    }

    if (Date.now() > expires) {
      _nonces.delete(storeKey);
      throw new Meteor.Error('nonce-expired', 'nonce expired — request a new challenge');
    }

    // Reconstruct expected challenge message
    const expectedChallenge = `${CHALLENGE_PREFIX}${nonce}`;

    // Resolve public key (priority: body → WellKnownKeys → keyserver)
    let armoredKey = publicKey || null;

    if (!armoredKey) {
      // Check WellKnownKeys collection if it exists (daemon-indexed)
      if (typeof WellKnownKeys !== 'undefined') {
        const knownEntry = WellKnownKeys.findOne({ fingerprint: fp });
        if (knownEntry && knownEntry.armoredKey) {
          armoredKey = knownEntry.armoredKey;
        }
      }
    }

    if (!armoredKey) {
      // Attempt keyserver fetch
      armoredKey = await fetchFromKeyserver(fp);
    }

    if (!armoredKey) {
      throw new Meteor.Error(
        'public-key-not-found',
        'public key not found — include publicKey field or upload to keys.openpgp.org'
      );
    }

    // Import and verify
    let km;
    try {
      km = await importPublicKey(armoredKey);
    } catch (err) {
      throw new Meteor.Error('key-import-failed', 'Failed to import public key: ' + err.message);
    }

    // Confirm key fingerprint matches claimed fingerprint (binding check)
    const keyFp = kmFingerprint(km);
    if (!keyFp || keyFp !== fp) {
      throw new Meteor.Error(
        'fingerprint-mismatch',
        `key fingerprint (${keyFp}) does not match claimed fingerprint (${fp})`
      );
    }

    const result = await verifyClearsign(clearsign, km);

    if (!result.verified) {
      throw new Meteor.Error('signature-invalid', result.error || 'signature verification failed');
    }

    // Confirm signed body matches the expected challenge (exact match, LF-normalized)
    const normalizedChallenge = expectedChallenge.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (result.body.trim() !== normalizedChallenge.trim()) {
      throw new Meteor.Error(
        'challenge-mismatch',
        'signed body does not match expected challenge'
      );
    }

    // Confirm signer fingerprint matches (redundant with key check above, but explicit)
    if (result.fingerprint !== fp) {
      throw new Meteor.Error(
        'signer-mismatch',
        'signer fingerprint does not match claimed fingerprint'
      );
    }

    // Consume nonce (single-use)
    _nonces.delete(storeKey);

    // Tag the ApplicationSession with the fingerprint (VESTA-SPEC-185 §8.2)
    const sessionId = this.connection && this.connection.id;
    if (!sessionId) {
      throw new Meteor.Error('no-session', 'No DDP session found for this connection');
    }

    await ApplicationSessions.updateAsync(
      { _id: sessionId },
      { $set: { fingerprint: fp, identifiedAt: new Date() } }
    );

    log.system(`[auth.verify] session ${sessionId.slice(0, 8)}... identified as ${fp.slice(0, 8)}...`);

    return { fingerprint: fp };
  },

  /**
   * auth.logout — Clear the fingerprint from the current session.
   * No-op if the session is already unauthenticated.
   */
  'auth.logout': async function () {
    const sessionId = this.connection && this.connection.id;
    if (!sessionId) return;

    await ApplicationSessions.updateAsync(
      { _id: sessionId },
      { $set: { fingerprint: null, identifiedAt: null } }
    );

    log.debug(`[auth.logout] session ${sessionId.slice(0, 8)}... cleared`);
    return { ok: true };
  },
});

log.success('loaded koad:io-accounts/pgp-auth (VESTA-SPEC-185)');
