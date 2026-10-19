// koad-deps-entry.js — esbuild entry for the ESM-only koad.deps surface
//
// Produces: koad-deps.bundle.min.js (IIFE, sets globalThis.__koadNpmDeps)
//
// Build command (run from ~/.koad-io/modules/node):
//   npx esbuild browser/koad-deps-entry.js --bundle --minify --format=iife \
//     --outfile=browser/koad-deps.bundle.min.js
//
// WHY this exists: @ipld/dag-json and multiformats are ESM-only packages that
// Meteor 3.4's client bundler cannot serve from a package's Npm.depends() or
// from app code (verified 2026-08-25, flight 5 — module.link fails at runtime
// in both paths). The ecosystem's proven pattern for browser-only deps is the
// pre-built bundle served from app public/ (see kbpgp.bundle.min.js). This
// bundle is the same pattern for the ESM-only deps.
//
// Consumers: apps copy koad-deps.bundle.min.js into their public/ and add
//   <script src="/koad-deps.bundle.min.js"></script>
// to their head. koad:io-core's client/deps.js reads globalThis.__koadNpmDeps
// and wires koad.deps.{ed,dagJsonEncode,dagJsonDecode,CID,sha256,base64}.

import * as ed from '@noble/ed25519';
import { encode as dagJsonEncode, decode as dagJsonDecode } from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { base64 } from 'multiformats/bases/base64';

globalThis.__koadNpmDeps = { ed, dagJsonEncode, dagJsonDecode, CID, sha256, base64 };
