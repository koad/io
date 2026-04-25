// pgp.js — Browser-side koad.deps.pgp lazy-loader (Meteor client)
//
// Implements VESTA-SPEC-148 v1.0 browser path.
// Same API surface as ~/.koad-io/modules/node/pgp.js (Node):
//   koad.deps.pgp.clearsign(body, km) → Promise<string>
//   koad.deps.pgp.verify(armored, pubKey) → Promise<{verified, body, fingerprint, error?}>
//
// The kbpgp bundle (~1.1 MB min / ~328 KB gz) is loaded lazily on first call
// via a <script> tag. Pages that don't invoke PGP pay no cost.
//
// Bundle served from: /kbpgp.bundle.min.js (public/ in any consuming Meteor app).
// The bundle was built from kbpgp 2.1.17 Node source via browserify -i sodium -s kbpgp.
//
// Browser use-case priority per SPEC-148 use-case note:
//   PRIMARY   — verify: client validates a player's clearsigned declaration without server round-trip
//   ADVANCED  — clearsign: requires exposing private key material to browser; opt-in / cautious only

const BUNDLE_PATH = '/kbpgp.bundle.min.js';

let _kbpgp = null;
let _loadPromise = null;

function _loadKbpgp() {
  if (_kbpgp) return Promise.resolve(_kbpgp);
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise(function(resolve, reject) {
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
      _loadPromise = null; // allow retry on next call
      reject(new Error('[koad.deps.pgp] Failed to load kbpgp bundle from ' + BUNDLE_PATH));
    };
    document.head.appendChild(script);
  });

  return _loadPromise;
}

/**
 * Sign a body string using a kbpgp KeyManager, producing an RFC 4880 clearsign.
 *
 * ADVANCED/CAUTIOUS: requires the player's private key to be loaded in-browser.
 * Only use when the player has explicitly chosen to load their key locally.
 *
 * @param {string} body - Plaintext to sign
 * @param {object} km   - kbpgp KeyManager with private key loaded
 * @returns {Promise<string>} Armored clearsign text
 */
async function clearsign(body, km) {
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
 * Primary browser-side PGP operation — no server round-trip.
 *
 * @param {string} clearsignArmored - The clearsign document
 * @param {object|string} publicKey  - kbpgp KeyManager OR armored public key string
 * @returns {Promise<{verified: boolean, body: string, fingerprint: string, error?: string}>}
 *
 * SPEC-148 §3.4: NEVER throws on bad signature. Returns { verified: false, error }.
 */
async function verify(clearsignArmored, publicKey) {
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
    throw new TypeError('[koad.deps.pgp.verify] publicKey must be a kbpgp KeyManager or an armored public key string');
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

// Wire onto koad.deps.pgp — same pattern as koad.deps.ed, koad.deps.CID, etc.
globalThis.koad = globalThis.koad || {};
koad.deps = koad.deps || {};
koad.deps.pgp = { clearsign, verify };

export { clearsign, verify };
