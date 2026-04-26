// client/identity.js — Wire the koad.identity substrate on the client.
//
// Implements VESTA-SPEC-149 v1.0.
//
// The createKoadIdentity factory was loaded by both/identity-factory.js
// (via api.addFiles in package.js, after both/initial.js).
//
// On the client, sign/verify delegate to koad.deps.pgp which is lazy-loaded
// by client/deps.js (ESM mainModule). koad.deps.pgp is available after the
// ESM import graph resolves on first use — this happens automatically.
//
// Ceremony methods (create, importMnemonic) throw "not available in browser"
// on the client (they require Node-only kbpgp internals via ceremony.js).
//
// The old client/identity.js had:
//   - "not available" stubs for sign, verify, encrypt, decrypt
//   - setServerIdentity() — no equivalent in new substrate; callers should
//     use koad.identity.load() instead (Flight E migration target)
//
// NOTE: koad.identity.isLoaded will be false initially on the client.
// No key is loaded until load() is called with a persisted device leaf.
// This is correct per SPEC-149 — the client does not generate keys.

koad.identity = createKoadIdentity();

// Note for Flight E: the old setServerIdentity(identityInfo) method set
// fingerprint, userid, and publicKey on the identity object from server data.
// The new API uses load() for this purpose. Any Blaze templates or Meteor
// methods calling koad.identity.setServerIdentity() need migration to load().

console.log('[koad.identity] Client identity substrate loaded. isLoaded:', koad.identity.isLoaded);
