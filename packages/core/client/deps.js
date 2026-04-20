// deps.js — Shared crypto/IPFS dependency hub for koad:io-core (client)
//
// Phase 2: Re-exports from @koad-io/node/deps (the standalone Node.js module at
// ~/.koad-io/modules/node/) instead of importing directly from @ipld/dag-json,
// multiformats, and @noble/ed25519. Those three packages are no longer in
// Npm.depends(); they live in the node module's own node_modules/ and are
// accessed via the @koad-io/node package declared in daemon/src/package.json.
//
// Public API unchanged — koad.deps.* and named exports are the same.
//   koad.deps.dagJsonEncode(obj) → Uint8Array
//   koad.deps.dagJsonDecode(bytes) → any
//   koad.deps.CID                 — multiformats CID class
//   koad.deps.sha256              — multiformats sha2-256 hasher
//   koad.deps.base64              — multiformats base64 codec
//   koad.deps.ed                  — @noble/ed25519 namespace

import { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed } from '@koad-io/node/deps';

// Attach to koad global so consumers can use koad.deps.* at runtime
// without a direct import (cross-package Meteor globals pattern).
// Initialize koad if missing — core can load before `koad:io` defines the
// global, so we must not depend on order of evaluation.
globalThis.koad = globalThis.koad || {};
koad.deps = koad.deps || {};
Object.assign(koad.deps, {
  dagJsonEncode,
  dagJsonDecode,
  CID,
  sha256,
  base64,
  ed,
});

export { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed };
