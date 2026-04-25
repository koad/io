// pgp.js — PGP sign/verify primitive for koad.deps.pgp (ESM)
//
// Implements VESTA-SPEC-148 v1.0.
// Exposes two operations over kbpgp (CommonJS), wrapped in a clean async/await
// interface. kbpgp owns the cryptography; this module owns the promise contract
// and error semantics.
//
// Consumers:
//   import { clearsign, verify } from '@koad-io/node/pgp';
//   // or via koad object:
//   koad.deps.pgp.clearsign(body, km)
//   koad.deps.pgp.verify(armoredText, pubKey)
//
// Implementation notes (SPEC-148 §4):
//   - kbpgp.clearsign() requires `signing_key`, NOT `sign_with`.
//     Use km.find_signing_pgp_key() SYNCHRONOUSLY — no callback.
//     The async variant hangs on Node 22 (iced-runtime edge case).
//   - kbpgp.box() is NOT clearsign — it produces BEGIN PGP MESSAGE, not
//     BEGIN PGP SIGNED MESSAGE. Never use box() for declarations.
//   - verify() NEVER throws on bad signature; returns { verified: false, error }.

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const kbpgp = _require('kbpgp');

/**
 * Sign a body string using a kbpgp KeyManager, producing an RFC 4880 clearsign.
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

  // SPEC-148 §4: find_signing_pgp_key() MUST be called synchronously.
  // The callback variant hangs on Node 22.
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
 * Verify a clearsigned document. Accepts both kbpgp-produced and gpg-produced text.
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

  // Load the public key into a KeyManager if we got an armored string
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

  // Build a KeyRing and verify
  const ring = new kbpgp.keyring.KeyRing();
  ring.add_key_manager(pubkm);

  return new Promise(function(resolve) {
    kbpgp.unbox({ armored: clearsignArmored, keyfetch: ring }, function(err, literals) {
      if (err) {
        return resolve({ verified: false, body: '', fingerprint: '', error: err.message });
      }

      try {
        const lit = literals[0];
        // body: canonical signed text, LF-normalized (kbpgp handles this)
        const body = lit.toString();
        // fingerprint: 40-hex lowercase
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
