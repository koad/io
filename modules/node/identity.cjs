// identity.cjs — CJS entry for @koad-io/node/identity
//
// Pure JS, no ESM deps — fully synchronous.

function createIdentityShape() {
  return {
    type: 'kbpgp',
    fingerprint: null,
    userid: null,
    publicKey: null,
  };
}

function createIdentity({ type, userid, fingerprint = null, publicKey = null } = {}) {
  if (!type) throw new Error('[koad/identity] type is required');
  if (!userid) throw new Error('[koad/identity] userid is required');
  return { type, userid, fingerprint, publicKey };
}

module.exports = { createIdentityShape, createIdentity };
