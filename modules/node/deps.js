// deps.js — Shared crypto/IPFS dependency hub for koad:io (ESM)
//
// Centralizes the ESM-only npm deps that were previously hacked into the
// Meteor package via patch-npm-exports.js. This module is the canonical
// source; the Meteor package will import from here in phase 2.
//
// Consumers:
//   import { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed } from '@koad-io/node/deps';
//
// Or via the koad object:
//   import { koad } from '@koad-io/node';
//   koad.deps.dagJsonEncode(obj)  → Uint8Array
//   koad.deps.dagJsonDecode(bytes) → any
//   koad.deps.CID                  — multiformats CID class
//   koad.deps.sha256               — multiformats sha2-256 hasher
//   koad.deps.base64               — multiformats base64 codec
//   koad.deps.ed                   — @noble/ed25519 namespace

import { encode as dagJsonEncode, decode as dagJsonDecode } from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { base64 } from 'multiformats/bases/base64';
import * as ed from '@noble/ed25519';

export { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed };
