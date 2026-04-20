// SPDX-License-Identifier: AGPL-3.0-or-later
//
// auth.js — Challenge-response authentication for sovereign entities
// Consumer: daemon (kingofalldata.com server, Passenger local daemon)
//
// Implements the sovereign auth flow:
//   1. Server issues a nonce challenge (SovereignAuth.challenge)
//   2. Client signs the nonce with their Ed25519 private key (SovereignAuth.respond)
//   3. Server verifies the signature against the entity's registered public key
//      (SovereignAuth.verify) and establishes a session
//
// The public key IS the identity — no username/password. The chain is where you
// verify the key is legitimate (look up the derived CDN address, confirm broadcasts
// exist via sigchain-discovery).
//
// API surface (all methods on SovereignAuth):
//   SovereignAuth.challenge()                               → { nonce, expires }
//   SovereignAuth.respond(nonce, privateKey)                → Promise<{ nonce, signature }>
//   SovereignAuth.verify(nonce, signatureB64url, pubKeyB64url) → Promise<{ valid, error }>
//   SovereignAuth.verifyFromDir(nonce, signatureB64url, entityDir) → Promise<{ valid, error }>
//
// Session establishment after successful verify is left to the calling app
// (Accounts or custom session store). SovereignAuth only handles the crypto layer.

'use strict';

const crypto = require('crypto');

// Nonce TTL in milliseconds. Challenges expire after 5 minutes.
const NONCE_TTL_MS = 5 * 60 * 1000;

// In-memory nonce store. Key = nonce hex string, value = expiry timestamp.
// For production: replace with a MongoDB-backed store to survive restarts.
// Nonces are single-use — verified nonces are deleted immediately.
const pendingNonces = new Map();

// Sweep expired nonces periodically (every 60 seconds)
Meteor.setInterval(function() {
  const now = Date.now();
  for (const [nonce, expires] of pendingNonces.entries()) {
    if (expires <= now) {
      pendingNonces.delete(nonce);
    }
  }
}, 60 * 1000);

// ── Helpers ───────────────────────────────────────────────────────────────────

let ed;
async function ensureEd() {
  if (!ed) {
    ed = await import('@noble/ed25519');
  }
}

/**
 * Decode a base64url (no-padding) string to a Uint8Array.
 * Mirrors the client-side fromBase64Url utility.
 */
function fromBase64Url(str) {
  // Node 16+ Buffer.from handles base64url natively
  return new Uint8Array(Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

/**
 * Encode a Uint8Array / Buffer to base64url (no padding).
 */
function toBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Build the canonical challenge message bytes that the client signs.
 * Format: UTF-8 "koad-io:auth:v1:<nonce>"
 * The prefix prevents signature reuse in other contexts.
 *
 * @param {string} nonce — hex nonce string
 * @returns {Uint8Array}
 */
function challengeMessage(nonce) {
  return new Uint8Array(Buffer.from(`koad-io:auth:v1:${nonce}`, 'utf8'));
}

// ── SovereignAuth ─────────────────────────────────────────────────────────────

const SovereignAuth = {};

/**
 * Issue a fresh nonce challenge.
 * The nonce is stored server-side with a TTL. Clients must sign it within
 * NONCE_TTL_MS milliseconds.
 *
 * @returns {{ nonce: string, expires: number }} — nonce in hex, expiry as Unix ms timestamp
 */
SovereignAuth.challenge = function() {
  const nonce = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + NONCE_TTL_MS;
  pendingNonces.set(nonce, expires);
  return { nonce, expires };
};

/**
 * Sign a nonce challenge with the given Ed25519 private key (seed).
 * Called client-side (or by an entity daemon acting on behalf of the entity).
 *
 * @param {string}     nonce      — hex nonce string from SovereignAuth.challenge()
 * @param {Uint8Array} privateKey — 32-byte Ed25519 seed
 * @returns {Promise<{ nonce: string, signature: string }>} — signature in base64url
 */
SovereignAuth.respond = async function(nonce, privateKey) {
  await ensureEd();
  const message = challengeMessage(nonce);
  const sigBytes = await ed.sign(message, privateKey);
  return { nonce, signature: toBase64Url(sigBytes) };
};

/**
 * Verify a challenge-response signature server-side.
 * Checks: nonce existence, nonce TTL, Ed25519 signature.
 * On success, the nonce is consumed (deleted) — cannot be replayed.
 *
 * @param {string} nonce          — hex nonce string
 * @param {string} signatureB64   — base64url Ed25519 signature
 * @param {string} pubKeyB64      — base64url Ed25519 public key (32 bytes)
 * @returns {Promise<{ valid: boolean, error: string|null }>}
 */
SovereignAuth.verify = async function(nonce, signatureB64, pubKeyB64) {
  await ensureEd();

  // Check nonce exists and has not expired
  const expires = pendingNonces.get(nonce);
  if (!expires) {
    return { valid: false, error: 'auth: nonce not found or already used' };
  }
  if (Date.now() > expires) {
    pendingNonces.delete(nonce);
    return { valid: false, error: 'auth: nonce expired' };
  }

  let sigBytes, pubKeyBytes;
  try {
    sigBytes    = fromBase64Url(signatureB64);
    pubKeyBytes = fromBase64Url(pubKeyB64);
  } catch (e) {
    return { valid: false, error: `auth: key/signature decode error: ${e.message}` };
  }

  if (pubKeyBytes.length !== 32) {
    return { valid: false, error: `auth: expected 32-byte public key, got ${pubKeyBytes.length}` };
  }
  if (sigBytes.length !== 64) {
    return { valid: false, error: `auth: expected 64-byte signature, got ${sigBytes.length}` };
  }

  const message = challengeMessage(nonce);
  let ok;
  try {
    ok = await ed.verify(sigBytes, message, pubKeyBytes);
  } catch (e) {
    return { valid: false, error: `auth: signature verification error: ${e.message}` };
  }

  if (!ok) {
    return { valid: false, error: 'auth: signature verification failed' };
  }

  // Consume nonce — prevents replay
  pendingNonces.delete(nonce);

  return { valid: true, error: null };
};

/**
 * Server-side verify using a public key read from the entity's id/ directory.
 * Convenience wrapper for the daemon — reads the public key from disk rather
 * than requiring the caller to supply it.
 *
 * @param {string} nonce        — hex nonce string
 * @param {string} signatureB64 — base64url Ed25519 signature
 * @param {string} entityDir    — absolute path to entity home dir
 * @returns {Promise<{ valid: boolean, error: string|null }>}
 */
SovereignAuth.verifyFromDir = async function(nonce, signatureB64, entityDir) {
  const keystore = globalThis.SovereignProfileKeystore;
  if (!keystore) {
    return { valid: false, error: 'auth: SovereignProfileKeystore not available — keystore.js not loaded' };
  }

  let pubKeyBytes;
  try {
    pubKeyBytes = keystore.readPublicKey(entityDir);
  } catch (e) {
    return { valid: false, error: `auth: keystore read error: ${e.message}` };
  }

  const pubKeyB64 = toBase64Url(pubKeyBytes);
  return SovereignAuth.verify(nonce, signatureB64, pubKeyB64);
};

// ── Pending nonce count (for monitoring) ─────────────────────────────────────

/**
 * Return the count of currently pending (non-expired) nonces.
 * Useful for health checks and monitoring.
 *
 * @returns {number}
 */
SovereignAuth.pendingNonceCount = function() {
  const now = Date.now();
  let count = 0;
  for (const expires of pendingNonces.values()) {
    if (expires > now) count++;
  }
  return count;
};

// Attach to globalThis for cross-file access
globalThis.SovereignAuth = SovereignAuth;

export { SovereignAuth };
