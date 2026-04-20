// index.js — Core koad object (ESM)
//
// Creates and exports the koad object. This is the canonical source for the
// koad global — the Meteor package koad:io-core will import from here in
// phase 2 instead of constructing it inline in both/initial.js.
//
// In Meteor apps, `koad` is a global. Outside Meteor (CLI tools, daemon,
// tests), consumers import it:
//
//   import { koad } from '@koad-io/node';
//   // or
//   const { koad } = require('@koad-io/node');  // via index.cjs
//
// The koad object shape mirrors both/initial.js exactly so phase 2 wiring
// is a drop-in replacement.

import { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed } from './deps.js';
import { createIdentityShape } from './identity.js';

// ── Core koad object ─────────────────────────────────────────────────────────

const koad = {
  maintenance: true,
  lighthouse: null,
  extension: null,
  instance: null,
  gateway: null,
  session: null,
  internals: 'unset',
  identity: createIdentityShape(),
  storage: {},
  library: {},
  format: {
    timestamp: function(d, s) {
      if (!d) d = new Date();
      if (!s) s = ':';
      const date = new Date(d);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}${s}${month}${s}${day}${s}${hours}${s}${minutes}${s}${seconds}`;
    },
  },
  seeders: [],
  emitters: [],
  trackers: [],
  // ── Shared crypto/IPFS deps ──────────────────────────────────────────────
  // Mirrors the koad.deps shape from packages/core/client/deps.js.
  // Consumers can use koad.deps.* or import named symbols from ./deps.js.
  deps: {
    dagJsonEncode,
    dagJsonDecode,
    CID,
    sha256,
    base64,
    ed,
  },
};

export { koad };
export { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed } from './deps.js';
export { createIdentityShape, createIdentity } from './identity.js';
