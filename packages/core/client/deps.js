// deps.js — Shared crypto/IPFS dependency hub for koad:io-core (client)
//
// Centralizes ESM-only npm deps. Requires patch-npm-exports.js to have run
// so each package has a `main` field Meteor's CJS resolver can follow.
//
// The canonical non-Meteor version of these deps lives in
// ~/.koad-io/modules/node/deps.js for CLI tools and other runtimes.
//
// koad.deps.pgp is wired by client/pgp.js (lazy-loads kbpgp browser bundle on first call).

import { encode as dagJsonEncode, decode as dagJsonDecode } from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { base64 } from 'multiformats/bases/base64';
import * as ed from '@noble/ed25519';
import { clearsign, verify } from './pgp.js';

globalThis.koad = globalThis.koad || {};
koad.deps = koad.deps || {};
Object.assign(koad.deps, {
  dagJsonEncode,
  dagJsonDecode,
  CID,
  sha256,
  base64,
  ed,
  pgp: { clearsign, verify },
});

export { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed };
