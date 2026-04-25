// identity.js — Identity primitives for the koad object (ESM)
//
// Extracted from packages/core/client/identity.js and server/identity.js.
// This module provides the base identity shape. Runtime environments (Meteor
// server, CLI, daemon) layer their own key-loading logic on top.
//
// Server-side kbpgp key operations (sign/verify) are now in ./pgp.js, exposed as
// koad.deps.pgp per VESTA-SPEC-148. Both Node and Meteor contexts use the same
// shared module — no runtime-specific code paths required.
//
// What IS here:
//   - The identity shape that koad.identity is initialized to
//   - Helper constructors for building identity objects

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
