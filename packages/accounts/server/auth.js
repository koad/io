// server/auth.js — SovereignAuth Meteor wrapper
//
// Wraps the pure @koad-io/node auth primitives into the SovereignAuth object
// surface expected by Meteor consumers (sovereign-auth.js on kingofalldata.com
// and any other storefront that imports from meteor/koad:io-accounts).
//
// Meteor-specific additions vs the pure module:
//   - Meteor.setInterval nonce sweep (60s)
//   - globalThis.SovereignAuth attach for cross-file access
//   - Meteor package export (api.export in package.js)
//
// The core challenge/respond/verify logic lives in @koad-io/node auth.js.
// verifyFromDir remains in koad:io-sovereign-profiles as a keystore wrapper.

import {
  challenge,
  respond,
  verify,
  pendingNonceCount,
  sweepExpiredNonces,
} from '@koad-io/node/auth';

const SovereignAuth = {
  challenge,
  respond,
  verify,
  pendingNonceCount,
};

// Sweep expired nonces every 60 seconds
Meteor.setInterval(function() {
  sweepExpiredNonces();
}, 60 * 1000);

// Attach to globalThis for cross-file access
globalThis.SovereignAuth = SovereignAuth;

export { SovereignAuth };
