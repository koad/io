// deps.js — Shared crypto/IPFS dependency hub for koad:io-core
//
// Centralizes the ESM-only npm deps used across sovereign-profiles, ipfs-client,
// and activity-stream. Static imports allow Meteor's bundler to resolve and
// bundle these packages at build time (requires patch-npm-exports.js to have
// run so that each package has a `main` field Meteor can follow).
//
// Consumers read from koad.deps:
//   koad.deps.dagJsonEncode(obj) → Uint8Array
//   koad.deps.dagJsonDecode(bytes) → any
//   koad.deps.CID                 — multiformats CID class
//   koad.deps.sha256              — multiformats sha2-256 hasher
//   koad.deps.base64              — multiformats base64 codec
//   koad.deps.ed                  — @noble/ed25519 namespace
//
// Also exported as named Meteor package symbols (see package.js api.export).

import { encode as dagJsonEncode, decode as dagJsonDecode } from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { base64 } from 'multiformats/bases/base64';
import * as ed from '@noble/ed25519';

// Attach to koad global so consumers can use koad.deps.* at runtime
// without a direct import (cross-package Meteor globals pattern).
if (typeof koad !== 'undefined') {
  koad.deps = koad.deps || {};
  Object.assign(koad.deps, {
    dagJsonEncode,
    dagJsonDecode,
    CID,
    sha256,
    base64,
    ed,
  });
}

export { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed };
