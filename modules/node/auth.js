// SPDX-License-Identifier: AGPL-3.0-or-later
//
// auth.js — Challenge-response Ed25519 authentication primitive (ESM)
//
// Pure identity-layer crypto. No Meteor. No globalThis. No Mongo.
// The Meteor wrapper (koad:io-accounts/server/auth.js) adds the setInterval
// nonce sweep, globalThis attach, and package export.
//
// API surface:
//   challenge()                               → { nonce, expires }
//   respond(nonce, privateKey)                → Promise<{ nonce, signature }>
//   verify(nonce, signatureB64url, pubKeyB64url) → Promise<{ valid, error }>
//   pendingNonceCount()                       → number
//
// Challenge message format (wire-protocol — do not change):
//   UTF-8 "koad-io:auth:v1:<nonce>"
//
// @noble/ed25519 is already vendored in deps.js. Lazily imported so this module
// loads synchronously even though sign/verify are async.

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const crypto = _require('crypto');

// Nonce TTL in milliseconds. Challenges expire after 5 minutes.
const NONCE_TTL_MS = 5 * 60 * 1000;

// In-memory nonce store. Key = nonce hex string, value = expiry timestamp (ms).
// Single-use — consumed (deleted) on successful verify.
const pendingNonces = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

let _ed;
async function ensureEd() {
  if (!_ed) {
    _ed = await import('@noble/ed25519');
  }
  return _ed;
}

/**
 * Decode a base64url (no-padding) string to a Uint8Array.
 */
function fromBase64Url(str) {
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

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Issue a fresh nonce challenge.
 * The nonce is stored in-memory with a TTL. Clients must sign it within
 * NONCE_TTL_MS milliseconds.
 *
 * @returns {{ nonce: string, expires: number }} — nonce in hex, expiry as Unix ms timestamp
 */
function challenge() {
  const nonce = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + NONCE_TTL_MS;
  pendingNonces.set(nonce, expires);
  return { nonce, expires };
}

/**
 * Sign a nonce challenge with the given Ed25519 private key (seed).
 * Called client-side (or by an entity daemon acting on behalf of the entity).
 *
 * @param {string}     nonce      — hex nonce string from challenge()
 * @param {Uint8Array} privateKey — 32-byte Ed25519 seed
 * @returns {Promise<{ nonce: string, signature: string }>} — signature in base64url
 */
async function respond(nonce, privateKey) {
  const ed = await ensureEd();
  const message = challengeMessage(nonce);
  const sigBytes = await ed.signAsync(message, privateKey);
  return { nonce, signature: toBase64Url(sigBytes) };
}

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
async function verify(nonce, signatureB64, pubKeyB64) {
  const ed = await ensureEd();

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
    ok = await ed.verifyAsync(sigBytes, message, pubKeyBytes);
  } catch (e) {
    return { valid: false, error: `auth: signature verification error: ${e.message}` };
  }

  if (!ok) {
    return { valid: false, error: 'auth: signature verification failed' };
  }

  // Consume nonce — prevents replay
  pendingNonces.delete(nonce);

  return { valid: true, error: null };
}

/**
 * Return the count of currently pending (non-expired) nonces.
 * Useful for health checks and monitoring.
 *
 * @returns {number}
 */
function pendingNonceCount() {
  const now = Date.now();
  let count = 0;
  for (const expires of pendingNonces.values()) {
    if (expires > now) count++;
  }
  return count;
}

// ── Internal nonce store (for wrapper use only) ───────────────────────────────

/**
 * Sweep expired nonces from the in-memory store.
 * Called by the Meteor wrapper via setInterval. Safe to call from plain Node too.
 */
function sweepExpiredNonces() {
  const now = Date.now();
  for (const [nonce, expires] of pendingNonces.entries()) {
    if (expires <= now) {
      pendingNonces.delete(nonce);
    }
  }
}

export { challenge, respond, verify, pendingNonceCount, sweepExpiredNonces };
