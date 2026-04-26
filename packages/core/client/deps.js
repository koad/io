// deps.js — koad:io-core client dependency hub
//
// Browser-side koad.deps.* surface. Only deps actually consumed by client
// code are imported here. IPLD content-addressing primitives
// (@ipld/dag-json, multiformats CID/sha256/base64) are server-side only —
// they're never invoked from browser code today, and their exports-field-only
// ESM shape was failing Meteor's client resolver. Server still has them via
// ~/.koad-io/modules/node/deps.js. If browser-side IPFS pinning or
// sigchain-render-via-CID is ever needed, they come back here with proper
// resolver setup at that point.
//
// koad.deps.pgp is wired by client/pgp.js (lazy-loads kbpgp browser bundle).

import * as ed from '@noble/ed25519';
import { clearsign, verify } from './pgp.js';

globalThis.koad = globalThis.koad || {};
koad.deps = koad.deps || {};
Object.assign(koad.deps, {
  ed,
  pgp: { clearsign, verify },
});

export { ed };
