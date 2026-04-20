// identity.js — Identity primitives for the koad object (ESM)
//
// Extracted from packages/core/client/identity.js and server/identity.js.
// This module provides the base identity shape. Runtime environments (Meteor
// server, CLI, daemon) layer their own key-loading logic on top.
//
// The server-side kbpgp key operations (sign/verify/encrypt/decrypt) are NOT
// included here — kbpgp is a Meteor-era dep that won't run in plain Node
// without the Meteor runtime. Those remain in packages/core/server/identity.js
// for now. Phase 2 will introduce an ed25519-based identity layer here using
// @noble/ed25519 (already a dep).
//
// What IS here:
//   - The identity shape that koad.identity is initialized to
//   - Helper constructors for building identity objects
//   - Placeholder stubs for sign/verify using @noble/ed25519 (future)

/**
 * Create the base identity shape that koad.identity starts as.
 * Matches the shape expected by both client and server Meteor code.
 */
export function createIdentityShape() {
  return {
    type: 'kbpgp',
    fingerprint: null,
    userid: null,
    publicKey: null,
  };
}

/**
 * Create a minimal identity record from known fields.
 * Used when constructing identity from stored key material.
 *
 * @param {object} opts
 * @param {string} opts.type      - Key type ('kbpgp' | 'ed25519')
 * @param {string} opts.userid    - Entity name or identifier
 * @param {string} [opts.fingerprint] - Key fingerprint (hex)
 * @param {string} [opts.publicKey]   - Armored or hex public key
 * @returns {object}
 */
export function createIdentity({ type, userid, fingerprint = null, publicKey = null } = {}) {
  if (!type) throw new Error('[koad/identity] type is required');
  if (!userid) throw new Error('[koad/identity] userid is required');
  return { type, userid, fingerprint, publicKey };
}
