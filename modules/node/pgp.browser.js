// pgp.browser.js — PGP sign/verify primitive for koad.deps.pgp (browser / Meteor client)
//
// Implements VESTA-SPEC-148 v1.0 — browser path.
// Same API surface as pgp.js (Node); loads the browserified kbpgp bundle
// lazily on first call so pages that don't need PGP don't pay the ~1.1 MB load.
//
// Usage (via koad.deps.pgp — set up by client/deps.js in koad:io-core):
//   const result = await koad.deps.pgp.verify(clearsignArmored, armoredPubKey);
//   // { verified: true, body: '...', fingerprint: '...' }
//
// Browser use-case priority (per flight plan + SPEC-148 use-case note):
//   PRIMARY   — verify: client validates a player's clearsigned declaration
//   ADVANCED  — clearsign: requires exposing private key material to the browser;
//               document as opt-in / cautious path only.
//
// Lazy-load strategy: a <script> tag is injected once; subsequent calls reuse
// window.kbpgp. This is the most Meteor-compatible path — dynamic import() of
// a UMD bundle inside Meteor's module graph can confuse the bundler.

// Served from the consuming app's public/ directory.
// For kingofalldata.com: public/kbpgp.bundle.min.js → /kbpgp.bundle.min.js
// Any Meteor app that imports koad.deps.pgp must copy this file to its own public/.
const BUNDLE_PATH = '/kbpgp.bundle.min.js';

let _kbpgp = null;
let _loadPromise = null;

function _loadKbpgp() {
  if (_kbpgp) return Promise.resolve(_kbpgp);
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise(function(resolve, reject) {
    // If already on window (e.g. server-side render stub or test), use it.
    if (typeof window !== 'undefined' && window.kbpgp) {
      _kbpgp = window.kbpgp;
      return resolve(_kbpgp);
    }

    var script = document.createElement('script');
    script.src = BUNDLE_PATH;
    script.async = true;
    script.onload = function() {
      if (!window.kbpgp) {
        return reject(new Error('[koad.deps.pgp] kbpgp bundle loaded but window.kbpgp is not defined'));
      }
      _kbpgp = window.kbpgp;
      resolve(_kbpgp);
    };
    script.onerror = function() {
      _loadPromise = null; // allow retry
      reject(new Error('[koad.deps.pgp] Failed to load kbpgp bundle from ' + BUNDLE_PATH));
    };
    document.head.appendChild(script);
  });

  return _loadPromise;
}

/**
 * Sign a body string using a kbpgp KeyManager, producing an RFC 4880 clearsign.
 *
 * ADVANCED / CAUTIOUS: calling this in the browser requires the player's private
 * key to be loaded into a KeyManager in-browser. Only use when the player has
 * explicitly chosen to load their key locally (e.g. via file-picker + passphrase).
 *
 * @param {string} body - Plaintext to sign
 * @param {object} km   - kbpgp KeyManager instance with private key loaded
 * @returns {Promise<string>} Armored clearsign text
 */
export async function clearsign(body, km) {
  if (typeof body !== 'string') throw new TypeError('[koad.deps.pgp.clearsign] body must be a string');
  if (!km || typeof km.find_signing_pgp_key !== 'function') {
    throw new TypeError('[koad.deps.pgp.clearsign] km must be a kbpgp KeyManager with a private key');
  }

  const kbpgp = await _loadKbpgp();

  const signing_key = km.find_signing_pgp_key();
  if (!signing_key) {
    throw new Error('[koad.deps.pgp.clearsign] No signing key found in KeyManager — is the private key loaded?');
  }

  return new Promise(function(resolve, reject) {
    kbpgp.clearsign({ msg: body, signing_key }, function(err, armored) {
      if (err) return reject(new Error('[koad.deps.pgp.clearsign] kbpgp error: ' + err.message));
      resolve(armored);
    });
  });
}

/**
 * Verify a clearsigned document in-browser.
 * Primary browser-side PGP operation per SPEC-148 use-case note.
 *
 * @param {string} clearsignArmored - The clearsign document to verify
 * @param {object|string} publicKey  - kbpgp KeyManager instance OR armored public key string
 * @returns {Promise<{verified: boolean, body: string, fingerprint: string, error?: string}>}
 *
 * SPEC-148 §3.4: NEVER throws on bad signature. Returns { verified: false, error } instead.
 */
export async function verify(clearsignArmored, publicKey) {
  if (typeof clearsignArmored !== 'string') {
    throw new TypeError('[koad.deps.pgp.verify] clearsignArmored must be a string');
  }

  const kbpgp = await _loadKbpgp();

  let pubkm;
  if (typeof publicKey === 'string') {
    pubkm = await new Promise(function(resolve, reject) {
      kbpgp.KeyManager.import_from_armored_pgp({ armored: publicKey }, function(err, km) {
        if (err) return reject(new Error('[koad.deps.pgp.verify] Failed to import public key: ' + err.message));
        resolve(km);
      });
    });
  } else if (publicKey && typeof publicKey.find_signing_pgp_key === 'function') {
    pubkm = publicKey;
  } else {
    throw new TypeError('[koad.deps.pgp.verify] publicKey must be a kbpgp KeyManager instance or an armored public key string');
  }

  const ring = new kbpgp.keyring.KeyRing();
  ring.add_key_manager(pubkm);

  return new Promise(function(resolve) {
    kbpgp.unbox({ armored: clearsignArmored, keyfetch: ring }, function(err, literals) {
      if (err) {
        return resolve({ verified: false, body: '', fingerprint: '', error: err.message });
      }

      try {
        const lit = literals[0];
        const body = lit.toString();
        const ds = lit.get_data_signer();
        const signerKm = ds ? ds.get_key_manager() : null;
        const fpBuf = signerKm ? signerKm.get_pgp_fingerprint() : null;
        const fingerprint = fpBuf ? fpBuf.toString('hex').toLowerCase() : '';
        resolve({ verified: true, body, fingerprint });
      } catch (extractErr) {
        resolve({ verified: false, body: '', fingerprint: '', error: 'Failed to extract result: ' + extractErr.message });
      }
    });
  });
}
