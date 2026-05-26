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
const fs = Npm.require('fs');
const path = Npm.require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches SPEC-185 §6.1 + SPEC-140 §3.3
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CHALLENGE_PREFIX = 'koad-io:pgp-auth:v1:'; // distinct from Ed25519 prefix in SPEC-140
const FINGERPRINT_RE = /^[0-9A-F]{40}$/; // 40-char uppercase hex

// ---------------------------------------------------------------------------
// In-memory nonce store
// Key: "<fingerprint>:<nonce>" (prevents cross-fingerprint reuse)
// Value: expiry timestamp (Unix ms)
// ---------------------------------------------------------------------------

const _nonces = new Map();

// Session token store — token → { fingerprint, expires }
const _tokens = new Map();

// Known keys store — fingerprint → armoredKey (persists for server lifetime)
const _knownKeys = new Map();

// Sweep expired nonces and tokens periodically (60s interval)
Meteor.setInterval(function () {
  const now = Date.now();
  for (const [key, expires] of _nonces.entries()) {
    if (now > expires) _nonces.delete(key);
  }
  for (const [token, entry] of _tokens.entries()) {
    if (now > entry.expires) _tokens.delete(token);
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

async function resolvePublicKeyForFingerprint(fp, explicitPublicKey = null) {
  let armoredKey = explicitPublicKey || null;

  if (!armoredKey) {
    armoredKey = _knownKeys.get(fp) || null;
  }

  if (!armoredKey && typeof WellKnownKeys !== 'undefined') {
    const knownEntry = WellKnownKeys.findOne({ fingerprint: fp });
    if (knownEntry && knownEntry.armoredKey) {
      armoredKey = knownEntry.armoredKey;
    }
  }

  if (!armoredKey) {
    armoredKey = await fetchFromKeyserver(fp);
  }

  return armoredKey || null;
}

function derivePortalCreator() {
  const entity = (globalThis.koad && globalThis.koad.entity) || 'portal';
  const internals = (globalThis.koad && globalThis.koad.internals) || 'auth.entityLogin';
  return `${entity}://${internals}`;
}

async function findOrCreatePortalUser(handle) {
  const username = String(handle || '').trim().toLowerCase();
  if (!username) {
    throw new Meteor.Error('invalid-handle', 'Resolved handle is empty');
  }

  let user = await Meteor.users.findOneAsync({ username }, { fields: { _id: 1, username: 1, services: 1 } });
  if (user) return user;

  const userId = (globalThis.koad && globalThis.koad.generate && typeof globalThis.koad.generate.cid === 'function')
    ? globalThis.koad.generate.cid(username)
    : Random.id();

  try {
    await Meteor.users.insertAsync({
      _id: userId,
      username,
      creator: derivePortalCreator(),
      created: new Date(),
      services: { resume: { loginTokens: [] } },
      counters: { login: 0, pageviews: 0 },
      invitations: { quota: 9, spent: 0 },
    });
  } catch (err) {
    const dup = await Meteor.users.findOneAsync({ username }, { fields: { _id: 1, username: 1, services: 1 } });
    if (dup) return dup;
    throw err;
  }

  user = await Meteor.users.findOneAsync({ _id: userId }, { fields: { _id: 1, username: 1, services: 1 } });
  if (!user) {
    throw new Meteor.Error('user-create-failed', `Failed to create portal user for ${username}`);
  }
  return user;
}

async function insertPortalLoginToken(userId, meta = {}) {
  const stampedToken = Accounts._generateStampedLoginToken();
  await Accounts._insertLoginToken(userId, stampedToken);

  const hashedToken = Accounts._hashLoginToken(stampedToken.token);
  const user = await Meteor.users.findOneAsync({ _id: userId }, { fields: { 'services.resume.loginTokens': 1 } });
  const loginTokens = user?.services?.resume?.loginTokens || [];
  const tokenIndex = loginTokens.findIndex((tokenEntry) => tokenEntry.hashedToken === hashedToken);

  if (tokenIndex !== -1) {
    const setObj = {
      [`services.resume.loginTokens.${tokenIndex}.portalHandle`]: meta.handle || '',
      [`services.resume.loginTokens.${tokenIndex}.portalKind`]: meta.kind || '',
      [`services.resume.loginTokens.${tokenIndex}.portalFingerprint`]: meta.signerFingerprint || '',
      [`services.resume.loginTokens.${tokenIndex}.portalCanonicalFingerprint`]: meta.canonicalFingerprint || '',
      [`services.resume.loginTokens.${tokenIndex}.portalBondType`]: meta.bondType || '',
      [`services.resume.loginTokens.${tokenIndex}.memo`]: meta.memo || `portal:${meta.handle || userId}`,
    };

    await Meteor.users.updateAsync({ _id: userId }, { $set: setObj });
  }

  return {
    token: stampedToken.token,
    tokenExpires: Accounts._tokenExpiration(stampedToken.when),
  };
}

function extractBondTypeFromPath(bondPath) {
  if (typeof bondPath !== 'string' || !bondPath.trim()) return null;
  const trimmed = bondPath.trim();

  try {
    if (path.isAbsolute(trimmed) && fs.existsSync(trimmed)) {
      const content = fs.readFileSync(trimmed, 'utf8');
      const match = content.match(/^(?:bond_type|bondType|type):\s*["']?([^"'\n]+)["']?/m);
      if (match && match[1]) return match[1].trim();
    }
  } catch (_) {
    // fall through to basename heuristics
  }

  const base = path.basename(trimmed).replace(/\.md(?:\.asc)?$/i, '');
  const known = base.match(/(authorized-agent|authorized-builder|authorized-specialist|peer|family|friend|employee|member|vendor|customer)/i);
  return known ? known[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Meteor Methods
// ---------------------------------------------------------------------------

Meteor.methods({
  /**
   * auth.challenge — Issue a nonce challenge for a given fingerprint or public key.
   *
   * Input: { fingerprint?, publicKey? }  — at least one required
   *   fingerprint: 40-char hex (upper or lower, spaces stripped)
   *   publicKey: armored PGP public key block — fingerprint extracted from it
   * Returns: { nonce, fingerprint, expires }
   * Throws: Meteor.Error on invalid input
   */
  'auth.challenge': async function ({ fingerprint, publicKey } = {}) {
    let fp = normalizeFingerprint(fingerprint);

    // If publicKey provided, import it and extract/confirm fingerprint
    if (publicKey) {
      let km;
      try {
        km = await importPublicKey(publicKey);
      } catch (err) {
        throw new Meteor.Error('key-import-failed', 'Failed to import public key: ' + err.message);
      }
      const keyFp = kmFingerprint(km);
      if (fp && keyFp !== fp) {
        throw new Meteor.Error('fingerprint-mismatch', `key fingerprint (${keyFp}) does not match provided fingerprint (${fp})`);
      }
      fp = keyFp;
      // Store for future fingerprint-only lookups
      if (fp) _knownKeys.set(fp, publicKey);
    }

    if (!fp) {
      throw new Meteor.Error('invalid-input', 'Provide a 40-char hex fingerprint or an armored PGP public key');
    }

    // Check if we can resolve this fingerprint to a key (for verify later)
    // Don't block the challenge — just flag whether we have the key
    let keyKnown = !!publicKey || _knownKeys.has(fp);
    if (!keyKnown && typeof WellKnownKeys !== 'undefined') {
      keyKnown = !!WellKnownKeys.findOne({ fingerprint: fp });
    }
    if (!keyKnown) {
      // Try keyserver (async, but worth it to give the right signal)
      const ksKey = await fetchFromKeyserver(fp);
      if (ksKey) {
        _knownKeys.set(fp, ksKey);
        keyKnown = true;
      }
    }

    const nonce = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + NONCE_TTL_MS;
    const storeKey = `${fp}:${nonce}`;
    _nonces.set(storeKey, expires);

    log.debug(`[auth.challenge] issued nonce for ${fp.slice(0, 8)}... keyKnown=${keyKnown}`);
    return { nonce, fingerprint: fp, expires, keyKnown };
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

    // Resolve public key (priority: body → knownKeys → WellKnownKeys → keyserver)
    const armoredKey = await resolvePublicKeyForFingerprint(fp, publicKey || null);

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

    // Store key for future fingerprint-only lookups
    if (armoredKey && !_knownKeys.has(fp)) {
      _knownKeys.set(fp, armoredKey);
    }

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

    // Issue a session token for persistence across page refreshes
    const token = crypto.randomBytes(32).toString('hex');
    _tokens.set(token, { fingerprint: fp, expires: Date.now() + TOKEN_TTL_MS });

    return { fingerprint: fp, token };
  },

  /**
   * auth.entityLogin — Verify a clearsigned challenge and mint a Meteor login token.
   *
   * Input: { fingerprint, clearsigned, publicKey?, bond_path? }
   * Returns: { id, token, tokenExpires }
   */
  'auth.entityLogin': async function ({ fingerprint, clearsigned, publicKey, bond_path } = {}) {
    const fp = normalizeFingerprint(fingerprint);
    if (!fp) {
      throw new Meteor.Error('invalid-fingerprint', 'fingerprint must be 40 hex characters');
    }
    if (typeof clearsigned !== 'string' || !clearsigned.includes('BEGIN PGP SIGNED MESSAGE')) {
      throw new Meteor.Error('invalid-clearsign', 'clearsigned must be a PGP clearsigned message');
    }

    const armoredKey = await resolvePublicKeyForFingerprint(fp, publicKey || null);
    if (!armoredKey) {
      throw new Meteor.Error(
        'public-key-not-found',
        'public key not found — include publicKey field or upload to keys.openpgp.org'
      );
    }

    let km;
    try {
      km = await importPublicKey(armoredKey);
    } catch (err) {
      throw new Meteor.Error('key-import-failed', 'Failed to import public key: ' + err.message);
    }

    const keyFp = kmFingerprint(km);
    if (!keyFp || keyFp !== fp) {
      throw new Meteor.Error(
        'fingerprint-mismatch',
        `key fingerprint (${keyFp}) does not match claimed fingerprint (${fp})`
      );
    }

    const result = await verifyClearsign(clearsigned, km);
    if (!result.verified) {
      throw new Meteor.Error('signature-invalid', result.error || 'signature verification failed');
    }
    if (result.fingerprint !== fp) {
      throw new Meteor.Error('signer-mismatch', 'signer fingerprint does not match claimed fingerprint');
    }

    const signedBody = (result.body || '').trim();
    if (!signedBody.startsWith(CHALLENGE_PREFIX)) {
      throw new Meteor.Error('challenge-mismatch', 'signed body is not a koad-io auth challenge');
    }

    const nonce = signedBody.slice(CHALLENGE_PREFIX.length).trim();
    if (!/^[0-9a-f]{64}$/i.test(nonce)) {
      throw new Meteor.Error('invalid-nonce', 'signed challenge nonce is malformed');
    }

    const storeKey = `${fp}:${nonce}`;
    const expires = _nonces.get(storeKey);
    if (expires === undefined) {
      throw new Meteor.Error('nonce-not-found', 'nonce not found or already used');
    }
    if (Date.now() > expires) {
      _nonces.delete(storeKey);
      throw new Meteor.Error('nonce-expired', 'nonce expired — request a new challenge');
    }

    _nonces.delete(storeKey);
    if (!_knownKeys.has(fp)) {
      _knownKeys.set(fp, armoredKey);
    }

    const principal = globalThis.FingerprintEntityIndex && typeof globalThis.FingerprintEntityIndex.lookup === 'function'
      ? globalThis.FingerprintEntityIndex.lookup(fp)
      : null;

    if (!principal || !principal.handle) {
      throw new Meteor.Error('unknown-fingerprint', `No kingdom identity is indexed for fingerprint ${fp}`);
    }

    const handle = String(principal.handle).trim().toLowerCase();
    const canonicalFingerprint = principal.canonicalFingerprint || fp;
    const bondType = extractBondTypeFromPath(bond_path);
    const sessionId = this.connection && this.connection.id;

    if (sessionId) {
      await ApplicationSessions.updateAsync(
        { _id: sessionId },
        {
          $set: {
            fingerprint: canonicalFingerprint,
            identifiedAt: new Date(),
            fingerprintSource: principal.kind || 'portal',
            portalHandle: handle,
            portalKind: principal.kind || null,
            portalSignerFingerprint: fp,
            portalCanonicalFingerprint: canonicalFingerprint,
            portalBondType: bondType || null,
          },
        }
      );
    }

    const user = await findOrCreatePortalUser(handle);
    const login = await insertPortalLoginToken(user._id, {
      handle,
      kind: principal.kind || null,
      signerFingerprint: fp,
      canonicalFingerprint,
      bondType,
      memo: `portal:${handle}`,
    });

    log.system(`[auth.entityLogin] minted portal token for ${handle} via ${fp.slice(0, 8)}...`);
    return { id: user._id, token: login.token, tokenExpires: login.tokenExpires };
  },

  /**
   * auth.resume — Re-tag the current DDP session using a previously issued token.
   *
   * Input: { token }
   * Returns: { fingerprint }
   * Throws: Meteor.Error if token is invalid or expired
   */
  'auth.resume': async function ({ token } = {}) {
    if (typeof token !== 'string' || token.length !== 64) {
      throw new Meteor.Error('invalid-token', 'token must be a 64-char hex string');
    }

    const entry = _tokens.get(token);
    if (!entry) {
      throw new Meteor.Error('token-not-found', 'session token not found or expired');
    }

    if (Date.now() > entry.expires) {
      _tokens.delete(token);
      throw new Meteor.Error('token-expired', 'session token expired — identify again');
    }

    const sessionId = this.connection && this.connection.id;
    if (!sessionId) {
      throw new Meteor.Error('no-session', 'No DDP session found for this connection');
    }

    await ApplicationSessions.updateAsync(
      { _id: sessionId },
      { $set: { fingerprint: entry.fingerprint, identifiedAt: new Date() } }
    );

    log.debug(`[auth.resume] session ${sessionId.slice(0, 8)}... resumed as ${entry.fingerprint.slice(0, 8)}...`);
    return { fingerprint: entry.fingerprint };
  },

  /**
   * auth.logout — Clear the fingerprint from the current session and invalidate token.
   */
  'auth.logout': async function ({ token } = {}) {
    const sessionId = this.connection && this.connection.id;
    if (!sessionId) return;

    // Invalidate the token if provided
    if (token && typeof token === 'string') {
      _tokens.delete(token);
    }

    await ApplicationSessions.updateAsync(
      { _id: sessionId },
      { $set: { fingerprint: null, identifiedAt: null } }
    );

    log.debug(`[auth.logout] session ${sessionId.slice(0, 8)}... cleared`);
    return { ok: true };
  },
});

log.success('loaded koad:io-accounts/pgp-auth (VESTA-SPEC-185)');
